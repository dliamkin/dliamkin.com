import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	EVAL_HISTORY_CASE_RUNS,
	EVAL_HISTORY_MAX_ENTRIES,
	type EvalProjectId,
	type EvalHistoryEntry,
	type EvalReport,
	type SuiteResult,
} from "../../src/lib/evals";

const run = promisify(execFile);

// Served as static files by the site (same convention as public/site-health),
// so the dashboard and badges need no API and no key.
const OUT_DIR = path.resolve("public/eval-results");
const LATEST = path.join(OUT_DIR, "latest.json");
const HISTORY = path.join(OUT_DIR, "history.json");

export async function loadPreviousReport(): Promise<EvalReport | null> {
	try {
		return JSON.parse(await readFile(LATEST, "utf8")) as EvalReport;
	} catch {
		return null; // first-ever run, or an unreadable report - baseline mode
	}
}

// A suite whose pass count dropped versus the previous report, with the case
// ids that newly flipped from pass to fail (the issue fingerprint input).
export interface SuiteRegression {
	project_id: EvalProjectId;
	project_label: string;
	previous_pass_count: number;
	pass_count: number;
	total: number;
	newly_failing_case_ids: string[];
}

export function detectRegressions(
	previous: EvalReport | null,
	suites: SuiteResult[],
): SuiteRegression[] {
	if (!previous) return [];
	const regressions: SuiteRegression[] = [];
	for (const suite of suites) {
		const before = previous.suites.find((s) => s.project_id === suite.project_id);
		if (!before || suite.pass_count >= before.pass_count) continue;
		const passedBefore = new Set(
			before.cases.filter((c) => c.passed).map((c) => c.case_id),
		);
		regressions.push({
			project_id: suite.project_id,
			project_label: suite.project_label,
			previous_pass_count: before.pass_count,
			pass_count: suite.pass_count,
			total: suite.total,
			newly_failing_case_ids: suite.cases
				.filter((c) => !c.passed && passedBefore.has(c.case_id))
				.map((c) => c.case_id)
				.sort(),
		});
	}
	return regressions;
}

function toHistoryEntry(report: EvalReport): EvalHistoryEntry {
	return {
		run_at: report.run_at,
		trigger: report.trigger,
		overall_pass_rate: report.overall_pass_rate,
		suites: report.suites.map((suite) => ({
			project_id: suite.project_id,
			pass_count: suite.pass_count,
			total: suite.total,
			model: suite.model,
			prompt_hash: suite.prompt_hash,
			cases: Object.fromEntries(suite.cases.map((c) => [c.case_id, c.passed])),
		})),
	};
}

export async function writeReport(report: EvalReport): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });

	let history: EvalHistoryEntry[] = [];
	try {
		history = JSON.parse(await readFile(HISTORY, "utf8")) as EvalHistoryEntry[];
	} catch {
		// no history yet
	}
	history.push(toHistoryEntry(report));
	if (history.length > EVAL_HISTORY_MAX_ENTRIES) {
		history = history.slice(-EVAL_HISTORY_MAX_ENTRIES);
	}
	// Per-case booleans (the dashboard's flakiness dots) are kept only on the
	// newest EVAL_HISTORY_CASE_RUNS entries; older entries keep counts and
	// hashes only, so the file stays small at the 90-entry cap.
	const caseCutoff = history.length - EVAL_HISTORY_CASE_RUNS;
	history = history.map((entry, index) =>
		index < caseCutoff
			? { ...entry, suites: entry.suites.map(({ cases: _cases, ...rest }) => rest) }
			: entry,
	);

	await writeFile(LATEST, JSON.stringify(report, null, 2) + "\n");
	await writeFile(HISTORY, JSON.stringify(history, null, 2) + "\n");
	console.log(`Wrote ${LATEST} and ${HISTORY}`);
}

// Commits the results back to the repo with the default GITHUB_TOKEN (pushed
// via actions/checkout's persisted credentials). [skip ci] keeps Cloudflare
// Workers Builds from redeploying for a data-only change. This commit cannot
// retrigger the eval workflow: evals.yml's push trigger is path-filtered to
// pipeline/prompt/eval source, which public/eval-results/ is not part of -
// and [skip ci] suppresses the push event besides.
export async function commitReport(report: EvalReport): Promise<void> {
	const date = report.run_at.slice(0, 10);
	const message = `chore(evals): eval run ${date} [skip ci]`;

	if (process.env.GITHUB_ACTIONS) {
		await run("git", ["config", "user.name", "evals-bot"]);
		await run("git", ["config", "user.email", "actions@github.com"]);
	}
	await run("git", ["add", "public/eval-results"]);
	const { stdout } = await run("git", ["status", "--porcelain", "public/eval-results"]);
	if (!stdout.trim()) {
		console.log("No result changes to commit.");
		return;
	}
	await run("git", ["commit", "-m", message]);
	// The suite takes minutes; rebase in case anything landed on main meanwhile.
	await run("git", ["pull", "--rebase"]);
	await run("git", ["push"]);
	console.log(`Committed and pushed: ${message}`);
}
