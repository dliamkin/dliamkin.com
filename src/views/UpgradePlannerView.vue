<script setup lang="ts">
import { computed, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import FileUpload, { type FileUploadSelectEvent } from "primevue/fileupload";
import Message from "primevue/message";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import Textarea from "primevue/textarea";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import UpgradeFactsTable from "@/components/projects/UpgradeFactsTable.vue";
import UpgradePlanResults from "@/components/projects/UpgradePlanResults.vue";
import UpgradePlanSkeleton from "@/components/projects/UpgradePlanSkeleton.vue";
import {
	sampleFactsFor,
	samplePlanFor,
	UPGRADE_SAMPLE_SNAPSHOT_DATE,
	UPGRADE_SAMPLES,
} from "@/data/upgrade-samples";
import {
	analyzeDependencies,
	ManifestParseError,
	MAX_ANALYZED_DEPENDENCIES,
	MAX_MANIFEST_CHARS,
	parsePackageJson,
	type DependencyFact,
	type DependencyFacts,
} from "@/lib/upgrade-facts";
import { toPlanRequestFacts, type UpgradePlanResult } from "@/lib/upgrade-planner";

// One Haiku call with a distilled facts payload - generous headroom for cold
// starts.
const REQUEST_TIMEOUT_MS = 90_000;

const toast = useToast();

const activeTab = ref("paste");
const manifestText = ref("");

// Phase 1 - facts. Streamed rows land in streamedFacts; the finished
// DependencyFacts (with peer conflicts, failures, skipped) lands in factsResult.
const factsStatus = ref<"idle" | "analyzing" | "done" | "error">("idle");
const factsError = ref("");
const streamedFacts = ref<DependencyFact[]>([]);
const factsResult = ref<DependencyFacts | null>(null);
const progress = ref<{ settled: number; total: number } | null>(null);
const factsSource = ref<"sample" | "live" | null>(null);
const sampleId = ref<string | null>(null);

// Phase 2 - plan.
const planStatus = ref<"idle" | "loading" | "done" | "error">("idle");
const planError = ref("");
const plan = ref<UpgradePlanResult | null>(null);

const overLimit = computed(() => manifestText.value.length > MAX_MANIFEST_CHARS);
const analyzing = computed(() => factsStatus.value === "analyzing");
const canAnalyze = computed(
	() =>
		manifestText.value.trim().length > 0 &&
		!overLimit.value &&
		!analyzing.value &&
		planStatus.value !== "loading",
);
const canPlan = computed(
	() =>
		factsStatus.value === "done" &&
		factsResult.value !== null &&
		factsResult.value.facts.length > 0 &&
		planStatus.value !== "loading",
);
const generatedNote = computed(() =>
	factsSource.value === "sample"
		? `registry data as of ${UPGRADE_SAMPLE_SNAPSHOT_DATE}`
		: "registry data fetched live from npmjs.org",
);

function resetResults() {
	factsStatus.value = "idle";
	factsError.value = "";
	streamedFacts.value = [];
	factsResult.value = null;
	progress.value = null;
	factsSource.value = null;
	planStatus.value = "idle";
	planError.value = "";
	plan.value = null;
}

// Bundled samples render their snapshot facts instantly - no registry
// traffic, and the snapshot date is shown since live registry state drifts.
function loadSample(id: string) {
	const sample = UPGRADE_SAMPLES.find((s) => s.id === id);
	const snapshot = sampleFactsFor(id);
	if (!sample || !snapshot) return;
	resetResults();
	manifestText.value = sample.manifestText;
	activeTab.value = "paste";
	sampleId.value = id;
	streamedFacts.value = snapshot.facts;
	factsResult.value = snapshot;
	factsSource.value = "sample";
	factsStatus.value = "done";
}

function clearAll() {
	manifestText.value = "";
	sampleId.value = null;
	resetResults();
}

function onFileSelect(event: FileUploadSelectEvent) {
	const file = Array.isArray(event.files) ? event.files[0] : event.files;
	if (!(file instanceof File)) return;
	if (file.size > MAX_MANIFEST_CHARS) {
		toast.add({
			severity: "error",
			summary: "File too large",
			detail: "That doesn't look like a package.json - it's over 50KB.",
			life: 5000,
		});
		return;
	}
	void file.text().then((text) => {
		manifestText.value = text;
		activeTab.value = "paste";
		resetResults();
		toast.add({
			severity: "success",
			summary: "File loaded in your browser",
			detail: "The file never leaves your machine - analyze when ready.",
			life: 4000,
		});
	});
}

// Phase 1: parse, then stream registry lookups. All client-side - the only
// network traffic is the visitor's browser talking to registry.npmjs.org.
async function analyze() {
	if (!canAnalyze.value) return;

	// An unmodified bundled sample re-uses its snapshot: zero network.
	const sample = UPGRADE_SAMPLES.find((s) => s.manifestText.trim() === manifestText.value.trim());
	if (sample && sampleFactsFor(sample.id)) {
		loadSample(sample.id);
		return;
	}

	resetResults();
	sampleId.value = null;
	factsStatus.value = "analyzing";
	try {
		const manifest = parsePackageJson(manifestText.value);
		const result = await analyzeDependencies(manifest, {
			onProgress: (settled, total, fact) => {
				progress.value = { settled, total };
				if (fact) streamedFacts.value = [...streamedFacts.value, fact];
			},
		});
		// Reassign: peer conflicts were attached after the last row streamed in.
		streamedFacts.value = [...result.facts];
		factsResult.value = result;
		factsSource.value = "live";
		factsStatus.value =
			result.facts.length > 0 || result.failures.length > 0 ? "done" : "error";
		if (factsStatus.value === "error") {
			factsError.value =
				"None of this manifest's dependencies are on the public npm registry, so there's nothing to analyze.";
		}
	} catch (error) {
		factsError.value =
			error instanceof ManifestParseError
				? error.message
				: "Something went wrong analyzing that package.json. Please check it and try again.";
		factsStatus.value = "error";
	}
}

// Phase 2: the one API call. Bundled samples render their pre-generated plan
// instead - the live endpoint is never spent on them.
async function generatePlan() {
	if (!canPlan.value || factsResult.value === null) return;

	if (factsSource.value === "sample" && sampleId.value !== null) {
		const bundled = samplePlanFor(sampleId.value);
		if (bundled) {
			plan.value = bundled;
			planStatus.value = "done";
			planError.value = "";
		} else {
			planStatus.value = "error";
			planError.value =
				"This sample's pre-generated plan isn't bundled in this build yet. Paste your own package.json for a live plan.";
		}
		return;
	}

	planStatus.value = "loading";
	planError.value = "";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch("/api/plan-upgrades", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ facts: toPlanRequestFacts(factsResult.value.facts) }),
			signal: controller.signal,
		});

		let payload: unknown = null;
		try {
			payload = await response.json();
		} catch {
			// fall through - handled by response.ok check below
		}

		if (!response.ok) {
			const serverError =
				payload !== null &&
				typeof payload === "object" &&
				"error" in payload &&
				typeof payload.error === "string"
					? payload.error
					: null;
			planError.value =
				serverError ??
				(response.status === 429
					? "Too many requests right now - please wait a minute and try again."
					: "Something went wrong generating the plan. Please try again.");
			planStatus.value = "error";
			return;
		}

		if (payload === null || typeof payload !== "object" || !("waves" in payload)) {
			planError.value = "The server returned an unexpected response. Please try again.";
			planStatus.value = "error";
			return;
		}

		plan.value = payload as UpgradePlanResult;
		planStatus.value = "done";
	} catch (error) {
		planError.value =
			error instanceof DOMException && error.name === "AbortError"
				? "The plan generation timed out. Please try again."
				: "Couldn't reach the server. Check your connection and try again.";
		planStatus.value = "error";
	} finally {
		clearTimeout(timeout);
	}
}
</script>

