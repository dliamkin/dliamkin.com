import type { Medication } from "../../src/lib/structured-note";
import { DRUGS, ALLERGY_DRUGS, mulberry32 } from "./templates";
import type { NoteSpec } from "./types";

// Deterministic, API-free stand-in for the generate→label pair, used by
// `--mock` to prove the entire pipeline (generation shape → labeling shape →
// alignment → dedupe → splits) end to end at $0 before spending on real calls.
// A single pure function returns BOTH the note text and the exact teacher
// Medication[] so the two stages stay consistent; the real path gets these
// from two independent API calls.
//
// It writes the medication attribute strings verbatim into the note (so
// alignment succeeds), emits explicit cue words for new/discontinued status,
// names allergy-only drugs when the spec asks (the allergy-context trap), and
// - for a small fraction - injects a phantom medication that is NOT written
// into the note, exercising the "name-unlocatable" discard branch.

export interface MockBuild {
	note: string;
	medications: Medication[];
}

export function mockBuild(spec: NoteSpec): MockBuild {
	const rng = mulberry32(spec.seed ^ 0x9e3779b9);
	const sentences: string[] = [];
	sentences.push(
		`${spec.specialty} visit, synthetic note. Pt seen today, reviewed history and current concerns.`,
	);

	const medications: Medication[] = [];
	const usedDrugs = new Set<number>();
	const wantNew = spec.tricky.includes("new-med");
	const wantDiscontinued = spec.tricky.includes("discontinued-med");

	for (let i = 0; i < spec.medCount; i++) {
		let idx = Math.floor(rng() * DRUGS.length);
		let guard = 0;
		while (usedDrugs.has(idx) && guard++ < DRUGS.length) idx = (idx + 1) % DRUGS.length;
		usedDrugs.add(idx);
		const drug = DRUGS[idx];
		if (!drug) continue;

		const dose = drug.doses[Math.floor(rng() * drug.doses.length)] ?? null;
		// Occasionally drop route/frequency to exercise null-field handling.
		const route = rng() < 0.75 ? (drug.routes[Math.floor(rng() * drug.routes.length)] ?? null) : null;
		const frequency = rng() < 0.85 ? (drug.freqs[Math.floor(rng() * drug.freqs.length)] ?? null) : null;

		let status: Medication["status"] = "active";
		let sentence: string;
		if (i === 0 && wantNew) {
			status = "new";
			sentence = `Started ${drug.name} ${dose ?? ""}${route ? " " + route : ""}${frequency ? " " + frequency : ""}.`;
		} else if (i === 1 && wantDiscontinued) {
			status = "discontinued";
			sentence = `Discontinued ${drug.name}; pt to stop taking it.`;
		} else {
			sentence = `Continue ${drug.name} ${dose ?? ""}${route ? " " + route : ""}${frequency ? " " + frequency : ""}.`;
		}
		sentences.push(sentence.replace(/\s+/g, " ").trim());
		medications.push({ name: drug.name, dose, route, frequency, status });
	}

	// The allergy-context trap: an allergy-only drug that must stay untagged.
	if (spec.tricky.includes("allergy-context")) {
		const allergen = ALLERGY_DRUGS[Math.floor(rng() * ALLERGY_DRUGS.length)] ?? "penicillin";
		sentences.push(`Allergies: ${allergen} (rash). No other known drug allergies.`);
	}

	sentences.push("Vitals stable. Assessment and plan discussed. RTC as needed.");

	// Phantom medication: labeled by the "teacher" but never written into the
	// note → alignment must discard this example. ~12% of med-bearing notes.
	if (spec.medCount > 0 && rng() < 0.12) {
		medications.push({ name: "phantomazole", dose: "5 mg", route: "oral", frequency: "daily", status: "active" });
	}

	return { note: sentences.join(" "), medications };
}
