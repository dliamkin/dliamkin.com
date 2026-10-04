<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import OraclePlanInput from "@/components/projects/OraclePlanInput.vue";
import OracleReport from "@/components/projects/OracleReport.vue";
import OracleHistoryDrawer from "@/components/projects/OracleHistoryDrawer.vue";
import {
	ORACLE_SAMPLE_PLAN,
	ORACLE_SAMPLE_RESULT,
	isOracleSampleRequest,
} from "@/data/oracle-sample";
import {
	isSimulationResult,
	type AgentPlan,
	type SimulateRequest,
	type SimulationResult,
} from "@/lib/dry-run-oracle";
import {
	addHistoryEntry,
	cacheForecast,
	clearHistory,
	forecastCacheHash,
	getCachedForecast,
	readHistory,
	type OracleHistoryEntry,
} from "@/lib/oracle-cache";

const REQUEST_TIMEOUT_MS = 90_000;

const STATUS_LINES = [
	"Consulting the oracle…",
	"Reading the token tea leaves…",
	"Simulating step 3…",
	"Checking the retry-storm radar…",
	"Estimating context re-send growth…",
	"Pricing the worst case…",
];

const toast = useToast();

const status = ref<"idle" | "loading" | "done">("idle");
const result = ref<SimulationResult | null>(null);
const ranPlan = ref<AgentPlan | null>(null); // snapshot the report was built from
const source = ref<"sample" | "cache" | "live">("live");
const stale = ref(false);
const appliedFixes = ref<Set<string>>(new Set());
const historyEntries = ref<OracleHistoryEntry[]>(readHistory());
const historyOpen = ref(false);

const inputRef = ref<InstanceType<typeof OraclePlanInput> | null>(null);
const inputSection = ref<HTMLElement | null>(null);

const loading = computed(() => status.value === "loading");

// Rotating weather-voice status line while the forecast runs.
const statusIndex = ref(0);
let statusTimer: ReturnType<typeof setInterval> | undefined;
const statusText = computed(
	(): string => STATUS_LINES[statusIndex.value % STATUS_LINES.length] ?? "Consulting the oracle…",
);

function startStatus(): void {
	statusIndex.value = 0;
	statusTimer = setInterval(() => {
		statusIndex.value = (statusIndex.value + 1) % STATUS_LINES.length;
	}, 1400);
}

function stopStatus(): void {
	if (statusTimer !== undefined) clearInterval(statusTimer);
	statusTimer = undefined;
}

onBeforeUnmount(stopStatus);

// The editor emits `change` on any user edit (setPlan calls don't fire it),
// so a rendered report goes stale exactly when the draft diverges from it.
function onPlanChanged(): void {
	if (result.value) stale.value = true;
}

function presentResult(
	simulation: SimulationResult,
	request: SimulateRequest,
	from: "sample" | "cache" | "live",
): void {
	result.value = simulation;
	source.value = from;
	stale.value = false;
	appliedFixes.value = new Set();
	status.value = "done";

	// The plan the report describes: the oracle-inferred structure for
	// freeform submissions, otherwise the structured input as submitted.
	let snapshot: AgentPlan;
	if (simulation.inferredPlan) {
		snapshot = structuredClone(simulation.inferredPlan);
	} else {
		snapshot = {
			title: request.title,
			targetModel: request.targetModel,
			steps: structuredClone(request.steps ?? []),
		};
		if (request.contextNotes) snapshot.contextNotes = request.contextNotes;
	}
	ranPlan.value = snapshot;

	// Pre-fill the editor with the structured plan so Edit & Re-run just works.
	inputRef.value?.setPlan(structuredClone(snapshot));
	inputRef.value?.setMode("structured");

	historyEntries.value = addHistoryEntry(snapshot, simulation);
}

async function onSubmit(request: SimulateRequest): Promise<void> {
	// The unmodified bundled sample renders its pre-generated result instantly
	// - no API call, no cost.
	if (isOracleSampleRequest(request)) {
		presentResult(structuredClone(ORACLE_SAMPLE_RESULT), request, "sample");
		return;
	}

	// Forecast cache: an unchanged plan (by SHA-256 of its compact
	// serialization + target model) never re-spends tokens.
	const hash = await forecastCacheHash(request);
	const cached = getCachedForecast(hash);
	if (cached) {
		presentResult(structuredClone(cached), request, "cache");
		return;
	}

	status.value = "loading";
	startStatus();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch("/api/simulate-plan", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		let body: unknown = null;
		try {
			body = await response.json();
		} catch {
			// fall through - handled below
		}

		if (!response.ok) {
			const serverError =
				body !== null &&
				typeof body === "object" &&
				"error" in body &&
				typeof body.error === "string"
					? body.error
					: null;
			showError(
				serverError ??
					(response.status === 429
						? "Too many forecasts right now - please wait a minute and try again."
						: "Something went wrong consulting the oracle. Please try again."),
			);
			return;
		}

		if (!isSimulationResult(body)) {
			showError("The server returned an unexpected response. Please try again.");
			return;
		}

		cacheForecast(hash, body);
		presentResult(body, request, "live");
	} catch (error) {
		showError(
			error instanceof DOMException && error.name === "AbortError"
				? "The forecast timed out. Please try again."
				: "Couldn't reach the server. Check your connection and try again.",
		);
	} finally {
		clearTimeout(timeout);
		stopStatus();
		if (status.value === "loading") status.value = result.value ? "done" : "idle";
	}
}

