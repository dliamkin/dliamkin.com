<script setup lang="ts">
// Tail Risk Lab - Monte Carlo cost simulator for AI agent runs. Everything
// happens client-side in a Web Worker; the page never calls an API.
import { computed, onMounted, ref, watch } from "vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import TailRiskScenarioBar from "@/components/projects/TailRiskScenarioBar.vue";
import TailRiskParamTable from "@/components/projects/TailRiskParamTable.vue";
import TailRiskPolicyPanel from "@/components/projects/TailRiskPolicyPanel.vue";
import TailRiskMetricCards from "@/components/projects/TailRiskMetricCards.vue";
import TailRiskDistributionChart from "@/components/projects/TailRiskDistributionChart.vue";
import TailRiskVarianceTornado from "@/components/projects/TailRiskVarianceTornado.vue";
import { useTailRiskScenarios } from "@/composables/useTailRiskScenarios";
import { useTailRiskSimulator } from "@/composables/useTailRiskSimulator";
import { cloneScenario, CUSTOM_SCENARIO_ID } from "@/lib/tail-risk/presets";
import { exceedanceFromCdf } from "@/lib/tail-risk/stats";
import {
	defaultPolicy,
	type ModelKey,
	type Policy,
	type Scenario,
	type StepParams,
} from "@/lib/tail-risk/types";

const ENGINE_SOURCE_URL =
	"https://github.com/dliamkin/dliamkin/blob/main/src/lib/tail-risk/monteCarlo.ts";

const { presets, saved, findById, saveScenario, deleteScenario } = useTailRiskScenarios();

function firstPreset(): Scenario {
	const preset = presets[0];
	if (!preset) throw new Error("Tail Risk Lab has no presets configured");
	return cloneScenario(preset);
}

const scenario = ref<Scenario>(firstPreset());
const activeScenarioId = ref<string>(scenario.value.id);
const policy = ref<Policy>(defaultPolicy());

const { summary, baseline, simulate, simulateImmediate, pinBaseline, clearBaseline } =
	useTailRiskSimulator();

// The budget the current summary was computed against - lets us show the
// engine's exact P(over) when the line hasn't moved, and interpolate from
// the CDF only mid-drag while the debounced re-sim catches up.
const simulatedBudgetUsd = ref<number | null>(null);

function requestSimulation(immediate = false): void {
	simulatedBudgetUsd.value = policy.value.budgetUsd;
	if (immediate) simulateImmediate(scenario.value, policy.value);
	else simulate(scenario.value, policy.value);
}

watch([scenario, policy], () => requestSimulation(), { deep: true });
onMounted(() => requestSimulation(true));

const probOverBudget = computed(() => {
	const s = summary.value;
	if (!s) return 0;
	if (policy.value.budgetUsd === simulatedBudgetUsd.value) return s.probOverBudget;
	return exceedanceFromCdf(s.cdf, policy.value.budgetUsd);
});

function markCustom(): void {
	if (activeScenarioId.value === CUSTOM_SCENARIO_ID) return;
	activeScenarioId.value = CUSTOM_SCENARIO_ID;
	scenario.value.id = CUSTOM_SCENARIO_ID;
	scenario.value.name = "Custom";
}

function onStepsUpdate(steps: StepParams[]): void {
	scenario.value.steps = steps;
	markCustom();
}

function onScenarioSelect(id: string): void {
	if (id === CUSTOM_SCENARIO_ID) return;
	const found = findById(id);
	if (!found) return;
	scenario.value = cloneScenario(found);
	activeScenarioId.value = id;
}

function onScenarioSave(name: string): void {
	const stored = saveScenario(name, scenario.value);
	scenario.value = cloneScenario(stored);
	activeScenarioId.value = stored.id;
}

function onScenarioDelete(id: string): void {
	deleteScenario(id);
	// Keep the parameters on screen, just as an unsaved custom scenario.
	markCustom();
}

// Switching the target model re-prices the same token samples; it doesn't
// flip the scenario to "custom" - it's a policy knob that happens to live on
// the scenario for pricing.
function onModelChange(model: ModelKey): void {
	scenario.value.targetModel = model;
}

function onPolicyUpdate(next: Policy): void {
	policy.value = next;
}

