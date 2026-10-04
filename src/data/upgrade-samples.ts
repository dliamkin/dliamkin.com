import sitePortfolio from "./upgrade-samples/site-portfolio.json?raw";
import legacyVue2 from "./upgrade-samples/legacy-vue2.json?raw";
import expressApi from "./upgrade-samples/express-api.json?raw";
import rawSampleFacts from "./upgrade-sample-facts.json";
import rawSampleResults from "./upgrade-sample-results.json";
import type { DependencyFacts } from "@/lib/upgrade-facts";
import type { UpgradePlanResult } from "@/lib/upgrade-planner";

export interface UpgradeSample {
	id: string;
	label: string;
	description: string;
	manifestText: string;
}

// Bundled samples ship with BOTH their facts snapshot (computed against the
// live registry at generation time - registry state drifts, hence the date
// stamp) and their pre-generated plan. Loading one never touches the registry
// or the API. scripts/generate-upgrade-samples.mjs regenerates all of it and
// refreshes site-portfolio.json from the repo's real package.json - keep ids
// in sync with SAMPLE_IDS there.
export const UPGRADE_SAMPLES: UpgradeSample[] = [
	{
		id: "site-portfolio",
		label: "This site's package.json",
		description:
			"The meta sample: the planner, planning its own host - this portfolio's real dependencies at snapshot time",
		manifestText: sitePortfolio,
	},
	{
		id: "legacy-vue2",
		label: "Legacy Vue 2 app",
		description:
			"A fictional 2021-era admin dashboard: a framework migration, packages up to 7 majors behind, a deprecated dependency, and five peer conflicts",
		manifestText: legacyVue2,
	},
	{
		id: "express-api",
		label: "Well-kept Express API",
		description:
			"A fictional, mostly-current API - the honest quiet case: almost everything already current, one small wave",
		manifestText: expressApi,
	},
];

interface SampleFactsFile {
	generated_at: string; // ISO date the registry was snapshotted
	facts: Record<string, DependencyFacts>;
}

const sampleFacts = rawSampleFacts as unknown as SampleFactsFile;

export const UPGRADE_SAMPLE_SNAPSHOT_DATE = sampleFacts.generated_at;

export function sampleFactsFor(id: string): DependencyFacts | null {
	return sampleFacts.facts[id] ?? null;
}

// Pre-generated plans arrive from generate:upgrade-samples runs with an API
// key; an id can be absent before the first keyed run, and the UI says so
// instead of calling the live API for a sample.
const samplePlans = rawSampleResults as unknown as Record<string, UpgradePlanResult>;

export function samplePlanFor(id: string): UpgradePlanResult | null {
	return samplePlans[id] ?? null;
}
