// Surface-form variants for medication names, used by the aligner to locate a
// teacher-extracted name back in the note even when the two disagree on
// surface form. The teacher (Sonnet) tends to normalize - expanding
// abbreviations the note wrote short ("HCTZ" → "hydrochlorothiazide"),
// preferring generics over the brand the note used ("Tylenol" →
// "acetaminophen"), or carrying a formulation/salt suffix ("Metoprolol
// tartrate") the note omits. Exact string matching then fails and the example
// is discarded as label noise. These variants recover those cases WITHOUT
// loosening into fuzzy matching: every candidate is still matched with word
// boundaries, so we only ever tag a real, whole surface form present in the
// note.

// Bidirectional synonym groups. Kept deliberately small and curated to the
// drugs this dataset actually generates (see templates.ts DRUGS) plus the most
// common clinical brand/abbreviation confusables. Add to this as new discards
// show up in the logs - it is not meant to be exhaustive.
const SYNONYM_GROUPS: string[][] = [
	["acetaminophen", "tylenol", "apap", "paracetamol"],
	["ibuprofen", "advil", "motrin"],
	["aspirin", "asa"],
	["atorvastatin", "lipitor"],
	["metformin", "glucophage"],
	["omeprazole", "prilosec"],
	["sertraline", "zoloft"],
	["amlodipine", "norvasc"],
	["furosemide", "lasix"],
	["insulin glargine", "lantus"],
	["gabapentin", "neurontin"],
	["levothyroxine", "synthroid"],
	["hydrochlorothiazide", "hctz", "microzide"],
	["albuterol", "ventolin", "proventil", "salbutamol"],
	["lisinopril", "prinivil", "zestril"],
	["hydroxyzine", "vistaril", "atarax"],
	["metoprolol", "lopressor", "toprol"],
	["nitroglycerin", "ntg", "nitrostat"],
	["potassium chloride", "kcl"],
	["multivitamin", "mvi"],
	["prednisone"],
	["hydralazine"],
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const GROUP_BY_NAME = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
	for (const member of group) GROUP_BY_NAME.set(norm(member), group);
}

// Formulation and salt suffixes the teacher may append that the note omits.
const SUFFIX = /\s+(xr|er|sr|cr|dr|xl|ir|hcl|hbr|sodium|potassium|sulfate|succinate|tartrate|maleate|besylate|mesylate|fumarate|micronized|extended[- ]release)$/i;

function stripFormulation(name: string): string {
	let out = name;
	let prev: string;
	do {
		prev = out;
		out = out.replace(SUFFIX, "");
	} while (out !== prev);
	return out.trim();
}

// Head tokens too generic to stand alone as a drug name - a bare match on
// these would bind the wrong drug (e.g. "insulin aspart" vs "insulin glargine").
const AMBIGUOUS_HEADS = new Set(["insulin", "vitamin", "multivitamin", "sodium", "potassium"]);

// Ordered, de-duplicated surface forms to search for, most specific first. The
// aligner uses the first form that actually occurs in the note.
export function nameVariants(name: string): string[] {
	const variants: string[] = [];
	const push = (v: string) => {
		const n = norm(v);
		if (n && !variants.includes(n)) variants.push(n);
	};

	push(name);
	const stripped = stripFormulation(name);
	push(stripped);

	// Synonyms of the full name or its stripped form.
	for (const key of [norm(name), norm(stripped)]) {
		const group = GROUP_BY_NAME.get(key);
		if (group) for (const member of group) push(member);
	}

	// Head-token fallback, guarded against generic heads.
	const head = norm(stripped).split(" ")[0] ?? "";
	if (head.length >= 5 && !AMBIGUOUS_HEADS.has(head)) push(head);

	return variants;
}
