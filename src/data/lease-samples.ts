import residentialRenewalOriginal from "./lease-samples/residential-renewal-original.txt?raw";
import residentialRenewalRevised from "./lease-samples/residential-renewal-revised.txt?raw";
import monthToMonthOriginal from "./lease-samples/month-to-month-original.txt?raw";
import monthToMonthRevised from "./lease-samples/month-to-month-revised.txt?raw";

export interface LeaseSamplePair {
	id: string;
	label: string;
	description: string;
	originalText: string;
	revisedText: string;
}

// Fully synthetic (fictional) lease pairs, stored as text files in
// ./lease-samples/. Their comparison results are pre-generated into
// lease-sample-results.json (npm run generate:lease-samples) so selecting an
// unmodified pair never hits the live API. scripts/generate-lease-samples.mjs
// reads the same files by id - keep ids and filenames in sync.
export const LEASE_SAMPLE_PAIRS: LeaseSamplePair[] = [
	{
		id: "residential-renewal",
		label: "Residential renewal",
		description: "A 12-month renewal with a rent increase and several new clauses",
		originalText: residentialRenewalOriginal,
		revisedText: residentialRenewalRevised,
	},
	{
		id: "month-to-month",
		label: "Month-to-month conversion",
		description: "A fixed term converted to month-to-month - some changes favor the tenant",
		originalText: monthToMonthOriginal,
		revisedText: monthToMonthRevised,
	},
];
