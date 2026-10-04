import Anthropic from "@anthropic-ai/sdk";
import {
	AUDIT_MAX_TOKENS,
	AUDIT_MODEL,
	AUDIT_SYSTEM_PROMPT,
	RECORD_HEALTH_REPORT_TOOL,
	SITE_ORIGIN,
	type HealthReport,
} from "../../src/lib/site-health";
import type { LighthouseResult } from "./lighthouse";
import type { Screenshot } from "./screenshots";

// Exactly one Messages API call per nightly run: every screenshot and all
// Lighthouse data go into a single request. The previous run's report (not
// its images - those aren't retained) is the model's memory of last night.
export async function analyze(
	screenshots: Screenshot[],
	lighthouseResults: LighthouseResult[],
	previousReport: HealthReport | null,
): Promise<HealthReport> {
	// The SDK reads ANTHROPIC_API_KEY from the environment. The key is never
	// logged, echoed, or written anywhere by this pipeline.
	const anthropic = new Anthropic();

	const content: Anthropic.ContentBlockParam[] = [
		{
			type: "text",
			text: `Nightly audit of ${SITE_ORIGIN}, ${new Date().toISOString()}. Below: current screenshots of each audited page (desktop and mobile), current Lighthouse results, and the previous audit report.`,
		},
	];

	for (const shot of screenshots) {
		content.push(
			{
				type: "text",
				text: `Screenshot: ${shot.label} (${shot.path}) - ${shot.viewport}, full page`,
			},
			{
				type: "image",
				source: { type: "base64", media_type: "image/jpeg", data: shot.base64 },
			},
		);
	}

	content.push({
		type: "text",
		text: `Current Lighthouse results (mobile config, one run per page - ±3 points of jitter is normal):\n${JSON.stringify(lighthouseResults, null, 2)}`,
	});

	content.push({
		type: "text",
		text: previousReport
			? `Previous audit report:\n${JSON.stringify(previousReport, null, 2)}`
			: "This is the first-ever audit (baseline mode): there is no previous report. Record scores and a visual_fingerprint for each page, leave score_deltas empty, and set should_file_issue to false.",
	});

	content.push({
		type: "text",
		text: "Record your audit via the record_health_report tool.",
	});

	const response = await anthropic.messages.create({
		model: AUDIT_MODEL,
		max_tokens: AUDIT_MAX_TOKENS,
		system: AUDIT_SYSTEM_PROMPT,
		tools: [RECORD_HEALTH_REPORT_TOOL],
		tool_choice: { type: "tool", name: RECORD_HEALTH_REPORT_TOOL.name },
		messages: [{ role: "user", content }],
	});

	const toolUse = response.content.find(
		(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
	);
	if (!toolUse || response.stop_reason === "max_tokens") {
		throw new Error("The model did not return a complete health report.");
	}

	// strict: true means the API already validated this against the schema.
	const report = toolUse.input as HealthReport;

	// The pipeline is authoritative for timestamps and measured numbers - the
	// model only interprets them, so transcription slips can't corrupt the
	// published report.
	report.audited_at = new Date().toISOString();
	const measuredByPath = new Map(lighthouseResults.map((r) => [r.path, r.lighthouse]));
	for (const page of report.pages) {
		const measured = measuredByPath.get(page.path);
		if (measured) page.lighthouse = measured;
	}

	// Baseline runs never file issues, even if the model gets over-eager.
	if (!previousReport) {
		report.should_file_issue = false;
		report.issue_title = null;
		report.issue_body = null;
		report.issue_fingerprint = null;
	}

	return report;
}
