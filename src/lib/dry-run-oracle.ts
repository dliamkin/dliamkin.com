import type Anthropic from "@anthropic-ai/sdk";

// The Dry-Run Oracle: a pre-flight simulator for AI agent plans. A cheap model
// (Claude Haiku) reads a plan destined for an expensive model, predicts failure
// modes, retry-loop probability, and per-step token ranges - and the user
// approves, edits, or aborts before a single expensive token burns.
//
// Shared between the Vue app, the Cloudflare Worker (worker/index.ts), and the
// eval suite. Keep the TypeScript interfaces and the tool JSON schema below in
// 1:1 sync - the schema is what actually constrains the model.
//
// The design rule this file enforces: the model predicts ONLY tokens,
// iterations, and risks. Every dollar figure is computed deterministically in
// code (finalizeSimulation) from the pricing table below - the model never
// does money math.

export type TargetModel = "claude-opus" | "claude-sonnet" | "claude-haiku";

export const TARGET_MODELS: TargetModel[] = ["claude-opus", "claude-sonnet", "claude-haiku"];

export const TARGET_MODEL_LABELS: Record<TargetModel, string> = {
	"claude-opus": "Claude Opus",
	"claude-sonnet": "Claude Sonnet",
	"claude-haiku": "Claude Haiku",
};

export interface PlanStep {
	id: string; // client-generated
	description: string; // what the agent will do in this step
	tools?: string[]; // tools the step uses, e.g. ["web_search", "file_write"]
	expectedIterations?: number; // user's guess; oracle may override
}

export interface AgentPlan {
	title: string;
	targetModel: TargetModel;
	steps: PlanStep[];
	contextNotes?: string; // freeform: codebase size, data volume, constraints
}

export type RiskLevel = "clear" | "caution" | "storm"; // weather-themed

export const RISK_LEVELS: RiskLevel[] = ["clear", "caution", "storm"];

export interface StepAssessment {
	stepId: string;
	riskLevel: RiskLevel;
	failureModes: string[]; // e.g. "file may not exist; parse will throw"
	loopRisk: number; // 0-1 probability of retry/looping behavior
	predictedInputTokens: [number, number]; // [low, high] per-iteration range
	predictedOutputTokens: [number, number];
	predictedIterations: number;
	suggestedFix?: string; // concrete plan edit that lowers risk
}

export interface SimulationResult {
	planHash: string;
	overallRisk: RiskLevel;
	forecastHeadline: string; // one sentence, weather-forecast voice
	steps: StepAssessment[];
	totalCostUsd: [number, number]; // [low, high]
	worstCaseCostUsd: number; // if all loop risks materialize
	oracleCostUsd: number; // what THIS simulation cost (recursion flex)
	savingsMultiple: number; // worstCaseCostUsd / oracleCostUsd
	abortRecommended: boolean;
	createdAt: string;
	// Present when the plan arrived as freeform text: the oracle's inferred
	// structure, echoed back so the UI can pre-fill the editor.
	inferredPlan?: AgentPlan;
}

// What POST /api/simulate-plan accepts. Exactly one of steps | freeform.
export interface SimulateRequest {
	title: string;
	targetModel: TargetModel;
	contextNotes?: string;
	steps?: PlanStep[];
	freeform?: string;
}

// ---------------------------------------------------------------------------
// Caps - enforced client-side for UX and server-side for spend control.

export const MAX_ORACLE_STEPS = 20;
export const MAX_STEP_CHARS = 600;
export const MAX_STEP_TOOLS = 10;
export const MAX_ITERATIONS_GUESS = 50;
export const MAX_ORACLE_TITLE_CHARS = 120;
export const MAX_ORACLE_NOTES_CHARS = 2_000;
export const MAX_FREEFORM_CHARS = 8_000;
// Hard output cap - frugality is the product. A 20-step assessment fits well
// under this; extractToolInput treats max_tokens truncation as a failure.
export const SIMULATE_MAX_TOKENS = 1500;

// ---------------------------------------------------------------------------
// Pricing. VERIFY against https://claude.com/pricing before deploying -
// prices change. Values are Anthropic first-party API rates as of 2026-08,
// per million tokens. Single source of truth for client chart math and the
// server's response totals.

