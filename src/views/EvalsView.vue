<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Card from "primevue/card";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Tag from "primevue/tag";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import {
	EVAL_HISTORY_PATH,
	EVAL_LATEST_PATH,
	isEvalReport,
	type CaseResult,
	type EvalHistoryEntry,
	type EvalReport,
	type SuiteResult,
} from "@/lib/evals";

// Public eval dashboard: renders the static JSON committed by
// .github/workflows/evals.yml (public/eval-results/) - no API, no key, no
// per-visitor cost. Failures are shown with the same expected/actual detail
// the runner prints; nothing is filtered.

const REPO_URL = "https://github.com/dliamkin/dliamkin";
const ISSUES_URL = `${REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3Aevals`;
const WORKFLOW_URL = `${REPO_URL}/blob/main/.github/workflows/evals.yml`;

const report = ref<EvalReport | null>(null);
const history = ref<EvalHistoryEntry[]>([]);
const loaded = ref(false);
const expandedRows = ref({});

async function fetchJson(path: string): Promise<unknown> {
	const response = await fetch(path);
	if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
		return null;
	}
	return response.json();
}

onMounted(async () => {
	try {
		const [latest, hist] = await Promise.all([
			fetchJson(EVAL_LATEST_PATH),
			fetchJson(EVAL_HISTORY_PATH),
		]);
		if (isEvalReport(latest)) report.value = latest;
		if (Array.isArray(hist)) history.value = hist as EvalHistoryEntry[];
	} catch {
		// render the pending state
	} finally {
		loaded.value = true;
	}
});

const lastRun = computed(() => {
	if (!report.value) return "";
	const ms = Date.now() - new Date(report.value.run_at).getTime();
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
});

const triggerLabel: Record<EvalReport["trigger"], string> = {
	schedule: "nightly schedule",
	push: "push to main",
	manual: "manual run",
};

const overallPercent = computed(() =>
	report.value ? Math.round(report.value.overall_pass_rate * 100) : 0,
);

// A suite regressed if the previous history entry had a higher pass count -
// same comparison the runner uses to set regression_from_previous.
function suiteRegressed(suite: SuiteResult): boolean {
	const previous = history.value[history.value.length - 2];
	const before = previous?.suites.find((s) => s.project_id === suite.project_id);
	return before !== undefined && suite.pass_count < before.pass_count;
}

function suiteStatus(suite: SuiteResult): { severity: string; label: string } {
	if (suite.pass_count === suite.total) return { severity: "success", label: "All passing" };
	return { severity: "danger", label: `${suite.total - suite.pass_count} failing` };
}

// Per-suite pass-rate sparkline over the whole history, with markers where
// the prompt hash changed - so a score move is attributable to "prompt
// changed here" vs "same prompt, model drifted".
const SPARK_W = 160;
const SPARK_H = 36;

function sparklineFor(projectId: SuiteResult["project_id"]): {
	points: string;
	markers: { x: number; y: number }[];
} | null {
	const entries = history.value
		.map((entry) => entry.suites.find((s) => s.project_id === projectId))
		.filter((s): s is NonNullable<typeof s> => s !== undefined);
	if (entries.length < 2) return null;
	const step = SPARK_W / (entries.length - 1);
	const y = (s: (typeof entries)[number]) =>
		SPARK_H - (s.total === 0 ? 0 : (s.pass_count / s.total) * (SPARK_H - 6)) - 3;
	const points = entries
		.map((s, i) => `${(i * step).toFixed(1)},${y(s).toFixed(1)}`)
		.join(" ");
	const markers = entries
		.map((s, i) => ({ s, i }))
		.filter(({ s, i }) => i > 0 && entries[i - 1]?.prompt_hash !== s.prompt_hash)
		.map(({ s, i }) => ({ x: i * step, y: y(s) }));
	return { points, markers };
}

// Last-14-runs pass/fail dots for one case - single-run pass/fail hides
// instability, so flakiness is made visible per case.
function caseDots(projectId: SuiteResult["project_id"], caseId: string): (boolean | null)[] {
	return history.value.slice(-14).map((entry) => {
		const suite = entry.suites.find((s) => s.project_id === projectId);
		return suite?.cases?.[caseId] ?? null;
	});
}

// Failures first inside the expansion, so the interesting rows lead.
function sortedChecks(caseResult: CaseResult): CaseResult["checks"] {
	return [...caseResult.checks].sort((a, b) => Number(a.passed) - Number(b.passed));
}
</script>

