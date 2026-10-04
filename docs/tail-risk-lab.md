# Tail Risk Lab - model & engineering notes

Live at `/projects/tail-risk-lab`. Engine: `src/lib/tail-risk/monteCarlo.ts` (pure TS, no DOM/Vue),
run inside a Web Worker (`monteCarlo.worker.ts`), tests in `src/lib/tail-risk/__tests__/`.

## The model, in ~20 lines

Each trial simulates one full agent run over the scenario's steps, using a seeded mulberry32 PRNG
(same seed + same params ⇒ byte-identical summaries, modulo wall-clock `elapsedMs`).

Per step, per trial:

1. **Token draws.** `inputK ~ Uniform(inLo, inHi)`, `outputK ~ Uniform(outLo, outHi)`, both in
   thousands of tokens. Uniform is a deliberate modeling choice: the user supplies a range, not a
   distribution, and uniform is the maximum-entropy distribution for a bounded range. If a policy
   sets an output cap, `outputK ← min(outputK, capK)`.
2. **Base cost.** `cost = inputK·inputRate + outputK·outputRate`, rates in $/K tokens from a
   pricing table numerically synced with the Dry-Run Oracle's (verify against claude.com/pricing).
3. **Retry loop.** Retry *k* (1-indexed) fires with probability `loopRisk · loopDecay^(k−1)` - a
   geometrically decaying chain, so `P(≥k retries) = Π_{j<k} loopRisk·decay^j`. Each retry re-sends
   the input inflated by accumulated context, `inputK·(1 + retryContextGrowth·k)`, plus a fresh
   output draw. The policy's retry cap truncates the chain; "uncapped" (cap 10) still hard-stops at
   50 retries so `risk=1, decay=1` cannot hang the worker.
4. **Accumulate.** Per-step cost feeds a per-step Welford accumulator; the trial total goes into a
   `Float64Array`.

After all trials: sort totals **once**; P50/P90/P99 by nearest-rank index (exact sample statistic,
unit-testable); histogram with 48 bins clamped at the 99.5th percentile (one outlier can't flatten
the chart - the top 0.5% of mass lands in the last bin); CDF downsampled to ≤200 points;
`P(over budget)` counted exactly. Variance attribution: steps are sampled independently, so
`Var(total) = Σ Var(step_i)` in expectation, and each step's share is `Var_i / Σ Var_j` from the
Welford accumulators (all zeros when the scenario is fully deterministic).

Why the tail responds to the retry cap while the median doesn't: the median run sees the *typical*
number of retries (small), but P99 is dominated by long retry chains whose cost grows
super-linearly (`context growth · k` per retry). Truncating the chain at k=2 removes exactly the
super-linear region - nearly-free insurance. On the default preset (seed 42, 5K trials):
uncapped P50 ≈ $3.02 / P99 ≈ $13.87 (4.6×); retryCap 2 → P99 ≈ $4.11 (−70%) with P50 −8%.

## Performance

- `Float64Array` totals, per-step scalar accumulators, zero per-trial allocation.
- 5K trials ≈ 6ms in Node, ≈ 16ms in-browser (worker); 20K trials well under the 150ms budget.
- The worker keeps the main thread jank-free; `useTailRiskSimulator` debounces knob input at 80ms
  and tags requests with an id, dropping stale responses when the user outruns the sim.
- Live budget drag: the exact `probOverBudget` comes from the debounced re-sim; between debounces
  the readout interpolates the 200-point CDF (`exceedanceFromCdf`) so the number tracks the cursor.

## Notable decisions

- **Repo layout over brief layout.** The brief suggested `src/features/tail-risk/`; this repo is
  layer-based, so: engine in `src/lib/tail-risk/`, composables in `src/composables/useTailRisk*.ts`,
  components as `src/components/projects/TailRisk*.vue`, view as `src/views/TailRiskLabView.vue`.
- **Model switch does not flip the scenario to "Custom".** `targetModel` lives on the Scenario type
  but behaves as a policy knob (re-prices the same token samples); preset identity survives it.
- **No EvalBadge.** The lab makes zero API calls, so it has no eval pipeline entry.
- **Histogram overlay normalization.** Current and baseline histograms are drawn as probability
  *densities* (count / (trials · binWidth)), so distributions from different trial counts and bin
  domains remain visually comparable.
- **Canvas is theme-aware.** A MutationObserver on `html.class` redraws with the dark/light palette
  when the site theme toggles, since canvas pixels can't inherit CSS.
- **`Math.random` appears exactly once** - in the dice button that picks a *new* seed. Every
  simulation is deterministic for whatever seed lands.
- Saved scenarios live in `localStorage` (`tail-risk-lab:scenarios`, max 10, oldest evicted),
  validated on read so a corrupt entry can't break the page.
