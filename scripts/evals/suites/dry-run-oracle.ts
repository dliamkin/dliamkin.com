import type { CheckResult } from "../../../src/lib/evals";
import {
	SIMULATE_PLAN_DEFAULT_MODEL,
	simulatePlan,
} from "../../../src/lib/pipelines/simulate-plan";
import {
	SIMULATE_PLAN_SYSTEM_PROMPT,
	planCostRange,
	planWorstCaseCost,
	type SimulateRequest,
	type SimulationResult,
} from "../../../src/lib/dry-run-oracle";
import { defineSuite, type EvalCase } from "../harness";

// Eval suite for the Dry-Run Oracle. Two things are measured: the model's
// risk judgment (does an unbounded "until green" step read as dangerous? does
// a small bounded task read as calm?) and the deterministic finalization
// layer (cost totals must be internally consistent, and structured plans must
// be assessed step-for-step - the pipeline itself throws when they aren't).
// Checks are deliberately generous about exact numbers: token predictions are
// the model's judgment call, but orderings and invariants are not.

const renderSteps = (output: SimulationResult) =>
	output.steps
		.map((s) => `${s.stepId}[${s.riskLevel} loop=${s.loopRisk.toFixed(2)} it=${s.predictedIterations}]`)
		.join(" | ");

function stepRisk(
	output: SimulationResult,
	stepId: string,
	expected: ("clear" | "caution" | "storm")[],
): CheckResult {
	const step = output.steps.find((s) => s.stepId === stepId);
	return {
		passed: step !== undefined && expected.includes(step.riskLevel),
		expected: `${stepId} assessed ${expected.join(" or ")}`,
		actual: step ? `${stepId} assessed ${step.riskLevel}` : `no assessment for ${stepId}: ${renderSteps(output)}`,
	};
}

function stepLoopRiskAtLeast(output: SimulationResult, stepId: string, min: number): CheckResult {
	const step = output.steps.find((s) => s.stepId === stepId);
	return {
		passed: step !== undefined && step.loopRisk >= min,
		expected: `${stepId} loop risk >= ${min}`,
		actual: step ? `${stepId} loop risk ${step.loopRisk.toFixed(2)}` : `no assessment for ${stepId}`,
	};
}

function stepHasFix(output: SimulationResult, stepId: string): CheckResult {
	const step = output.steps.find((s) => s.stepId === stepId);
	return {
		passed: step !== undefined && typeof step.suggestedFix === "string" && step.suggestedFix.length > 0,
		expected: `${stepId} carries a concrete suggested fix`,
		actual: step
			? step.suggestedFix
				? `fix: "${step.suggestedFix.slice(0, 80)}..."`
				: "no suggested fix"
			: `no assessment for ${stepId}`,
	};
}

// The deterministic-finalization invariants: money fields must be exactly
// what the shared pricing functions produce for the returned assessments,
// ordered low <= high <= worst, with a positive self-cost from real usage.
function costMathConsistent(output: SimulationResult, targetModel: SimulateRequest["targetModel"]): CheckResult {
	const [low, high] = planCostRange(output.steps, targetModel);
	const worst = planWorstCaseCost(output.steps, targetModel);
	const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
	const consistent =
		close(output.totalCostUsd[0], low) &&
		close(output.totalCostUsd[1], high) &&
		close(output.worstCaseCostUsd, worst) &&
		low <= high &&
		high <= worst + 1e-9;
	return {
		passed: consistent,
		expected: "totals equal to pricing-table math with low <= high <= worst case",
		actual: `low=${output.totalCostUsd[0].toFixed(4)} high=${output.totalCostUsd[1].toFixed(4)} worst=${output.worstCaseCostUsd.toFixed(4)} (recomputed: ${low.toFixed(4)}/${high.toFixed(4)}/${worst.toFixed(4)})`,
	};
}

function oracleCostReported(output: SimulationResult): CheckResult {
	const savingsConsistent =
		output.oracleCostUsd > 0 &&
		Math.abs(output.savingsMultiple - output.worstCaseCostUsd / output.oracleCostUsd) < 0.01;
	return {
		passed: savingsConsistent,
		expected: "oracleCostUsd > 0 (from real usage) and savingsMultiple = worst / oracle cost",
		actual: `oracleCostUsd=${output.oracleCostUsd.toFixed(5)} savingsMultiple=${output.savingsMultiple.toFixed(1)}`,
	};
}

function headlinePresent(output: SimulationResult): CheckResult {
	const ok = output.forecastHeadline.trim().length >= 10;
	return {
		passed: ok,
		expected: "a non-trivial one-sentence forecast headline",
		actual: `"${output.forecastHeadline}"`,
	};
}

