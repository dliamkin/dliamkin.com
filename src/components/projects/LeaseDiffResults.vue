<script setup lang="ts">
import { computed, ref } from "vue";
import { FilterMatchMode } from "@primevue/core/api";
import Button from "primevue/button";
import Card from "primevue/card";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Message from "primevue/message";
import Select from "primevue/select";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";
import type { ChangeCategory, LeaseChange, LeaseComparison } from "@/lib/lease-diff";

const props = defineProps<{ result: LeaseComparison }>();

const toast = useToast();

interface ChangeRow extends LeaseChange {
	idx: number;
}

const severityRank = { high: 0, medium: 1, low: 2 } as const;

const rows = computed<ChangeRow[]>(() =>
	props.result.changes
		.map((change, idx) => ({ ...change, idx }))
		.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]),
);

const expandedRows = ref<Record<number, boolean>>({});

const filters = ref({
	category: { value: null as ChangeCategory | null, matchMode: FilterMatchMode.EQUALS },
});

const categoryOptions = computed(() =>
	[...new Set(props.result.changes.map((c) => c.category))].map((category) => ({
		label: categoryLabel(category),
		value: category,
	})),
);

const highCount = computed(() => props.result.changes.filter((c) => c.severity === "high").length);
const landlordCount = computed(
	() => props.result.changes.filter((c) => c.impact === "favors_landlord").length,
);
const tenantCount = computed(
	() => props.result.changes.filter((c) => c.impact === "favors_tenant").length,
);

function categoryLabel(category: ChangeCategory): string {
	return category.replaceAll("_", " ").replace("and", "&");
}

const impactLabel = (impact: LeaseChange["impact"]): string => {
	switch (impact) {
		case "favors_landlord":
			return "favors landlord";
		case "favors_tenant":
			return "favors tenant";
		default:
			return impact;
	}
};

const impactSeverity = (impact: LeaseChange["impact"]): string => {
	switch (impact) {
		case "favors_landlord":
			return "warn";
		case "favors_tenant":
			return "success";
		case "neutral":
			return "secondary";
		default:
			return "info";
	}
};

const severitySeverity = (severity: LeaseChange["severity"]): string => {
	switch (severity) {
		case "high":
			return "danger";
		case "medium":
			return "warn";
		default:
			return "secondary";
	}
};

async function copyQuestions() {
	const text = props.result.questions_to_ask.map((q) => `- ${q}`).join("\n");
	try {
		await navigator.clipboard.writeText(text);
		toast.add({
			severity: "success",
			summary: "Copied",
			detail: "Questions copied to clipboard.",
			life: 2500,
		});
	} catch {
		toast.add({
			severity: "error",
			summary: "Copy failed",
			detail: "Your browser blocked clipboard access.",
			life: 3500,
		});
	}
}
</script>

