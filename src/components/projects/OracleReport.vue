<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Timeline from "primevue/timeline";
import OracleForecastSummary from "./OracleForecastSummary.vue";
import OracleStepCard from "./OracleStepCard.vue";
import OracleCostBreakdown from "./OracleCostBreakdown.vue";
import type { AgentPlan, RiskLevel, SimulationResult, StepAssessment } from "@/lib/dry-run-oracle";

const props = defineProps<{
	result: SimulationResult;
	plan: AgentPlan;
	source: "sample" | "cache" | "live";
	stale: boolean;
	appliedFixes: ReadonlySet<string>;
}>();

const emit = defineEmits<{
	approve: [];
	edit: [];
	abort: [];
	applyFix: [stepId: string, fix: string];
}>();

interface TimelineItem {
	assessment: StepAssessment;
	description: string;
	index: number;
}

const items = computed<TimelineItem[]>(() =>
	props.result.steps.map((assessment, index) => ({
		assessment,
		description:
			props.plan.steps.find((step) => step.id === assessment.stepId)?.description ??
			`Step ${index + 1}`,
		index,
	})),
);

const MARKER: Record<RiskLevel, string> = {
	clear: "fa-solid fa-sun",
	caution: "fa-solid fa-cloud",
	storm: "fa-solid fa-bolt",
};
</script>

<template>
	<section class="report" aria-label="Simulation report">
		<Message v-if="props.stale" severity="warn" :closable="false" class="report__stale">
			The plan changed since this forecast - hit <strong>Edit &amp; Re-run</strong> for fresh
			numbers.
		</Message>

		<OracleForecastSummary :result="props.result" :source="props.source" />

		<Timeline :value="items" class="report__timeline">
			<template #marker="{ item }">
				<span
					class="report__marker"
					:data-risk="(item as TimelineItem).assessment.riskLevel"
				>
					<i
						:class="MARKER[(item as TimelineItem).assessment.riskLevel]"
						aria-hidden="true"
					></i>
				</span>
			</template>
			<template #content="{ item }">
				<OracleStepCard
					:assessment="(item as TimelineItem).assessment"
					:description="(item as TimelineItem).description"
					:index="(item as TimelineItem).index"
					:target-model="props.plan.targetModel"
					:fix-applied="props.appliedFixes.has((item as TimelineItem).assessment.stepId)"
					@apply-fix="(stepId, fix) => emit('applyFix', stepId, fix)"
				/>
			</template>
		</Timeline>

		<OracleCostBreakdown :result="props.result" :target-model="props.plan.targetModel" />

		<div class="report__actions">
			<Button
				label="Approve"
				icon="fa-solid fa-check"
				severity="success"
				@click="emit('approve')"
			/>
			<Button
				label="Edit & Re-run"
				icon="fa-solid fa-pen"
				severity="secondary"
				@click="emit('edit')"
			/>
			<Button
				label="Abort"
				icon="fa-solid fa-xmark"
				severity="danger"
				outlined
				@click="emit('abort')"
			/>
		</div>
	</section>
</template>

<style scoped>
.report {
	display: flex;
	flex-direction: column;
	gap: 1.1rem;
}

.report__stale {
	margin: 0;
}

.report__timeline :deep(.p-timeline-event-opposite) {
	display: none;
}

.report__timeline :deep(.p-timeline-event-content) {
	padding-bottom: 1rem;
	min-width: 0;
}

.report__marker {
	width: 2rem;
	height: 2rem;
	border-radius: 50%;
	display: grid;
	place-items: center;
	background: #f2f4f6;
	border: 1px solid rgba(0, 0, 0, 0.12);
}

.report__marker[data-risk="clear"] i {
	color: #4caf50;
}

.report__marker[data-risk="caution"] i {
	color: #f0a020;
}

.report__marker[data-risk="storm"] i {
	color: #e04b3a;
}

.report__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.6rem;
}

@media (max-width: 420px) {
	.report__actions {
		flex-direction: column;
		align-items: stretch;
	}
}

html.dark .report__marker {
	background: var(--dm-bg-mute);
	border-color: var(--dm-border);
}

html.dark .report__marker[data-risk="clear"] i {
	color: #5cb85c;
}

html.dark .report__marker[data-risk="caution"] i {
	color: #f2b13d;
}

html.dark .report__marker[data-risk="storm"] i {
	color: #ff6b6b;
}
</style>
