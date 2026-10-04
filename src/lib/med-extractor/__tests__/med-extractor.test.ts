import { describe, expect, it } from "vitest";
import { decodeBio, type TokenTag } from "../decode";
import { assembleMedications, extractMedications } from "../assembler";
import { BIO_LABELS, LABEL_TO_ID, type BioLabel } from "../labels";

// Build word-level TokenTags from a note by splitting on spaces and applying a
// parallel array of labels - a stand-in for the subword tokens the real model
// emits, sufficient to exercise decode + assembly deterministically.
function tokenize(note: string, labels: BioLabel[]): TokenTag[] {
	const tokens: TokenTag[] = [];
	let idx = 0;
	const words = note.split(" ");
	words.forEach((word, i) => {
		const start = note.indexOf(word, idx);
		const end = start + word.length;
		idx = end;
		tokens.push({ start, end, label: labels[i] ?? "O" });
	});
	return tokens;
}

describe("BIO label scheme", () => {
	it("has 11 labels in the fixed order, O first", () => {
		expect(BIO_LABELS.length).toBe(11);
		expect(BIO_LABELS[0]).toBe("O");
		expect(LABEL_TO_ID["I-STATUS_CUE"]).toBe(10);
	});
});

describe("decodeBio", () => {
	it("merges B/I runs into char spans", () => {
		const note = "lisinopril 10 mg daily";
		const spans = decodeBio(
			note,
			tokenize(note, ["B-MED_NAME", "B-DOSE", "I-DOSE", "B-FREQUENCY"]),
		);
		expect(spans).toEqual([
			{ start: 0, end: 10, type: "MED_NAME", text: "lisinopril" },
			{ start: 11, end: 16, type: "DOSE", text: "10 mg" },
			{ start: 17, end: 22, type: "FREQUENCY", text: "daily" },
		]);
	});

	it("treats a stray I- (no preceding B-) as the start of an entity", () => {
		const note = "metformin BID";
		const spans = decodeBio(note, tokenize(note, ["I-MED_NAME", "B-FREQUENCY"]));
		expect(spans[0]).toMatchObject({ type: "MED_NAME", text: "metformin" });
	});

	it("closes an entity on a type switch", () => {
		const note = "aspirin oral";
		const spans = decodeBio(note, tokenize(note, ["B-MED_NAME", "I-DOSE"]));
		expect(spans.map((s) => s.type)).toEqual(["MED_NAME", "DOSE"]);
	});
});

describe("assembleMedications", () => {
	it("binds nearest dose/route/frequency within the sentence and reads a status cue", () => {
		const note = "Started metformin 500 mg PO BID.";
		const meds = extractMedications(
			note,
			tokenize(note, ["B-STATUS_CUE", "B-MED_NAME", "B-DOSE", "I-DOSE", "B-ROUTE", "B-FREQUENCY"]),
		);
		expect(meds).toEqual([
			{ name: "metformin", dose: "500 mg", route: "PO", frequency: "BID", status: "new" },
		]);
	});

	it("does not bind a dose across a sentence boundary", () => {
		const note = "Continue lisinopril daily. Ibuprofen 400 mg PRN.";
		const meds = extractMedications(
			note,
			tokenize(note, [
				"O", "B-MED_NAME", "B-FREQUENCY", // "Continue lisinopril daily."
				"B-MED_NAME", "B-DOSE", "I-DOSE", "B-FREQUENCY", // "Ibuprofen 400 mg PRN."
			]),
		);
		const lisinopril = meds.find((m) => m.name === "lisinopril");
		expect(lisinopril?.dose).toBeNull(); // 400 mg belongs to ibuprofen, not lisinopril
		expect(meds.find((m) => m.name === "Ibuprofen")?.dose).toBe("400 mg");
	});

	it("collapses a bare plan-context re-mention into the mention that carries attributes", () => {
		const note = "Continue lisinopril 20 mg daily. Consider increasing lisinopril later.";
		const meds = extractMedications(
			note,
			tokenize(note, [
				"O", "B-MED_NAME", "B-DOSE", "I-DOSE", "B-FREQUENCY", // sentence 1 (rich)
				"O", "O", "B-MED_NAME", "O", // sentence 2 (bare re-mention)
			]),
		);
		expect(meds).toHaveLength(1);
		expect(meds[0]).toMatchObject({ name: "lisinopril", dose: "20 mg", frequency: "daily" });
	});

	it("returns an empty list when there are no medication spans (hard negative)", () => {
		const note = "No active medications. Vitals stable.";
		expect(assembleMedications(note, [])).toEqual([]);
	});
});
