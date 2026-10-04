import type { Medication } from "../../src/lib/structured-note";
import type { EntitySpan } from "../../src/lib/med-extractor/labels";

// A generation spec: the seeded parameters that steer one synthetic note.
// Diversity is engineered here, not left to model whim - every axis is sampled
// from a seeded PRNG so a run is reproducible and its distribution auditable.
export interface NoteSpec {
	seed: number;
	specialty: string; // "cardiology", "urgent care", ...
	style: "SOAP" | "narrative" | "urgent-care-shorthand" | "telehealth";
	abbreviationDensity: "low" | "medium" | "high";
	medCount: number; // 0–8; 0 is a deliberate hard negative
	tricky: TrickyFlag[]; // difficulty injectors, may be empty
}

// The hard cases that make the dataset worth training on. Each maps to a
// documented failure mode a naive extractor gets wrong.
export type TrickyFlag =
	| "dose-change-midnote" // same drug, dose changes → teacher records the current one
	| "discontinued-med" // "stop lisinopril" → status discontinued, needs a cue
	| "prn-med" // PRN frequency phrasing
	| "look-alike-names" // hydrALAZINE vs hydrOXYzine, etc.
	| "allergy-context" // a drug named ONLY as an allergy - must NOT be extracted
	| "new-med"; // "start metformin" → status new, needs a cue

// One finished training example. Written as a JSONL line to ml/data/. The
// canonical supervision signal is `entities` (char spans); the Python trainer
// derives BIO tags per subword from these via the tokenizer's offset mapping.
// `medications` is the teacher's Medication[] subset, kept for reference and
// for the field-level agreement diff on the demo page.
export interface DatasetExample {
	id: string;
	note: string;
	entities: EntitySpan[];
	medications: Medication[];
	split?: "train" | "val" | "test";
	meta: {
		spec: NoteSpec;
		mock: boolean; // true when produced by --mock (no API), for provenance
		generation_model: string;
		labeling_model: string;
	};
}

// Why an aligned example was thrown away - logged and counted so the discard
// rate (a label-noise proxy) can go in the docs.
export type DiscardReason =
	| "name-unlocatable" // a teacher medication name not found in the note text
	| "ambiguous-span" // a field matched in multiple equally-plausible places
	| "near-duplicate" // too similar to another generated note
	| "eval-overlap" // too similar to a public eval sample - exam leak
	| "empty-note"; // generation returned nothing usable

export interface AlignmentResult {
	example: DatasetExample | null;
	discarded: DiscardReason | null;
	// Count of optional attribute fields (dose/route/frequency) the teacher
	// extracted but the aligner declined to tag because their only occurrence was
	// already claimed by another medication - genuinely ambiguous, so left
	// untagged rather than bound to the wrong drug. A dataset-quality stat, not a
	// discard: the example is still kept.
	skippedAmbiguousFields: number;
}