export const ORACLE_PRICING: Record<TargetModel, { inputPerMTok: number; outputPerMTok: number }> =
	{
		"claude-opus": { inputPerMTok: 5, outputPerMTok: 25 },
		"claude-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
		"claude-haiku": { inputPerMTok: 1, outputPerMTok: 5 },
	};

// The oracle itself runs on Haiku - the whole point is that the forecast
// costs pocket change next to the run it de-risks.
export const ORACLE_SELF_PRICING = { inputPerMTok: 1, outputPerMTok: 5 };

const MTOK = 1_000_000;

// Agents re-send prior context every iteration, so input grows roughly
// linearly per turn: iteration n costs ~ base x n input tokens. Total input
// over k iterations ~ base x (1 + 2 + ... + k) = base x k(k+1)/2.
export function iterationInputMultiplier(iterations: number): number {
	const k = Math.max(1, Math.round(iterations));
	return (k * (k + 1)) / 2;
}

// If a step's loop risk materializes, retries multiply the iteration count.
// Worst case inflates the predicted count by up to 2x at loopRisk = 1 (a
// 0.5-risk step doubles, a 1.0-risk step triples).
export function worstCaseIterations(iterations: number, loopRisk: number): number {
	const k = Math.max(1, Math.round(iterations));
	return Math.max(k, Math.ceil(k * (1 + 2 * loopRisk)));
}

function costFor(
	inputPerIteration: number,
	outputPerIteration: number,
	iterations: number,
	model: TargetModel,
): number {
	const { inputPerMTok, outputPerMTok } = ORACLE_PRICING[model];
	const totalInput = inputPerIteration * iterationInputMultiplier(iterations);
	const totalOutput = outputPerIteration * Math.max(1, Math.round(iterations));
	return (totalInput / MTOK) * inputPerMTok + (totalOutput / MTOK) * outputPerMTok;
}

// Expected [low, high] cost for one step at its predicted iteration count.
export function stepCostRange(step: StepAssessment, model: TargetModel): [number, number] {
	return [
		costFor(
			step.predictedInputTokens[0],
			step.predictedOutputTokens[0],
			step.predictedIterations,
			model,
		),
		costFor(
			step.predictedInputTokens[1],
			step.predictedOutputTokens[1],
			step.predictedIterations,
			model,
		),
	];
}

// Worst-case cost for one step: high token bounds x loop-inflated iterations.
export function stepWorstCaseCost(step: StepAssessment, model: TargetModel): number {
	return costFor(
		step.predictedInputTokens[1],
		step.predictedOutputTokens[1],
		worstCaseIterations(step.predictedIterations, step.loopRisk),
		model,
	);
}

export function planCostRange(steps: StepAssessment[], model: TargetModel): [number, number] {
	return steps.reduce<[number, number]>(
		(acc, step) => {
			const [low, high] = stepCostRange(step, model);
			return [acc[0] + low, acc[1] + high];
		},
		[0, 0],
	);
}

export function planWorstCaseCost(steps: StepAssessment[], model: TargetModel): number {
	return steps.reduce((acc, step) => acc + stepWorstCaseCost(step, model), 0);
}

// What the oracle call itself cost, from the real usage block.
export function oracleSelfCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
	return (
		(usage.input_tokens / MTOK) * ORACLE_SELF_PRICING.inputPerMTok +
		(usage.output_tokens / MTOK) * ORACLE_SELF_PRICING.outputPerMTok
	);
}

export function formatUsd(value: number): string {
	if (value === 0) return "$0";
	if (value < 0.01) return `$${value.toFixed(4)}`;
	if (value < 1) return `$${value.toFixed(3)}`;
	if (value < 100) return `$${value.toFixed(2)}`;
	return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatTokenCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return `${value}`;
}

// ---------------------------------------------------------------------------
// Request validation. Returns the normalized request or a human-readable
// rejection - same contract as the other demos' validators.

function isTargetModel(value: unknown): value is TargetModel {
	return typeof value === "string" && (TARGET_MODELS as string[]).includes(value);
}

