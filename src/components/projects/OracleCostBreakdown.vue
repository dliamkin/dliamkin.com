<script setup lang="ts">
import { computed } from "vue";
import Chart from "primevue/chart";
import Knob from "primevue/knob";
import { useTheme } from "@/composables/useTheme";
import {
	formatUsd,
	stepCostRange,
	type SimulationResult,
	type TargetModel,
} from "@/lib/dry-run-oracle";

const props = defineProps<{ result: SimulationResult; targetModel: TargetModel }>();

const { theme } = useTheme();

// Single-hue magnitude chart in the site accent: solid = expected low, a
// translucent extension of the same hue = the range up to high. Which step a
// bar is lives on the axis, not in color; risk state lives on the step cards.
const BAR_SOLID = "#27a9e0";
const BAR_RANGE = "rgba(39, 169, 224, 0.3)";

const ink = computed(() =>
	theme.value === "dark"
		? { primary: "#c3c8cf", secondary: "#98a0aa", grid: "rgba(255, 255, 255, 0.09)" }
		: { primary: "#414042", secondary: "#6b6a6d", grid: "rgba(0, 0, 0, 0.08)" },
);

const perStep = computed(() =>
	props.result.steps.map((step, index) => {
		const [low, high] = stepCostRange(step, props.targetModel);
		return { label: `Step ${index + 1}`, low, high };
	}),
);

const chartData = computed(() => ({
	labels: perStep.value.map((step) => step.label),
	datasets: [
		{
			label: "Expected (low)",
			data: perStep.value.map((step) => step.low),
			backgroundColor: BAR_SOLID,
			borderRadius: 4,
			borderSkipped: false,
			barPercentage: 0.62,
		},
		{
			label: "Range to high",
			data: perStep.value.map((step) => Math.max(0, step.high - step.low)),
			backgroundColor: BAR_RANGE,
			borderRadius: 4,
			borderSkipped: false,
			barPercentage: 0.62,
		},
	],
}));

const chartOptions = computed(() => ({
	indexAxis: "y" as const,
	responsive: true,
	maintainAspectRatio: false,
	plugins: {
		legend: {
			position: "bottom" as const,
			labels: {
				color: ink.value.primary,
				boxWidth: 12,
				boxHeight: 12,
				usePointStyle: true,
				pointStyle: "rectRounded",
			},
		},
		tooltip: {
			callbacks: {
				label: (ctx: { datasetIndex: number; dataIndex: number }) => {
					const step = perStep.value[ctx.dataIndex];
					if (!step) return "";
					return ctx.datasetIndex === 0
						? ` Expected low: ${formatUsd(step.low)}`
						: ` Up to: ${formatUsd(step.high)}`;
				},
			},
		},
	},
	scales: {
		x: {
			stacked: true,
			grid: { color: ink.value.grid },
			ticks: {
				color: ink.value.secondary,
				callback: (value: string | number) => formatUsd(Number(value)),
				maxTicksLimit: 6,
			},
			border: { display: false },
		},
		y: {
			stacked: true,
			grid: { display: false },
			ticks: { color: ink.value.secondary },
			border: { display: false },
		},
	},
}));

const chartHeight = computed(() => `${Math.max(180, props.result.steps.length * 46 + 70)}px`);

const expectedHigh = computed(() => props.result.totalCostUsd[1]);
const worstPct = computed(() => {
	if (props.result.worstCaseCostUsd <= 0) return 0;
	return Math.min(100, Math.round((expectedHigh.value / props.result.worstCaseCostUsd) * 100));
});
</script>

<template>
	<section class="cost" aria-label="Cost breakdown">
		<h3 class="cost__title">Cost per step</h3>
		<div class="cost__grid">
			<div class="cost__chart" :style="{ height: chartHeight }">
				<Chart
					:key="theme"
					type="bar"
					:data="chartData"
					:options="chartOptions"
					class="cost__chart-canvas"
				/>
			</div>
			<div class="cost__gauge">
				<Knob
					:model-value="worstPct"
					:size="120"
					readonly
					value-template="{value}%"
					value-color="#27a9e0"
					:range-color="
						theme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)'
					"
					:text-color="ink.primary"
				/>
				<p class="cost__gauge-caption">
					Expected high is <strong>{{ worstPct }}%</strong> of the
					{{ formatUsd(props.result.worstCaseCostUsd) }} worst case - the gap is what loop
					risks would burn.
				</p>
			</div>
		</div>
	</section>
</template>

<style scoped>
.cost {
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 14px;
	padding: 1.2rem 1.4rem;
}

.cost__title {
	margin: 0 0 0.8rem;
	font-size: 0.95rem;
	font-weight: 700;
	color: #414042;
}

.cost__grid {
	display: flex;
	gap: 1.5rem;
	align-items: center;
	flex-wrap: wrap;
}

.cost__chart {
	flex: 1 1 320px;
	min-width: 0;
}

.cost__chart-canvas {
	height: 100%;
}

.cost__chart-canvas :deep(canvas) {
	max-width: 100%;
}

.cost__gauge {
	flex: 0 1 220px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.4rem;
	text-align: center;
}

.cost__gauge-caption {
	margin: 0;
	font-size: 0.82rem;
	color: #6b6a6d;
}

.cost__gauge-caption strong {
	color: #414042;
}

html.dark .cost {
	background: var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark .cost__title,
html.dark .cost__gauge-caption strong {
	color: var(--dm-text-1);
}

html.dark .cost__gauge-caption {
	color: var(--dm-text-2);
}
</style>
