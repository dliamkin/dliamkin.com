import { SAMPLE_NOTES } from "../../src/data/sample-notes";
import { DUPE_JACCARD, EVAL_OVERLAP_JACCARD, SHINGLE_SIZE } from "./config";

// Hygiene: dedupe near-identical generated notes, and - critically - guard the
// public eval cases. Those samples are the fair exam both teacher and student
// sit; if a generated note leaks one into training, the student's dashboard
// score stops meaning anything. We compare with Jaccard similarity over word
// shingles: cheap, order-sensitive enough to catch real overlap, forgiving of
// trivial rewording.

export function shingles(text: string, k: number = SHINGLE_SIZE): Set<string> {
	const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
	const set = new Set<string>();
	for (let i = 0; i + k <= words.length; i++) set.add(words.slice(i, i + k).join(" "));
	// Short notes shorter than k words still get one whole-note shingle.
	if (set.size === 0 && words.length > 0) set.add(words.join(" "));
	return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const s of a) if (b.has(s)) intersection++;
	return intersection / (a.size + b.size - intersection);
}

// Precomputed shingle sets for every public eval sample note.
const EVAL_SHINGLES = SAMPLE_NOTES.map((n) => shingles(n.text));

// Returns true if the note is too close to any public eval sample - an exam
// leak that must be dropped.
export function overlapsEvalSet(noteShingles: Set<string>): boolean {
	return EVAL_SHINGLES.some((evalSet) => jaccard(noteShingles, evalSet) >= EVAL_OVERLAP_JACCARD);
}

// Incremental near-dupe detector across the generated set. Feed notes in
// order; each call reports whether the note duplicates one already accepted,
// and (if not) retains its shingles for future comparisons.
export class DupeGuard {
	private readonly seen: Set<string>[] = [];

	isDupe(noteShingles: Set<string>): boolean {
		return this.seen.some((prev) => jaccard(noteShingles, prev) >= DUPE_JACCARD);
	}

	remember(noteShingles: Set<string>): void {
		this.seen.push(noteShingles);
	}
}
