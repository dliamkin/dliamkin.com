import type Anthropic from "@anthropic-ai/sdk";
import {
	capExcerpts,
	EXPLAIN_TOS_MAX_TOKENS,
	EXPLAIN_TOS_SYSTEM_PROMPT,
	EXPLAIN_TOS_TOOL,
	type TosChangeReport,
} from "../tos-watch";
import { computeTosChangedBlocks, formatTosChangedBlocks } from "../tos-watch-diff";
import { extractToolInput } from "./shared";

// The diff-and-explain pipeline for the ToS watchdog: mechanical diff first,
// model second. Invoked only on change days - the nightly hash comparison in
// scripts/tos-watch/run.ts is the zero-cost common path - so volume is a few
// calls a month at most. The eval suite (scripts/evals/suites/tos-watch.ts)
// runs this exact function.

// Sonnet, matching the lease pipeline's reasoning: legal text published under
// the owner's name, where a misread clause matters more than the ~3x cost.
// TOS_WATCH_MODEL overrides per environment (Haiku is the budget fallback).
export const EXPLAIN_TOS_DEFAULT_MODEL = "claude-sonnet-5";

// Bumped when prompt/schema/diff behavior changes meaningfully; stamped on
// every published changelog entry so old entries stay attributable.
// 1.1.1: excerpt cap enforced at the pipeline boundary (was publisher-only,
// so eval runs saw uncapped model output - caught by tos-arbitration-added).
export const TOS_PIPELINE_VERSION = "1.1.1";

export interface TosDocumentMeta {
	serviceName: string;
	documentLabel: string;
}

export async function explainTosChange(
	client: Anthropic,
	meta: TosDocumentMeta,
	previousText: string,
	currentText: string,
	model: string = EXPLAIN_TOS_DEFAULT_MODEL,
): Promise<TosChangeReport> {
	// Only the changed blocks (with nearest unchanged context) go to the
	// model - never both full documents. ToS run tens of thousands of words;
	// the diff-blocks approach keeps a change-day call in the low thousands
	// of input tokens.
	const diffSummary = formatTosChangedBlocks(computeTosChangedBlocks(previousText, currentText));

	const response = await client.messages.create({
		model,
		max_tokens: EXPLAIN_TOS_MAX_TOKENS,
		// The mechanical diff already did change detection; the model's job is
		// neutral explanation of the listed blocks. Disabling thinking keeps
		// the whole budget for the structured output.
		thinking: { type: "disabled" },
		system: EXPLAIN_TOS_SYSTEM_PROMPT,
		tools: [EXPLAIN_TOS_TOOL],
		tool_choice: { type: "tool", name: EXPLAIN_TOS_TOOL.name },
		messages: [
			{
				role: "user",
				content: `Service: ${meta.serviceName}\nDocument: ${meta.documentLabel}\n\n<changed_blocks>\n${diffSummary}\n</changed_blocks>`,
			},
		],
	});
	// The prompt asks for <= 25-word excerpts; capExcerpts is the code-level
	// guarantee, applied here so every consumer of this pipeline (nightly
	// runner, evals) receives a report that honors the type's contract.
	return capExcerpts(extractToolInput<TosChangeReport>(response, EXPLAIN_TOS_TOOL.name));
}