export function validateSimulateRequest(value: unknown): SimulateRequest | string {
	if (value === null || typeof value !== "object") {
		return "Request body must be a JSON object.";
	}
	const body = value as Record<string, unknown>;
	const { title, targetModel, contextNotes, steps, freeform } = body;

	if (typeof title !== "string" || title.trim().length === 0) {
		return "A plan title is required.";
	}
	if (title.length > MAX_ORACLE_TITLE_CHARS) {
		return `The title must be at most ${MAX_ORACLE_TITLE_CHARS} characters.`;
	}
	if (!isTargetModel(targetModel)) {
		return `targetModel must be one of: ${TARGET_MODELS.join(", ")}.`;
	}
	if (contextNotes !== undefined && typeof contextNotes !== "string") {
		return "contextNotes must be a string.";
	}
	if (typeof contextNotes === "string" && contextNotes.length > MAX_ORACLE_NOTES_CHARS) {
		return `contextNotes must be at most ${MAX_ORACLE_NOTES_CHARS} characters.`;
	}

	const hasSteps = Array.isArray(steps) && steps.length > 0;
	const hasFreeform = typeof freeform === "string" && freeform.trim().length > 0;
	if (hasSteps === hasFreeform) {
		return "Provide either structured steps or freeform text, not both.";
	}

	const request: SimulateRequest = { title: title.trim(), targetModel };
	if (typeof contextNotes === "string" && contextNotes.trim().length > 0) {
		request.contextNotes = contextNotes.trim();
	}

	if (hasSteps) {
		if (steps.length > MAX_ORACLE_STEPS) {
			return `Plans are capped at ${MAX_ORACLE_STEPS} steps.`;
		}
		const normalized: PlanStep[] = [];
		const seenIds = new Set<string>();
		for (const entry of steps) {
			if (entry === null || typeof entry !== "object") {
				return "Each step must be an object.";
			}
			const s = entry as Record<string, unknown>;
			if (typeof s.id !== "string" || s.id.length === 0 || s.id.length > 64) {
				return "Each step needs a short string id.";
			}
			if (seenIds.has(s.id)) return `Duplicate step id "${s.id}".`;
			seenIds.add(s.id);
			if (typeof s.description !== "string" || s.description.trim().length === 0) {
				return "Every step needs a non-empty description.";
			}
			if (s.description.length > MAX_STEP_CHARS) {
				return `Step descriptions must be at most ${MAX_STEP_CHARS} characters.`;
			}
			const step: PlanStep = { id: s.id, description: s.description.trim() };
			if (s.tools !== undefined) {
				if (
					!Array.isArray(s.tools) ||
					s.tools.length > MAX_STEP_TOOLS ||
					!s.tools.every((t) => typeof t === "string" && t.length > 0 && t.length <= 40)
				) {
					return `Step tools must be at most ${MAX_STEP_TOOLS} short strings.`;
				}
				if (s.tools.length > 0) step.tools = s.tools as string[];
			}
			if (s.expectedIterations !== undefined) {
				if (
					typeof s.expectedIterations !== "number" ||
					!Number.isFinite(s.expectedIterations) ||
					s.expectedIterations < 1 ||
					s.expectedIterations > MAX_ITERATIONS_GUESS
				) {
					return `expectedIterations must be between 1 and ${MAX_ITERATIONS_GUESS}.`;
				}
				step.expectedIterations = Math.round(s.expectedIterations);
			}
			normalized.push(step);
		}
		request.steps = normalized;
	} else {
		const text = (freeform as string).trim();
		if (text.length > MAX_FREEFORM_CHARS) {
			return `Freeform plans are capped at ${MAX_FREEFORM_CHARS} characters.`;
		}
		request.freeform = text;
	}
	return request;
}

// ---------------------------------------------------------------------------
// Serialization + hashing. Compact on purpose: stripped empty fields, no
// pretty-printing - every token in the prompt is a token billed.

