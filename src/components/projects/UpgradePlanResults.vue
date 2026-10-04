<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Card from "primevue/card";
import Message from "primevue/message";
import Tag from "primevue/tag";
import Timeline from "primevue/timeline";
import { useToast } from "primevue/usetoast";
import type { DependencyFact } from "@/lib/upgrade-facts";
import {
	toPlanRequestFacts,
	upgradePlanToMarkdown,
	type PackagePlan,
	type RiskTier,
	type UpgradePlanResult,
} from "@/lib/upgrade-planner";

// Renders the synthesized plan. Design rule made visible here: version data
// on every row comes from the facts object (keyed by package name) - the
// model's output selects and orders packages, it never restates numbers.

const props = defineProps<{
	plan: UpgradePlanResult;
	facts: DependencyFact[];
	generatedNote: string; // e.g. "registry data as of 2026-07-09"
}>();

const toast = useToast();

const factsByName = computed(() => new Map(props.facts.map((fact) => [fact.name, fact])));
const plansByName = computed(() => new Map(props.plan.plans.map((entry) => [entry.name, entry])));

const expandedPackage = ref<string | null>(null);
const showCurrent = ref(false);

const tierMeta: Record<RiskTier, { label: string; severity: "success" | "warn" | "danger" }> = {
	safe_now: { label: "safe now", severity: "success" },
	needs_testing: { label: "needs testing", severity: "warn" },
	breaking_likely: { label: "breaking likely", severity: "danger" },
};

function planFor(name: string): PackagePlan | undefined {
	return plansByName.value.get(name);
}

function versionLine(name: string): string {
	const fact = factsByName.value.get(name);
	return fact ? `${fact.declared_range} → ${fact.latest}` : "";
}

function toggleDetail(name: string) {
	expandedPackage.value = expandedPackage.value === name ? null : name;
}

async function copyText(text: string, what: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.add({ severity: "success", summary: `${what} copied`, life: 2500 });
	} catch {
		toast.add({
			severity: "error",
			summary: "Couldn't copy",
			detail: "Your browser blocked clipboard access.",
			life: 4000,
		});
	}
}

function copyMarkdown() {
	void copyText(
		upgradePlanToMarkdown(props.plan, toPlanRequestFacts(props.facts), props.generatedNote),
		"Plan markdown",
	);
}
</script>

