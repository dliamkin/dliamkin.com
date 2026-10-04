// ---------------------------------------------------------------------------
// Tail Risk Lab - data model.
//
// Pure types shared by the simulation engine, the Web Worker, and the UI.
// Nothing in this file (or in engine/) may import Vue or touch the DOM: the
// engine must stay runnable in a worker, in vitest, and in a plain script.

export interface StepParams {
	id: string;
	label: string;
	/** [low, high] input tokens per attempt, in thousands. */
	inputTokensK: [number, number];
	/** [low, high] output tokens per attempt, in thousands. */
	outputTokensK: [number, number];
	/** Probability of the first retry, 0–1. */
	loopRisk: number;
	/** Geometric decay of retry probability: P(retry k) = loopRisk · loopDecay^(k−1). */
	loopDecay: number;
	/** Retry k re-sends input × (1 + retryContextGrowth · k) - context accretes. */
	retryContextGrowth: number;
}

export type ModelKey = "opus" | "sonnet" | "haiku";

export interface Scenario {
	id: string;
	name: string;
	steps: StepParams[];
	targetModel: ModelKey;
}

export type TrialCount = 1000 | 5000 | 20000;

export interface Policy {
	/** Max retries per step, 1–10. RETRY_CAP_UNCAPPED (10) means effectively uncapped. */
	retryCap: number;
	/** Per-step hard cap on output tokens, in thousands. null = off. */
	outputTokenCapK: number | null;
	trials: TrialCount;
	/** PRNG seed - same seed + same params ⇒ identical results. */
	seed: number;
	/** Budget line for P(over budget); draggable on the distribution chart. */
	budgetUsd: number;
}

export interface PricingRates {
	/** $ per thousand input tokens. */
	inputPerKTok: number;
	/** $ per thousand output tokens. */
	outputPerKTok: number;
}

export type PricingTable = Record<ModelKey, PricingRates>;

export interface SimulationSummary {
	p50: number;
	p90: number;
	p99: number;
	mean: number;
	/** Fraction of trials whose total cost exceeded policy.budgetUsd, 0–1. */
	probOverBudget: number;
	histogram: { binEdges: number[]; counts: number[] };
	cdf: { x: number[]; y: number[] };
	/** Per-step share of total cost variance; sums to 1 (all zeros if no variance). */
	varianceShare: { stepId: string; share: number }[];
	trials: number;
	/** Engine runtime in ms - shown under the chart as the perf flex. */
	elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Pricing. VERIFY against https://claude.com/pricing before deploying -
// prices change. Values are Anthropic first-party API rates as of 2026-08,
// converted to $ per thousand tokens (the engine samples token counts in K).
// Same figures as ORACLE_PRICING in src/lib/dry-run-oracle.ts (per MTok ÷ 1000)
// - kept numerically in sync by hand; both carry this verify comment.

export const TAIL_RISK_PRICING: PricingTable = {
	opus: { inputPerKTok: 0.005, outputPerKTok: 0.025 },
	sonnet: { inputPerKTok: 0.003, outputPerKTok: 0.015 },
	haiku: { inputPerKTok: 0.001, outputPerKTok: 0.005 },
};

export const MODEL_LABELS: Record<ModelKey, string> = {
	opus: "Claude Opus",
	sonnet: "Claude Sonnet",
	haiku: "Claude Haiku",
};

/** retryCap value that the UI labels "uncapped" (engine still hard-stops at 50). */
export const RETRY_CAP_UNCAPPED = 10;

export const MIN_STEPS = 1;
export const MAX_STEPS = 12;

export const DEFAULT_LOOP_DECAY = 0.82;
export const DEFAULT_RETRY_CONTEXT_GROWTH = 0.3;

export function defaultPolicy(): Policy {
	return {
		retryCap: RETRY_CAP_UNCAPPED,
		outputTokenCapK: null,
		trials: 5000,
		seed: 42,
		budgetUsd: 6,
	};
}