<template>
	<div class="evals-page">
		<AppNavbar />

		<main class="evals-main">
			<header class="evals-header">
				<ProjectBreadcrumb current="Eval Dashboard" />
				<h1>Eval Dashboard</h1>
				<p class="intro">
					Every AI project on this site is continuously tested. A
					<a :href="WORKFLOW_URL" target="_blank" rel="noopener noreferrer"
						>scheduled CI job</a
					>
					re-runs each project's eval suite through the exact pipeline production uses and
					commits the results here - automatically, failures included. Regressions file
					<a :href="ISSUES_URL" target="_blank" rel="noopener noreferrer"
						>GitHub issues</a
					>
					on their own.
				</p>
			</header>

			<template v-if="report">
				<div class="overall-strip">
					<span class="overall-rate"
						><span class="rate-number">{{ overallPercent }}%</span> passing</span
					>
					<span class="overall-meta">
						Last run {{ lastRun }} · {{ triggerLabel[report.trigger] }}
					</span>
					<Tag
						v-if="report.regression_from_previous"
						severity="danger"
						:value="`Regression: ${report.regression_detail}`"
					/>
				</div>

				<div class="suite-cards">
					<Card v-for="suite in report.suites" :key="suite.project_id" class="suite-card">
						<template #title>
							<div class="suite-title">
								<span>{{ suite.project_label }}</span>
								<span class="suite-tags">
									<Tag
										:severity="suiteStatus(suite).severity"
										:value="suiteStatus(suite).label"
									/>
									<Tag
										v-if="suiteRegressed(suite)"
										severity="danger"
										value="regression"
									/>
								</span>
							</div>
						</template>
						<template #content>
							<div class="suite-summary">
								<span class="suite-fraction">
									{{ suite.pass_count }}<span class="fraction-total">/{{ suite.total }}</span>
								</span>
								<div v-if="sparklineFor(suite.project_id)" class="suite-trend">
									<svg
										:viewBox="`0 0 ${SPARK_W} ${SPARK_H}`"
										:width="SPARK_W"
										:height="SPARK_H"
										role="img"
										:aria-label="`${suite.project_label} pass-rate trend`"
									>
										<polyline
											:points="sparklineFor(suite.project_id)!.points"
											fill="none"
											stroke="#27a9e0"
											stroke-width="2"
											stroke-linejoin="round"
											stroke-linecap="round"
										/>
										<circle
											v-for="(marker, i) in sparklineFor(suite.project_id)!.markers"
											:key="i"
											:cx="marker.x"
											:cy="marker.y"
											r="3"
											fill="#f59e0b"
										>
											<title>prompt changed here</title>
										</circle>
									</svg>
									<span class="trend-label">pass-rate trend · <span class="marker-dot"></span> prompt changed</span>
								</div>
							</div>
							<div class="suite-meta">
								<Tag severity="secondary" :value="suite.model" />
								<Tag severity="secondary" :value="`prompt ${suite.prompt_hash}`" />
							</div>

							<DataTable
								v-model:expandedRows="expandedRows"
								:value="suite.cases"
								dataKey="case_id"
								size="small"
								class="case-table"
							>
								<Column expander style="width: 2.5rem" />
								<Column header="Case">
									<template #body="{ data }">
										<div class="case-cell">
											<i
												:class="
													data.passed
														? 'fa-solid fa-circle-check case-pass'
														: 'fa-solid fa-circle-xmark case-fail'
												"
												aria-hidden="true"
											></i>
											<div>
												<span class="case-id">{{ data.case_id }}</span>
												<span class="case-desc">{{ data.description }}</span>
											</div>
										</div>
									</template>
								</Column>
								<Column header="Last 14 runs" style="width: 11rem">
									<template #body="{ data }">
										<span class="dots" aria-label="pass/fail across recent runs">
											<span
												v-for="(dot, i) in caseDots(suite.project_id, data.case_id)"
												:key="i"
												class="dot"
												:class="
													dot === null ? 'dot-none' : dot ? 'dot-pass' : 'dot-fail'
												"
											></span>
										</span>
									</template>
								</Column>
								<template #expansion="{ data }">
									<div class="checks">
										<p v-if="data.error" class="check-error">
											Pipeline error: <code>{{ data.error }}</code>
										</p>
										<div
											v-for="check in sortedChecks(data)"
											:key="check.name"
											class="check"
											:class="{ 'check-failed': !check.passed }"
										>
											<i
												:class="
													check.passed
														? 'fa-solid fa-check'
														: 'fa-solid fa-xmark'
												"
												aria-hidden="true"
											></i>
											<div>
												<span class="check-name">{{ check.name }}</span>
												<dl v-if="!check.passed" class="check-detail">
													<dt>expected</dt>
													<dd>{{ check.expected }}</dd>
													<dt>actual</dt>
													<dd>{{ check.actual }}</dd>
												</dl>
											</div>
										</div>
									</div>
								</template>
							</DataTable>
						</template>
					</Card>
				</div>

				<Accordion class="details-accordion" :value="null">
					<AccordionPanel value="how">
						<AccordionHeader>How this works &amp; why failures are public</AccordionHeader>
						<AccordionContent>
							<div class="architecture-notes">
								<p>
									AI features don't stay tested on their own. Model updates, prompt
									edits, and provider-side changes can all shift behavior without a
									single line of my code changing - and "I tried it and it looked
									fine" is not a test suite. So every project on this site registers an
									eval suite: planted ground truth (synthetic notes with known
									medications, lease pairs with known changes, screenshots with known
									components) checked by plain deterministic assertions on the
									structured output.
								</p>
								<p>
									The design choice that matters most: the evals run the exact
									production code path. Each project's pipeline - prompt, forced
									tool-use schema, parsing - lives in one shared module that the
									serverless handler and the eval runner both import, so the suite
									can't quietly test a stale copy of the logic. Each run also records
									a hash of the system prompt, so when a score moves, the dashboard
									can tell "the prompt changed here" apart from "same prompt, the
									model drifted."
								</p>
								<p>
									Results are published automatically, failures included, because an
									eval dashboard that only ever shows green is marketing. One run per
									case per scheduled execution, no retry-until-green; the per-case
									dots above exist precisely because a single run's pass/fail can
									hide instability that shows up across fourteen.
								</p>
								<p>
									Honest limitations: deterministic checks measure extraction
									fidelity - did the model find the planted facts, decline to invent
									absent ones, and label judgments sanely - not prose quality or
									explanation depth. A production eval system would add
									rubric-based LLM-as-judge scoring calibrated against human labels,
									much larger case sets, and statistical handling for flaky cases
									rather than eyeballed dots. The bones, though - versioned prompts,
									pinned ground truth, CI enforcement, public accountability - are
									the same ones I'd ship at work.
								</p>
							</div>
						</AccordionContent>
					</AccordionPanel>
					<AccordionPanel value="raw-json">
						<AccordionHeader>View raw report JSON</AccordionHeader>
						<AccordionContent>
							<pre class="raw-json">{{ JSON.stringify(report, null, 2) }}</pre>
						</AccordionContent>
					</AccordionPanel>
				</Accordion>
			</template>

			<div v-else-if="loaded" class="pending">
				<i class="fa-regular fa-hourglass-half" aria-hidden="true"></i>
				<p>
					First eval run pending - results will appear here automatically once the
					<a :href="WORKFLOW_URL" target="_blank" rel="noopener noreferrer"
						>eval workflow</a
					>
					has run.
				</p>
			</div>
		</main>

		<SiteFooter />
	</div>