function showError(message: string): void {
	toast.add({ severity: "error", summary: "Forecast failed", detail: message, life: 6000 });
}

function loadSample(): void {
	inputRef.value?.setPlan(structuredClone(ORACLE_SAMPLE_PLAN));
	inputRef.value?.setMode("structured");
}

function runSample(): void {
	loadSample();
	void onSubmit({
		title: ORACLE_SAMPLE_PLAN.title,
		targetModel: ORACLE_SAMPLE_PLAN.targetModel,
		contextNotes: ORACLE_SAMPLE_PLAN.contextNotes,
		steps: structuredClone(ORACLE_SAMPLE_PLAN.steps),
	});
}

function onApplyFix(stepId: string, fix: string): void {
	if (!inputRef.value?.applyFix(stepId, fix)) return;
	appliedFixes.value = new Set([...appliedFixes.value, stepId]);
	stale.value = true;
	toast.add({
		severity: "info",
		summary: "Fix applied",
		detail: "Step updated in the plan editor. Re-run for a fresh forecast.",
		life: 4000,
	});
}

async function onApprove(): Promise<void> {
	const clean = inputRef.value?.getPlan() ?? ranPlan.value;
	if (!clean) return;
	try {
		await navigator.clipboard.writeText(JSON.stringify(clean, null, 2));
		toast.add({
			severity: "success",
			summary: "Plan approved",
			detail: "Copied as clean JSON - go spend those tokens wisely.",
			life: 4500,
		});
	} catch {
		toast.add({
			severity: "warn",
			summary: "Clipboard unavailable",
			detail: "Copy was blocked by the browser.",
			life: 4000,
		});
	}
}

