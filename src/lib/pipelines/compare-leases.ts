import type Anthropic from "@anthropic-ai/sdk";
import {
	COMPARE_LEASES_SYSTEM_PROMPT,
	COMPARE_LEASES_TOOL,
	LEASE_DIFF_MAX_TOKENS,
	type LeaseComparison,
} from "../lease-diff";
import { computeChangedBlocks, formatChangedBlocks } from "../lease-mechanical-diff";
import { extractToolInput } from "./shared";

// The full production pipeline for the Lease Diff Explainer: mechanical diff,
// prompt assembly, forced tool call, schema-validated parse. worker/index.ts
// wraps this with validation and rate limiting; scripts/generate-lease-samples.mjs
// and the eval suite in scripts/evals/ run it directly.

// Sonnet is the default here (not Haiku like the other demos) because
// full-length leases are long, dense legal text where missed or misread
// clauses matter - recall justifies the ~3x cost. The worker overrides this
// per-environment via the LEASE_DIFF_MODEL var.
export const COMPARE_LEASES_DEFAULT_MODEL = "claude-sonnet-5";

export async function compareLeases(
	client: Anthropic,
	originalText: string,
	revisedText: string,
	model: string = COMPARE_LEASES_DEFAULT_MODEL,
): Promise<LeaseComparison> {
	// Hybrid pipeline: a classical text diff grounds the model call. The
	// changed-blocks summary acts as a checklist so mechanical change
	// detection and semantic explanation each do what they're best at.
	const diffSummary = formatChangedBlocks(computeChangedBlocks(originalText, revisedText));

	const response = await client.messages.create({
		model,
		max_tokens: LEASE_DIFF_MAX_TOKENS,
		// The mechanical diff already grounds change detection, so the model's
		// job is explanation, not discovery. Disabling thinking (which Sonnet
		// runs by default) keeps the whole token budget for the structured
		// output and bounds latency on these large inputs.
		thinking: { type: "disabled" },
		system: COMPARE_LEASES_SYSTEM_PROMPT,
		tools: [COMPARE_LEASES_TOOL],
		tool_choice: { type: "tool", name: COMPARE_LEASES_TOOL.name },
		messages: [
			{
				role: "user",
				content: `<original_lease>\n${originalText}\n</original_lease>\n\n<revised_lease>\n${revisedText}\n</revised_lease>\n\n<mechanical_diff>\n${diffSummary}\n</mechanical_diff>`,
			},
		],
	});
	return extractToolInput<LeaseComparison>(response, COMPARE_LEASES_TOOL.name);
}
