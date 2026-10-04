import type Anthropic from "@anthropic-ai/sdk";
import {
	STRUCTURE_NOTE_SYSTEM_PROMPT,
	STRUCTURE_NOTE_TOOL,
	type StructuredNote,
} from "../structured-note";
import { extractToolInput } from "./shared";

// The full production pipeline for the Clinical Note Structurer: prompt,
// forced tool call, schema-validated parse. worker/index.ts wraps this with
// validation and rate limiting; scripts/generate-samples.mjs and the eval
// suite in scripts/evals/ run it directly.

// claude-haiku-4-5 is fast, cheap, and vision-capable - right-sized for a
// demo. claude-sonnet-5 is the drop-in upgrade if higher accuracy ever
// matters more than latency/cost.
export const STRUCTURE_NOTE_MODEL = "claude-haiku-4-5";

export const STRUCTURE_NOTE_MAX_TOKENS = 2000;

export async function structureNote(
	client: Anthropic,
	noteText: string,
	model: string = STRUCTURE_NOTE_MODEL,
): Promise<StructuredNote> {
	const response = await client.messages.create({
		model,
		max_tokens: STRUCTURE_NOTE_MAX_TOKENS,
		system: STRUCTURE_NOTE_SYSTEM_PROMPT,
		tools: [STRUCTURE_NOTE_TOOL],
		tool_choice: { type: "tool", name: STRUCTURE_NOTE_TOOL.name },
		messages: [{ role: "user", content: noteText }],
	});
	return extractToolInput<StructuredNote>(response, STRUCTURE_NOTE_TOOL.name);
}
