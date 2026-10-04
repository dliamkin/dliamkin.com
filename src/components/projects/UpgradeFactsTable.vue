<script setup lang="ts">
import { computed } from "vue";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Tag from "primevue/tag";
import type { DependencyFacts, DependencyFact } from "@/lib/upgrade-facts";

// The Phase-1 payoff: every cell here is computed, none of it generated. Rows
// stream in as the browser's registry lookups settle (the parent re-passes a
// growing facts array); the summary strip and peer-conflict column fill once
// all lookups are done.

const props = defineProps<{
	facts: DependencyFact[];
	result: DependencyFacts | null; // null while lookups are still streaming
	progress: { settled: number; total: number } | null;
}>();

const summary = computed(() => {
	const current = props.facts.filter((f) => f.is_current).length;
	const deprecated = props.facts.filter((f) => f.latest_deprecated || f.floor_deprecated).length;
	const conflicts = props.facts.reduce((sum, f) => sum + f.peer_conflicts.length, 0);
	return {
		current,
		behind: props.facts.length - current,
		deprecated,
		conflicts,
	};
});

type BehindSeverity = "success" | "info" | "warn" | "danger";

// The colored heart of the table: current = green, patch/minor = blue,
// 1 major = orange, 2+ majors or deprecated = red.
function behindLabel(fact: DependencyFact): { label: string; severity: BehindSeverity } {
	if (fact.latest_deprecated) return { label: "deprecated", severity: "danger" };
	if (fact.is_current) return { label: "current", severity: "success" };
	if (fact.majors_behind >= 2) {
		return { label: `${fact.majors_behind} majors behind`, severity: "danger" };
	}
	if (fact.majors_behind === 1) return { label: "1 major behind", severity: "warn" };
	if (fact.minors_behind > 0) {
		return {
			label: `${fact.minors_behind} minor${fact.minors_behind > 1 ? "s" : ""} behind`,
			severity: "info",
		};
	}
	if (fact.patches_behind > 0) {
		return {
			label: `${fact.patches_behind} patch${fact.patches_behind > 1 ? "es" : ""} behind`,
			severity: "info",
		};
	}
	// Floor above latest (range newer than the published latest) - rare, but honest.
	return { label: "ahead of latest", severity: "info" };
}

// Numeric sort key so "behind" sorts by actual distance, not label text.
function behindRank(fact: DependencyFact): number {
	if (fact.is_current && !fact.latest_deprecated) return 0;
	return (
		fact.majors_behind * 10_000 +
		fact.minors_behind * 100 +
		fact.patches_behind +
		(fact.latest_deprecated ? 100_000 : 0)
	);
}

const rows = computed(() =>
	props.facts.map((fact) => ({ ...fact, behind_rank: behindRank(fact) })),
);

function conflictTooltip(fact: DependencyFact): string {
	return fact.peer_conflicts.map((c) => c.message).join("\n\n");
}
</script>

