<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import Card from "primevue/card";
import Message from "primevue/message";
import Select from "primevue/select";
import Skeleton from "primevue/skeleton";
import Tag from "primevue/tag";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import {
	TOS_CHANGE_CATEGORIES,
	type ChangelogEntry,
	type DocumentState,
	type TosChange,
	type TosChangeCategory,
	type TosChangeImpact,
	type TosWatchState,
} from "@/lib/tos-watch";

// Everything this page shows comes from two static JSON files the nightly
// workflow commits (public/tos-watch/) - no API, no key, no server. The SPA
// fallback answers missing paths with index.html (HTTP 200), so absence is
// detected by content shape, not status code.

const loading = ref(true);
const state = ref<TosWatchState | null>(null);
const changelog = ref<ChangelogEntry[]>([]);

function isState(value: unknown): value is TosWatchState {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as TosWatchState).documents)
	);
}

onMounted(async () => {
	try {
		const [stateRes, logRes] = await Promise.all([
			fetch("/tos-watch/state.json"),
			fetch("/tos-watch/changelog.json"),
		]);
		const stateBody: unknown = await stateRes.json().catch(() => null);
		const logBody: unknown = await logRes.json().catch(() => null);
		if (isState(stateBody)) state.value = stateBody;
		if (Array.isArray(logBody)) changelog.value = logBody as ChangelogEntry[];
	} catch {
		// state stays null - the pre-baseline notice renders
	} finally {
		loading.value = false;
	}
});

// --- Service grid -----------------------------------------------------------

interface ServiceGroup {
	service_id: string;
	documents: DocumentState[];
}

const serviceGroups = computed<ServiceGroup[]>(() => {
	const groups = new Map<string, DocumentState[]>();
	for (const doc of state.value?.documents ?? []) {
		const list = groups.get(doc.service_id) ?? [];
		list.push(doc);
		groups.set(doc.service_id, list);
	}
	return [...groups.entries()].map(([service_id, documents]) => ({ service_id, documents }));
});

function serviceName(serviceId: string): string {
	const doc = state.value?.documents.find((d) => d.service_id === serviceId);
	return doc?.service_name ?? serviceId;
}

const RECENT_CHANGE_DAYS = 30;

function docTag(doc: DocumentState): { value: string; severity: string } {
	if (doc.status === "unreachable") return { value: "unreachable", severity: "warn" };
	if (doc.status === "robots_skipped") return { value: "robots skipped", severity: "warn" };
	if (doc.last_changed_at) {
		const age = (Date.now() - new Date(doc.last_changed_at).getTime()) / 86_400_000;
		if (age <= RECENT_CHANGE_DAYS) {
			return { value: `changed ${doc.last_changed_at.slice(0, 10)}`, severity: "info" };
		}
	}
	return { value: "monitored", severity: "success" };
}

const documentCount = computed(() => state.value?.documents.length ?? 0);
const serviceCount = computed(() => serviceGroups.value.length);

