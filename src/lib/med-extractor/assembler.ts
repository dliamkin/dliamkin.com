import type { Medication } from "../structured-note";
import { decodeBio, type TokenTag } from "./decode";
import type { EntitySpan } from "./labels";

// The deterministic assembler: turn decoded entity spans into Medication[],
// matching the Medication subset of the production StructuredNote schema. This
// is the honest division of labor - the small model does token tagging (which
// it's good at), and this unit-tested TypeScript does the structured assembly
// (which small models are bad at). The SAME module runs in the browser and in
// the Node eval runner, so what the evals grade is exactly what ships.
//
// Grouping rule: within a sentence, each MED_NAME span becomes a candidate
// medication; the nearest DOSE / ROUTE / FREQUENCY span in that same sentence
// binds to it, and a STATUS_CUE in the sentence sets the status. Sentences are
// the binding boundary so a drug named in a "plan" sentence doesn't steal a
// dose from an unrelated line. Finally we dedupe by normalized name, collapsing
// bare re-mentions (e.g. a drug referenced again in the assessment) into the
// mention that actually carries attributes.

const STATUS_CUES: { status: Medication["status"]; words: string[] }[] = [
	{ status: "discontinued", words: ["discontinued", "discontinue", "stopped", "stop", "d/c", "held", "hold", "ceased"] },
	{ status: "new", words: ["started", "start", "initiated", "initiate", "begin", "began", "new", "added", "add"] },
];

function statusFromCue(text: string): Medication["status"] | null {
	const t = text.toLowerCase();
	for (const { status, words } of STATUS_CUES) {
		if (words.some((w) => t.includes(w))) return status;
	}
	return null;
}

interface Sentence {
	start: number;
	end: number;
}

// Split on sentence-ish boundaries (., ;, newline) keeping char offsets. Notes
// use clinical shorthand, so this is intentionally lenient - it only needs to
// stop a dose on one line from binding to a drug on another.
function sentences(note: string): Sentence[] {
	const out: Sentence[] = [];
	let start = 0;
	for (let i = 0; i < note.length; i++) {
		const ch = note[i];
		if (ch === "." || ch === ";" || ch === "\n") {
			if (i + 1 > start) out.push({ start, end: i + 1 });
			start = i + 1;
		}
	}
	if (start < note.length) out.push({ start, end: note.length });
	return out;
}

const midpoint = (s: EntitySpan) => (s.start + s.end) / 2;
const normName = (s: string) => cleanText(s).toLowerCase().replace(/\s+/g, " ").trim();

// Trim whitespace and surrounding sentence punctuation from a span's surface
// text. A small model occasionally includes a trailing "." / "," / ";" / ":"
// in a span; stripping only the ends keeps internal punctuation intact, so
// "2.5 mg" and "q4-6h" survive while "daily." becomes "daily".
function cleanText(text: string): string {
	return text.replace(/^[\s.,;:]+/, "").replace(/[\s.,;:]+$/, "");
}

export function assembleMedications(note: string, spans: EntitySpan[]): Medication[] {
	const sents = sentences(note);
	const sentenceOf = (span: EntitySpan) =>
		sents.find((s) => span.start >= s.start && span.start < s.end) ?? { start: 0, end: note.length };

	const candidates: Medication[] = [];
	for (const name of spans.filter((s) => s.type === "MED_NAME")) {
		const sent = sentenceOf(name);
		const inSent = (s: EntitySpan) => s.start >= sent.start && s.start < sent.end;
		const nearest = (type: EntitySpan["type"]): string | null => {
			const options = spans.filter((s) => s.type === type && inSent(s));
			if (options.length === 0) return null;
			options.sort((a, b) => Math.abs(midpoint(a) - midpoint(name)) - Math.abs(midpoint(b) - midpoint(name)));
			return cleanText((options[0] as EntitySpan).text);
		};
		const cueSpans = spans.filter((s) => s.type === "STATUS_CUE" && inSent(s));
		const status = cueSpans.map((c) => statusFromCue(c.text)).find((s): s is Medication["status"] => s != null);
		candidates.push({
			name: cleanText(name.text),
			dose: nearest("DOSE"),
			route: nearest("ROUTE"),
			frequency: nearest("FREQUENCY"),
			status: status ?? "active",
		});
	}

	// Dedupe by normalized name: keep the richest mention (most attributes),
	// and let a non-"active" status win over a bare "active" re-mention.
	const byName = new Map<string, Medication>();
	const richness = (m: Medication) =>
		Number(m.dose != null) + Number(m.route != null) + Number(m.frequency != null);
	for (const med of candidates) {
		const key = normName(med.name);
		const existing = byName.get(key);
		if (!existing) {
			byName.set(key, med);
			continue;
		}
		const merged: Medication = {
			name: existing.name,
			dose: existing.dose ?? med.dose,
			route: existing.route ?? med.route,
			frequency: existing.frequency ?? med.frequency,
			status: existing.status !== "active" ? existing.status : med.status,
		};
		// Prefer the name spelling from the richer mention for display.
		merged.name = richness(med) > richness(existing) ? med.name : existing.name;
		byName.set(key, merged);
	}
	return [...byName.values()];
}

// Convenience: full token-tags → Medication[] path used by the browser runtime
// and the Node eval runner alike.
export function extractMedications(note: string, tokens: TokenTag[]): Medication[] {
	return assembleMedications(note, decodeBio(note, tokens));
}