</template>

<style scoped>
.evals-page {
	font-family: "Raleway", sans-serif;
	color: #414042;
	/* Transparent so the site-wide particle field shows through; the body
	   already paints the same background this used to. */
	background: transparent;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

.evals-main {
	flex: 1;
	width: 100%;
	max-width: 1280px;
	margin: 0 auto;
	padding: 7.5rem 1rem 4rem;
}

.evals-header {
	max-width: 720px;
	margin-bottom: 1.5rem;
}

h1 {
	font-size: 2.25rem;
	font-weight: 700;
	margin-bottom: 0.75rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.intro a {
	color: #1f8fc0;
}

.overall-strip {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 1rem;
	margin-bottom: 1.5rem;
}

.overall-rate {
	font-size: 1.05rem;
	color: #6b6a6d;
}

.rate-number {
	font-family: "JetBrains Mono", monospace;
	font-size: 1.6rem;
	font-weight: 700;
	color: #414042;
}

.overall-meta {
	font-size: 0.85rem;
	color: #9b9aa0;
}

.suite-cards {
	display: grid;
	/* minmax(0, …) so a wide case table can't blow the column out past the
	   viewport - it scrolls inside the card instead. */
	grid-template-columns: minmax(0, 1fr);
	gap: 1.5rem;
	margin-bottom: 2rem;
}

.suite-card {
	min-width: 0;
}

.suite-title {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 0.5rem;
	font-size: 1.05rem;
}

.suite-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

/* Long regression detail must wrap instead of widening the page. */
.overall-strip :deep(.p-tag) {
	white-space: normal;
	text-align: left;
}

/* Wide table content scrolls inside the card, never the page body. */
.case-table {
	max-width: 100%;
}

.case-table :deep(.p-datatable-table-container) {
	overflow-x: auto;
}

.suite-summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 1rem;
	margin-bottom: 0.5rem;
}

.suite-fraction {
	font-family: "JetBrains Mono", monospace;
	font-size: 2rem;
	font-weight: 700;
	color: #414042;
}

.fraction-total {
	color: #9b9aa0;
	font-size: 1.2rem;
}

.suite-trend {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.trend-label {
	font-size: 0.72rem;
	color: #9b9aa0;
}

.marker-dot {
	display: inline-block;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: #f59e0b;
	vertical-align: middle;
}

.suite-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
	margin-bottom: 1rem;
}

.suite-meta :deep(.p-tag) {
	font-family: "JetBrains Mono", monospace;
	font-weight: 500;
	font-size: 0.72rem;
}

.case-cell {
	display: flex;
	align-items: flex-start;
	gap: 0.6rem;
}

.case-cell > div {
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	min-width: 0;
}

.case-pass {
	color: #22a05a;
	margin-top: 0.2rem;
}

.case-fail {
	color: #d32f2f;
	margin-top: 0.2rem;
}

.case-id {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.8rem;
	font-weight: 600;
}

.case-desc {
	font-size: 0.8rem;
	color: #6b6a6d;
	line-height: 1.5;
}

.dots {
	display: inline-flex;
	gap: 3px;
}

.dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
}