function onEdit(): void {
	inputSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function onAbort(): void {
	const keepModel = inputRef.value?.getPlan().targetModel ?? "claude-opus";
	result.value = null;
	ranPlan.value = null;
	stale.value = false;
	status.value = "idle";
	appliedFixes.value = new Set();
	inputRef.value?.setPlan({
		title: "",
		targetModel: keepModel,
		steps: [{ id: crypto.randomUUID(), description: "" }],
		contextNotes: "",
	});
	toast.add({ severity: "info", summary: "Aborted", detail: "Crisis averted.", life: 4000 });
}

function onRestore(entry: OracleHistoryEntry): void {
	historyOpen.value = false;
	result.value = entry.result;
	ranPlan.value = structuredClone(entry.plan);
	source.value = entry.result.planHash === "sample" ? "sample" : "cache";
	stale.value = false;
	status.value = "done";
	appliedFixes.value = new Set();
	inputRef.value?.setPlan(structuredClone(entry.plan));
}

function onClearHistory(): void {
	clearHistory();
	historyEntries.value = [];
}
</script>

<template>
	<div class="project-page">
		<Toast position="bottom-right" />
		<AppNavbar />

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="Dry-Run Oracle" />
				<h1>Dry-Run Oracle</h1>
				<EvalBadge project-id="dry-run-oracle" class="header-eval-badge" />
				<p class="intro">
					A weather forecast for AI spend. Before an expensive multi-step agent task runs,
					paste the plan here - a cheap model (Claude Haiku) simulates it, predicting
					likely failure points, retry storms, and the token bill per step. Approve, edit,
					or abort before a single expensive token burns: spending ~$0.01 of forecast to
					avoid wasting $5+ of agent run is the best trade in the business.
				</p>
				<p class="header-actions">
					<Button
						label="Load the sample plan"
						icon="fa-solid fa-file-import"
						severity="secondary"
						outlined
						size="small"
						:disabled="loading"
						@click="loadSample"
					/>
					<Button
						label="Run the sample forecast"
						icon="fa-solid fa-play"
						size="small"
						:disabled="loading"
						@click="runSample"
					/>
					<Button
						label="Past forecasts"
						icon="fa-solid fa-clock-rotate-left"
						severity="secondary"
						text
						size="small"
						@click="historyOpen = true"
					/>
				</p>
			</header>

			<section ref="inputSection" class="zone" aria-label="Plan editor">
				<OraclePlanInput
					ref="inputRef"
					:loading="loading"
					:status-text="statusText"
					@submit="onSubmit"
					@change="onPlanChanged"
				/>
			</section>

			<section v-if="result && ranPlan" class="zone" aria-label="Forecast" aria-live="polite">
				<OracleReport
					:result="result"
					:plan="ranPlan"
					:source="source"
					:stale="stale"
					:applied-fixes="appliedFixes"
					@approve="onApprove"
					@edit="onEdit"
					@abort="onAbort"
					@apply-fix="onApplyFix"
				/>
			</section>

			<section v-else-if="!loading" class="zone placeholder">
				<i class="fa-solid fa-compass" aria-hidden="true"></i>
				<h2>Check the weather before you fly</h2>
				<p>
					Describe the steps your agent will take (or paste a messy freeform plan), pick
					the model it would run on, and run the dry-run. The sample forecast renders
					instantly from a bundled result - zero API calls.
				</p>
				<Button
					label="Try the sample forecast"
					icon="fa-solid fa-play"
					@click="runSample"
				/>
			</section>

			<Accordion class="details-accordion" :value="null">
				<AccordionPanel value="raw-json">
					<AccordionHeader>View raw JSON</AccordionHeader>
					<AccordionContent>
						<pre v-if="result" class="raw-json">{{
							JSON.stringify(result, null, 2)
						}}</pre>
						<p v-else class="empty">
							Run a forecast first - the exact SimulationResult JSON will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works &amp; the cost model</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								The oracle is one forced tool-use call to Claude Haiku through this
								site's Cloudflare Worker, with the output schema strictly validated
								by the API and the response hard-capped at 1,500 tokens. The model
								predicts only <em>tokens, iterations, and risks</em> - every dollar
								figure is computed deterministically in code from a shared pricing
								table, so the money math can't hallucinate.
							</p>
							<p>
								The cost model assumes agents re-send prior context each iteration:
								a step with per-iteration input <code>b</code> over
								<code>k</code> iterations costs about
								<code>b × k(k+1)/2</code> input tokens, plus output × k. The worst
								case inflates iterations by up to 2× at loop risk 1.0 and uses the
								high token bounds - that's the "if all loop risks materialize"
								number the savings multiple is measured against.
							</p>
							<p>
								The tool practices the frugality it preaches: one API call per
								simulation, compact serialization (stripped fields, no
								pretty-printing), a localStorage forecast cache keyed by SHA-256 of
								the plan - unchanged plans re-render for free - and the bundled
								sample never calls the API at all. Every report displays what the
								forecast itself cost, straight from the real usage block.
							</p>
							<p>
								Nothing you type is stored server-side: plans live in Worker memory
								for the duration of the request, and the forecast cache and history
								live only in your browser's localStorage. Rate limits (per minute
								and per day, per IP) bound worst-case spend.
							</p>
						</div>
					</AccordionContent>
				</AccordionPanel>
			</Accordion>
		</main>

		<SiteFooter />
	</div>

	<OracleHistoryDrawer
		v-model:visible="historyOpen"
		:entries="historyEntries"
		@restore="onRestore"
		@clear="onClearHistory"
	/>
</template>

<style scoped>
.header-eval-badge {
	margin-bottom: 0.75rem;
}

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
	margin-bottom: 0.75rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.header-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-top: 1rem;
}

.zone {
	margin-bottom: 1.5rem;
}

.placeholder {
	border: 2px dashed rgba(0, 0, 0, 0.12);
	border-radius: 14px;
	padding: 2.4rem 1.4rem;
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.7rem;
}

.placeholder i {
	font-size: 2rem;
	color: #27a9e0;
}

.placeholder h2 {
	margin: 0;
	font-size: 1.15rem;
	font-weight: 700;
}

.placeholder p {
	margin: 0;
	max-width: 36rem;
	color: #6b6a6d;
	font-size: 0.92rem;
	line-height: 1.55;
}

.details-accordion {
	margin-top: 2.5rem;
}

.raw-json {
	background: #1e1e1e;
	color: #d4d4d4;
	padding: 1rem;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 0.85rem;
	line-height: 1.5;
}

.architecture-notes p {
	line-height: 1.7;
	margin-bottom: 1rem;
}

.architecture-notes p:last-child {
	margin-bottom: 0;
}

.empty {
	color: #9b9aa0;
	font-style: italic;
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

html.dark h1,
html.dark .placeholder h2 {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .placeholder p {
	color: var(--dm-text-2);
}

html.dark .placeholder {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .empty {
	color: var(--dm-text-3);
}
</style>
