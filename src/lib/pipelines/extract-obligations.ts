import type Anthropic from "@anthropic-ai/sdk";
import {
	EXTRACT_OBLIGATIONS_SYSTEM_PROMPT,
	EXTRACT_OBLIGATIONS_TOOL,
	PAPERWORK_MAX_TOKENS,
	type ObligationExtraction,
} from "../paperwork";
import { reconcileComputedDates } from "../paperwork-dates";
import type { AllowedMediaType } from "../ui-analysis";
import { extractToolInput } from "./shared";

// The full production pipeline for the Paperwork → Calendar demo: prompt
// assembly (with today's date substituted in), forced tool call,
// schema-validated parse, for both the text and photographed-pages input
// modes. worker/index.ts wraps this with validation and rate limiting;
// scripts/generate-paperwork-samples.mjs and the eval suite in
// scripts/evals/ run it directly.

// Sonnet, not Haiku (the house default for demos): date arithmetic is this
// pipeline's known failure mode, and Haiku demonstrably missed it - during
// sample generation it computed "2027-08-31 minus 60 days" as 2027-06-02
// (off by a month). This demo's whole value is date correctness, so the ~3x
// cost is worth it; the eval suite's month-boundary cases are the regression
// guard. The worker overrides this per-environment via PAPERWORK_MODEL.
export const EXTRACT_OBLIGATIONS_DEFAULT_MODEL = "claude-sonnet-5";

export interface PaperworkImage {
	imageData: string; // base64, already size-validated by the caller
	mediaType: AllowedMediaType;
}

export type PaperworkInput =
	| { documentText: string }
	| { images: PaperworkImage[] };

export async function extractObligations(
	client: Anthropic,
	input: PaperworkInput,
	todayIso: string, // UTC date (YYYY-MM-DD) - anchors relative expressions and in_past
	model: string = EXTRACT_OBLIGATIONS_DEFAULT_MODEL,
): Promise<ObligationExtraction> {
	const content: Anthropic.ContentBlockParam[] =
		"documentText" in input
			? [
					{
						type: "text",
						text: `<document>\n${input.documentText}\n</document>\n\nExtract this document's obligations per your instructions and record the result via the tool.`,
					},
				]
			: [
					...input.images.map(
						(image): Anthropic.ImageBlockParam => ({
							type: "image",
							source: {
								type: "base64",
								media_type: image.mediaType,
								data: image.imageData,
							},
						}),
					),
					{
						type: "text",
						text: "These are photographed pages of one document, in order. Extract its obligations per your instructions and record the result via the tool.",
					},
				];

	const callOnce = async (): Promise<ObligationExtraction> => {
		const response = await client.messages.create({
			model,
			max_tokens: PAPERWORK_MAX_TOKENS,
			system: EXTRACT_OBLIGATIONS_SYSTEM_PROMPT.replace("{TODAY}", todayIso),
			tools: [EXTRACT_OBLIGATIONS_TOOL],
			tool_choice: { type: "tool", name: EXTRACT_OBLIGATIONS_TOOL.name },
			messages: [{ role: "user", content }],
		});
		// The model identifies anchors and offsets; the arithmetic for
		// computed dates is re-run (and corrected) in code - see
		// reconcileComputedDates for why the model's math can't be trusted.
		return reconcileComputedDates(
			extractToolInput<ObligationExtraction>(response, EXTRACT_OBLIGATIONS_TOOL.name),
			todayIso,
		);
	};

	const result = await callOnce();
	// "This is an obligation document" + zero events is self-contradictory -
	// observed (2026-07-04, CI) as a transient degenerate response: schema-
	// valid, near-instant, contentless. One bounded retry; if the second
	// attempt agrees, the document may genuinely have no datable events and
	// the UI says so rather than erroring.
	if (result.is_obligation_document && result.events.length === 0) {
		return callOnce();
	}
	return result;
}