.dot-pass {
	background: #22a05a;
}

.dot-fail {
	background: #d32f2f;
}

.dot-none {
	background: #e3e3e6;
}

.checks {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	padding: 0.5rem 0.75rem;
}

.check {
	display: flex;
	align-items: flex-start;
	gap: 0.6rem;
	font-size: 0.85rem;
}

.check i {
	color: #22a05a;
	margin-top: 0.2rem;
}

.check-failed i {
	color: #d32f2f;
}

.check-name {
	font-weight: 600;
}

.check-failed .check-name {
	color: #d32f2f;
}

.check-detail {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.15rem 0.6rem;
	margin: 0.3rem 0 0;
	font-size: 0.8rem;
}

.check-detail dt {
	font-family: "JetBrains Mono", monospace;
	color: #9b9aa0;
}

.check-detail dd {
	margin: 0;
	color: #6b6a6d;
	overflow-wrap: anywhere;
}

.check-failed .check-detail dd {
	color: #b03434;
}

.check-error {
	font-size: 0.85rem;
	color: #d32f2f;
	margin: 0;
}

.details-accordion {
	max-width: 900px;
}

.architecture-notes p {
	line-height: 1.7;
	color: #6b6a6d;
	margin-bottom: 1rem;
}

.raw-json {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.75rem;
	line-height: 1.5;
	overflow-x: auto;
	background: #f7f8fa;
	border-radius: 8px;
	padding: 1rem;
	max-height: 480px;
	overflow-y: auto;
}

.pending {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	color: #6b6a6d;
	background: #f7f8fa;
	border-radius: 10px;
	padding: 1.25rem 1.5rem;
	max-width: 640px;
}

.pending i {
	color: #27a9e0;
	font-size: 1.3rem;
}

.pending a {
	color: #1f8fc0;
}

@media (max-width: 900px) {
	.evals-main {
		padding-top: 6.5rem;
	}

	h1 {
		font-size: 1.75rem;
	}
}

html.dark .evals-page {
	color: var(--dm-text-2);
	background: transparent;
}

html.dark h1 {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .overall-rate,
html.dark .case-desc,
html.dark .check-detail dd,
html.dark .architecture-notes p {
	color: var(--dm-text-2);
}

html.dark .intro a,
html.dark .pending a {
	color: var(--dm-blue-soft);
}

html.dark .rate-number,
html.dark .suite-fraction {
	color: var(--dm-text-1);
}

html.dark .overall-meta,
html.dark .fraction-total,
html.dark .trend-label,
html.dark .check-detail dt {
	color: var(--dm-text-3);
}

html.dark .case-fail,
html.dark .check-failed i,
html.dark .check-failed .check-name,
html.dark .check-error {
	color: #f0655f;
}

html.dark .dot-fail {
	background: #f0655f;
}

html.dark .dot-none {
	background: #3a4048;
}

html.dark .check-failed .check-detail dd {
	color: #ff8f8f;
}

html.dark .raw-json,
html.dark .pending {
	background: var(--dm-bg-soft);
}

html.dark .pending {
	color: var(--dm-text-2);
}
</style>