<template>
	<div class="plan-results">
		<div class="plan-header">
			<p class="plan-summary">{{ plan.summary }}</p>
			<Button
				label="Copy full plan as markdown"
				icon="fa-regular fa-copy"
				severity="secondary"
				outlined
				size="small"
				@click="copyMarkdown"
			/>
		</div>

		<Message
			v-for="alert in plan.deprecated_alerts"
			:key="alert"
			severity="warn"
			:closable="false"
			class="plan-message"
		>
			{{ alert }}
		</Message>
		<Message
			v-for="guidance in plan.peer_conflict_guidance"
			:key="guidance"
			severity="info"
			:closable="false"
			class="plan-message"
		>
			{{ guidance }}
		</Message>
		<Message
			v-if="plan.validation_warnings.length > 0"
			severity="warn"
			:closable="false"
			class="plan-message"
		>
			Post-validation stripped {{ plan.validation_warnings.length }} model output(s) that
			contradicted the computed facts:
			{{ plan.validation_warnings.join(" ") }}
		</Message>

		<Message v-if="plan.waves.length === 0" severity="success" :closable="false">
			Nothing to do - every analyzed package is already current.
		</Message>

		<Timeline v-else :value="plan.waves" class="wave-timeline">
			<template #marker="{ item }">
				<span class="wave-marker">{{ item.order }}</span>
			</template>
			<template #content="{ item }">
				<Card class="wave-card">
					<template #title>
						<span class="wave-title">{{ item.title }}</span>
					</template>
					<template #content>
						<p class="wave-rationale">{{ item.rationale }}</p>

						<div class="wave-packages">
							<button
								v-for="name in item.packages"
								:key="name"
								type="button"
								class="pkg-chip"
								:class="[
									planFor(name)?.tier,
									{ expanded: expandedPackage === name },
								]"
								:aria-expanded="expandedPackage === name"
								@click="toggleDetail(name)"
							>
								<span class="pkg-chip-name">{{ name }}</span>
								<Tag
									v-if="planFor(name)"
									:value="tierMeta[planFor(name)!.tier].label"
									:severity="tierMeta[planFor(name)!.tier].severity"
								/>
							</button>
						</div>

						<template v-for="name in item.packages" :key="`detail-${name}`">
							<div
								v-if="expandedPackage === name && planFor(name)"
								class="pkg-detail"
							>
								<p class="pkg-detail-versions">
									<code>{{ versionLine(name) }}</code>
								</p>
								<p>{{ planFor(name)!.rationale }}</p>
								<ul
									v-if="planFor(name)!.breaking_notes.length > 0"
									class="breaking-notes"
								>
									<li
										v-for="note in planFor(name)!.breaking_notes"
										:key="note.note"
									>
										{{ note.note }}
										<span class="note-provenance">
											from model knowledge, {{ note.confidence }} confidence -
											verify against the changelog
										</span>
									</li>
								</ul>
								<p class="pkg-detail-links">
									<a
										v-if="factsByName.get(name)"
										:href="factsByName.get(name)!.npm_url"
										target="_blank"
										rel="noopener noreferrer"
									>
										npm page
									</a>
									<a
										v-if="factsByName.get(name)?.repository_url"
										:href="factsByName.get(name)!.repository_url!"
										target="_blank"
										rel="noopener noreferrer"
									>
										repository / changelog
									</a>
								</p>
							</div>
						</template>

						<div class="wave-command">
							<code>{{ item.command }}</code>
							<Button
								icon="fa-regular fa-copy"
								text
								size="small"
								:aria-label="`Copy wave ${item.order} command`"
								@click="copyText(item.command, 'Command')"
							/>
						</div>
						<p class="verify-after">
							<i class="fa-solid fa-list-check" aria-hidden="true"></i>
							Before the next wave: {{ item.verify_after }}
						</p>
					</template>
				</Card>
			</template>
		</Timeline>

		<div v-if="plan.general_advice.length > 0" class="general-advice">
			<h3>General advice</h3>
			<ul>
				<li v-for="advice in plan.general_advice" :key="advice">{{ advice }}</li>
			</ul>
		</div>

		<div v-if="plan.already_current.length > 0" class="already-current">
			<button type="button" class="current-toggle" @click="showCurrent = !showCurrent">
				<i
					:class="showCurrent ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'"
					aria-hidden="true"
				></i>
				{{ plan.already_current.length }} package{{
					plan.already_current.length === 1 ? " is" : "s are"
				}}
				already current
			</button>
			<p v-if="showCurrent" class="current-list">
				{{ plan.already_current.join(", ") }}
			</p>
		</div>

		<p class="provenance-note">
			Versions, deprecations, and peer conflicts are computed from npm registry data ({{
				generatedNote
			}}). Tiers, waves, and breaking-change notes are model judgment - notes come from
			training knowledge and can be stale, so verify against each package's changelog before
			upgrading.
		</p>
	</div>
</template>

<style scoped>
.plan-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
	margin-bottom: 1rem;
}

.plan-summary {
	max-width: 640px;
	line-height: 1.7;
	font-size: 1.02rem;
}

.plan-message {
	margin-bottom: 0.6rem;
}

.wave-timeline {
	margin-top: 1.25rem;
}

.wave-timeline :deep(.p-timeline-event-opposite) {
	display: none;
}

.wave-marker {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.8rem;
	height: 1.8rem;
	border-radius: 50%;
	background: #27a9e0;
	color: #fff;
	font-weight: 700;
	font-size: 0.9rem;
}

.wave-card {
	margin-bottom: 1.25rem;
}

