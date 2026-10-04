import { AUDIT_PAGES, type HealthReport } from "../../src/lib/site-health";
import { analyze } from "./analyze";
import { runLighthouse, type LighthouseResult } from "./lighthouse";
import { captureScreenshots, type Screenshot } from "./screenshots";
import { commitReport, loadPreviousReport, writeReport } from "./persist";
import { fileOrUpdateIssue } from "./issues";

// Nightly site-health audit orchestrator. Degrades gracefully: if Lighthouse,
// screenshots, or the model call fail, it still writes a status:"audit_error"
// report (so the widget shows "audit skipped" instead of stale data), files
// no issue, and exits 0 - the workflow run stays green.
//
// Flags: --no-issue (skip GitHub issue filing) and --no-commit (skip the git
// commit/push) for safe local runs via `npm run audit:local`.

const args = process.argv.slice(2);
const noIssue = args.includes("--no-issue");
const noCommit = args.includes("--no-commit");

function errorReport(reason: string, lighthouseResults: LighthouseResult[]): HealthReport {
	return {
		audited_at: new Date().toISOString(),
		status: "audit_error",
		summary: "Tonight's automated audit could not complete; no findings were recorded.",
		pages: lighthouseResults.map((r) => ({
			path: r.path,
			lighthouse: r.lighthouse,
			visual_findings: [],
			visual_fingerprint: "",
		})),
		score_deltas: [],
		top_fix: null,
		should_file_issue: false,
		issue_title: null,
		issue_body: null,
		issue_fingerprint: null,
		error_reason: reason,
	};
}

async function main(): Promise<void> {
	const previous = await loadPreviousReport();
	console.log(
		previous
			? `Previous report loaded (${previous.audited_at}).`
			: "No previous report - baseline mode: no deltas, no issue filing.",
	);

	let report: HealthReport;
	let lighthouseResults: LighthouseResult[] = [];
	try {
		if (!process.env.ANTHROPIC_API_KEY) {
			throw new Error("ANTHROPIC_API_KEY is not set.");
		}
		const screenshots: Screenshot[] = await captureScreenshots();
		lighthouseResults = await runLighthouse();
		report = await analyze(screenshots, lighthouseResults, previous);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(`Audit failed: ${reason}`);
		report = errorReport(reason, lighthouseResults);
	}

	if (report.pages.length !== AUDIT_PAGES.length) {
		console.warn(
			`Report covers ${report.pages.length}/${AUDIT_PAGES.length} pages - check the model output.`,
		);
	}

	await writeReport(report);

	if (noCommit) {
		console.log("--no-commit: skipping git commit.");
	} else {
		await commitReport(report);
	}

	if (noIssue) {
		console.log("--no-issue: skipping issue filing.");
	} else if (report.should_file_issue) {
		try {
			await fileOrUpdateIssue(report);
		} catch (error) {
			// A failed issue call must not fail the run - the report is
			// already committed and next night's audit will retry.
			console.error(`Issue filing failed: ${error instanceof Error ? error.message : error}`);
		}
	} else {
		console.log("No issue to file.");
	}

	console.log("\nFinal health report:");
	console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
