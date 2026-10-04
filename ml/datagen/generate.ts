import type Anthropic from "@anthropic-ai/sdk";
import { GENERATION_MODEL } from "./config";
import { buildGenerationPrompt } from "./templates";
import type { NoteSpec } from "./types";

// Part 1a: generate one synthetic clinical note to spec. High temperature for
// prose diversity - the spec already pins the structural variation, so the
// model is free to vary wording, which is exactly the surface the student must
// generalize over. Returns the trimmed note text (may be empty on a refusal or
// a degenerate response; the caller treats empty as a discard).
export async function generateNote(client: Anthropic, spec: NoteSpec): Promise<string> {
	const response = await client.messages.create({
		model: GENERATION_MODEL,
		max_tokens: 700,
		temperature: 1,
		system:
			"You generate synthetic, fictional clinical visit notes for a machine-learning dataset. " +
			"They must never describe a real person and must never contain real medical advice. " +
			"Follow the requested specification exactly.",
		messages: [{ role: "user", content: buildGenerationPrompt(spec) }],
	});

	return response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
}
