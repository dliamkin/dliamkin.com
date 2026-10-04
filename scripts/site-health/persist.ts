import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	HISTORY_MAX_ENTRIES,
	type HealthHistoryEntry,
	type HealthReport,
} from "../../src/lib/site-health";

const run = promisify(execFile);

// Served as static files by the site, so the widget needs no API and no key.
const OUT_DIR = path.resolve("public/site-health");
const LATEST = path.join(OUT_DIR, "latest.json");
const HISTORY = path.join(OUT_DIR, "history.json");

export async function loadPreviousReport(): Promise<HealthReport | null> {
	try {
		return JSON.parse(await readFile(LATEST, "utf8")) as HealthReport;
	} catch {
		return null; // first-ever run, or an unreadable report - baseline mode
	}
}

function averageScores(report: HealthReport): HealthHistoryEntry["scores"] {
	const pages = report.pages;
	if (pages.length === 0) {
		return { performance: 0, accessibility: 0, best_practices: 0, seo: 0 };
	}
	const avg = (pick: (p: (typeof pages)[number]) => number) =>
		Math.round(pages.reduce((sum, p) => sum + pick(p), 0) / pages.length);
	return {
		performance: avg((p) => p.lighthouse.performance),
		accessibility: avg((p) => p.lighthouse.accessibility),
		best_practices: avg((p) => p.lighthouse.best_practices),
		seo: avg((p) => p.lighthouse.seo),
	};
}

export async function writeReport(report: HealthReport): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });

	let history: HealthHistoryEntry[] = [];
	try {
		history = JSON.parse(await readFile(HISTORY, "utf8")) as HealthHistoryEntry[];
	} catch {
		// no history yet
	}
	history.push({
		audited_at: report.audited_at,
		status: report.status,
		scores: averageScores(report),
	});
	if (history.length > HISTORY_MAX_ENTRIES) {
		history = history.slice(-HISTORY_MAX_ENTRIES);
	}

	await writeFile(LATEST, JSON.stringify(report, null, 2) + "\n");
	await writeFile(HISTORY, JSON.stringify(history, null, 2) + "\n");
	console.log(`Wrote ${LATEST} and ${HISTORY}`);
}

// Commits the report back to the repo with the default GITHUB_TOKEN (pushed
// via actions/checkout's persisted credentials). [skip ci] keeps Cloudflare
// Workers Builds from redeploying for a data-only change. This commit cannot
// retrigger the audit itself: site-health.yml has no push trigger - schedule
// and workflow_dispatch only.
export async function commitReport(report: HealthReport): Promise<void> {
	const date = report.audited_at.slice(0, 10);
	const message = `chore(site-health): nightly audit ${date} [skip ci]`;

	if (process.env.GITHUB_ACTIONS) {
		await run("git", ["config", "user.name", "site-health-bot"]);
		await run("git", ["config", "user.email", "actions@github.com"]);
	}
	await run("git", ["add", "public/site-health"]);
	const { stdout } = await run("git", ["status", "--porcelain", "public/site-health"]);
	if (!stdout.trim()) {
		console.log("No report changes to commit.");
		return;
	}
	await run("git", ["commit", "-m", message]);
	// The audit takes minutes; rebase in case anything landed on main meanwhile.
	await run("git", ["pull", "--rebase"]);
	await run("git", ["push"]);
	console.log(`Committed and pushed: ${message}`);
}