function onBudgetDrag(value: number): void {
	policy.value = { ...policy.value, budgetUsd: value };
}
</script>

<template>
	<div class="project-page">
		<AppNavbar />

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="Tail Risk Lab" />
				<h1>Tail Risk Lab</h1>
				<p class="subtitle">
					P50/P90/P99 budgeting for agent runs - treat AI spend the way SREs treat
					latency.
				</p>
				<p class="intro">
					Point estimates lie about agent costs. Retry loops make the true distribution
					fat-tailed: the median run is cheap, but the 99th-percentile run - the one where
					"fix all failing tests" loops nine times with a growing context - costs several
					multiples of it. This lab runs your plan thousands of times with classical Monte
					Carlo over LLM-predicted parameters, entirely in your browser, and lets you buy
					down tail risk with policy knobs before spending a cent. Watch the P99 collapse
					when you cap retries - while the median barely moves.
				</p>
			</header>

			<section class="zone" aria-label="Scenario picker">
				<TailRiskScenarioBar
					:presets="presets"
					:saved="saved"
					:active-id="activeScenarioId"
					@select="onScenarioSelect"
					@save="onScenarioSave"
					@delete="onScenarioDelete"
				/>
			</section>

			<section class="zone" aria-label="Step parameters">
				<TailRiskParamTable :steps="scenario.steps" @update:steps="onStepsUpdate" />
			</section>

			<section class="zone" aria-label="Policy knobs">
				<TailRiskPolicyPanel
					:policy="policy"
					:target-model="scenario.targetModel"
					:baseline-pinned="baseline !== null"
					@update:policy="onPolicyUpdate"
					@update:target-model="onModelChange"
					@pin="pinBaseline"
					@clear-pin="clearBaseline"
				/>
			</section>

			<section class="zone" aria-label="Cost percentiles" aria-live="polite">
				<TailRiskMetricCards
					:summary="summary"
					:baseline="baseline"
					:prob-over-budget="probOverBudget"
					:budget-usd="policy.budgetUsd"
				/>
			</section>

			<section class="zone" aria-label="Cost distribution">
				<TailRiskDistributionChart
					:summary="summary"
					:baseline="baseline"
					:budget-usd="policy.budgetUsd"
					:prob-over-budget="probOverBudget"
					@update:budget-usd="onBudgetDrag"
				/>
			</section>

			<section class="zone" aria-label="Variance attribution">
				<TailRiskVarianceTornado :summary="summary" :steps="scenario.steps" />
			</section>

			<p class="footer-note">
				All simulation runs client-side - classical Monte Carlo, no AI in the loop, 0 tokens
				spent.
				<a :href="ENGINE_SOURCE_URL" target="_blank" rel="noopener"
					>View the engine source →</a
				>
			</p>
		</main>

		<SiteFooter />
	</div>
</template>

<style scoped>
.project-page {
	font-family: "Raleway", sans-serif;
	color: #414042;
	background: #fff;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

.project-main {
	flex: 1;
	width: 100%;
	max-width: 960px;
	margin: 0 auto;
	padding: 7.5rem 1rem 4rem;
}

.project-header {
	max-width: 760px;
	margin-bottom: 1.5rem;
}

h1 {
	font-size: 2.25rem;
	font-weight: 700;
	margin-bottom: 0.35rem;
}

.subtitle {
	font-size: 1.05rem;
	font-weight: 600;
	color: #27a9e0;
	margin-bottom: 0.75rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.zone {
	margin-bottom: 1.25rem;
}

.footer-note {
	margin-top: 2rem;
	font-size: 0.85rem;
	color: #6b6a6d;
	text-align: center;
}

.footer-note a {
	color: #1f8fc0;
	font-weight: 600;
}

@media (max-width: 900px) {
	.project-main {
		padding-top: 6.5rem;
	}

	h1 {
		font-size: 1.75rem;
	}
}

html.dark .project-page {
	color: var(--dm-text-2);
	background: var(--dm-bg);
}

html.dark h1 {
	color: var(--dm-text-1);
}

html.dark .subtitle {
	color: var(--dm-blue-soft);
}

html.dark .intro,
html.dark .footer-note {
	color: var(--dm-text-3);
}

html.dark .footer-note a {
	color: var(--dm-blue-soft);
}
</style>
