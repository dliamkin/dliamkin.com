// Preset scenarios. Each one is tuned to tell a specific story at default
// policy settings (uncapped retries, 5,000 trials, seed 42) - see
// docs/tail-risk-lab.md for the target numbers and the tuning script output.

import {
	DEFAULT_LOOP_DECAY,
	DEFAULT_RETRY_CONTEXT_GROWTH,
	type Scenario,
	type StepParams,
} from "./types";

interface StepOverrides {
	loopDecay?: number;
	retryContextGrowth?: number;
}

function step(
	id: string,
	label: string,
	inputTokensK: [number, number],
	outputTokensK: [number, number],
	loopRisk: number,
	overrides: StepOverrides = {},
): StepParams {
	return {
		id,
		label,
		inputTokensK,
		outputTokensK,
		loopRisk,
		loopDecay: overrides.loopDecay ?? DEFAULT_LOOP_DECAY,
		retryContextGrowth: overrides.retryContextGrowth ?? DEFAULT_RETRY_CONTEXT_GROWTH,
	};
}

// Story: one unbounded "fix the tests" step turns a tidy $2–3 refactor into a
// fat-tailed distribution - P99 several times P50. Capping retries at 2
// amputates that tail while barely moving the median.
const refactorAuth: Scenario = {
	id: "preset-refactor-auth",
	name: "Refactor auth module",
	targetModel: "opus",
	steps: [
		step("map-module", "Map the auth module", [20, 40], [2, 4], 0.05),
		step("plan-refactor", "Plan the refactor", [15, 25], [3, 6], 0.05),
		step("rewrite-core", "Rewrite core auth files", [25, 45], [6, 12], 0.15),
		step("update-callsites", "Update call sites", [20, 40], [4, 8], 0.2),
		step("fix-tests", "Fix all failing tests", [30, 60], [5, 10], 0.75, {
			loopDecay: 0.97,
			retryContextGrowth: 0.65,
		}),
		step("write-pr", "Write summary + PR description", [10, 20], [2, 4], 0.05),
	],
};

// Story: input-token variance dominates - you don't know how big 200 pages
// are until you fetch them. Moderate loop risk on the flaky scrape step.
const scrapeSummarize: Scenario = {
	id: "preset-scrape-200",
	name: "Scrape → summarize 200 pages",
	targetModel: "sonnet",
	steps: [
		step("fetch-pages", "Fetch & clean 200 pages", [100, 400], [5, 10], 0.35, {
			retryContextGrowth: 0.1,
		}),
		step("chunk-filter", "Chunk & filter relevant content", [80, 250], [8, 15], 0.1),
		step("summarize-clusters", "Summarize each cluster", [60, 180], [20, 40], 0.15),
		step("compose-digest", "Compose final digest", [20, 40], [5, 8], 0.05),
	],
};

// Story: eight individually boring steps, each with a small loop risk, still
// compound into a real tail - you rarely get a night where nothing retries.
const nightlyPipeline: Scenario = {
	id: "preset-nightly-pipeline",
	name: "Nightly data pipeline agent",
	targetModel: "haiku",
	steps: [
		step("pull-sources", "Pull source feeds", [15, 30], [1, 2], 0.15),
		step("validate-schemas", "Validate schemas", [10, 20], [1, 3], 0.12),
		step("dedupe-records", "Dedupe records", [12, 25], [1, 2], 0.12),
		step("enrich-entities", "Enrich entities", [15, 35], [2, 4], 0.18, { loopDecay: 0.9 }),
		step("reconcile-deltas", "Reconcile deltas", [10, 25], [2, 4], 0.2, { loopDecay: 0.9 }),
		step("build-rollups", "Build rollups", [8, 18], [1, 3], 0.12),
		step("write-outputs", "Write outputs", [6, 12], [1, 2], 0.1),
		step("post-report", "Post run report", [4, 8], [1, 2], 0.08),
	],
};

export const TAIL_RISK_PRESETS: Scenario[] = [refactorAuth, scrapeSummarize, nightlyPipeline];

export const CUSTOM_SCENARIO_ID = "custom";

/** Deep-copy a scenario so edits never mutate the preset constants. */
export function cloneScenario(scenario: Scenario): Scenario {
	return {
		...scenario,
		steps: scenario.steps.map((s) => ({
			...s,
			inputTokensK: [...s.inputTokensK],
			outputTokensK: [...s.outputTokensK],
		})),
	};
}
