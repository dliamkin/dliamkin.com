import { SAMPLE_NOTES } from "../../../src/data/sample-notes";
import { STRUCTURE_NOTE_SYSTEM_PROMPT, type Medication, type StructuredNote } from "../../../src/lib/structured-note";
import {
	STRUCTURE_NOTE_MODEL,
	structureNote,
} from "../../../src/lib/pipelines/structure-note";
import {
	arrayIsEmpty,
	arrayNonEmpty,
	containsNormalized,
	defineSuite,
	fieldIsNull,
	normalized,
	setContains,
	setLacks,
	type EvalCase,
} from "../harness";
import type { CheckResult } from "../../../src/lib/evals";

// Eval suite for the Clinical Note Structurer: the 3 bundled sample notes
// plus 7 synthetic notes each planted with a specific extraction hazard
// (dose changes, discontinuations, absent fields that must stay absent,
// ambiguity that must not be guessed). All notes are fictional, in the same
// style as src/data/sample-notes.ts. Checks are per-field assertions against
// that planted ground truth.

const sampleText = (id: string): string => {
	const sample = SAMPLE_NOTES.find((s) => s.id === id);
	if (!sample) throw new Error(`Unknown sample note id: ${id}`);
	return sample.text;
};

const renderMed = (m: Medication) =>
	`${m.name} ${m.dose ?? "?"} ${m.frequency ?? "?"} [${m.status}]`;

// Dose matching tolerant of "20 mg" / "20mg" / "20 milligrams" style drift,
// anchored so "40" never matches "140".
const doseHas = (dose: string | null, amount: string) =>
	new RegExp(`(^|[^0-9.])${amount}([^0-9]|$)`).test(normalized(dose));

interface MedSpec {
	name: RegExp;
	dose?: string; // numeric part, e.g. "20"
	frequency?: RegExp;
	status?: Medication["status"][];
}

// "medications set-contains a med matching name/dose/frequency/status".
function hasMed(note: StructuredNote, expected: string, spec: MedSpec): CheckResult {
	return setContains(
		note.medications,
		expected,
		(m) =>
			spec.name.test(normalized(m.name)) &&
			(spec.dose === undefined || doseHas(m.dose, spec.dose)) &&
			(spec.frequency === undefined || spec.frequency.test(normalized(m.frequency))) &&
			(spec.status === undefined || spec.status.includes(m.status)),
		renderMed,
	);
}

const joinAll = (items: readonly string[]) => items.join(" ; ");