<template>
	<div class="project-page">
		<AppNavbar />
		<Toast position="bottom-right" />

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="Dependency Upgrade Planner" />
				<h1>Dependency Upgrade Planner</h1>
				<EvalBadge project-id="upgrade-planner" class="header-eval-badge" />
				<p class="intro">
					Paste a package.json and get two things: hard facts about every dependency -
					versions behind, deprecations, peer conflicts - computed in your browser
					straight from the npm registry, and then, only if you ask, an AI-synthesized
					upgrade plan: risk tiers, ordered upgrade waves, and the commands to run. Facts
					are computed; only the judgment is generated.
				</p>
			</header>

			<Message severity="warn" :closable="false" class="planner-warning">
				A planning aid, not a substitute for release notes -
				<strong>always verify against each package's changelog before upgrading.</strong>
				Your dependency list is analyzed in your browser; only the computed facts are sent
				(transiently, never stored) if you request a plan.
			</Message>

			<section class="input-section" aria-label="package.json input">
				<div class="samples-row">
					<p class="hint">Load a sample, or bring your own package.json:</p>
					<div class="sample-buttons">
						<Button
							v-for="sample in UPGRADE_SAMPLES"
							:key="sample.id"
							v-tooltip.bottom="sample.description"
							:label="sample.label"
							severity="secondary"
							outlined
							size="small"
							@click="loadSample(sample.id)"
						/>
					</div>
				</div>

				<Tabs v-model:value="activeTab">
					<TabList>
						<Tab value="paste">
							<i class="fa-solid fa-paste" aria-hidden="true"></i>
							Paste package.json
						</Tab>
						<Tab value="upload">
							<i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
							Upload the file
						</Tab>
					</TabList>
					<TabPanels>
						<TabPanel value="paste">
							<Textarea
								v-model="manifestText"
								auto-resize
								rows="12"
								class="manifest-input"
								:invalid="overLimit"
								placeholder='{ "dependencies": { "vue": "^3.4.0", … }, "devDependencies": { … } }'
								aria-label="package.json contents"
							/>
							<div class="panel-footer">
								<span class="char-counter" :class="{ over: overLimit }">
									{{ manifestText.length.toLocaleString() }} /
									{{ MAX_MANIFEST_CHARS.toLocaleString() }}
								</span>
								<Button
									label="Clear all"
									severity="secondary"
									text
									size="small"
									:disabled="manifestText.length === 0 || analyzing"
									@click="clearAll"
								/>
							</div>
						</TabPanel>

						<TabPanel value="upload">
							<div class="upload-zone">
								<i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
								<p>Upload a package.json</p>
								<FileUpload
									mode="basic"
									custom-upload
									auto
									choose-label="Choose file"
									accept=".json,application/json"
									:disabled="analyzing"
									@select="onFileSelect"
								/>
								<p class="formats">
									Read entirely in your browser - the file never leaves it. The
									contents land in the paste tab for review first.
								</p>
							</div>
						</TabPanel>
					</TabPanels>
				</Tabs>

				<div class="actions">
					<Button
						label="Analyze dependencies"
						icon="fa-solid fa-magnifying-glass-chart"
						:disabled="!canAnalyze"
						:loading="analyzing"
						@click="analyze"
					/>
					<span class="phase-note">
						Free &amp; browser-side: your browser queries the npm registry directly - no
						AI, and nothing touches this site's server.
					</span>
				</div>
			</section>

			<section
				v-if="factsStatus !== 'idle'"
				class="facts-section"
				aria-label="Dependency facts"
				aria-live="polite"
			>
				<Message v-if="factsStatus === 'error'" severity="error" :closable="false">
					{{ factsError }}
				</Message>

				<template v-else>
					<div class="section-heading">
						<h2>The facts - computed, not generated</h2>
						<p class="section-sub">
							Everything below is deterministic: registry data plus semver math in
							tested code, no model involved.
							<span v-if="factsSource === 'sample'" class="snapshot-note">
								<i class="fa-solid fa-bolt" aria-hidden="true"></i>
								Bundled snapshot - {{ generatedNote }}, zero network calls.
							</span>
							<span v-else>
								Without a lockfile, the declared ranges are the source of truth.
								First {{ MAX_ANALYZED_DEPENDENCIES }} dependencies analyzed.
							</span>
						</p>
					</div>

					<UpgradeFactsTable
						:facts="streamedFacts"
						:result="factsResult"
						:progress="progress"
					/>

					<div class="actions plan-actions">
						<Button
							v-tooltip.bottom="
								analyzing
									? 'Available once all registry lookups finish'
									: 'One AI call - the computed facts above are sent, never your raw package.json'
							"
							label="Generate upgrade plan"
							icon="fa-solid fa-wand-magic-sparkles"
							:disabled="!canPlan"
							:loading="planStatus === 'loading'"
							@click="generatePlan"
						/>
						<span class="phase-note">
							This is the demo's single AI step: the facts go to a serverless endpoint
							for one model call that tiers, sequences, and annotates - it cannot
							change the numbers.
						</span>
					</div>
				</template>
			</section>

			<section
				v-if="planStatus !== 'idle'"
				class="plan-section"
				aria-label="Upgrade plan"
				aria-live="polite"
			>
				<template v-if="planStatus === 'loading'">
					<p class="stage-note">Synthesizing the upgrade plan…</p>
					<UpgradePlanSkeleton />
				</template>

				<Message v-else-if="planStatus === 'error'" severity="error" :closable="false">
					{{ planError }}
				</Message>

				<template v-else-if="planStatus === 'done' && plan">
					<p v-if="factsSource === 'sample'" class="source-note">
						<i class="fa-solid fa-bolt" aria-hidden="true"></i>
						Rendered from the bundled pre-generated plan - zero API calls.
					</p>
					<UpgradePlanResults
						:plan="plan"
						:facts="streamedFacts"
						:generated-note="generatedNote"
					/>
				</template>
			</section>

			<Accordion class="details-accordion" :value="null">
				<AccordionPanel value="raw-json">
					<AccordionHeader>View raw JSON</AccordionHeader>
					<AccordionContent>
						<template v-if="factsResult">
							<h3 class="raw-heading">Computed facts (phase 1)</h3>
							<pre class="raw-json">{{ JSON.stringify(factsResult, null, 2) }}</pre>
							<template v-if="plan">
								<h3 class="raw-heading">Synthesized plan (phase 2)</h3>
								<pre class="raw-json">{{ JSON.stringify(plan, null, 2) }}</pre>
							</template>
						</template>
						<p v-else class="empty">
							Analyze a package.json first - the exact facts object (and, after phase
							2, the plan the model returned) will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works &amp; the split-brain design</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								This demo has a deliberately split brain. Facts are computed, never
								generated: version numbers, versions-behind counts, deprecation
								flags, and peer conflicts all come from the npm registry
								(CORS-enabled and keyless, so your browser queries it directly - the
								facts phase makes zero calls to my infrastructure and costs nothing)
								plus deterministic semver math in unit-tested TypeScript. Judgment
								is synthesized: one guarded model call turns those facts into risk
								tiers, ordered waves, and rationale. The design rule is that the
								model selects and orders but never restates numbers - the UI renders
								every version from the facts object keyed by package name, the
								server strips any plan entry whose target doesn't equal the computed
								latest, and the install commands are rebuilt in code from the facts
								rather than trusted from the model's output.
							</p>
							<p>
								The peer-conflict detector is the clearest example of putting
								deterministic code where determinism is possible. "@vue/test-utils'
								latest requires vue 3.x but your declared range caps at ^2.6" is a
								fact, computable with semver range intersection - so it's computed,
								in code with unit tests, and handed to the model as ground truth to
								sequence around. An LLM could guess at this and would sometimes be
								wrong; range math is never wrong.
							</p>
							<p>
								The model's breaking-change notes are the one place its training
								knowledge enters - and training data ages, so each note carries a
								model-assigned confidence, the UI labels every note "from model
								knowledge - verify," and every package row links to its npm page and
								repository. Those links are deterministic, from registry metadata,
								precisely because a model-generated changelog URL is the kind of
								thing that gets hallucinated.
							</p>
							<p>
								Honest limitations: no lockfile resolution (declared ranges are the
								source of truth, so what's actually installed may differ), no
								transitive dependency analysis, and no monorepo workspaces. A
								production version would parse the lockfile, retrieve real changelog
								entries instead of relying on model memory, and hook into CI to open
								the upgrade PRs wave by wave - the two-phase architecture stays the
								same.
							</p>
						</div>
					</AccordionContent>
				</AccordionPanel>
			</Accordion>
		</main>

		<SiteFooter />
	</div>
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
	max-width: 1280px;
	margin: 0 auto;
	padding: 7.5rem 1rem 4rem;
}

