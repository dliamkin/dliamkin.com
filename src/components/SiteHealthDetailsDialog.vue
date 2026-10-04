<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import type { HealthHistoryEntry, HealthReport } from "@/lib/site-health";

// The details dialog carries PrimeVue's heaviest components (DataTable,
// Dialog). SiteHealthWidget loads this file lazily on the first click so
// none of it lands in the main bundle that blocks first paint.

const REPO_URL = "https://github.com/dliamkin/dliamkin";
const ISSUES_URL = `${REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3Asite-health`;
const WORKFLOW_URL = `${REPO_URL}/blob/main/.github/workflows/site-health.yml`;

const props = defineProps<{
	report: HealthReport;
	statusLabel: string;
	statusSeverity: string;
}>();

const visible = defineModel<boolean>("visible", { required: true });

const history = ref<HealthHistoryEntry[]>([]);

onMounted(async () => {
	try {
		const response = await fetch("/site-health/history.json");
		if (response.ok && response.headers.get("content-type")?.includes("json")) {
			const data = await response.json();
			if (Array.isArray(data)) history.value = data as HealthHistoryEntry[];
		}
	} catch {
		// Sparkline just stays hidden.
	}
});

// Minimal inline SVG sparkline of nightly average performance - no chart
// dependency needed for a 90-point line.
const sparkline = computed(() => {
	const points = history.value.map((entry) => entry.scores.performance);
	if (points.length < 2) return null;
	const width = 140;
	const height = 36;
	const step = width / (points.length - 1);
	return points
		.map(
			(score, i) =>
				`${(i * step).toFixed(1)},${(height - (score / 100) * height).toFixed(1)}`,
		)
		.join(" ");
});
</script>

<template>
	<Dialog
		v-model:visible="visible"
		modal
		header="Nightly AI Site Health Audit"
		class="health-dialog"
		:style="{ width: 'min(680px, 94vw)' }"
	>
		<p class="dialog-framing">
			This site audits itself nightly -
			<a :href="WORKFLOW_URL" target="_blank" rel="noopener noreferrer"
				>Lighthouse + Playwright + an AI reviewer in CI</a
			>. Findings are filed as
			<a :href="ISSUES_URL" target="_blank" rel="noopener noreferrer">GitHub issues</a>
			automatically.
		</p>

		<p class="dialog-status">
			<Tag :severity="statusSeverity" :value="statusLabel" />
			<span>{{ props.report.summary }}</span>
		</p>

		<DataTable :value="props.report.pages" size="small" class="dialog-table">
			<Column field="path" header="Page" />
			<Column header="Perf">
				<template #body="{ data }">{{ data.lighthouse.performance }}</template>
			</Column>
			<Column header="A11y">
				<template #body="{ data }">{{ data.lighthouse.accessibility }}</template>
			</Column>
			<Column header="Best">
				<template #body="{ data }">{{ data.lighthouse.best_practices }}</template>
			</Column>
			<Column header="SEO">
				<template #body="{ data }">{{ data.lighthouse.seo }}</template>
			</Column>
		</DataTable>

		<p v-if="props.report.top_fix" class="dialog-topfix">
			<strong>Top recommended fix:</strong> {{ props.report.top_fix }}
		</p>

		<div v-if="sparkline" class="dialog-trend">
			<span class="trend-label">Performance trend (nightly avg)</span>
			<svg
				viewBox="0 0 140 36"
				width="140"
				height="36"
				role="img"
				aria-label="Performance score trend"
			>
				<polyline
					:points="sparkline"
					fill="none"
					stroke="#27a9e0"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			</svg>
		</div>

		<template #footer>
			<Button
				label="Open site-health issues"
				icon="fa-brands fa-github"
				severity="secondary"
				size="small"
				as="a"
				:href="ISSUES_URL"
				target="_blank"
				rel="noopener noreferrer"
			/>
		</template>
	</Dialog>
</template>

<style scoped>
.dialog-framing,
.dialog-status,
.dialog-topfix {
	font-family: "Raleway", sans-serif;
	font-size: 0.92rem;
	line-height: 1.55;
	margin: 0 0 1rem;
}

.dialog-framing a {
	color: #1f8fc0;
}

.dialog-status {
	display: flex;
	align-items: flex-start;
	gap: 0.6rem;
}

.dialog-table {
	margin-bottom: 1rem;
}

.dialog-trend {
	display: flex;
	align-items: center;
	gap: 0.8rem;
}

.trend-label {
	font-family: "Raleway", sans-serif;
	font-size: 0.8rem;
	color: #6b7280;
}

/* The footer widget itself is already dark; only the dialog text needs help. */
html.dark .dialog-framing a {
	color: var(--dm-blue-soft);
}

html.dark .trend-label {
	color: var(--dm-text-3);
}
</style>
