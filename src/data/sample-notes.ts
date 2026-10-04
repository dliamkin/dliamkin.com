export interface SampleNote {
	id: string;
	label: string;
	text: string;
}

// Fully synthetic (fictional) clinical notes. Their structured results are
// pre-generated into sample-note-results.json (npm run generate:samples) so
// selecting a sample never hits the live API.
export const SAMPLE_NOTES: SampleNote[] = [
	{
		id: "follow-up",
		label: "Follow-up visit",
		text: "Pt is a 58 y/o male here for f/u on HTN and T2DM. Reports good adherence to lisinopril 20mg daily and metformin 500mg BID. Home BP readings averaging 130s/80s. Denies chest pain, SOB, dizziness. Notes occasional tingling in feet, worse at night. BP today 128/82, HR 72, wt 204 lbs (down 3 lbs). A1c last month 7.1, down from 7.8. Assessment: HTN controlled, T2DM improving, possible early peripheral neuropathy. Plan: continue current meds, order monofilament test, discussed diet wins. RTC 3 months, sooner if foot symptoms worsen. Pt to schedule lipid panel within 2 weeks.",
	},
	{
		id: "new-patient",
		label: "New patient",
		text: "New pt intake, 34 y/o female. CC: recurrent headaches x 2 months, described as bilateral, pressure-like, 3-4x/week, worse late afternoon. Denies aura, vision changes, N/V. Works remote, reports high screen time and poor sleep (5-6 hrs). No current medications. Allergies: penicillin (hives), sulfa (unknown reaction per pt). Vitals: BP 118/74, HR 68, T 98.2F, SpO2 99%. Neuro exam grossly normal. Assessment: tension-type headache, likely lifestyle contributors; r/o refractive error. Plan: sleep hygiene counseling, trial of OTC ibuprofen 400mg PRN max 3x/week, recommend eye exam, headache diary. F/u 6 weeks or sooner if red flag sx (worst headache of life, focal deficits, fever w/ stiff neck) - pt educated on these.",
	},
	{
		id: "urgent-care",
		label: "Urgent care",
		text: "22 y/o male presents to urgent care with R ankle pain after inversion injury playing basketball ~3 hrs ago. Able to bear weight x4 steps with pain. Swelling over lateral malleolus, TTP anterior talofibular region, no bony tenderness at posterior malleolus or base of 5th metatarsal. Ottawa criteria negative. Vitals: BP 122/78, HR 80, T 98.6F. Assessment: Grade I-II lateral ankle sprain. Plan: RICE protocol, air stirrup brace dispensed, ibuprofen 600mg TID with food x5 days, crutches PRN first 48h. Return precautions: inability to bear weight, numbness, worsening swelling. F/u with PCP in 1 week if not improving. Work note provided x2 days.",
	},
];
