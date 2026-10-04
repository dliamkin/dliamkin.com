import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Full normalized document text lives ONLY here - in a separate, private
// snapshot repo - retained solely so tomorrow's text has something to diff
// against. It is never published and never served. The public repo carries
// only hashes, summaries, and <=25-word excerpts.
//
// Layout inside the snapshot repo:
//   <service_id>/<doc-slug>/latest.txt
//   <service_id>/<doc-slug>/history/<YYYY-MM-DD>.txt   (rolling last 10)
//
// CI clones the repo with the fine-grained TOS_SNAPSHOT_PAT before the run
// and passes its working dir via TOS_SNAPSHOT_DIR; locally, point
// TOS_SNAPSHOT_DIR at any directory (a scratch dir for dry runs).

export const HISTORY_KEEP = 10;

export function snapshotDir(): string {
	const dir = process.env.TOS_SNAPSHOT_DIR;
	if (!dir) {
		throw new Error(
			"TOS_SNAPSHOT_DIR is not set - point it at a clone of the private snapshot repo (or a scratch dir for dry runs).",
		);
	}
	return path.resolve(dir);
}

export function docSlug(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function docDir(baseDir: string, serviceId: string, label: string): string {
	return path.join(baseDir, serviceId, docSlug(label));
}

export async function readLatestSnapshot(
	baseDir: string,
	serviceId: string,
	label: string,
): Promise<string | null> {
	try {
		return await readFile(path.join(docDir(baseDir, serviceId, label), "latest.txt"), "utf8");
	} catch {
		return null; // first observation of this document
	}
}

export async function writeSnapshot(
	baseDir: string,
	serviceId: string,
	label: string,
	text: string,
	dateIso: string,
): Promise<void> {
	const dir = docDir(baseDir, serviceId, label);
	const historyDir = path.join(dir, "history");
	await mkdir(historyDir, { recursive: true });
	await writeFile(path.join(dir, "latest.txt"), text);
	await writeFile(path.join(historyDir, `${dateIso.slice(0, 10)}.txt`), text);

	// Rolling retention: dated filenames sort chronologically.
	const entries = (await readdir(historyDir)).filter((f) => f.endsWith(".txt")).sort();
	for (const stale of entries.slice(0, Math.max(0, entries.length - HISTORY_KEEP))) {
		await rm(path.join(historyDir, stale));
	}
}

// Commit + push the snapshot repo. Called once per run, after all documents
// are processed, and BEFORE the public-side commit: if this push fails the
// public entries are withheld and tonight's changes simply re-detect
// tomorrow - the record can lag but never lie.
export async function commitAndPushSnapshots(baseDir: string, dateIso: string): Promise<boolean> {
	const git = (...args: string[]) => run("git", ["-C", baseDir, ...args]);
	if (process.env.GITHUB_ACTIONS) {
		await git("config", "user.name", "tos-watch-bot");
		await git("config", "user.email", "actions@github.com");
	}
	await git("add", "-A");
	const { stdout } = await git("status", "--porcelain");
	if (!stdout.trim()) {
		console.log("Snapshots: nothing to commit.");
		return true;
	}
	await git("commit", "-m", `snapshots ${dateIso.slice(0, 10)}`);
	await git("push");
	console.log("Snapshots committed and pushed.");
	return true;
}