.project-header {
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

.planner-warning {
	margin-bottom: 2rem;
}

.samples-row {
	margin-bottom: 1rem;
}

.hint {
	color: #6b6a6d;
	margin-bottom: 0.6rem;
}

.sample-buttons {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.manifest-input {
	width: 100%;
	font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
	line-height: 1.6;
	font-size: 0.85rem;
}

.panel-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 0.25rem;
}

.char-counter {
	font-size: 0.8rem;
	color: #9b9aa0;
}

.char-counter.over {
	color: #d32f2f;
	font-weight: 700;
}

.actions {
	display: flex;
	gap: 1rem;
	align-items: center;
	margin-top: 1.25rem;
	flex-wrap: wrap;
}

.phase-note {
	font-size: 0.82rem;
	color: #9b9aa0;
	max-width: 460px;
	line-height: 1.5;
}

.upload-zone {
	border: 2px dashed rgba(39, 169, 224, 0.5);
	border-radius: 10px;
	padding: 2rem 1.5rem;
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	background: rgba(39, 169, 224, 0.04);
}

.upload-zone i {
	font-size: 2rem;
	color: #27a9e0;
}

.formats {
	font-size: 0.8rem;
	color: #9b9aa0;
	max-width: 480px;
}

.facts-section {
	margin-top: 2.5rem;
}

.section-heading {
	margin-bottom: 1rem;
}

.section-heading h2 {
	font-size: 1.3rem;
	font-weight: 700;
	margin-bottom: 0.35rem;
}

.section-sub {
	font-size: 0.88rem;
	color: #6b6a6d;
	line-height: 1.6;
	max-width: 720px;
}

.snapshot-note {
	color: #5cb85c;
	font-weight: 600;
}

.snapshot-note i {
	margin-right: 0.25rem;
}

.plan-actions {
	margin-top: 1.5rem;
}

.plan-section {
	margin-top: 2.5rem;
}

.stage-note {
	color: #6b6a6d;
	font-size: 0.9rem;
	margin-bottom: 0.75rem;
}

.source-note {
	font-size: 0.85rem;
	color: #5cb85c;
	font-weight: 600;
	margin-bottom: 0.75rem;
}

.details-accordion {
	margin-top: 2.5rem;
}

.raw-heading {
	font-size: 0.95rem;
	margin: 0.75rem 0 0.5rem;
}

.raw-json {
	background: #1e1e1e;
	color: #d4d4d4;
	padding: 1rem;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 0.85rem;
	line-height: 1.5;
	max-height: 480px;
	overflow-y: auto;
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
html.dark .section-heading h2 {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .hint,
html.dark .section-sub,
html.dark .stage-note {
	color: var(--dm-text-2);
}

html.dark .char-counter,
html.dark .phase-note,
html.dark .formats,
html.dark .empty {
	color: var(--dm-text-3);
}

html.dark .char-counter.over {
	color: #ff6b6b;
}

html.dark .upload-zone {
	background: rgba(39, 169, 224, 0.07);
}
</style>
