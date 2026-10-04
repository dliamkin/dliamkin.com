import type Anthropic from "@anthropic-ai/sdk";
import { structureNote } from "../../src/lib/pipelines/structure-note";
import type { Medication } from "../../src/lib/structured-note";
import { LABELING_MODEL } from "./config";

// Part 1b: the teacher IS the shipped system. Each note is labeled by the exact
// production note-structurer pipeline (src/lib/pipelines/structure-note.ts),
// just run at the stronger LABELING_MODEL for label quality regardless of what
// the demo's runtime teacher uses. We keep only the Medication[] subset - the
// one part of the schema the student is distilled to reproduce.
export async function labelNote(client: Anthropic, note: string): Promise<Medication[]> {
	const structured = await structureNote(client, note, LABELING_MODEL);
	return structured.medications;
}