export function serializeSimulateRequest(request: SimulateRequest): string {
	if (request.freeform !== undefined) {
		return JSON.stringify({
			title: request.title,
			targetModel: request.targetModel,
			freeform: request.freeform,
			contextNotes: request.contextNotes,
		});
	}
	const steps = (request.steps ?? []).map((step) => {
		const out: Record<string, unknown> = { id: step.id, description: step.description };
		if (step.tools && step.tools.length > 0) out.tools = step.tools;
		if (step.expectedIterations !== undefined) out.expectedIterations = step.expectedIterations;
		return out;
	});
	const out: Record<string, unknown> = {
		title: request.title,
		targetModel: request.targetModel,
		steps,
	};
	if (request.contextNotes) out.contextNotes = request.contextNotes;
	return JSON.stringify(out);
}

// SHA-256 via WebCrypto - available in the browser, Workers, and Node 20+,
// so the same hash function serves the client cache and the server response.
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function planCacheKeyInput(request: SimulateRequest): string {
	return `${serializeSimulateRequest(request)}|${request.targetModel}`;
}

// ---------------------------------------------------------------------------
// Prompt and tool schema. The system prompt is deliberately token-lean.

export const SIMULATE_PLAN_SYSTEM_PROMPT =
	"You are the Dry-Run Oracle: a pre-flight simulator for AI agent plans. You receive a JSON plan of steps an agent will execute on an expensive model. Mentally simulate execution. For each step, assess: likely failure modes (missing files, ambiguous instructions, unbounded scopes, external dependencies), probability of retry loops, and realistic token consumption ranges given the step's scope. Be pessimistic-realistic: agents re-read context every turn, retries multiply cost, vague steps balloon. If the plan arrives as freeform text, first infer discrete steps (ids s1..sN). Record your assessment via the tool. Token ranges are per-iteration; report realistic iteration counts. The forecast_headline is one sentence in a weather-forecast voice.";

// Wire shape of the tool input (snake_case, mirrors StepAssessment). Token
// ranges travel as {low, high} objects - strict schemas can't express tuples -
// and are converted to [low, high] pairs in finalizeSimulation. suggested_fix
// uses "" (not null) when there is nothing to fix, keeping the schema
// union-free under strict validation.
export interface RawStepAssessment {
	step_id: string;
	description: string;
	risk_level: RiskLevel;
	failure_modes: string[];
	loop_risk: number;
	input_tokens: { low: number; high: number };
	output_tokens: { low: number; high: number };
	iterations: number;
	suggested_fix: string;
}

export interface RawSimulation {
	overall_risk: RiskLevel;
	forecast_headline: string;
	abort_recommended: boolean;
	steps: RawStepAssessment[];
}

// strict: true means the API validates the model's output against this schema
// before it ever reaches us.
export const SIMULATE_PLAN_TOOL: Anthropic.Tool = {
	name: "record_simulation",
	description:
		"Record the dry-run forecast: overall risk, a one-sentence weather-voice headline, and a per-step assessment (failure modes, loop risk, per-iteration token ranges, iteration count, optional fix).",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			overall_risk: { type: "string", enum: RISK_LEVELS },
			forecast_headline: {
				type: "string",
				description:
					'One sentence, weather-forecast voice, e.g. "Clear until step 4, then retry storms likely."',
			},
			abort_recommended: {
				type: "boolean",
				description: "true only when the plan as written should not run at all",
			},
			steps: {
				type: "array",
				items: {
					type: "object",
					properties: {
						step_id: {
							type: "string",
							description:
								"Echo the given step id; for freeform plans assign s1..sN in order",
						},
						description: {
							type: "string",
							description:
								"Short description of the step (echo the given one, or the inferred step for freeform plans)",
						},
						risk_level: { type: "string", enum: RISK_LEVELS },
						failure_modes: {
							type: "array",
							items: { type: "string" },
							description:
								"Concrete likely failure modes; empty when none significant",
						},
						loop_risk: {
							type: "number",
							description: "Probability 0-1 of retry/looping behavior",
						},
						input_tokens: {
							type: "object",
							properties: {
								low: { type: "number" },
								high: { type: "number" },
							},
							required: ["low", "high"],
							additionalProperties: false,
							description:
								"Per-iteration input token range (context re-send growth is computed in code)",
						},
						output_tokens: {
							type: "object",
							properties: {
								low: { type: "number" },
								high: { type: "number" },
							},
							required: ["low", "high"],
							additionalProperties: false,
							description: "Per-iteration output token range",
						},
						iterations: {
							type: "number",
							description: "Realistic iteration count for this step, at least 1",
						},
						suggested_fix: {
							type: "string",
							description:
								"A concrete plan edit that lowers risk, or an empty string when none needed",
						},
					},
					required: [
						"step_id",
						"description",
						"risk_level",
						"failure_modes",
						"loop_risk",
						"input_tokens",
						"output_tokens",
						"iterations",
						"suggested_fix",
					],
					additionalProperties: false,
				},
			},
		},
		required: ["overall_risk", "forecast_headline", "abort_recommended", "steps"],
		additionalProperties: false,
	},
};

