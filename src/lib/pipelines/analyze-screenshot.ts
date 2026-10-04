import type Anthropic from "@anthropic-ai/sdk";
import {
	UI_ANALYSIS_MAX_TOKENS,
	UI_ANALYSIS_SYSTEM_PROMPT,
	UI_ANALYSIS_TOOL,
	type AllowedMediaType,
	type UiAnalysis,
} from "../ui-analysis";
import { extractToolInput } from "./shared";

// The full production pipeline for the Screenshot → PrimeVue demo: vision
// prompt, forced tool call, schema-validated parse. worker/index.ts wraps
// this with validation and rate limiting; scripts/generate-screenshot-samples.mjs
// and the eval suite in scripts/evals/ run it directly.

// claude-haiku-4-5 is fast, cheap, and vision-capable - right-sized for a
// demo. claude-sonnet-5 is the drop-in upgrade if higher accuracy ever
// matters more than latency/cost.
export const ANALYZE_SCREENSHOT_MODEL = "claude-haiku-4-5";

export async function analyzeScreenshot(
	client: Anthropic,
	imageData: string, // base64, already size-validated by the caller
	mediaType: AllowedMediaType,
): Promise<UiAnalysis> {
	const response = await client.messages.create({
		model: ANALYZE_SCREENSHOT_MODEL,
		max_tokens: UI_ANALYSIS_MAX_TOKENS,
		system: UI_ANALYSIS_SYSTEM_PROMPT,
		tools: [UI_ANALYSIS_TOOL],
		tool_choice: { type: "tool", name: UI_ANALYSIS_TOOL.name },
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "base64", media_type: mediaType, data: imageData },
					},
					{
						type: "text",
						text: "Analyze this image per your instructions and record the result via the tool.",
					},
				],
			},
		],
	});
	return extractToolInput<UiAnalysis>(response, UI_ANALYSIS_TOOL.name);
}