function relativeTime(iso: string | null): string {
	if (!iso) return "never";
	const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.round(hours / 24)} days ago`;
}

const lastCheck = computed(() => {
	const times = (state.value?.documents ?? [])
		.map((d) => d.last_checked_at)
		.filter((t): t is string => t !== null)
		.sort();
	return times[times.length - 1] ?? null;
});

// --- Changelog feed + filters ----------------------------------------------

const filterService = ref<string | null>(null);
const filterCategory = ref<TosChangeCategory | null>(null);
const filterImpact = ref<TosChangeImpact | null>(null);
const filterSeverity = ref<TosChange["severity"] | null>(null);

const serviceOptions = computed(() =>
	serviceGroups.value.map((g) => ({ label: serviceName(g.service_id), value: g.service_id })),
);
const categoryOptions = TOS_CHANGE_CATEGORIES.map((c) => ({
	label: c.replaceAll("_", " ").replace(" and ", " & "),
	value: c,
}));
const impactOptions = [
	{ label: "favors provider", value: "favors_provider" },
	{ label: "favors user", value: "favors_user" },
	{ label: "neutral", value: "neutral" },
	{ label: "unclear", value: "unclear" },
];
const severityOptions = [
	{ label: "high", value: "high" },
	{ label: "medium", value: "medium" },
	{ label: "low", value: "low" },
];

const hasChangeFilters = computed(
	() =>
		filterCategory.value !== null || filterImpact.value !== null || filterSeverity.value !== null,
);

function changeMatches(change: TosChange): boolean {
	return (
		(filterCategory.value === null || change.category === filterCategory.value) &&
		(filterImpact.value === null || change.impact === filterImpact.value) &&
		(filterSeverity.value === null || change.severity === filterSeverity.value)
	);
}

const filteredEntries = computed(() =>
	changelog.value.filter((entry) => {
		if (filterService.value !== null && entry.service_id !== filterService.value) return false;
		// Change-level filters: an entry stays visible if any of its changes
		// matches every active filter. Cosmetic entries have no changes, so
		// any change-level filter hides them.
		if (hasChangeFilters.value) return entry.report.changes.some(changeMatches);
		return true;
	}),
);

function clearFilters() {
	filterService.value = null;
	filterCategory.value = null;
	filterImpact.value = null;
	filterSeverity.value = null;
}

const expanded = ref(new Set<string>());
function toggleEntry(id: string) {
	const next = new Set(expanded.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	expanded.value = next;
}

// Same color language as the lease demo's results table.
const impactLabel = (impact: TosChangeImpact): string => impact.replaceAll("_", " ");
const impactSeverity = (impact: TosChangeImpact): string => {
	switch (impact) {
		case "favors_provider":
			return "warn";
		case "favors_user":
			return "success";
		case "neutral":
			return "secondary";
		default:
			return "info";
	}
};
const severitySeverity = (severity: TosChange["severity"]): string => {
	switch (severity) {
		case "high":
			return "danger";
		case "medium":
			return "warn";
		default:
			return "secondary";
	}
};
const categoryLabel = (category: TosChangeCategory): string =>
	category.replaceAll("_", " ").replace(" and ", " & ");

const latestEntryJson = computed(() =>
	changelog.value.length > 0 ? JSON.stringify(changelog.value[0], null, 2) : null,
);
</script>

<template>
	<div class="project-page">
		<AppNavbar />

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="ToS Watchdog" />
				<h1>ToS Watchdog</h1>
				<EvalBadge project-id="tos-watch" class="header-eval-badge" />
				<p class="intro">
					A standing public record of how terms-of-service and policy documents change.
					Every night, this site checks each monitored document for text changes - most
					nights nothing has changed and the check costs nothing. When a document does
					change, a diff-and-explain pipeline publishes a dated, plain-English entry:
					what changed, who it favors, and how much it matters.
				</p>
				<p v-if="state" class="monitoring-line">
					<i class="fa-solid fa-tower-observation" aria-hidden="true"></i>
					Monitoring {{ documentCount }} documents across {{ serviceCount }} services ·
					last check {{ relativeTime(lastCheck) }}
					<a href="/tos-watch/feed.xml" class="rss-link" target="_blank" rel="noopener">
						<i class="fa-solid fa-rss" aria-hidden="true"></i> Subscribe via RSS
					</a>
				</p>
			</header>

			<Message severity="warn" :closable="false" class="legal-warning">
				This is automated analysis and may contain errors - it is not legal advice, and
				impact and severity labels are automated assessments. This project is not
				affiliated with or endorsed by any listed service. Entries record when a change
				was <em>detected</em> by nightly monitoring, not when it was made. Always verify
				against the linked official documents.
			</Message>

			<template v-if="loading">
				<Skeleton height="8rem" class="loading-block" />
				<Skeleton height="16rem" class="loading-block" />
			</template>

			<Message v-else-if="!state" severity="info" :closable="false">
				The watchdog's first baseline run hasn't landed yet. The monitored-service grid
				and changelog will appear here once nightly monitoring begins.
			</Message>

			<template v-else>
				<section class="grid-section" aria-label="Monitored services">
					<h2>Monitored documents</h2>
					<div class="service-grid">
						<Card v-for="group in serviceGroups" :key="group.service_id" class="service-card">
							<template #title>
								<span class="service-name">{{ serviceName(group.service_id) }}</span>
							</template>
							<template #content>
								<ul class="doc-list">
									<li v-for="doc in group.documents" :key="doc.document_label" class="doc-row">
										<div class="doc-line">
											<a
												:href="doc.document_url"
												target="_blank"
												rel="noopener"
												class="doc-link"
											>
												{{ doc.document_label }}
												<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
											</a>
											<Tag v-bind="docTag(doc)" />
										</div>
										<p class="doc-dates">
											checked {{ relativeTime(doc.last_checked_at) }}
											<template v-if="doc.last_changed_at">
												· last change detected {{ doc.last_changed_at.slice(0, 10) }}
											</template>
										</p>
									</li>
								</ul>
							</template>
						</Card>
					</div>
				</section>

				<section class="feed-section" aria-label="Change log">
					<div class="feed-header">
						<h2>Detected changes</h2>
						<div class="filters">
							<Select
								v-model="filterService"
								:options="serviceOptions"
								option-label="label"
								option-value="value"
								placeholder="Service"
								show-clear
								size="small"
							/>
							<Select
								v-model="filterCategory"
								:options="categoryOptions"
								option-label="label"
								option-value="value"
								placeholder="Category"
								show-clear
								size="small"
							/>
							<Select
								v-model="filterImpact"
								:options="impactOptions"
								option-label="label"
								option-value="value"
								placeholder="Impact"
								show-clear
								size="small"
							/>
							<Select
								v-model="filterSeverity"
								:options="severityOptions"
								option-label="label"
								option-value="value"
								placeholder="Severity"
								show-clear
								size="small"
							/>
						</div>
					</div>

					<div v-if="changelog.length === 0" class="placeholder">
						<i class="fa-solid fa-binoculars" aria-hidden="true"></i>
						<p>
							No changes detected yet - monitoring began
							{{ state.monitoring_since.slice(0, 10) }}. That's the honest state of a
							young monitor, not a malfunction: entries appear here the first night a
							document actually changes.
						</p>
					</div>

					<div v-else-if="filteredEntries.length === 0" class="placeholder">
						<p>No entries match the current filters.</p>
						<Button label="Clear filters" text size="small" @click="clearFilters" />
					</div>

					<ul v-else class="entry-list">
						<li
							v-for="entry in filteredEntries"
							:key="entry.id"
							class="entry"
							:class="{ cosmetic: !entry.report.substantive }"
						>
							<!-- Cosmetic entries: one muted line, no excerpts, no severity. -->
							<p v-if="!entry.report.substantive" class="cosmetic-line">
								<span class="entry-date">{{ entry.detected_at.slice(0, 10) }}</span>
								{{ entry.service_name }} · {{ entry.document_label }} - cosmetic change
								detected ({{ entry.report.cosmetic_note ?? "formatting or wording only" }})
							</p>

							<template v-else>
								<button
									type="button"
									class="entry-summary"
									:aria-expanded="expanded.has(entry.id)"
									@click="toggleEntry(entry.id)"
								>
									<div class="entry-head">
										<span class="entry-title">
											{{ entry.service_name }} · {{ entry.document_label }}
										</span>
										<span class="entry-date">detected {{ entry.detected_at.slice(0, 10) }}</span>
									</div>
									<p class="entry-blurb">{{ entry.report.summary }}</p>
									<div class="entry-tags">
										<Tag
											v-for="(change, i) in entry.report.changes"
											:key="i"
											:value="`${change.severity}: ${impactLabel(change.impact)}`"
											:severity="severitySeverity(change.severity)"
										/>
										<i
											class="fa-solid expand-icon"
											:class="expanded.has(entry.id) ? 'fa-chevron-up' : 'fa-chevron-down'"
											aria-hidden="true"
										></i>
									</div>
								</button>

								<div v-if="expanded.has(entry.id)" class="entry-detail">
									<article
										v-for="(change, i) in entry.report.changes"
										:key="i"
										class="change"
									>
										<div class="change-head">
											<h3>{{ change.title }}</h3>
											<div class="change-tags">
												<Tag :value="categoryLabel(change.category)" severity="secondary" />
												<Tag
													:value="impactLabel(change.impact)"
													:severity="impactSeverity(change.impact)"
												/>
												<Tag :value="change.severity" :severity="severitySeverity(change.severity)" />
											</div>
										</div>
										<p class="change-explanation">{{ change.explanation }}</p>
										<p class="change-effect">
											<strong>In practice:</strong> {{ change.practical_effect }}
										</p>
										<figure v-if="change.old_excerpt" class="excerpt">
											<figcaption>Previous text (excerpt)</figcaption>
											<blockquote>“{{ change.old_excerpt }}”</blockquote>
										</figure>
										<figure class="excerpt">
											<figcaption>
												New text (excerpt) ·
												<a :href="entry.document_url" target="_blank" rel="noopener">
													official document
												</a>
											</figcaption>
											<blockquote>“{{ change.new_excerpt }}”</blockquote>
										</figure>
									</article>
									<p class="entry-meta">
										Generated by {{ entry.model }} · pipeline v{{ entry.pipeline_version }} ·
										automated assessment
									</p>
								</div>
							</template>
						</li>
					</ul>
				</section>
			</template>

			<Accordion class="details-accordion" :value="null">
				<AccordionPanel value="raw-json">
					<AccordionHeader>View raw JSON</AccordionHeader>
					<AccordionContent>
						<pre v-if="latestEntryJson" class="raw-json">{{ latestEntryJson }}</pre>
						<p v-else class="empty">
							No changelog entries yet - the latest entry's exact published JSON will
							appear here after the first detected change.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works &amp; editorial design</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								The economics are the trick: a nightly monitor sounds expensive, but
								almost every night every document is unchanged - and an unchanged
								document is detected by comparing content hashes, which costs nothing.
								Each page's text is extracted, normalized (navigation stripped,
								whitespace collapsed, volatile fragments like copyright years and
								"last updated" lines removed), and hashed; only when a hash differs
								does the model get involved, and even then it sees only the changed
								paragraphs with a little surrounding context, never the whole
								document. A standing public monitor ends up nearly free to run,
								invoking AI a few times a month at most - exactly when there's
								something to explain.
							</p>
							<p>
								A public record about real organizations' legal documents is only
								valuable if it's trustworthy, so the editorial constraints are
								engineered, not aspirational. The site never republishes document
								text: entries carry generated summaries and quoted excerpts capped at
								25 words - a cap enforced by code truncation after the model call, not
								just requested in the prompt. The model's own prose is scanned against
								a forbidden-language list ("quietly", "buried", "sneaky" and friends);
								a violation blocks auto-publish and files a review issue instead.
								Entries say a change was <em>detected</em> on a date - nightly
								monitoring can't know when a change was actually made, and the record
								doesn't pretend otherwise. Cosmetic-only changes (renumbering,
								identical-meaning rewording) are gated into minimal one-line entries
								so the feed never cries wolf.
							</p>
							<p>
								Almost nothing here was built from scratch. The diff-and-explain
								pipeline generalizes the Lease Diff Explainer's hybrid design -
								mechanical diff for detection, model for explanation, forced tool call
								with a schema the API itself validates. The nightly workflow reuses
								the site-health audit's pattern: scheduled CI, results committed back
								to the repo as static JSON with [skip ci], deduplicated ops issues
								when something needs my attention. And like every project on this
								site, the pipeline runs under a continuously-published eval suite -
								synthetic policy documents with planted changes, including a
								user-favorable one to catch directional bias, and a cosmetic-only
								pair that must gate as non-substantive.
							</p>
							<p>
								Honest limitations: monitoring is nightly, so a change made and
								reverted within a day is invisible, and the detection date can trail
								the real change date. Main-content extraction can miss text inside
								scripts or PDFs. The monitored list is a curated sample, not
								coverage. And automated analysis of legal text is a starting point
								for reading the linked source document - never a substitute.
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
	max-width: 780px;
	margin-bottom: 1.5rem;
}

h1 {
	font-size: 2.25rem;
	font-weight: 700;
	margin-bottom: 0.75rem;
}

h2 {
	font-size: 1.15rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	margin: 0 0 1rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.monitoring-line {
	margin-top: 0.9rem;
	font-size: 0.95rem;
	color: #6b6a6d;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.monitoring-line i {
	color: #27a9e0;
}

.rss-link {
	color: #e08427;
	font-weight: 600;
	text-decoration: none;
	margin-left: 0.5rem;
}

.rss-link:hover {
	text-decoration: underline;
}

.legal-warning {
	margin-bottom: 2rem;
}

.loading-block {
	margin-bottom: 1.5rem;
}

.grid-section {
	margin-bottom: 2.5rem;
}

.service-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 1rem;
}

.service-name {
	font-size: 1.05rem;
}

.doc-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.doc-line {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.doc-link {
	color: inherit;
	font-weight: 600;
	text-decoration: none;
}

.doc-link:hover {
	color: #27a9e0;
}

.doc-link i {
	font-size: 0.7rem;
	opacity: 0.55;
	margin-left: 0.25rem;
}

.doc-dates {
	font-size: 0.8rem;
	color: #9b9aa0;
	margin: 0.15rem 0 0;
}

.feed-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
	margin-bottom: 1rem;
}

.feed-header h2 {
	margin: 0;
}

.filters {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.placeholder {
	border: 2px dashed rgba(0, 0, 0, 0.12);
	border-radius: 8px;
	padding: 3rem 1.5rem;
	text-align: center;
	color: #9b9aa0;
}

.placeholder i {
	font-size: 2rem;
	margin-bottom: 0.5rem;
	display: block;
}

.entry-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.entry {
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 8px;
	overflow: hidden;
}

.entry.cosmetic {
	border-style: dashed;
}

.cosmetic-line {
	margin: 0;
	padding: 0.7rem 1rem;
	font-size: 0.88rem;
	color: #9b9aa0;
}

.entry-summary {
	display: block;
	width: 100%;
	text-align: left;
	background: none;
	border: none;
	padding: 1rem;
	cursor: pointer;
	font: inherit;
	color: inherit;
}

.entry-summary:hover {
	background: rgba(39, 169, 224, 0.05);
}

.entry-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	flex-wrap: wrap;
}

.entry-title {
	font-weight: 700;
}

.entry-date {
	font-size: 0.82rem;
	color: #9b9aa0;
	white-space: nowrap;
}

.entry-blurb {
	margin: 0.4rem 0 0.6rem;
	line-height: 1.6;
	color: #6b6a6d;
}

.entry-tags {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	flex-wrap: wrap;
}

.expand-icon {
	margin-left: auto;
	color: #9b9aa0;
	font-size: 0.8rem;
}

.entry-detail {
	border-top: 1px solid rgba(0, 0, 0, 0.08);
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
}

.change-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	flex-wrap: wrap;
	margin-bottom: 0.4rem;
}

.change-head h3 {
	font-size: 1rem;
	font-weight: 700;
	margin: 0;
	text-transform: none;
	letter-spacing: normal;
}

.change-tags {
	display: flex;
	gap: 0.4rem;
	flex-wrap: wrap;
}

.change-explanation {
	line-height: 1.65;
	margin: 0 0 0.35rem;
}

.change-effect {
	line-height: 1.6;
	margin: 0 0 0.6rem;
	color: #6b6a6d;
}

.excerpt {
	margin: 0.5rem 0 0;
	padding-left: 1rem;
	border-left: 3px solid rgba(39, 169, 224, 0.5);
}

.excerpt figcaption {
	font-size: 0.78rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: #9b9aa0;
	margin-bottom: 0.2rem;
}

.excerpt a {
	color: #27a9e0;
	text-transform: none;
	letter-spacing: normal;
}

.excerpt blockquote {
	margin: 0;
	font-style: italic;
	line-height: 1.6;
	font-size: 0.92rem;
}

.entry-meta {
	font-size: 0.78rem;
	color: #9b9aa0;
	margin: 0;
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

	.service-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}

html.dark .project-page {
	color: var(--dm-text-2);
	background: var(--dm-bg);
}

html.dark h1,
html.dark h2,
html.dark .change-head h3,
html.dark .entry-title {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .monitoring-line,
html.dark .entry-blurb,
html.dark .change-effect {
	color: var(--dm-text-2);
}

html.dark .doc-dates,
html.dark .entry-date,
html.dark .cosmetic-line,
html.dark .placeholder,
html.dark .empty,
html.dark .entry-meta,
html.dark .excerpt figcaption {
	color: var(--dm-text-3);
}

html.dark .placeholder {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .entry {
	border-color: rgba(255, 255, 255, 0.12);
}

html.dark .entry-detail {
	border-top-color: rgba(255, 255, 255, 0.1);
}

html.dark .entry-summary:hover {
	background: rgba(39, 169, 224, 0.08);
}
</style>