// ---------------------------------------------------------------------------
// Deterministic finalization: raw tool output + real usage in, finished
// SimulationResult out. ALL money math happens here, never in the model.

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function nonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function finalizeSimulation(
	raw: RawSimulation,
	request: SimulateRequest,
	usage: { input_tokens: number; output_tokens: number },
	planHash: string,
	createdAt: string,
): SimulationResult {
	const steps: StepAssessment[] = raw.steps.map((step) => {
		const inputLow = nonNegative(step.input_tokens.low);
		const inputHigh = Math.max(inputLow, nonNegative(step.input_tokens.high));
		const outputLow = nonNegative(step.output_tokens.low);
		const outputHigh = Math.max(outputLow, nonNegative(step.output_tokens.high));
		const assessment: StepAssessment = {
			stepId: step.step_id,
			riskLevel: step.risk_level,
			failureModes: step.failure_modes,
			loopRisk: clamp01(step.loop_risk),
			predictedInputTokens: [inputLow, inputHigh],
			predictedOutputTokens: [outputLow, outputHigh],
			predictedIterations: Math.max(1, Math.round(step.iterations)),
		};
		if (step.suggested_fix.trim().length > 0) {
			assessment.suggestedFix = step.suggested_fix.trim();
		}
		return assessment;
	});

	const model = request.targetModel;
	const totalCostUsd = planCostRange(steps, model);
	const worstCaseCostUsd = planWorstCaseCost(steps, model);
	const oracleCostUsd = oracleSelfCostUsd(usage);

	const result: SimulationResult = {
		planHash,
		overallRisk: raw.overall_risk,
		forecastHeadline: raw.forecast_headline,
		steps,
		totalCostUsd,
		worstCaseCostUsd,
		oracleCostUsd,
		savingsMultiple: oracleCostUsd > 0 ? worstCaseCostUsd / oracleCostUsd : 0,
		abortRecommended: raw.abort_recommended,
		createdAt,
	};

	// Freeform submissions get the inferred structure echoed back so the UI
	// can pre-fill the plan editor for Edit & Re-run.
	if (request.freeform !== undefined) {
		const inferred: AgentPlan = {
			title: request.title,
			targetModel: model,
			steps: raw.steps.map((step, index) => ({
				id: step.step_id || `s${index + 1}`,
				description: step.description || `Step ${index + 1}`,
			})),
		};
		if (request.contextNotes) inferred.contextNotes = request.contextNotes;
		result.inferredPlan = inferred;
	}

	return result;
}

// ---------------------------------------------------------------------------
// Client-side shape check for the fetched result (the SPA fallback answers
// unknown paths with index.html, so content shape is the only reliable test).

export function isSimulationResult(value: unknown): value is SimulationResult {
	if (value === null || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.planHash === "string" &&
		typeof r.forecastHeadline === "string" &&
		(RISK_LEVELS as string[]).includes(r.overallRisk as string) &&
		Array.isArray(r.steps) &&
		Array.isArray(r.totalCostUsd) &&
		typeof r.worstCaseCostUsd === "number" &&
		typeof r.oracleCostUsd === "number" &&
		typeof r.abortRecommended === "boolean" &&
		typeof r.createdAt === "string"
	);
}
