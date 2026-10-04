<script setup lang="ts">
// Variance attribution tornado: one horizontal bar per step, sorted by its
// share of total cost variance. Answers "which step should I de-risk first?"
import { computed } from "vue";
import { formatPercent } from "@/lib/tail-risk/format";
import type { SimulationSummary, StepParams } from "@/lib/tail-risk/types";

const props = defineProps<{
	summary: SimulationSummary | null;
	steps: StepParams[];
}>();

interface Row {
	stepId: string;
	label: string;
	share: number;
	/** Bar width relative to the largest share, for visual spread. */
	widthPct: number;
}

const rows = computed<Row[]>(() => {
	const s = props.summary;
	if (!s) return [];
	const labels = new Map(props.steps.map((step) => [step.id, step.label]));
	const sorted = [...s.varianceShare].sort((a, b) => b.share - a.share);
	const max = sorted[0]?.share ?? 0;
	return sorted.map((entry) => ({
		stepId: entry.stepId,
		label: labels.get(entry.stepId) ?? entry.stepId,
		share: entry.share,
		widthPct: max > 0 ? (entry.share / max) * 100 : 0,
	}));
});

const hasVariance = computed(() => rows.value.some((r) => r.share > 0));
</script>

<template>
	<div class="tornado">
		<h2>Variance attribution</h2>
		<p class="caption">Where to spend your prompt-engineering effort first.</p>

		<p v-if="!hasVariance" class="empty">
			No variance - every parameter is deterministic (lo = hi, loop risk 0).
		</p>

		<ol v-else class="tornado-rows">
			<li v-for="row in rows" :key="row.stepId" class="tornado-row">
				<span class="row-label" :title="row.label">{{ row.label }}</span>
				<span class="row-track">
					<span class="row-bar" :style="{ width: `${row.widthPct}%` }"></span>
				</span>
				<span class="row-share">{{ formatPercent(row.share) }}</span>
			</li>
		</ol>
	</div>
</template>

<style scoped>
h2 {
	font-size: 1.1rem;
	font-weight: 700;
	margin-bottom: 0.15rem;
}

.caption {
	font-size: 0.85rem;
	color: #6b6a6d;
	margin-bottom: 0.9rem;
}

.empty {
	font-size: 0.9rem;
	color: #6b6a6d;
	border: 1px dashed rgba(0, 0, 0, 0.15);
	border-radius: 8px;
	padding: 0.8rem 1rem;
}

.tornado-rows {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.tornado-row {
	display: grid;
	grid-template-columns: minmax(120px, 220px) 1fr 3.5rem;
	align-items: center;
	gap: 0.7rem;
}

.row-label {
	font-size: 0.85rem;
	color: #414042;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.row-track {
	background: rgba(124, 83, 201, 0.1);
	border-radius: 4px;
	height: 14px;
	overflow: hidden;
}

.row-bar {
	display: block;
	height: 100%;
	background: #7c53c9;
	border-radius: 4px;
	transition: width 0.3s ease;
}

.row-share {
	font-size: 0.82rem;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	color: #6b6a6d;
	text-align: right;
}

@media (max-width: 480px) {
	.tornado-row {
		grid-template-columns: minmax(90px, 130px) 1fr 3.2rem;
	}
}

html.dark h2 {
	color: var(--dm-text-1);
}

html.dark .caption,
html.dark .row-share,
html.dark .empty {
	color: var(--dm-text-3);
}

html.dark .empty {
	border-color: var(--dm-border);
}

html.dark .row-label {
	color: var(--dm-text-2);
}

html.dark .row-track {
	background: rgba(155, 118, 224, 0.16);
}

html.dark .row-bar {
	background: #9b76e0;
}
</style>
