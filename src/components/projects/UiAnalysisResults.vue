<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Card from "primevue/card";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Image from "primevue/image";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";
import type { ComponentMapping, UiAnalysis } from "@/lib/ui-analysis";

const props = defineProps<{ result: UiAnalysis; imageUrl: string }>();

const toast = useToast();

interface MappingRow extends ComponentMapping {
	idx: number;
}

const rows = computed<MappingRow[]>(() => props.result.mappings.map((m, idx) => ({ ...m, idx })));

const expandedRows = ref<Record<number, boolean>>({});

// Only plain component names ("DataTable") get a docs link - entries like
// "None (plain HTML)" stay as text.
const docsUrl = (component: string): string | null =>
	/^[A-Za-z]+$/.test(component) ? `https://primevue.org/${component.toLowerCase()}/` : null;

const confidenceSeverity = (confidence: ComponentMapping["confidence"]): string => {
	switch (confidence) {
		case "high":
			return "success";
		case "medium":
			return "warn";
		default:
			return "secondary";
	}
};

async function copyScaffold() {
	if (!props.result.scaffold_code) return;
	try {
		await navigator.clipboard.writeText(props.result.scaffold_code);
		toast.add({
			severity: "success",
			summary: "Copied",
			detail: "Scaffold code copied to clipboard.",
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
	<div class="analysis">
		<div class="analysis-grid">
			<Card class="image-card">
				<template #title>Analyzed screenshot</template>
				<template #content>
					<Image :src="imageUrl" alt="Analyzed screenshot" preview image-class="shot" />
				</template>
			</Card>

			<div class="mapping-side">
				<div class="summary">
					<Tag v-if="result.ui_type" :value="result.ui_type" severity="info" />
					<p v-if="result.layout_summary" class="layout-summary">
						{{ result.layout_summary }}
					</p>
				</div>

				<Card>
					<template #title>Component mapping</template>
					<template #content>
						<div class="table-scroll">
							<DataTable
								v-model:expanded-rows="expandedRows"
								:value="rows"
								data-key="idx"
								size="small"
							>
								<Column expander style="width: 2.5rem" />
								<Column field="detected_element" header="Detected element" />
								<Column field="primevue_component" header="PrimeVue">
									<template #body="{ data }">
										<a
											v-if="docsUrl(data.primevue_component)"
											:href="docsUrl(data.primevue_component)!"
											target="_blank"
											rel="noopener"
											class="component-link"
											>{{ data.primevue_component }}</a
										>
										<span v-else>{{ data.primevue_component }}</span>
									</template>
								</Column>
								<Column field="confidence" header="Confidence">
									<template #body="{ data }">
										<Tag
											:value="data.confidence"
											:severity="confidenceSeverity(data.confidence)"
										/>
									</template>
								</Column>
								<template #expansion="{ data }">
									<div class="expansion">
										<p>{{ data.rationale }}</p>
										<ul v-if="data.key_props.length > 0">
											<li v-for="prop in data.key_props" :key="prop">
												<code>{{ prop }}</code>
											</li>
										</ul>
									</div>
								</template>
							</DataTable>
						</div>
					</template>
				</Card>

				<Message v-if="result.gaps.length > 0" severity="info">
					<strong>No clean PrimeVue equivalent:</strong>
					<ul class="gaps-list">
						<li v-for="gap in result.gaps" :key="gap">{{ gap }}</li>
					</ul>
				</Message>
			</div>
		</div>

		<Card v-if="result.scaffold_code" class="scaffold-card">
			<template #title>
				<div class="scaffold-header">
					<span>Scaffold code</span>
					<Button
						label="Copy code"
						icon="fa-regular fa-copy"
						size="small"
						severity="secondary"
						outlined
						@click="copyScaffold"
					/>
				</div>
			</template>
			<template #content>
				<pre class="scaffold-code"><code>{{ result.scaffold_code }}</code></pre>
			</template>
		</Card>
	</div>
</template>

<style scoped>
.analysis {
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
}

.analysis-grid {
	display: grid;
	grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
	gap: 1.25rem;
	align-items: start;
}

.image-card :deep(.shot) {
	max-width: 100%;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 6px;
}

.mapping-side {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	min-width: 0;
}

.summary {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	align-items: flex-start;
}

.layout-summary {
	color: #6b6a6d;
	line-height: 1.6;
}

.table-scroll {
	overflow-x: auto;
}

.component-link {
	color: #27a9e0;
	font-weight: 600;
	text-decoration: none;
}

.component-link:hover {
	text-decoration: underline;
}

.expansion {
	padding: 0.5rem 0.75rem;
	color: #6b6a6d;
}

.expansion ul {
	margin: 0.5rem 0 0;
	padding-left: 1.25rem;
}

.expansion code {
	background: #f2f4f6;
	padding: 0.1rem 0.35rem;
	border-radius: 4px;
	font-size: 0.85em;
}

.gaps-list {
	margin: 0.35rem 0 0;
	padding-left: 1.25rem;
}

.scaffold-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}

.scaffold-code {
	background: #1e1e1e;
	color: #d4d4d4;
	padding: 1rem;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 0.85rem;
	line-height: 1.55;
	max-height: 480px;
	overflow-y: auto;
}

@media (max-width: 900px) {
	.analysis-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}

html.dark .layout-summary,
html.dark .expansion {
	color: var(--dm-text-2);
}

html.dark .image-card :deep(.shot) {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .expansion code {
	background: var(--dm-bg-mute);
}
</style>