function inferredPlanMatches(output: SimulationResult, minSteps: number): CheckResult {
	const inferred = output.inferredPlan;
	if (!inferred) {
		return {
			passed: false,
			expected: `an inferredPlan with at least ${minSteps} structured steps`,
			actual: "no inferredPlan on the result",
		};
	}
	const idsUnique = new Set(inferred.steps.map((s) => s.id)).size === inferred.steps.length;
	const descriptionsPresent = inferred.steps.every((s) => s.description.trim().length > 0);
	const coversAssessments =
		inferred.steps.length === output.steps.length &&
		output.steps.every((a) => inferred.steps.some((s) => s.id === a.stepId));
	return {
		passed: inferred.steps.length >= minSteps && idsUnique && descriptionsPresent && coversAssessments,
		expected: `>= ${minSteps} inferred steps, unique ids, non-empty descriptions, 1:1 with assessments`,
		actual: `${inferred.steps.length} steps: ${inferred.steps.map((s) => s.id).join(", ")}`,
	};
}

// ---------------------------------------------------------------------------
// Fixtures.

const refactorPlan: SimulateRequest = {
	title: "Refactor auth module across 40 files",
	targetModel: "claude-opus",
	contextNotes:
		"Mid-size TypeScript monorepo (~180K LOC). Legacy auth module imported in 40 files. CI suite takes 6 minutes.",
	steps: [
		{
			id: "s1",
			description: "Map all usages of the legacy auth module across the codebase",
			tools: ["grep", "file_read"],
			expectedIterations: 2,
		},
		{
			id: "s2",
			description: "Refactor all 40 files to the new interface",
			tools: ["file_read", "file_write"],
			expectedIterations: 8,
		},
		{
			id: "s3",
			description: "Fix all failing tests until the suite is green",
			tools: ["bash", "file_write"],
			expectedIterations: 3,
		},
	],
};

const boundedPlan: SimulateRequest = {
	title: "Summarize one README",
	targetModel: "claude-haiku",
	steps: [
		{
			id: "s1",
			description:
				"Read the repository README.md (about 300 lines) and write a five-bullet summary to summary.md",
			tools: ["file_read", "file_write"],
			expectedIterations: 1,
		},
	],
};

const freeformPlan: SimulateRequest = {
	title: "Migrate blog to new CMS",
	targetModel: "claude-sonnet",
	freeform:
		"First export all 200 posts from the old CMS via its REST API. Then convert each post's HTML to markdown, fixing image links. After that, upload everything to the new CMS and set up redirects from the old URLs. Finally spot-check 10 random posts for formatting breakage.",
};

const cases: EvalCase<SimulateRequest, SimulationResult>[] = [
	{
		id: "oracle-unbounded-test-loop",
		description:
			'An unbounded "fix tests until green" step must read as the risky one: elevated risk level, high loop risk, and a concrete fix.',
		input: refactorPlan,
		checks: [
			{ name: "until-green step tiered caution or storm", run: (o) => stepRisk(o, "s3", ["caution", "storm"]) },
			{ name: "until-green loop risk at least 0.4", run: (o) => stepLoopRiskAtLeast(o, "s3", 0.4) },
			{ name: "until-green step carries a suggested fix", run: (o) => stepHasFix(o, "s3") },
			{ name: "recon step not tiered storm", run: (o) => stepRisk(o, "s1", ["clear", "caution"]) },
			{ name: "cost totals internally consistent", run: (o) => costMathConsistent(o, "claude-opus") },
			{ name: "oracle self-cost and savings multiple reported", run: oracleCostReported },
		],
	},
	{
		id: "oracle-bounded-single-step",
		description:
			"A small, bounded single-step task must not be dramatized: calm overall risk, no abort, low loop risk.",
		input: boundedPlan,
		checks: [
			{
				name: "overall risk clear or caution",
				run: (o) => ({
					passed: o.overallRisk === "clear" || o.overallRisk === "caution",
					expected: "overall risk clear or caution",
					actual: `overall risk ${o.overallRisk}`,
				}),
			},
			{
				name: "abort not recommended",
				run: (o) => ({
					passed: !o.abortRecommended,
					expected: "abortRecommended false",
					actual: String(o.abortRecommended),
				}),
			},
			{ name: "single step loop risk below 0.5", run: (o) => ({
				...stepLoopRiskAtLeast(o, "s1", 0),
				passed: (o.steps[0]?.loopRisk ?? 1) < 0.5,
				expected: "s1 loop risk < 0.5",
			}) },
			{ name: "forecast headline present", run: headlinePresent },
			{ name: "cost totals internally consistent", run: (o) => costMathConsistent(o, "claude-haiku") },
		],
	},
	{
		id: "oracle-freeform-structuring",
		description:
			"A freeform prose plan must come back structured: at least 3 inferred steps with unique ids matching the assessments 1:1.",
		input: freeformPlan,
		checks: [
			{ name: "inferred plan structured 1:1", run: (o) => inferredPlanMatches(o, 3) },
			{ name: "forecast headline present", run: headlinePresent },
			{ name: "cost totals internally consistent", run: (o) => costMathConsistent(o, "claude-sonnet") },
			{ name: "oracle self-cost and savings multiple reported", run: oracleCostReported },
		],
	},
];

export const dryRunOracleSuite = defineSuite<SimulateRequest, SimulationResult>({
	project_id: "dry-run-oracle",
	project_label: "Dry-Run Oracle",
	model: SIMULATE_PLAN_DEFAULT_MODEL,
	prompt: SIMULATE_PLAN_SYSTEM_PROMPT,
	cases,
	execute: (client, input) => simulatePlan(client, input),
});
