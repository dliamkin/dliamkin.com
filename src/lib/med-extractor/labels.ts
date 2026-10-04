// The label scheme for the distilled medication extractor - the single source
// of truth shared by every part of the system: the data-generation aligner
// (ml/datagen), the Python training config (mirrored in ml/train/config), the
// browser BIO decoder (src/lib/med-extractor/decode.ts), the span assembler
// (assembler.ts), and the student eval suite (scripts/evals/suites). Nothing
// here imports runtime code, so it is safe to ship to the client bundle.

// The five entity types the student tags at the token level. Deliberately
// narrow: this is the Medication[] subset of the full StructuredNote schema.
// STATUS_CUE is not a medication attribute itself - it marks the cue words
// ("discontinued", "started", "hold") the assembler reads to derive a
// Medication.status, keeping status out of the generation-style guesswork
// small models are bad at.
export const ENTITY_TYPES = ["MED_NAME", "DOSE", "ROUTE", "FREQUENCY", "STATUS_CUE"] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

// BIO tag set: O plus B-/I- for each entity type. Order is fixed and index-
// stable - the Python trainer's id2label MUST match this exact ordering, so a
// model exported from training decodes correctly in the browser. Do not
// reorder; append only.
export const BIO_LABELS = [
	"O",
	...ENTITY_TYPES.flatMap((t) => [`B-${t}`, `I-${t}`]),
] as const;

export type BioLabel = (typeof BIO_LABELS)[number];

export const LABEL_TO_ID: Record<BioLabel, number> = Object.fromEntries(
	BIO_LABELS.map((label, id) => [label, id]),
) as Record<BioLabel, number>;

export const ID_TO_LABEL: Record<number, BioLabel> = Object.fromEntries(
	BIO_LABELS.map((label, id) => [id, label]),
);

export function bioTag(prefix: "B" | "I", type: EntityType): BioLabel {
	return `${prefix}-${type}` as BioLabel;
}

// A located entity span in a note, as character offsets into the original
// (unnormalized) note text. This is the canonical intermediate representation
// everywhere: the aligner produces spans from the teacher's output, the
// browser decoder produces spans from model logits, and the assembler consumes
// spans to build Medication[]. Char offsets (not token indices) keep it
// tokenizer-independent.
export interface EntitySpan {
	start: number; // inclusive char offset
	end: number; // exclusive char offset
	type: EntityType;
	text: string; // note.slice(start, end) - carried for convenience/debugging
}
