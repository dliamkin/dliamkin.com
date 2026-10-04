<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import Tag from "primevue/tag";
import { HEALTH_STATUSES, type HealthReport, type HealthStatus } from "@/lib/site-health";

// Reads the static JSON committed nightly by .github/workflows/site-health.yml
// - no API, no key, no per-visitor cost. Before the first audit exists the
// widget renders nothing: the SPA fallback answers unknown paths with
// index.html (HTTP 200), so "missing" is detected by content-type + shape,
// not status code.

// The details dialog pulls in PrimeVue's DataTable + Dialog - by far the
// heaviest components in the library. Loading them only on the first click
// keeps them out of the main bundle every page ships.
const SiteHealthDetailsDialog = defineAsyncComponent(
	() => import("@/components/SiteHealthDetailsDialog.vue"),
);

const report = ref<HealthReport | null>(null);
const showDetails = ref(false);
const detailsRequested = ref(false);

function isHealthReport(value: unknown): value is HealthReport {
	return (
		typeof value === "object" &&
		value !== null &&
		HEALTH_STATUSES.includes((value as HealthReport).status) &&
		Array.isArray((value as HealthReport).pages)
	);
}

onMounted(async () => {
	try {
		const response = await fetch("/site-health/latest.json");
		if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
			return;
		}
		const data = await response.json();
		if (isHealthReport(data)) report.value = data;
	} catch {
		// No report yet (or unreachable) - render nothing.
	}
});

function openDetails() {
	detailsRequested.value = true;
	showDetails.value = true;
}

const statusMeta: Record<HealthStatus, { severity: string; label: string }> = {
	healthy: { severity: "success", label: "Healthy" },
	warnings: { severity: "warn", label: "Warnings" },
	regression: { severity: "danger", label: "Regression" },
	audit_error: { severity: "secondary", label: "Audit skipped" },
};

const meta = computed(() => (report.value ? statusMeta[report.value.status] : null));

const lastAudited = computed(() => {
	if (!report.value) return "";
	const ms = Date.now() - new Date(report.value.audited_at).getTime();
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
});

const averages = computed(() => {
	const pages = report.value?.pages ?? [];
	if (pages.length === 0) return null;
	const avg = (pick: (p: (typeof pages)[number]) => number) =>
		Math.round(pages.reduce((sum, p) => sum + pick(p), 0) / pages.length);
	return [
		{ label: "Perf", value: avg((p) => p.lighthouse.performance) },
		{ label: "A11y", value: avg((p) => p.lighthouse.accessibility) },
		{ label: "Best", value: avg((p) => p.lighthouse.best_practices) },
		{ label: "SEO", value: avg((p) => p.lighthouse.seo) },
	];
});
</script>

<template>
	<div v-if="report && meta" class="site-health">
		<!-- No aria-label: it hid the visible text from the accessible name
		     (a WCAG 2.5.3 label-in-name failure); the button's own content -
		     status tag, title, blurb, scores - already names it. -->
		<button type="button" class="health-summary-btn" @click="openDetails">
			<Tag :severity="meta.severity" :value="meta.label" class="health-tag" />
			<span class="health-copy">
				<span class="health-title">Site health · audited {{ lastAudited }}</span>
				<span class="health-blurb">{{ report.summary }}</span>
			</span>
			<span v-if="averages" class="health-scores">
				<span v-for="score in averages" :key="score.label" class="score">
					<span class="score-value">{{ score.value }}</span>
					<span class="score-label">{{ score.label }}</span>
				</span>
			</span>
		</button>

		<SiteHealthDetailsDialog
			v-if="detailsRequested"
			v-model:visible="showDetails"
			:report="report"
			:status-label="meta.label"
			:status-severity="meta.severity"
		/>
	</div>
</template>

<style scoped>
.health-summary-btn {
	display: flex;
	align-items: center;
	gap: 1rem;
	max-width: 620px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.09);
	border-radius: 10px;
	padding: 0.6rem 0.9rem;
	cursor: pointer;
	text-align: left;
	font-family: "Raleway", sans-serif;
	color: #cdd3da;
	transition:
		border-color 0.25s ease,
		background 0.25s ease;
}

.health-summary-btn:hover {
	border-color: rgba(102, 198, 239, 0.5);
	background: rgba(255, 255, 255, 0.07);
}

.health-tag {
	flex-shrink: 0;
	font-size: 0.7rem;
}

.health-copy {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	min-width: 0;
}

.health-title {
	font-size: 0.78rem;
	font-weight: 700;
	color: #eef1f4;
}

.health-blurb {
	font-size: 0.74rem;
	line-height: 1.4;
	color: #8a8b8f;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.health-scores {
	display: flex;
	gap: 0.7rem;
	flex-shrink: 0;
}

.score {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.score-value {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.85rem;
	color: #66c6ef;
}

.score-label {
	font-size: 0.6rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: #8a8b8f;
}

@media (max-width: 700px) {
	.health-scores {
		display: none;
	}
}
</style>
