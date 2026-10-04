// ---------------------------------------------------------------------------
// The Monte Carlo engine. Pure function: (scenario, policy, pricing) →
// SimulationSummary. No DOM, no Vue, no side effects - it runs identically
// inside the Web Worker, in vitest, and in a tuning script.
//
// Cost model, per trial, per step:
//   inputK  ~ Uniform(inLo, inHi)      (thousands of tokens, seeded PRNG)
//   outputK ~ Uniform(outLo, outHi), then min(outputK, policy.outputTokenCapK)
//   base cost = inputK·inputRate + outputK·outputRate
//   retry loop: retry k (1-indexed) happens with probability
//   loopRisk·loopDecay^(k−1) and re-sends inputK·(1 + retryContextGrowth·k)
//   plus a fresh outputK, until the policy's retry cap stops it.

import { mulberry32 } from "./prng";
import { buildCdf, buildHistogram, percentileSorted, Welford } from "./stats";
import {
	RETRY_CAP_UNCAPPED,
	type Policy,
	type PricingTable,
	type Scenario,
	type SimulationSummary,
} from "./types";

// "Uncapped" still needs a ceiling: with loopDecay = 1 and loopRisk = 1 the
// retry chain never terminates on its own. 50 retries is far beyond anything
// the probability model produces at decay < 1 (P ≈ risk^50·decay^1225).
const HARD_RETRY_CEILING = 50;

interface CompiledStep {
	id: string;
	inLo: number;
	inSpan: number;
	outLo: number;
	outSpan: number;
	risk: number;
	decay: number;
	growth: number;
	welford: Welford;
}

// Sanitize once, outside the hot loop: swap inverted ranges, clamp
// probabilities. The UI validates too, but the engine must never NaN or hang
// on hostile input.
function compileSteps(scenario: Scenario): CompiledStep[] {
	return scenario.steps.map((step) => {
		const inLo = Math.max(0, Math.min(step.inputTokensK[0], step.inputTokensK[1]));
		const inHi = Math.max(0, Math.max(step.inputTokensK[0], step.inputTokensK[1]));
		const outLo = Math.max(0, Math.min(step.outputTokensK[0], step.outputTokensK[1]));
		const outHi = Math.max(0, Math.max(step.outputTokensK[0], step.outputTokensK[1]));
		return {
			id: step.id,
			inLo,
			inSpan: inHi - inLo,
			outLo,
			outSpan: outHi - outLo,
			risk: Math.min(1, Math.max(0, step.loopRisk)),
			decay: Math.min(1, Math.max(0, step.loopDecay)),
			growth: Math.max(0, step.retryContextGrowth),
			welford: new Welford(),
		};
	});
}

export function runSimulation(
	scenario: Scenario,
	policy: Policy,
	pricing: PricingTable,
): SimulationSummary {
	const started = performance.now();

	const rng = mulberry32(policy.seed);
	const rates = pricing[scenario.targetModel];
	const inRate = rates.inputPerKTok;
	const outRate = rates.outputPerKTok;
	const steps = compileSteps(scenario);
	const stepCount = steps.length;
	const trials = policy.trials;
	const outputCapK = policy.outputTokenCapK;
	const maxRetries =
		policy.retryCap >= RETRY_CAP_UNCAPPED ? HARD_RETRY_CEILING : Math.max(0, policy.retryCap);

	// Float64Array + scalar accumulators: zero per-trial object allocation.
	const totals = new Float64Array(trials);

	for (let t = 0; t < trials; t++) {
		let total = 0;
		for (let s = 0; s < stepCount; s++) {
			const step = steps[s];
			if (!step) continue;
			const inputK = step.inLo + rng() * step.inSpan;
			let outputK = step.outLo + rng() * step.outSpan;
			if (outputCapK !== null && outputK > outputCapK) outputK = outputCapK;

			let cost = inputK * inRate + outputK * outRate;
			let retryProb = step.risk;
			let k = 0;
			while (k < maxRetries && rng() < retryProb) {
				cost += inputK * (1 + step.growth * (k + 1)) * inRate + outputK * outRate;
				k++;
				retryProb *= step.decay;
			}

			step.welford.push(cost);
			total += cost;
		}
		totals[t] = total;
	}

	totals.sort();

	let mean = 0;
	let overBudget = 0;
	for (let t = 0; t < trials; t++) {
		const v = totals[t] ?? 0;
		mean += v;
		if (v > policy.budgetUsd) overBudget++;
	}
	mean /= trials;

	// Attribution: each step's share of the sum of per-step variances. (Steps
	// are independent, so the covariance terms are zero in expectation and
	// Σ var_i is the variance of the total.)
	const totalVariance = steps.reduce((sum, step) => sum + step.welford.variance, 0);
	const varianceShare = steps.map((step) => ({
		stepId: step.id,
		share: totalVariance > 0 ? step.welford.variance / totalVariance : 0,
	}));

	return {
		p50: percentileSorted(totals, 50),
		p90: percentileSorted(totals, 90),
		p99: percentileSorted(totals, 99),
		mean,
		probOverBudget: overBudget / trials,
		histogram: buildHistogram(totals),
		cdf: buildCdf(totals),
		varianceShare,
		trials,
		elapsedMs: performance.now() - started,
	};
}
