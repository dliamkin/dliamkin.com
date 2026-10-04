import {
	finalizeSimulation,
	type AgentPlan,
	type RawSimulation,
	type SimulateRequest,
	type SimulationResult,
} from "@/lib/dry-run-oracle";

// The bundled sample forecast for the Dry-Run Oracle. Like the other demos'
// pre-generated results, submitting the unmodified sample renders this
// instantly - zero API calls. It deliberately exercises the UI's full range:
// one storm-level step (an unbounded "fix all failing tests" loop) with a
// suggested fix, a caution step, and clear steps.
//
// The dollar fields are computed through finalizeSimulation - the exact
// production code path - so the sample numbers always agree with the live
// pricing table.

export const ORACLE_SAMPLE_PLAN: AgentPlan = {
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
			description:
				"Design the new auth interface and write a migration plan to a scratch file",
			tools: ["file_read", "file_write"],
			expectedIterations: 1,
		},
		{
			id: "s3",
			description: "Refactor all 40 files to the new interface",
			tools: ["file_read", "file_write"],
			expectedIterations: 8,
		},
		{
			id: "s4",
			description: "Fix all failing tests until the suite is green",
			tools: ["bash", "file_write"],
			expectedIterations: 3,
		},
		{
			id: "s5",
			description: "Write a migration summary and changelog entry",
			tools: ["file_write"],
			expectedIterations: 1,
		},
	],
};

const SAMPLE_RAW: RawSimulation = {
	overall_risk: "storm",
	forecast_headline:
		"Mostly clear through step 3, then an 85% chance of retry storms in step 4 - pack a test-attempt cap.",
	abort_recommended: false,
	steps: [
		{
			step_id: "s1",
			description: "Map all usages of the legacy auth module across the codebase",
			risk_level: "clear",
			failure_modes: ["Grep patterns may miss dynamic imports and re-exports"],
			loop_risk: 0.05,
			input_tokens: { low: 8_000, high: 14_000 },
			output_tokens: { low: 1_200, high: 2_500 },
			iterations: 2,
			suggested_fix: "",
		},
		{
			step_id: "s2",
			description:
				"Design the new auth interface and write a migration plan to a scratch file",
			risk_level: "clear",
			failure_modes: ["Interface may under-specify session-refresh edge cases"],
			loop_risk: 0.1,
			input_tokens: { low: 10_000, high: 16_000 },
			output_tokens: { low: 2_000, high: 4_000 },
			iterations: 1,
			suggested_fix: "",
		},
		{
			step_id: "s3",
			description: "Refactor all 40 files to the new interface",
			risk_level: "caution",
			failure_modes: [
				"40 files won't fit one context window - agent will re-read the plan file every batch",
				"Mechanical edits drift as context fills; later files get sloppier than earlier ones",
			],
			loop_risk: 0.35,
			input_tokens: { low: 22_000, high: 38_000 },
			output_tokens: { low: 6_000, high: 11_000 },
			iterations: 8,
			suggested_fix:
				"Split into batches of 5 files with a checklist file the agent updates after each batch, so progress survives context compaction.",
		},
		{
			step_id: "s4",
			description: "Fix all failing tests until the suite is green",
			risk_level: "storm",
			failure_modes: [
				'"Until green" is unbounded - flaky tests make this a classic retry storm',
				"Each fix attempt re-runs the 6-minute suite and re-reads failing output into context",
				'Agent may start "fixing" tests by weakening assertions instead of fixing the refactor',
			],
			loop_risk: 0.85,
			input_tokens: { low: 30_000, high: 55_000 },
			output_tokens: { low: 4_000, high: 9_000 },
			iterations: 6,
			suggested_fix:
				"Cap at 3 fix attempts, run only the test files touched by the refactor, and require failures to be listed before any edit is made.",
		},
		{
			step_id: "s5",
			description: "Write a migration summary and changelog entry",
			risk_level: "clear",
			failure_modes: [],
			loop_risk: 0.02,
			input_tokens: { low: 6_000, high: 9_000 },
			output_tokens: { low: 1_500, high: 3_000 },
			iterations: 1,
			suggested_fix: "",
		},
	],
};

// Realistic usage for a forecast of a plan this size (what a live Haiku call
// reports for ~1.5K in / ~0.6K out).
const SAMPLE_USAGE = { input_tokens: 1_460, output_tokens: 560 };

const SAMPLE_REQUEST: SimulateRequest = {
	title: ORACLE_SAMPLE_PLAN.title,
	targetModel: ORACLE_SAMPLE_PLAN.targetModel,
	contextNotes: ORACLE_SAMPLE_PLAN.contextNotes,
	steps: ORACLE_SAMPLE_PLAN.steps,
};

export const ORACLE_SAMPLE_RESULT: SimulationResult = finalizeSimulation(
	SAMPLE_RAW,
	SAMPLE_REQUEST,
	SAMPLE_USAGE,
	"sample",
	"2026-08-03T12:00:00.000Z",
);

// True when a request is byte-equivalent to the unmodified bundled sample -
// those render the pre-generated result instantly, spending nothing.
export function isOracleSampleRequest(request: SimulateRequest): boolean {
	if (request.freeform !== undefined) return false;
	if (request.targetModel !== ORACLE_SAMPLE_PLAN.targetModel) return false;
	if (request.title.trim() !== ORACLE_SAMPLE_PLAN.title) return false;
	const steps = request.steps ?? [];
	if (steps.length !== ORACLE_SAMPLE_PLAN.steps.length) return false;
	return steps.every(
		(step, index) => step.description.trim() === ORACLE_SAMPLE_PLAN.steps[index]?.description,
	);
}
