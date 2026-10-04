import type { Medication } from "../../src/lib/structured-note";
import type { EntitySpan, EntityType } from "../../src/lib/med-extractor/labels";
import type { AlignmentResult, DatasetExample, NoteSpec } from "./types";
import { GENERATION_MODEL, LABELING_MODEL } from "./config";
import { nameVariants } from "./drug-synonyms";

// Part 1c: turn the teacher's Medication[] into token-level supervision. We
// locate each extracted field back in the note by normalized string matching
// and record it as a char-span EntitySpan; dose/route/frequency are bound to
// the NEAREST medication name so attributes attach to the right drug. Status
// is realized as a STATUS_CUE span over the cue word ("started" / "stopped")
// that justifies a new/discontinued status - the assembler reads those cues
// back out. Alignment failures (a name that isn't in the text, a field whose
// only occurrence is already claimed) are label noise: we discard the whole
// example and count why, so the discard rate can go in the docs.

interface Norm {
	text: string; // lowercased, whitespace-collapsed
	map: number[]; // map[i] = original char index of norm char i
}

function buildNorm(note: string): Norm {
	const chars: string[] = [];
	const map: number[] = [];
	let prevWasSpace = false;
	for (let i = 0; i < note.length; i++) {
		const ch = note[i] as string;
		if (/\s/.test(ch)) {
			if (!prevWasSpace) {
				chars.push(" ");
				map.push(i);
				prevWasSpace = true;
			}
		} else {
			chars.push(ch.toLowerCase());
			map.push(i);
			prevWasSpace = false;
		}
	}
	return { text: chars.join(""), map };
}

function normalizeNeedle(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

interface Occurrence {
	start: number;
	end: number;
} // original char offsets

// All non-overlapping occurrences of `needle` (normalized) in the note.
function findOccurrences(norm: Norm, note: string, needle: string): Occurrence[] {
	const n = normalizeNeedle(needle);
	if (!n) return [];
	const out: Occurrence[] = [];
	let from = 0;
	for (;;) {
		const at = norm.text.indexOf(n, from);
		if (at === -1) break;
		const start = norm.map[at] as number;
		const lastNormIdx = at + n.length - 1;
		const end = (norm.map[lastNormIdx] as number) + 1;
		// Guard against matching inside a larger word for short alphabetic needles
		// (e.g. "new" inside "renew"): require word boundaries in the original.
		const before = start > 0 ? note[start - 1] : " ";
		const after = end < note.length ? note[end] : " ";
		const alnum = /[a-z0-9]/i;
		const boundaryOk = !(alnum.test(n[0] as string) && alnum.test(before as string)) &&
			!(alnum.test(n[n.length - 1] as string) && alnum.test(after as string));
		if (boundaryOk) out.push({ start, end: end > start ? end : start + needle.length });
		from = at + n.length;
	}
	return out;
}

const overlaps = (a: Occurrence, b: EntitySpan) => a.start < b.end && b.start < a.end;
const mid = (o: Occurrence) => (o.start + o.end) / 2;

const STATUS_CUES: Record<"new" | "discontinued", string[]> = {
	new: ["started", "start", "initiated", "initiate", "begin", "began", "new", "added", "add"],
	discontinued: ["discontinued", "discontinue", "stopped", "stop", "d/c", "held", "hold", "ceased"],
};

export function alignExample(
	id: string,
	note: string,
	medications: Medication[],
	spec: NoteSpec,
	mock: boolean,
): AlignmentResult {
	if (!note.trim()) return { example: null, discarded: "empty-note", skippedAmbiguousFields: 0 };

	const norm = buildNorm(note);
	const entities: EntitySpan[] = [];
	let skippedAmbiguousFields = 0;
	const claim = (occ: Occurrence, type: EntityType) => {
		entities.push({ start: occ.start, end: occ.end, type, text: note.slice(occ.start, occ.end) });
	};
	const isFree = (occ: Occurrence) => !entities.some((e) => overlaps(occ, e));

	for (const med of medications) {
		// Try each surface variant of the name (full → salt/formulation-stripped →
		// brand/generic/abbreviation synonyms → guarded head token) and use the
		// first that actually occurs free in the note.
		let nameOccs: Occurrence[] = [];
		for (const variant of nameVariants(med.name)) {
			const found = findOccurrences(norm, note, variant).filter(isFree);
			if (found.length > 0) {
				nameOccs = found;
				break;
			}
		}
		if (nameOccs.length === 0) {
			return { example: null, discarded: "name-unlocatable", skippedAmbiguousFields };
		}
		for (const occ of nameOccs) claim(occ, "MED_NAME");
		const anchor = nameOccs[0] as Occurrence; // nearest-binding reference point

		// dose / route / frequency: bind the nearest free occurrence to this med.
		const attrs: [string | null, EntityType][] = [
			[med.dose, "DOSE"],
			[med.route, "ROUTE"],
			[med.frequency, "FREQUENCY"],
		];
		for (const [value, type] of attrs) {
			if (!value) continue;
			const occs = findOccurrences(norm, note, value);
			if (occs.length === 0) continue; // optional field simply not in the prose
			const free = occs.filter(isFree);
			if (free.length === 0) {
				// The value is present but every occurrence is already claimed -
				// two meds are fighting over one span. Rather than discard the whole
				// example, leave this field untagged (the note is genuinely ambiguous
				// about which drug it belongs to) and count it.
				skippedAmbiguousFields++;
				continue;
			}
			free.sort((a, b) => Math.abs(mid(a) - mid(anchor)) - Math.abs(mid(b) - mid(anchor)));
			claim(free[0] as Occurrence, type);
		}

		// status cue: only new/discontinued leave a lexical trace to tag.
		if (med.status === "new" || med.status === "discontinued") {
			const cues = STATUS_CUES[med.status];
			const candidates = cues
				.flatMap((cue) => findOccurrences(norm, note, cue))
				.filter(isFree)
				.sort((a, b) => Math.abs(mid(a) - mid(anchor)) - Math.abs(mid(b) - mid(anchor)));
			if (candidates[0]) claim(candidates[0], "STATUS_CUE");
		}
	}

	entities.sort((a, b) => a.start - b.start);
	const example: DatasetExample = {
		id,
		note,
		entities,
		medications,
		meta: { spec, mock, generation_model: GENERATION_MODEL, labeling_model: LABELING_MODEL },
	};
	return { example, discarded: null, skippedAmbiguousFields };
}
