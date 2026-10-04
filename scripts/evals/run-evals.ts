// Eval runner: executes every project's eval suite through the same
// src/lib/pipelines/ functions production uses, prints honest per-case
// detail, persists public results, and files regression issues in CI.
//
// Usage:
//   npm run eval                         all suites; writes + commits results
//   npm run eval -- --no-commit          all suites; writes results, no git commit
//   npm run eval -- --project lease-diff    one suite; prints only, never persists
//   npm run eval -- --json               machine-readable report on stdout
//
// Needs ANTHROPIC_API_KEY in the environment (GitHub Actions secrets in CI,
// local env for manual runs). Exits 1 when any check fails - after results
// are persisted, so a red run is still a published run.
import Anthropic from "@anthropic-ai/sdk";
import {
	EVAL_PROJECT_IDS,
	type EvalProjectId,
	type EvalReport,
	type EvalTrigger,
	type SuiteResult,
} from "../../src/lib/evals";
import type { RunnableSuite } from "./harness";
import { commentOnRecoveries, fileRegressionIssues } from "./issues";
import {
	commitReport,
	detectRegressions,
	loadPreviousReport,
	writeReport,
} from "./persist";
import { dryRunOracleSuite } from "./suites/dry-run-oracle";
import { leaseDiffSuite } from "./suites/lease-diff";
import { noiseTranslatorSuite } from "./suites/noise-translator";
import { noteStructurerSuite } from "./suites/note-structurer";
import { paperworkSuite } from "./suites/paperwork-to-calendar";
import { screenshotSuite } from "./suites/screenshot-to-primevue";
import { tosWatchSuite } from "./suites/tos-watch";
import { upgradePlannerSuite } from "./suites/upgrade-planner";

const ALL_SUITES: RunnableSuite[] = [
	noteStructurerSuite,
	leaseDiffSuite,
	screenshotSuite,
	paperworkSuite,
	upgradePlannerSuite,
	tosWatchSuite,
	dryRunOracleSuite,
	noiseTranslatorSuite,
];

function parseArgs(argv: string[]): { project: EvalProjectId | null; json: boolean; noCommit: boolean } {
	let project: EvalProjectId | null = null;
	const projectIndex = argv.indexOf("--project");
	if (projectIndex !== -1) {
		const value = argv[projectIndex + 1];
		if (!value || !(EVAL_PROJECT_IDS as readonly string[]).includes(value)) {
			console.error(
				`--project must be one of: ${EVAL_PROJECT_IDS.join(", ")} (got "${value ?? ""}")`,
			);
			process.exit(2);
		}
		project = value as EvalProjectId;
	}
	return { project, json: argv.includes("--json"), noCommit: argv.includes("--no-commit") };
}

function detectTrigger(): EvalTrigger {
	switch (process.env.GITHUB_EVENT_NAME) {
		case "schedule":
			return "schedule";
		case "push":
			return "push";
		default:
			return "manual";
	}
}

function printSuite(suite: SuiteResult): void {
	console.log(`\n=== ${suite.project_label} (${suite.model}, prompt ${suite.prompt_hash}) ===`);
	for (const caseResult of suite.cases) {
		const mark = caseResult.passed ? "✓" : "✗";
		console.log(
			`  ${mark} ${caseResult.case_id} (${(caseResult.duration_ms / 1000).toFixed(1)}s)`,
		);
		if (caseResult.error) {
			console.log(`      pipeline error: ${caseResult.error}`);
		}
		for (const check of caseResult.checks.filter((c) => !c.passed)) {
			console.log(`      ✗ ${check.name}`);
			console.log(`        expected: ${check.expected}`);
			console.log(`        actual:   ${check.actual}`);
		}
	}
	console.log(`  Suite: ${suite.pass_count}/${suite.total} passing`);
}

async function main(): Promise<void> {
	const { project, json, noCommit } = parseArgs(process.argv.slice(2));
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("ANTHROPIC_API_KEY is not set - cannot run evals.");
		process.exit(2);
	}

	const suites = project ? ALL_SUITES.filter((s) => s.project_id === project) : ALL_SUITES;
	const client = new Anthropic();

	// Suites run sequentially (each already runs its cases with small internal
	// concurrency) - keeps the global request rate polite.
	const results: SuiteResult[] = [];
	for (const suite of suites) {
		if (!json) console.log(`Running ${suite.project_label} (${suite.case_ids.length} cases)...`);
		const result = await suite.run(client);
		results.push(result);
		if (!json) printSuite(result);
	}

	const previous = await loadPreviousReport();
	const regressions = detectRegressions(previous, results);
	const totalCases = results.reduce((sum, s) => sum + s.total, 0);
	const totalPassed = results.reduce((sum, s) => sum + s.pass_count, 0);
	const report: EvalReport = {
		run_at: new Date().toISOString(),
		trigger: detectTrigger(),
		suites: results,
		overall_pass_rate: totalCases === 0 ? 0 : Math.round((totalPassed / totalCases) * 10000) / 10000,
		regression_from_previous: regressions.length > 0,
		regression_detail:
			regressions.length > 0
				? regressions
						.map(
							(r) =>
								`${r.project_id}: ${r.previous_pass_count}/${r.total} → ${r.pass_count}/${r.total}`,
						)
						.join("; ")
				: null,
	};

	if (json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(`\nOverall: ${totalPassed}/${totalCases} passing`);
		if (report.regression_detail) console.log(`REGRESSION: ${report.regression_detail}`);
	}

	// Partial runs are for local iteration only - persisting one suite's
	// results would publish a misleading latest.json.
	if (!project) {
		await writeReport(report);
		if (!noCommit) await commitReport(report);
		if (process.env.GITHUB_TOKEN) {
			// Issue management is best-effort: a GitHub API hiccup shouldn't
			// mask the eval outcome itself.
			try {
				await fileRegressionIssues(report, regressions);
				await commentOnRecoveries(report);
			} catch (error) {
				console.error("Issue management failed:", error);
			}
		}
	}

	process.exitCode = totalPassed === totalCases ? 0 : 1;
}

await main();