.wave-title {
	font-size: 1.05rem;
}

.wave-rationale {
	color: #6b6a6d;
	line-height: 1.6;
	margin-bottom: 0.9rem;
}

.wave-packages {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-bottom: 0.9rem;
}

.pkg-chip {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.3rem 0.65rem;
	border: 1px solid rgba(0, 0, 0, 0.14);
	border-radius: 999px;
	background: transparent;
	cursor: pointer;
	font: inherit;
	font-size: 0.85rem;
	transition:
		border-color 0.15s ease,
		background 0.15s ease;
}

.pkg-chip:hover,
.pkg-chip.expanded {
	border-color: #27a9e0;
	background: rgba(39, 169, 224, 0.07);
}

.pkg-chip-name {
	font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
	font-weight: 600;
}

.pkg-detail {
	border: 1px solid rgba(39, 169, 224, 0.35);
	border-radius: 8px;
	padding: 0.8rem 1rem;
	margin-bottom: 0.9rem;
	font-size: 0.9rem;
	line-height: 1.6;
}

.pkg-detail-versions {
	margin-bottom: 0.4rem;
}

.breaking-notes {
	margin: 0.5rem 0 0.5rem 1.1rem;
}

.note-provenance {
	display: block;
	font-size: 0.78rem;
	color: #9b9aa0;
	font-style: italic;
}

.pkg-detail-links {
	display: flex;
	gap: 1rem;
	margin-top: 0.5rem;
}

.pkg-detail-links a {
	color: #1f8fc0;
	font-weight: 600;
	font-size: 0.85rem;
}

.wave-command {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	background: #1e1e1e;
	border-radius: 6px;
	padding: 0.45rem 0.75rem;
	overflow-x: auto;
}

.wave-command code {
	color: #d4d4d4;
	font-size: 0.82rem;
	white-space: nowrap;
	flex: 1;
}

.verify-after {
	margin-top: 0.7rem;
	font-size: 0.85rem;
	color: #6b6a6d;
}

.verify-after i {
	color: #27a9e0;
	margin-right: 0.35rem;
}

.general-advice {
	margin-top: 1.5rem;
}

.general-advice h3 {
	font-size: 1rem;
	margin-bottom: 0.5rem;
}

.general-advice ul {
	margin-left: 1.2rem;
	line-height: 1.7;
}

.already-current {
	margin-top: 1.25rem;
}

.current-toggle {
	background: none;
	border: none;
	cursor: pointer;
	font: inherit;
	font-size: 0.9rem;
	font-weight: 600;
	color: #6b6a6d;
	padding: 0;
}

.current-toggle i {
	margin-right: 0.4rem;
	font-size: 0.8rem;
}

.current-list {
	margin-top: 0.5rem;
	font-size: 0.85rem;
	color: #9b9aa0;
	font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
	line-height: 1.8;
}

.provenance-note {
	margin-top: 1.75rem;
	font-size: 0.82rem;
	color: #9b9aa0;
	line-height: 1.6;
	border-top: 1px solid rgba(0, 0, 0, 0.08);
	padding-top: 0.9rem;
}

@media (max-width: 640px) {
	.wave-timeline :deep(.p-timeline-event-content) {
		padding-right: 0;
	}
}

html.dark .wave-rationale,
html.dark .verify-after,
html.dark .current-toggle {
	color: var(--dm-text-2);
}

html.dark .note-provenance,
html.dark .current-list,
html.dark .provenance-note {
	color: var(--dm-text-3);
}

html.dark .pkg-chip {
	border-color: rgba(255, 255, 255, 0.18);
}

html.dark .pkg-chip:hover,
html.dark .pkg-chip.expanded {
	border-color: #27a9e0;
	background: rgba(39, 169, 224, 0.12);
}

html.dark .pkg-detail-links a {
	color: var(--dm-blue-soft);
}

html.dark .provenance-note {
	border-top-color: rgba(255, 255, 255, 0.12);
}
</style>