<template>
	<div class="facts-table">
		<div class="summary-strip" role="status">
			<span class="stat">
				<strong>{{ summary.current }}</strong> current
			</span>
			<span class="stat behind">
				<strong>{{ summary.behind }}</strong> behind
			</span>
			<span class="stat deprecated" :class="{ zero: summary.deprecated === 0 }">
				<strong>{{ summary.deprecated }}</strong> deprecated
			</span>
			<span class="stat conflicts" :class="{ zero: summary.conflicts === 0 }">
				<strong>{{ summary.conflicts }}</strong> peer conflict{{
					summary.conflicts === 1 ? "" : "s"
				}}
			</span>
			<span v-if="progress && !result" class="progress-note">
				<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
				{{ progress.settled }} / {{ progress.total }} looked up…
			</span>
		</div>

		<DataTable
			:value="rows"
			data-key="name"
			sort-field="behind_rank"
			:sort-order="-1"
			size="small"
			scrollable
			class="facts-datatable"
		>
			<Column field="name" header="Package" sortable frozen>
				<template #body="{ data }">
					<span class="pkg-name">{{ data.name }}</span>
				</template>
			</Column>
			<Column field="section" header="Section" sortable>
				<template #body="{ data }">
					<Tag
						:value="data.section === 'dependencies' ? 'dep' : 'devDep'"
						:severity="data.section === 'dependencies' ? 'primary' : 'secondary'"
					/>
				</template>
			</Column>
			<Column field="declared_range" header="Declared" sortable>
				<template #body="{ data }">
					<code>{{ data.declared_range }}</code>
				</template>
			</Column>
			<Column field="latest" header="Latest" sortable>
				<template #body="{ data }">
					<code>{{ data.latest }}</code>
				</template>
			</Column>
			<Column field="behind_rank" header="Behind" sortable>
				<template #body="{ data }">
					<Tag :value="behindLabel(data).label" :severity="behindLabel(data).severity" />
				</template>
			</Column>
			<Column header="Peers">
				<template #body="{ data }">
					<i
						v-if="data.peer_conflicts.length > 0"
						v-tooltip.left="conflictTooltip(data)"
						class="fa-solid fa-triangle-exclamation conflict-icon"
						:aria-label="`${data.peer_conflicts.length} peer conflicts: ${conflictTooltip(data)}`"
						tabindex="0"
					></i>
					<span v-else class="no-conflict" aria-hidden="true">-</span>
				</template>
			</Column>
			<Column header="Links">
				<template #body="{ data }">
					<span class="links">
						<a
							:href="data.npm_url"
							target="_blank"
							rel="noopener noreferrer"
							:aria-label="`${data.name} on npm`"
						>
							npm
						</a>
						<a
							v-if="data.repository_url"
							:href="data.repository_url"
							target="_blank"
							rel="noopener noreferrer"
							:aria-label="`${data.name} repository`"
						>
							repo
						</a>
					</span>
				</template>
			</Column>
		</DataTable>

		<template v-if="result">
			<p v-if="result.failures.length > 0" class="degraded-note">
				<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
				Lookup failed for
				{{ result.failures.map((f) => `${f.name} (${f.reason})`).join(", ") }} - the rest of
				the analysis is unaffected.
			</p>
			<p v-if="result.skipped.length > 0" class="skipped-note">
				Skipped (not on the public registry):
				{{ result.skipped.map((s) => `${s.name} - ${s.reason}`).join("; ") }}.
			</p>
			<p v-if="result.truncated" class="skipped-note">
				This manifest declares {{ result.total_declared }} registry dependencies - only the
				first {{ facts.length + result.failures.length }} were analyzed.
			</p>
		</template>
	</div>
</template>

<style scoped>
.summary-strip {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 1.25rem;
	padding: 0.7rem 1rem;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 8px;
	background: rgba(39, 169, 224, 0.05);
	margin-bottom: 0.9rem;
	font-size: 0.9rem;
}

.stat strong {
	font-size: 1.05rem;
}

.stat.deprecated:not(.zero) strong,
.stat.conflicts:not(.zero) strong {
	color: #d32f2f;
}

.progress-note {
	margin-left: auto;
	color: #6b6a6d;
	font-size: 0.85rem;
}

.progress-note i {
	color: #27a9e0;
	margin-right: 0.3rem;
}

.facts-datatable {
	font-size: 0.88rem;
}

.pkg-name {
	font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
	font-weight: 600;
	word-break: break-all;
}

code {
	font-size: 0.85em;
}

.conflict-icon {
	color: #d32f2f;
	cursor: help;
}

.no-conflict {
	color: #c9c8cc;
}

.links {
	display: inline-flex;
	gap: 0.6rem;
}

.links a {
	color: #1f8fc0;
	font-size: 0.82rem;
	font-weight: 600;
}

.degraded-note,
.skipped-note {
	margin-top: 0.6rem;
	font-size: 0.82rem;
	color: #9b9aa0;
}

.degraded-note i {
	color: #e0a92e;
	margin-right: 0.3rem;
}

html.dark .summary-strip {
	border-color: rgba(255, 255, 255, 0.12);
	background: rgba(39, 169, 224, 0.08);
}

html.dark .progress-note {
	color: var(--dm-text-2);
}

html.dark .stat.deprecated:not(.zero) strong,
html.dark .stat.conflicts:not(.zero) strong,
html.dark .conflict-icon {
	color: #ff6b6b;
}

html.dark .no-conflict {
	color: var(--dm-text-3);
}

html.dark .links a {
	color: var(--dm-blue-soft);
}

html.dark .degraded-note,
html.dark .skipped-note {
	color: var(--dm-text-3);
}
</style>
