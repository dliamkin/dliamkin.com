import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	CHANGELOG_MAX_ENTRIES,
	type ChangelogEntry,
	type TosWatchState,
} from "../../src/lib/tos-watch";

const run = promisify(execFile);

// Public-side persistence, following the site-health convention: JSON files
// under public/ served as static assets (the page needs no API and no key),
// committed back with [skip ci].

const OUT_DIR = path.resolve("public/tos-watch");
const STATE = path.join(OUT_DIR, "state.json");
const CHANGELOG = path.join(OUT_DIR, "changelog.json");
const ARCHIVE = path.join(OUT_DIR, "changelog-archive.json");
const FEED = path.join(OUT_DIR, "feed.xml");

export async function loadState(): Promise<TosWatchState | null> {
	try {
		return JSON.parse(await readFile(STATE, "utf8")) as TosWatchState;
	} catch {
		return null; // first-ever run - baseline mode
	}
}

export async function saveState(state: TosWatchState): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(STATE, JSON.stringify(state, null, 2) + "\n");
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
	try {
		return JSON.parse(await readFile(CHANGELOG, "utf8")) as ChangelogEntry[];
	} catch {
		return [];
	}
}

// Newest first; entries beyond the cap overflow into the archive so the
// public record stays complete without the main file growing unbounded.
export function splitAtCap(
	newEntries: ChangelogEntry[],
	current: ChangelogEntry[],
	cap: number = CHANGELOG_MAX_ENTRIES,
): { kept: ChangelogEntry[]; overflow: ChangelogEntry[] } {
	const merged = [...newEntries, ...current];
	return { kept: merged.slice(0, cap), overflow: merged.slice(cap) };
}

export async function prependChangelogEntries(entries: ChangelogEntry[]): Promise<ChangelogEntry[]> {
	await mkdir(OUT_DIR, { recursive: true });
	const { kept: updated, overflow } = splitAtCap(entries, await loadChangelog());

	if (overflow.length > 0) {
		let archive: ChangelogEntry[] = [];
		try {
			archive = JSON.parse(await readFile(ARCHIVE, "utf8")) as ChangelogEntry[];
		} catch {
			// no archive yet
		}
		await writeFile(ARCHIVE, JSON.stringify([...overflow, ...archive], null, 2) + "\n");
	}

	await writeFile(CHANGELOG, JSON.stringify(updated, null, 2) + "\n");
	return updated;
}

export async function saveFeed(xml: string): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(FEED, xml);
}

// Commits the public artifacts with the default GITHUB_TOKEN. [skip ci]
// keeps Cloudflare Workers Builds from redeploying for a data-only change,
// and tos-watch.yml has no push trigger, so this commit cannot retrigger
// the watchdog itself.
export async function commitPublicFiles(dateIso: string): Promise<void> {
	const date = dateIso.slice(0, 10);
	const message = `chore(tos-watch): nightly check ${date} [skip ci]`;

	if (process.env.GITHUB_ACTIONS) {
		await run("git", ["config", "user.name", "tos-watch-bot"]);
		await run("git", ["config", "user.email", "actions@github.com"]);
	}
	await run("git", ["add", "public/tos-watch"]);
	const { stdout } = await run("git", ["status", "--porcelain", "public/tos-watch"]);
	if (!stdout.trim()) {
		console.log("No public tos-watch changes to commit.");
		return;
	}
	await run("git", ["commit", "-m", message]);
	// The check takes minutes; rebase in case anything landed on main meanwhile.
	await run("git", ["pull", "--rebase"]);
	await run("git", ["push"]);
	console.log(`Committed and pushed: ${message}`);
}
