<script setup lang="ts">
import Card from "primevue/card";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { Medication, StructuredNote } from "@/lib/structured-note";

const props = defineProps<{ result: StructuredNote }>();

const VITALS_LABELS: Record<keyof StructuredNote["vitals"], string> = {
	blood_pressure: "Blood pressure",
	heart_rate: "Heart rate",
	temperature: "Temperature",
	respiratory_rate: "Respiratory rate",
	oxygen_saturation: "SpO₂",
	weight: "Weight",
};

const vitalsEntries = () =>
	(Object.keys(VITALS_LABELS) as (keyof StructuredNote["vitals"])[]).map((key) => ({
		key,
		label: VITALS_LABELS[key],
		value: props.result.vitals[key] ?? "-",
	}));

const statusSeverity = (status: Medication["status"]): string => {
	switch (status) {
		case "active":
			return "success";
		case "new":
			return "info";
		case "discontinued":
			return "danger";
		default:
			return "secondary";
	}
};
</script>

<template>
	<div class="results">
		<Message v-if="result.red_flags.length > 0" severity="error">
			<strong>Red flags documented in the note:</strong>
			<ul class="flag-list">
				<li v-for="flag in result.red_flags" :key="flag">{{ flag }}</li>
			</ul>
		</Message>

		<Card>
			<template #title>Chief Complaint</template>
			<template #content>
				<p class="lead">{{ result.chief_complaint ?? "Not documented" }}</p>
				<p v-if="result.history_of_present_illness" class="hpi">
					{{ result.history_of_present_illness }}
				</p>
			</template>
		</Card>

		<Card>
			<template #title>Medications</template>
			<template #content>
				<div v-if="result.medications.length > 0" class="table-scroll">
					<DataTable :value="result.medications" size="small">
						<Column field="name" header="Name" />
						<Column field="dose" header="Dose">
							<template #body="{ data }">{{ data.dose ?? "-" }}</template>
						</Column>
						<Column field="route" header="Route">
							<template #body="{ data }">{{ data.route ?? "-" }}</template>
						</Column>
						<Column field="frequency" header="Frequency">
							<template #body="{ data }">{{ data.frequency ?? "-" }}</template>
						</Column>
						<Column field="status" header="Status">
							<template #body="{ data }">
								<Tag :value="data.status" :severity="statusSeverity(data.status)" />
							</template>
						</Column>
					</DataTable>
				</div>
				<p v-else class="empty">None documented</p>
			</template>
		</Card>

		<Card>
			<template #title>Allergies</template>
			<template #content>
				<div v-if="result.allergies.length > 0" class="tag-row">
					<Tag
						v-for="allergy in result.allergies"
						:key="allergy"
						:value="allergy"
						severity="danger"
					/>
				</div>
				<p v-else class="empty">None documented</p>
			</template>
		</Card>

		<Card>
			<template #title>Vitals</template>
			<template #content>
				<dl class="vitals">
					<div v-for="entry in vitalsEntries()" :key="entry.key" class="vital">
						<dt>{{ entry.label }}</dt>
						<dd>{{ entry.value }}</dd>
					</div>
				</dl>
			</template>
		</Card>

		<Card>
			<template #title>Assessment</template>
			<template #content>
				<ol v-if="result.assessment.length > 0" class="numbered-list">
					<li v-for="item in result.assessment" :key="item">{{ item }}</li>
				</ol>
				<p v-else class="empty">None documented</p>
			</template>
		</Card>

		<Card>
			<template #title>Plan</template>
			<template #content>
				<ul v-if="result.plan.length > 0" class="plain-list">
					<li v-for="item in result.plan" :key="item">{{ item }}</li>
				</ul>
				<p v-else class="empty">None documented</p>
			</template>
		</Card>

		<Card>
			<template #title>Follow-ups</template>
			<template #content>
				<ul v-if="result.follow_ups.length > 0" class="followups">
					<li v-for="item in result.follow_ups" :key="item.action">
						<i class="fa-regular fa-square-check" aria-hidden="true"></i>
						<span>
							{{ item.action }}
							<em v-if="item.timeframe"> - {{ item.timeframe }}</em>
						</span>
					</li>
				</ul>
				<p v-else class="empty">None documented</p>
			</template>
		</Card>

		<Message v-if="result.extraction_notes.length > 0" severity="secondary">
			<strong>Extraction notes</strong>
			<ul class="flag-list">
				<li v-for="note in result.extraction_notes" :key="note">{{ note }}</li>
			</ul>
		</Message>
	</div>
</template>

<style scoped>
.results {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.lead {
	font-size: 1.1rem;
	font-weight: 600;
}

.hpi {
	margin-top: 0.5rem;
	color: #6b6a6d;
}

.empty {
	color: #9b9aa0;
	font-style: italic;
}

.table-scroll {
	overflow-x: auto;
}

.tag-row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.vitals {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 0.75rem;
	margin: 0;
}

.vital dt {
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: #9b9aa0;
}

.vital dd {
	margin: 0.15rem 0 0;
	font-weight: 600;
}

.numbered-list,
.plain-list {
	margin: 0;
	padding-left: 1.25rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.followups {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.followups li {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
}

.followups i {
	color: #27a9e0;
}

.flag-list {
	margin: 0.35rem 0 0;
	padding-left: 1.25rem;
}

html.dark .hpi {
	color: var(--dm-text-2);
}

html.dark .empty,
html.dark .vital dt {
	color: var(--dm-text-3);
}
</style>
