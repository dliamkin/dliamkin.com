import mapleVineLease from "./paperwork-samples/maple-vine-lease.txt?raw";
import scholarshipAward from "./paperwork-samples/scholarship-award.txt?raw";
import autoInsuranceSummary from "./paperwork-samples/auto-insurance-summary.txt?raw";

export interface PaperworkSample {
	id: string;
	label: string;
	description: string;
	text: string;
}

// The fixed "today" that the pre-generated sample results (and the eval
// suite) were produced against. Sample dates are planted in 2026-2027 so the
// results stay sensible for a long time; regenerating the samples
// (npm run generate:paperwork-samples) keeps using this anchor so in_past
// flags and relative arithmetic stay deterministic.
export const PAPERWORK_SAMPLE_TODAY = "2026-07-01";

// Fully synthetic (fictional) documents, stored as text files in
// ./paperwork-samples/. Their extraction results are pre-generated into
// paperwork-sample-results.json (npm run generate:paperwork-samples) so
// selecting an unmodified sample never hits the live API.
// scripts/generate-paperwork-samples.mjs and the eval suite read the same
// files by id - keep ids and filenames in sync.
export const PAPERWORK_SAMPLES: PaperworkSample[] = [
	{
		id: "maple-vine-lease",
		label: "Residential lease",
		description:
			"A 12-month lease with a 60-day non-renewal notice deadline, monthly rent, and a renewal offer tied to an undefined anniversary date",
		text: mapleVineLease,
	},
	{
		id: "scholarship-award",
		label: "Scholarship award letter",
		description:
			"An award letter with an acceptance deadline, an enrollment-verification window, a yearly GPA report, and one already-passed date",
		text: scholarshipAward,
	},
	{
		id: "auto-insurance-summary",
		label: "Auto insurance policy",
		description:
			"A policy summary with an expiration date, a 30-day cancellation notice window, monthly premiums, and a renewal-offer mail date",
		text: autoInsuranceSummary,
	},
];