<template>
	<div class="comparison">
		<p class="disclaimer">
			Automated comparison for demonstration purposes - not legal advice. Consult a licensed
			attorney for real lease decisions.
		</p>

		<Card>
			<template #title>Summary</template>
			<template #content>
				<p class="summary-text">{{ result.overall_summary }}</p>
				<div class="stat-chips">
					<Tag :value="`${result.changes.length} changes found`" severity="info" />
					<Tag
						v-if="highCount > 0"
						:value="`${highCount} high severity`"
						severity="danger"
					/>
					<Tag
						v-if="landlordCount > 0"
						:value="`${landlordCount} favor landlord`"
						severity="warn"
					/>
					<Tag
						v-if="tenantCount > 0"
						:value="`${tenantCount} favor tenant`"
						severity="success"
					/>
				</div>
			</template>
		</Card>

		<Card>
			<template #title>Changes</template>
			<template #content>
				<div class="table-scroll">
					<DataTable
						v-model:expanded-rows="expandedRows"
						v-model:filters="filters"
						:value="rows"
						data-key="idx"
						size="small"
						filter-display="menu"
					>
						<Column expander style="width: 2.5rem" />
						<Column field="title" header="Change" />
						<Column field="category" header="Category" :show-filter-match-modes="false">
							<template #body="{ data }">
								<Tag :value="categoryLabel(data.category)" severity="secondary" />
							</template>
							<template #filter="{ filterModel }">
								<Select
									v-model="filterModel.value"
									:options="categoryOptions"
									option-label="label"
									option-value="value"
									placeholder="Any category"
									show-clear
								/>
							</template>
						</Column>
						<Column field="impact" header="Impact">
							<template #body="{ data }">
								<Tag
									:value="impactLabel(data.impact)"
									:severity="impactSeverity(data.impact)"
								/>
							</template>
						</Column>
						<Column field="severity" header="Severity">
							<template #body="{ data }">
								<Tag
									:value="data.severity"
									:severity="severitySeverity(data.severity)"
								/>
							</template>
						</Column>
						<template #expansion="{ data }">
							<div class="expansion">
								<div class="excerpts">
									<div class="excerpt">
										<h4>Original</h4>
										<blockquote v-if="data.original_excerpt !== null">
											{{ data.original_excerpt }}
										</blockquote>
										<p v-else class="not-present">- not present -</p>
									</div>
									<div class="excerpt">
										<h4>Revised</h4>
										<blockquote v-if="data.revised_excerpt !== null">
											{{ data.revised_excerpt }}
										</blockquote>
										<p v-else class="not-present">- not present -</p>
									</div>
								</div>
								<p class="explanation">{{ data.explanation }}</p>
								<p v-if="data.negotiation_note" class="negotiation-note">
									<i class="fa-regular fa-comment-dots" aria-hidden="true"></i>
									{{ data.negotiation_note }}
								</p>
							</div>
						</template>
					</DataTable>
				</div>
			</template>
		</Card>

		<Card v-if="result.questions_to_ask.length > 0" class="questions-card">
			<template #title>
				<div class="questions-header">
					<span>Questions to ask before signing</span>
					<Button
						label="Copy all questions"
						icon="fa-regular fa-copy"
						size="small"
						severity="secondary"
						outlined
						@click="copyQuestions"
					/>
				</div>
			</template>
			<template #content>
				<ul class="questions-list">
					<li v-for="question in result.questions_to_ask" :key="question">
						<i class="fa-regular fa-square" aria-hidden="true"></i>
						<span>{{ question }}</span>
					</li>
				</ul>
			</template>
		</Card>

		<Message v-if="result.ambiguities.length > 0" severity="info">
			<strong>The model declined to guess about:</strong>
			<ul class="info-list">
				<li v-for="ambiguity in result.ambiguities" :key="ambiguity">{{ ambiguity }}</li>
			</ul>
		</Message>

		<Message v-if="result.formatting_notes" severity="info">
			<strong>Formatting notes:</strong> {{ result.formatting_notes }}
		</Message>
	</div>
</template>

<style scoped>
.comparison {
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
}

.disclaimer {
	font-size: 0.85rem;
	font-weight: 600;
	color: #9b6a00;
}

.summary-text {
	line-height: 1.7;
	color: #414042;
	margin-bottom: 0.9rem;
}

.stat-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.table-scroll {
	overflow-x: auto;
}

.expansion {
	padding: 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.excerpts {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem;
}

.excerpt h4 {
	font-size: 0.75rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: #9b9aa0;
	margin-bottom: 0.35rem;
}

.excerpt blockquote {
	margin: 0;
	padding: 0.6rem 0.75rem;
	background: #f7f8f9;
	border-left: 3px solid rgba(39, 169, 224, 0.5);
	border-radius: 4px;
	font-size: 0.9rem;
	line-height: 1.6;
	color: #414042;
}

.not-present {
	color: #9b9aa0;
	font-style: italic;
	font-size: 0.9rem;
	padding: 0.6rem 0;
}

.explanation {
	line-height: 1.65;
	color: #414042;
}

.negotiation-note {
	line-height: 1.6;
	color: #6b6a6d;
	background: rgba(39, 169, 224, 0.07);
	padding: 0.6rem 0.75rem;
	border-radius: 6px;
	font-size: 0.9rem;
}

.negotiation-note i {
	color: #27a9e0;
	margin-right: 0.4rem;
}

.questions-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
}

.questions-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
}

.questions-list li {
	display: flex;
	gap: 0.6rem;
	line-height: 1.6;
	color: #414042;
}

.questions-list i {
	color: #27a9e0;
	margin-top: 0.3rem;
}

.info-list {
	margin: 0.35rem 0 0;
	padding-left: 1.25rem;
}

@media (max-width: 700px) {
	.excerpts {
		grid-template-columns: minmax(0, 1fr);
	}
}

html.dark .disclaimer {
	color: #e3b341;
}

html.dark .summary-text,
html.dark .explanation,
html.dark .questions-list li {
	color: var(--dm-text-2);
}

html.dark .excerpt h4,
html.dark .not-present {
	color: var(--dm-text-3);
}

html.dark .excerpt blockquote {
	background: var(--dm-bg-soft);
	color: var(--dm-text-2);
}

html.dark .negotiation-note {
	background: rgba(39, 169, 224, 0.1);
	color: var(--dm-text-2);
}
</style>
