import type { NoteSpec, TrickyFlag } from "./types";

// The seeded diversity engine. Every axis of variation is sampled from a
// deterministic PRNG so a run reproduces exactly and its distribution can be
// audited (01-data-design.md). The generation model then writes prose to the
// spec; the spec - not the model's mood - is what guarantees coverage of
// specialties, styles, abbreviation density, medication counts, and the hard
// cases that make the set worth training on.

// mulberry32 - tiny, fast, good enough for reproducible sampling. Not crypto.
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = <T>(rng: () => number, items: readonly T[]): T =>
	items[Math.floor(rng() * items.length)] as T;

const SPECIALTIES = [
	"primary care",
	"cardiology",
	"endocrinology",
	"urgent care",
	"psychiatry",
	"pulmonology",
	"nephrology",
	"geriatrics",
	"pain management",
	"pediatrics",
] as const;

const STYLES: NoteSpec["style"][] = ["SOAP", "narrative", "urgent-care-shorthand", "telehealth"];
const ABBREV: NoteSpec["abbreviationDensity"][] = ["low", "medium", "high"];

const TRICKY_POOL: TrickyFlag[] = [
	"dose-change-midnote",
	"discontinued-med",
	"prn-med",
	"look-alike-names",
	"allergy-context",
	"new-med",
];

// A compact but varied drug lexicon with realistic attribute options. The
// look-alike pairs are deliberate confusables the student must keep distinct.
export interface DrugEntry {
	name: string;
	doses: string[];
	routes: string[];
	freqs: string[];
}

export const DRUGS: DrugEntry[] = [
	{ name: "lisinopril", doses: ["10 mg", "20 mg", "40 mg"], routes: ["oral"], freqs: ["daily", "once daily"] },
	{ name: "metformin", doses: ["500 mg", "850 mg", "1000 mg"], routes: ["oral", "PO"], freqs: ["BID", "twice daily", "with meals"] },
	{ name: "atorvastatin", doses: ["10 mg", "40 mg", "80 mg"], routes: ["oral"], freqs: ["at bedtime", "nightly"] },
	{ name: "amlodipine", doses: ["2.5 mg", "5 mg", "10 mg"], routes: ["oral"], freqs: ["daily"] },
	{ name: "sertraline", doses: ["25 mg", "50 mg", "100 mg"], routes: ["oral"], freqs: ["daily", "every morning"] },
	{ name: "albuterol", doses: ["90 mcg", "2 puffs"], routes: ["inhaled", "MDI"], freqs: ["q4-6h PRN", "PRN wheezing"] },
	{ name: "hydralazine", doses: ["25 mg", "50 mg"], routes: ["oral"], freqs: ["TID", "three times daily"] },
	{ name: "hydroxyzine", doses: ["25 mg", "50 mg"], routes: ["oral"], freqs: ["at bedtime PRN", "PRN itching"] },
	{ name: "gabapentin", doses: ["100 mg", "300 mg", "600 mg"], routes: ["oral"], freqs: ["TID", "at bedtime"] },
	{ name: "furosemide", doses: ["20 mg", "40 mg"], routes: ["oral", "IV"], freqs: ["daily", "BID"] },
	{ name: "prednisone", doses: ["5 mg", "10 mg", "20 mg"], routes: ["oral"], freqs: ["daily", "taper"] },
	{ name: "ibuprofen", doses: ["200 mg", "400 mg", "600 mg"], routes: ["oral"], freqs: ["q6h PRN", "PRN pain"] },
	{ name: "omeprazole", doses: ["20 mg", "40 mg"], routes: ["oral"], freqs: ["daily", "before breakfast"] },
	{ name: "levothyroxine", doses: ["50 mcg", "75 mcg", "100 mcg"], routes: ["oral"], freqs: ["every morning", "daily on empty stomach"] },
	{ name: "insulin glargine", doses: ["10 units", "20 units"], routes: ["subcutaneous", "SC"], freqs: ["at bedtime", "nightly"] },
];

// Drugs used only as allergies (never as active meds) - the allergy-context
// trap. The teacher puts these in `allergies`, so a correct aligner leaves
// them untagged; a naive one grabs the drug name as a MED_NAME.
export const ALLERGY_DRUGS = ["penicillin", "sulfa", "codeine", "morphine", "aspirin"];

export function sampleSpec(seed: number): NoteSpec {
	const rng = mulberry32(seed);
	// ~1 in 8 notes is a zero-medication hard negative.
	const isNegative = rng() < 0.125;
	const medCount = isNegative ? 0 : 1 + Math.floor(rng() * 8); // 1–8

	const tricky: TrickyFlag[] = [];
	if (!isNegative) {
		const trickyCount = rng() < 0.55 ? (rng() < 0.3 ? 2 : 1) : 0;
		const shuffled = [...TRICKY_POOL].sort(() => rng() - 0.5);
		tricky.push(...shuffled.slice(0, trickyCount));
	} else if (rng() < 0.4) {
		tricky.push("allergy-context"); // negatives sometimes still name an allergy drug
	}

	return {
		seed,
		specialty: pick(rng, SPECIALTIES),
		style: pick(rng, STYLES),
		abbreviationDensity: pick(rng, ABBREV),
		medCount,
		tricky,
	};
}

// The instruction block handed to the generation model. Concrete and
// constraining so the note actually honors the spec (count, style, traps)
// while the prose stays diverse.
export function buildGenerationPrompt(spec: NoteSpec): string {
	const trickyLines: Record<TrickyFlag, string> = {
		"dose-change-midnote": "Include one medication whose dose is changed during the visit; write the note so the CURRENT dose is unambiguous.",
		"discontinued-med": 'Discontinue one medication using an explicit cue word like "discontinued", "stopped", or "d/c".',
		"prn-med": "Include at least one as-needed (PRN) medication with PRN-style frequency phrasing.",
		"look-alike-names": "Use a look-alike drug name (e.g. hydralazine vs hydroxyzine) and spell it correctly and clearly.",
		"allergy-context": "Name a drug ONLY in the allergy list (e.g. penicillin) - it must NOT appear as an active medication.",
		"new-med": 'Start one new medication using an explicit cue word like "start", "initiate", or "new".',
	};

	const lines = [
		"Write ONE fully synthetic (fictional) clinical visit note. It must not describe any real person.",
		`Specialty context: ${spec.specialty}.`,
		`Note style: ${spec.style}.`,
		`Abbreviation density: ${spec.abbreviationDensity} (use realistic clinical shorthand accordingly).`,
		spec.medCount === 0
			? "This note must mention ZERO medications in the active medication list (a hard negative). It may still mention vitals, assessment, and plan."
			: `Include exactly ${spec.medCount} distinct active medication(s), each with a realistic dose, route, and frequency where appropriate.`,
		...spec.tricky.map((t) => `- ${trickyLines[t]}`),
		"Return ONLY the note text - no preamble, no headings like 'Note:', no commentary.",
		"Keep it under 300 words.",
	];
	return lines.join("\n");
}