const cases: EvalCase<string, StructuredNote>[] = [
	// --- The 3 bundled demo samples -------------------------------------
	{
		id: "note-followup-htn",
		description:
			"Bundled follow-up sample: two active meds extracted exactly, no invented allergies, vitals and the lipid-panel follow-up captured",
		input: sampleText("follow-up"),
		checks: [
			{
				name: "extracts lisinopril 20 mg daily, active",
				run: (note) =>
					hasMed(note, "lisinopril 20 mg daily [active]", {
						name: /lisinopril/,
						dose: "20",
						frequency: /daily|qd|once/,
						status: ["active"],
					}),
			},
			{
				name: "extracts metformin 500 mg BID, active",
				run: (note) =>
					hasMed(note, "metformin 500 mg BID [active]", {
						name: /metformin/,
						dose: "500",
						frequency: /bid|twice/,
						status: ["active"],
					}),
			},
			{
				name: "allergies is empty (none mentioned in the note)",
				run: (note) => arrayIsEmpty(note.allergies),
			},
			{
				name: "blood pressure 128/82 captured",
				run: (note) => containsNormalized(note.vitals.blood_pressure, "128/82"),
			},
			{
				// The model defensibly files "pt to schedule lipid panel" under
				// either plan or follow_ups - what must not happen is losing it.
				name: "lipid panel action captured (plan or follow-ups)",
				run: (note) =>
					containsNormalized(
						joinAll([...note.plan, ...note.follow_ups.map((f) => f.action)]),
						"lipid",
					),
			},
		],
	},
	{
		id: "note-newpatient-headache",
		description:
			"Bundled new-patient sample: both allergies with reactions, vitals transcribed exactly, explicitly-educated red flags surfaced",
		input: sampleText("new-patient"),
		checks: [
			{
				name: "penicillin allergy captured",
				run: (note) => containsNormalized(joinAll(note.allergies), "penicillin"),
			},
			{
				name: "sulfa allergy captured",
				run: (note) => containsNormalized(joinAll(note.allergies), "sulfa"),
			},
			{
				name: "blood pressure 118/74 captured",
				run: (note) => containsNormalized(note.vitals.blood_pressure, "118/74"),
			},
			{
				name: "temperature 98.2 captured",
				run: (note) => containsNormalized(note.vitals.temperature, "98.2"),
			},
			{
				name: "red flags present (note explicitly educates on them)",
				run: (note) => arrayNonEmpty(note.red_flags),
			},
		],
	},
	{
		id: "note-urgentcare-ankle",
		description:
			"Bundled urgent-care sample: new ibuprofen prescription with dose, return precautions not lost in extraction",
		input: sampleText("urgent-care"),
		checks: [
			{
				name: "extracts ibuprofen 600 mg, new or active",
				run: (note) =>
					hasMed(note, "ibuprofen 600 mg TID [new]", {
						name: /ibuprofen/,
						dose: "600",
						status: ["new", "active"],
					}),
			},
			{
				name: "heart rate 80 captured",
				run: (note) => containsNormalized(note.vitals.heart_rate, "80"),
			},
			{
				// "Return precautions" are conditional warnings - the model
				// defensibly files them under red_flags or plan, but must not
				// drop them. (note-explicit-redflags covers the strict case.)
				name: "return precautions captured (red flags or plan)",
				run: (note) =>
					containsNormalized(
						joinAll([...note.red_flags, ...note.plan, ...note.follow_ups.map((f) => f.action)]),
						"bear weight",
					),
			},
			{
				name: "PCP follow-up captured",
				run: (note) =>
					setContains(
						note.follow_ups,
						"a follow-up mentioning the PCP or 1 week",
						(f) =>
							normalized(f.action).includes("pcp") ||
							normalized(f.timeframe).includes("1 week") ||
							normalized(f.timeframe).includes("one week"),
						(f) => `${f.action} (${f.timeframe ?? "no timeframe"})`,
					),
			},
		],
	},

	// --- New synthetic notes, each planted with a hazard -----------------
	{
		id: "note-dose-change",
		description:
			"Dose change mid-note: atorvastatin increased 20→40 mg - the extracted dose must be the new one, not the old",
		input:
			"Pt is a 63 y/o male here for f/u on hyperlipidemia and HTN. Lipid panel last week shows LDL 148 despite atorvastatin 20mg nightly - increasing to atorvastatin 40mg nightly starting tonight. Amlodipine 5mg daily continued unchanged. Home BP log running 120s-130s over 70s-80s. BP today 126/78, HR 66. No chest pain, no myalgias on statin. Assessment: hyperlipidemia suboptimally controlled on prior dose, HTN at goal. Plan: increase atorvastatin to 40mg nightly, continue amlodipine 5mg daily, repeat lipid panel in 12 weeks. RTC 3 months.",
		checks: [
			{
				name: "atorvastatin extracted at the NEW dose (40 mg nightly)",
				run: (note) =>
					hasMed(note, "atorvastatin 40 mg nightly", {
						name: /atorvastatin/,
						dose: "40",
						frequency: /night|qhs|bedtime|even/,
					}),
			},
			{
				name: "no active atorvastatin left at the old 20 mg dose",
				run: (note) =>
					setLacks(
						note.medications,
						"atorvastatin 20 mg still marked active/new",
						(m) =>
							/atorvastatin/.test(normalized(m.name)) &&
							doseHas(m.dose, "20") &&
							(m.status === "active" || m.status === "new"),
						renderMed,
					),
			},
			{
				name: "amlodipine 5 mg daily unchanged, active",
				run: (note) =>
					hasMed(note, "amlodipine 5 mg daily [active]", {
						name: /amlodipine/,
						dose: "5",
						frequency: /daily|qd|once/,
						status: ["active"],
					}),
			},
			{
				name: "blood pressure 126/78 captured",
				run: (note) => containsNormalized(note.vitals.blood_pressure, "126/78"),
			},
		],
	},
	{
		id: "note-discontinued-med",
		description:
			"Discontinued medication: HCTZ stopped for hyponatremia - status must be discontinued, not active",
		input:
			"Pt is a 71 y/o female here for f/u after recent admission for symptomatic hyponatremia. Hydrochlorothiazide 25mg daily was DISCONTINUED at hospital discharge due to low sodium - pt confirms she has stopped taking it. Continues losartan 50mg daily for HTN. Sodium today 138, up from 126 at admission. BP 134/80, HR 76. Denies dizziness, confusion, falls. Assessment: hyponatremia resolved off HCTZ, HTN acceptable on losartan alone. Plan: remain off hydrochlorothiazide, recheck BMP in 4 weeks, RTC 2 months.",
		checks: [
			{
				name: "hydrochlorothiazide status is discontinued",
				run: (note) =>
					hasMed(note, "hydrochlorothiazide 25 mg [discontinued]", {
						name: /hydrochlorothiazide|hctz/,
						status: ["discontinued"],
					}),
			},
			{
				name: "no active/new hydrochlorothiazide entry remains",
				run: (note) =>
					setLacks(
						note.medications,
						"hydrochlorothiazide marked active or new",
						(m) =>
							/hydrochlorothiazide|hctz/.test(normalized(m.name)) &&
							(m.status === "active" || m.status === "new"),
						renderMed,
					),
			},
			{
				name: "losartan 50 mg daily remains active",
				run: (note) =>
					hasMed(note, "losartan 50 mg daily [active]", {
						name: /losartan/,
						dose: "50",
						status: ["active"],
					}),
			},
		],
	},
	{
		id: "note-no-allergies",
		description:
			"Allergies never mentioned: the allergies array must stay empty - not populated with NKDA or invented entries",
		input:
			"Pt is a 45 y/o male here for annual physical. Feels well, no complaints. Takes omeprazole 20mg daily for GERD, well controlled. Ex-smoker, quit 5 years ago, 15 pack-year history. Exercises 2-3x/week. BP 121/79, HR 74. Exam unremarkable. Assessment: healthy adult male, GERD controlled on PPI. Plan: routine screening labs, continue omeprazole 20mg daily, discussed colonoscopy scheduling at 45. RTC 1 year.",
		checks: [
			{
				name: "allergies is an empty array (note never mentions allergies)",
				run: (note) => arrayIsEmpty(note.allergies),
			},
			{
				name: "omeprazole 20 mg daily extracted, active",
				run: (note) =>
					hasMed(note, "omeprazole 20 mg daily [active]", {
						name: /omeprazole/,
						dose: "20",
						frequency: /daily|qd|once/,
						status: ["active"],
					}),
			},
		],
	},
	{
		id: "note-explicit-redflags",
		description:
			"Explicit urgency in the note: ED precautions for possible unstable angina must appear in red_flags",
		input:
			"Pt is a 66 y/o male reporting exertional chest tightness x 2 weeks, resolving within minutes of rest. Hx HTN on amlodipine 10mg daily. In-office ECG without acute changes. Given the symptom pattern, concern for possible unstable angina - pt instructed to go to the ED immediately if pain occurs at rest, lasts more than 10 minutes, or radiates to the arm or jaw. Urgent cardiology referral placed for this week. Aspirin 81mg daily started today. BP 142/88, HR 78. Assessment: exertional chest pain, urgent evaluation warranted. Plan: urgent cardiology referral, stress testing per cardiology, strict ED return precautions reviewed with pt.",
		checks: [
			{
				name: "red flags present (note explicitly flags urgent ED precautions)",
				run: (note) => arrayNonEmpty(note.red_flags),
			},
			{
				name: "red flags reference the cardiac concern",
				run: (note) => {
					const flags = joinAll(note.red_flags);
					return {
						passed: /chest|angina|cardi/.test(normalized(flags)),
						expected: 'mentions the chest pain / angina concern (matches "chest", "angina", or "cardi…")',
						actual: note.red_flags.length === 0 ? "empty array" : `"${flags}"`,
					};
				},
			},
			{
				name: "aspirin 81 mg captured as newly started",
				run: (note) =>
					hasMed(note, "aspirin 81 mg daily [new]", {
						name: /aspirin/,
						dose: "81",
						status: ["new"],
					}),
			},
		],
	},
	{
		id: "note-benign-complex-meds",
		description:
			"Nothing urgent but four chronic meds: all extracted with doses, and red_flags stays empty - no false alarms",
		input:
			"Pt is a 52 y/o female here for stable f/u of T2DM, HTN, and hypothyroidism. All chronic conditions well controlled; no new complaints, feels well. Medications reviewed and unchanged: metformin 1000mg BID, glipizide 5mg daily before breakfast, lisinopril 10mg daily, levothyroxine 88mcg daily on empty stomach. A1c last week 6.8, TSH 2.1, both at goal. BP 124/76, HR 70. Foot exam normal, denies hypoglycemic episodes. Assessment: T2DM at goal, HTN controlled, hypothyroidism euthyroid on current dose. Plan: continue all current medications unchanged, routine labs in 6 months. RTC 6 months.",
		checks: [
			{
				name: "red_flags is empty (nothing urgent in the note)",
				run: (note) => arrayIsEmpty(note.red_flags),
			},
			{
				name: "metformin 1000 mg BID extracted",
				run: (note) =>
					hasMed(note, "metformin 1000 mg BID [active]", {
						name: /metformin/,
						dose: "1000",
						frequency: /bid|twice/,
						status: ["active"],
					}),
			},
			{
				name: "glipizide 5 mg daily extracted",
				run: (note) =>
					hasMed(note, "glipizide 5 mg daily [active]", {
						name: /glipizide/,
						dose: "5",
						status: ["active"],
					}),
			},
			{
				name: "lisinopril 10 mg daily extracted",
				run: (note) =>
					hasMed(note, "lisinopril 10 mg daily [active]", {
						name: /lisinopril/,
						dose: "10",
						status: ["active"],
					}),
			},
			{
				name: "levothyroxine 88 mcg daily extracted",
				run: (note) =>
					hasMed(note, "levothyroxine 88 mcg daily [active]", {
						name: /levothyroxine/,
						dose: "88",
						status: ["active"],
					}),
			},
		],
	},
	{
		id: "note-sparse-vitals",
		description:
			"Telehealth visit with only a reported home BP: every unmeasured vital must be null, not invented",
		input:
			"Pt is a 29 y/o male, telehealth visit for seasonal allergic rhinitis. Sneezing, nasal congestion, itchy eyes x 2 weeks, consistent with prior spring seasons. No fever, no facial pain or pressure, no purulent discharge. Telehealth visit - no vitals obtained except home BP 119/75 reported by pt from his own cuff. Assessment: seasonal allergic rhinitis. Plan: OTC loratadine 10mg daily during pollen season, saline nasal rinses, return if fever or facial pain develops. RTC PRN.",
		checks: [
			{
				name: "reported home BP 119/75 captured",
				run: (note) => containsNormalized(note.vitals.blood_pressure, "119/75"),
			},
			{
				name: "heart rate is null (never measured)",
				run: (note) => fieldIsNull(note.vitals.heart_rate),
			},
			{
				name: "temperature is null (never measured)",
				run: (note) => fieldIsNull(note.vitals.temperature),
			},
			{
				name: "oxygen saturation is null (never measured)",
				run: (note) => fieldIsNull(note.vitals.oxygen_saturation),
			},
			{
				name: "weight is null (never measured)",
				run: (note) => fieldIsNull(note.vitals.weight),
			},
		],
	},
	{
		id: "note-ambiguous-dose",
		description:
			"Ambiguous dose (25 vs 50 mg, records pending): must land in extraction_notes and must not be resolved by guessing",
		input:
			"Pt is a 60 y/o male, new to practice, transferring care from out of state. Reports taking 'a water pill' and metoprolol for blood pressure but is unsure of the metoprolol dose - thinks it is either 25mg or 50mg twice daily; pharmacy records requested and pending. Also takes atorvastatin 20mg nightly, confirmed from the bottle he brought in. BP 138/84, HR 58. Assessment: HTN on unconfirmed regimen, medication reconciliation pending. Plan: obtain pharmacy records, continue current regimen once confirmed, RTC 4 weeks with bottles.",
		checks: [
			{
				name: "metoprolol dose is not silently guessed as exactly 25 or exactly 50",
				run: (note) => {
					const metoprolol = note.medications.find((m) =>
						/metoprolol/.test(normalized(m.name)),
					);
					const dose = metoprolol?.dose ?? null;
					// Acceptable: null, or a value that preserves the uncertainty
					// (mentions both candidates). Unacceptable: exactly one of them.
					const digits = (dose ?? "").match(/\d+/g) ?? [];
					const guessedOne =
						digits.length === 1 && (digits[0] === "25" || digits[0] === "50");
					return {
						passed: metoprolol !== undefined && !guessedOne,
						expected:
							"metoprolol present with dose null or explicitly uncertain (not a single guessed value)",
						actual: metoprolol ? renderMed(metoprolol) : "metoprolol not extracted",
					};
				},
			},
			{
				name: "the dose ambiguity lands in extraction_notes",
				run: (note) => containsNormalized(joinAll(note.extraction_notes), "metoprolol"),
			},
			{
				name: "confirmed atorvastatin 20 mg nightly extracted normally",
				run: (note) =>
					hasMed(note, "atorvastatin 20 mg nightly [active]", {
						name: /atorvastatin/,
						dose: "20",
						status: ["active"],
					}),
			},
		],
	},
];

export const noteStructurerSuite = defineSuite({
	project_id: "note-structurer",
	project_label: "Clinical Note Structurer",
	model: STRUCTURE_NOTE_MODEL,
	prompt: STRUCTURE_NOTE_SYSTEM_PROMPT,
	cases,
	execute: (client, input) => structureNote(client, input),
});
