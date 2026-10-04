import type Anthropic from "@anthropic-ai/sdk";
import type { MeasuredFeatures } from "../audio-analysis/types";
import {
	applyDescriptionGate,
	MACHINE_TYPE_LABELS,
	NOISE_TRANSLATOR_MAX_TOKENS,
	NOISE_TRANSLATOR_SYSTEM_PROMPT,
	NOISE_TRANSLATOR_TOOL,
	type DescribeNoiseResponse,
	type NoiseContext,
	type NoiseDescription,
} from "../noise-translator";
import { extractToolInput } from "./shared";

// The full production pipeline for the Noise Translator demo: spectrogram
// image + measured features + context answers in, forced tool call,
// schema-validated parse, then the deterministic description gate (diagnosis
// deny-list + measured-number check). worker/index.ts wraps this with
// validation and rate limiting; scripts/generate-noise-samples.mjs and the
// eval suite in scripts/evals/ run it directly.

// Sonnet, not Haiku (the house default for demos): reading structure off a
// spectrogram is genuinely hard perception work - the model must align click
// transients with the burned-in time axis and tonal ridges with the frequency
// axis - and this endpoint's volume is low. The worker overrides this
// per-environment via NOISE_TRANSLATOR_MODEL (Haiku is the cheap fallback).
export const DESCRIBE_NOISE_DEFAULT_MODEL = "claude-sonnet-5";

const WHEN_LABELS: Record<NoiseContext["when_it_happens"], string> = {
	startup_only: "only at startup",
	constant: "constantly",
	intermittent: "intermittently",
	under_load: "only under load or at speed",
};

const SPEED_LABELS: Record<NoiseContext["changes_with_speed"], string> = {
	tracks_speed: "tracks speed/intensity",
	constant: "does not change with speed/intensity",
	unsure: "unsure whether it changes with speed",
};

/** Render the measured features + context as the model-facing text block. */
export function buildNoiseUserText(features: MeasuredFeatures, context: NoiseContext): string {
	const machine =
		context.machine_type === "other" && context.machine_type_other.trim().length > 0
			? context.machine_type_other.trim()
			: MACHINE_TYPE_LABELS[context.machine_type];
	const contextLines = [
		`machine: ${machine}`,
		`when it happens: ${WHEN_LABELS[context.when_it_happens]}`,
		`speed dependence: ${SPEED_LABELS[context.changes_with_speed]}`,
		context.how_long.trim().length > 0 ? `going on for: ${context.how_long.trim()}` : null,
		context.recent_changes.trim().length > 0
			? `recent changes: ${context.recent_changes.trim()}`
			: null,
	].filter((line): line is string => line !== null);
	return (
		`<measured_features>\n${JSON.stringify(features, null, 2)}\n</measured_features>\n\n` +
		`<user_context>\n${contextLines.join("\n")}\n</user_context>\n\n` +
		"The image is the recording's spectrogram with labeled time and frequency axes. " +
		"Describe this sound per your instructions and record the result via the tool."
	);
}

export async function describeNoise(
	client: Anthropic,
	spectrogramPngBase64: string, // base64 PNG, already size-validated by the caller
	features: MeasuredFeatures,
	context: NoiseContext,
	model: string = DESCRIBE_NOISE_DEFAULT_MODEL,
): Promise<DescribeNoiseResponse> {
	const response = await client.messages.create({
		model,
		max_tokens: NOISE_TRANSLATOR_MAX_TOKENS,
		system: NOISE_TRANSLATOR_SYSTEM_PROMPT,
		tools: [NOISE_TRANSLATOR_TOOL],
		tool_choice: { type: "tool", name: NOISE_TRANSLATOR_TOOL.name },
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: spectrogramPngBase64,
						},
					},
					{ type: "text", text: buildNoiseUserText(features, context) },
				],
			},
		],
	});
	const raw = extractToolInput<NoiseDescription>(response, NOISE_TRANSLATOR_TOOL.name);
	// The prompt bans diagnosis language and fabricated numbers; this gate
	// guarantees it. Stripped sentences travel back to the caller for logging
	// and on-page transparency.
	const { description, stripped } = applyDescriptionGate(raw, features);
	return { description, stripped };
}
