<script setup lang="ts">
// P50 / P90 / P99 / P(over budget) tiles. Numbers lerp over 200ms so
// knob-dragging feels alive; when a baseline is pinned, each tile grows a
// delta chip comparing against it (green = risk bought down).
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { formatDelta, formatPercent, formatUsd } from "@/lib/tail-risk/format";
import { exceedanceFromCdf } from "@/lib/tail-risk/stats";
import type { SimulationSummary } from "@/lib/tail-risk/types";

const props = defineProps<{
	summary: SimulationSummary | null;
	baseline: SimulationSummary | null;
	/** Live P(over budget) - exact after a re-sim, interpolated mid-drag. */
	probOverBudget: number;
	budgetUsd: number;
}>();

const ANIMATION_MS = 200;

/** Lerp a numeric target over ANIMATION_MS via requestAnimationFrame. */
function useLerped(target: () => number): Ref<number> {
	const value = ref(target());
	let raf = 0;
	watch(target, (to) => {
		const from = value.value;
		cancelAnimationFrame(raf);
		if (!Number.isFinite(from) || !Number.isFinite(to)) {
			value.value = to;
			return;
		}
		const startedAt = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - startedAt) / ANIMATION_MS);
			value.value = from + (to - from) * t;
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	});
	onBeforeUnmount(() => cancelAnimationFrame(raf));
	return value;
}

const p50 = useLerped(() => props.summary?.p50 ?? 0);
const p90 = useLerped(() => props.summary?.p90 ?? 0);
const p99 = useLerped(() => props.summary?.p99 ?? 0);
const probOver = useLerped(() => props.probOverBudget);

// Baseline P(over) is re-read at the *current* budget so the chip stays
// honest when the budget line moves after pinning.
const baselineProbOver = computed(() =>
	props.baseline ? exceedanceFromCdf(props.baseline.cdf, props.budgetUsd) : null,
);

interface CardModel {
	key: string;
	label: string;
	sublabel: string;
	value: string;
	danger?: boolean;
	delta: string | null;
	deltaGood: boolean;
}

function deltaFor(current: number | undefined, base: number | undefined): string | null {
	if (current === undefined || base === undefined) return null;
	return formatDelta(current, base);
}

const cards = computed<CardModel[]>(() => {
	const s = props.summary;
	const b = props.baseline;
	const models: CardModel[] = [
		{
			key: "p50",
			label: "P50",
			sublabel: "Median run",
			value: s ? formatUsd(p50.value) : "-",
			delta: b && s ? deltaFor(s.p50, b.p50) : null,
			deltaGood: !!b && !!s && s.p50 <= b.p50,
		},
		{
			key: "p90",
			label: "P90",
			sublabel: "Bad day",
			value: s ? formatUsd(p90.value) : "-",
			delta: b && s ? deltaFor(s.p90, b.p90) : null,
			deltaGood: !!b && !!s && s.p90 <= b.p90,
		},
		{
			key: "p99",
			label: "P99",
			sublabel: "Disaster run",
			value: s ? formatUsd(p99.value) : "-",
			danger: true,
			delta: b && s ? deltaFor(s.p99, b.p99) : null,
			deltaGood: !!b && !!s && s.p99 <= b.p99,
		},
		{
			key: "over",
			label: `P(> ${formatUsd(props.budgetUsd)})`,
			sublabel: "Over budget",
			value: s ? formatPercent(probOver.value) : "-",
			delta:
				baselineProbOver.value !== null && s
					? deltaFor(props.probOverBudget, baselineProbOver.value)
					: null,
			deltaGood:
				baselineProbOver.value !== null && props.probOverBudget <= baselineProbOver.value,
		},
	];
	return models;
});
</script>

<template>
	<div class="metric-cards">
		<div
			v-for="card in cards"
			:key="card.key"
			class="metric-card"
			:class="{ danger: card.danger }"
		>
			<div class="metric-top">
				<span class="metric-label">{{ card.label }}</span>
				<span
					v-if="card.delta"
					class="delta-chip"
					:class="card.deltaGood ? 'good' : 'bad'"
					>{{ card.delta }}</span
				>
			</div>
			<div class="metric-value">{{ card.value }}</div>
			<div class="metric-sublabel">{{ card.sublabel }}</div>
		</div>
	</div>
</template>

<style scoped>
.metric-cards {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 0.75rem;
}

.metric-card {
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 10px;
	padding: 0.8rem 1rem;
	background: #fff;
	min-width: 0;
}

.metric-top {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.4rem;
}

.metric-label {
	font-size: 0.75rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: #6b6a6d;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.metric-value {
	font-size: 1.55rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	margin-top: 0.25rem;
	color: #414042;
}

.metric-card.danger .metric-value {
	color: #c0392b;
}

.metric-sublabel {
	font-size: 0.8rem;
	color: #6b6a6d;
	margin-top: 0.1rem;
}

.delta-chip {
	font-size: 0.72rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	padding: 0.1rem 0.4rem;
	border-radius: 999px;
	white-space: nowrap;
}

.delta-chip.good {
	color: #1e7d43;
	background: rgba(46, 160, 91, 0.14);
}

.delta-chip.bad {
	color: #b03a2e;
	background: rgba(192, 57, 43, 0.14);
}

@media (max-width: 680px) {
	.metric-cards {
		grid-template-columns: repeat(2, 1fr);
	}
}

@media (max-width: 380px) {
	.metric-cards {
		grid-template-columns: 1fr;
	}
}

html.dark .metric-card {
	background: var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark .metric-label,
html.dark .metric-sublabel {
	color: var(--dm-text-3);
}

html.dark .metric-value {
	color: var(--dm-text-1);
}

html.dark .metric-card.danger .metric-value {
	color: #e5766a;
}

html.dark .delta-chip.good {
	color: #5fce8d;
	background: rgba(46, 160, 91, 0.2);
}

html.dark .delta-chip.bad {
	color: #ef8b7f;
	background: rgba(192, 57, 43, 0.22);
}
</style>
