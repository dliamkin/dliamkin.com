<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import ProgressBar from "primevue/progressbar";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Textarea from "primevue/textarea";
import {
	MAX_FREEFORM_CHARS,
	MAX_ITERATIONS_GUESS,
	MAX_ORACLE_NOTES_CHARS,
	MAX_ORACLE_STEPS,
	MAX_ORACLE_TITLE_CHARS,
	MAX_STEP_CHARS,
	TARGET_MODEL_LABELS,
	type AgentPlan,
	type PlanStep,
	type SimulateRequest,
	type TargetModel,
} from "@/lib/dry-run-oracle";

// The plan editor owns the draft plan state (one-way data flow - the parent
// never mutates it directly). The parent drives it through the exposed
// methods below (setPlan / applyFix / getPlan / setMode) and listens to
// `change` to mark a rendered report stale.

const props = defineProps<{ loading: boolean; statusText: string }>();
const emit = defineEmits<{ submit: [request: SimulateRequest]; change: [] }>();

type InputMode = "structured" | "freeform";
const mode = ref<InputMode>("structured");
const MODE_OPTIONS: { label: string; value: InputMode }[] = [
	{ label: "Structured", value: "structured" },
	{ label: "Paste freeform", value: "freeform" },
];

function blankStep(): PlanStep {
	return { id: crypto.randomUUID(), description: "" };
}

const plan = reactive<AgentPlan>({
	title: "",
	targetModel: "claude-opus",
	steps: [blankStep()],
	contextNotes: "",
});

const freeformText = ref("");

let suppressChange = false;
watch([plan, freeformText], () => {
	if (!suppressChange) emit("change");
});

const MODEL_OPTIONS = (Object.entries(TARGET_MODEL_LABELS) as [TargetModel, string][]).map(
	([value, label]) => ({ value, label }),
);

const TOOL_PRESETS = [
	"web_search",
	"file_read",
	"file_write",
	"bash",
	"grep",
	"code_execution",
	"git",
	"browser",
	"sql",
].map((tool) => ({ label: tool, value: tool }));

function addStep(): void {
	if (plan.steps.length >= MAX_ORACLE_STEPS) return;
	plan.steps.push(blankStep());
}

function removeStep(index: number): void {
	plan.steps.splice(index, 1);
}

function moveStep(index: number, delta: -1 | 1): void {
	const target = index + delta;
	if (target < 0 || target >= plan.steps.length) return;
	const [step] = plan.steps.splice(index, 1);
	if (step) plan.steps.splice(target, 0, step);
}

const canSubmit = computed(() => {
	if (props.loading) return false;
	if (plan.title.trim() === "") return false;
	if (mode.value === "freeform") {
		const length = freeformText.value.trim().length;
		return length > 0 && length <= MAX_FREEFORM_CHARS;
	}
	return (
		plan.steps.length > 0 &&
		plan.steps.every(
			(step) => step.description.trim() !== "" && step.description.length <= MAX_STEP_CHARS,
		)
	);
});

function cleanSteps(): PlanStep[] {
	return plan.steps.map((step) => {
		const out: PlanStep = { id: step.id, description: step.description.trim() };
		if (step.tools && step.tools.length > 0) out.tools = [...step.tools];
		if (step.expectedIterations !== undefined) out.expectedIterations = step.expectedIterations;
		return out;
	});
}

function submit(): void {
	if (!canSubmit.value) return;
	const request: SimulateRequest = {
		title: plan.title.trim(),
		targetModel: plan.targetModel,
	};
	const notes = plan.contextNotes?.trim();
	if (notes) request.contextNotes = notes;
	if (mode.value === "freeform") {
		request.freeform = freeformText.value.trim();
	} else {
		request.steps = cleanSteps();
	}
	emit("submit", request);
}

defineExpose({
	setMode(value: InputMode) {
		mode.value = value;
	},
	// Replace the draft without firing `change` (used for restore/prefill).
	setPlan(next: AgentPlan) {
		suppressChange = true;
		plan.title = next.title;
		plan.targetModel = next.targetModel;
		plan.contextNotes = next.contextNotes ?? "";
		plan.steps.splice(
			0,
			plan.steps.length,
			...next.steps.map((step) => ({
				...step,
				tools: step.tools ? [...step.tools] : undefined,
			})),
		);
		if (plan.steps.length === 0) plan.steps.push(blankStep());
		queueMicrotask(() => {
			suppressChange = false;
		});
	},
	// Snapshot of the current draft with empty fields stripped.
	getPlan(): AgentPlan {
		const snapshot: AgentPlan = {
			title: plan.title.trim(),
			targetModel: plan.targetModel,
			steps: cleanSteps(),
		};
		const notes = plan.contextNotes?.trim();
		if (notes) snapshot.contextNotes = notes;
		return snapshot;
	},
	// Append a suggested fix to a step's description; fires `change` so the
	// parent's stale flag flips through the normal path.
	applyFix(stepId: string, fix: string): boolean {
		const step = plan.steps.find((s) => s.id === stepId);
		if (!step || !fix) return false;
		step.description = `${step.description.replace(/\s+$/, "")} - constraint: ${fix}`;
		return true;
	},
});
</script>

<template>
	<section class="plan-input" aria-label="Plan input">
		<div class="plan-input__row">
			<div class="plan-input__field plan-input__field--grow">
				<label for="oracle-title">Plan title</label>
				<InputText
					id="oracle-title"
					v-model="plan.title"
					:maxlength="MAX_ORACLE_TITLE_CHARS"
					placeholder="e.g. Refactor auth module across 40 files"
				/>
			</div>
			<div class="plan-input__field">
				<label for="oracle-model">Target model</label>
				<Select
					id="oracle-model"
					v-model="plan.targetModel"
					:options="MODEL_OPTIONS"
					option-label="label"
					option-value="value"
				/>
			</div>
		</div>

		<SelectButton
			v-model="mode"
			:options="MODE_OPTIONS"
			option-label="label"
			option-value="value"
			:allow-empty="false"
			aria-label="Input mode"
		/>

		<div v-if="mode === 'structured'" class="plan-input__steps">
			<div v-for="(step, i) in plan.steps" :key="step.id" class="plan-step">
				<div class="plan-step__order">
					<span class="plan-step__number">{{ i + 1 }}</span>
					<Button
						icon="fa-solid fa-chevron-up"
						text
						rounded
						size="small"
						severity="secondary"
						:disabled="i === 0"
						aria-label="Move step up"
						@click="moveStep(i, -1)"
					/>
					<Button
						icon="fa-solid fa-chevron-down"
						text
						rounded
						size="small"
						severity="secondary"
						:disabled="i === plan.steps.length - 1"
						aria-label="Move step down"
						@click="moveStep(i, 1)"
					/>
				</div>
				<div class="plan-step__fields">
					<Textarea
						v-model="step.description"
						auto-resize
						rows="2"
						:maxlength="MAX_STEP_CHARS"
						placeholder="What will the agent do in this step?"
						:aria-label="`Step ${i + 1} description`"
					/>
					<div class="plan-step__meta">
						<MultiSelect
							v-model="step.tools"
							:options="TOOL_PRESETS"
							option-label="label"
							option-value="value"
							placeholder="Tools"
							display="chip"
							:show-toggle-all="false"
							class="plan-step__tools"
						/>
						<InputNumber
							v-model="step.expectedIterations"
							:min="1"
							:max="MAX_ITERATIONS_GUESS"
							show-buttons
							placeholder="Iterations"
							input-class="plan-step__iters"
							:aria-label="`Expected iterations for step ${i + 1}`"
						/>
						<Button
							icon="fa-solid fa-trash-can"
							text
							rounded
							severity="danger"
							aria-label="Remove step"
							:disabled="plan.steps.length === 1"
							@click="removeStep(i)"
						/>
					</div>
				</div>
			</div>
			<Button
				label="Add step"
				icon="fa-solid fa-plus"
				text
				:disabled="plan.steps.length >= MAX_ORACLE_STEPS"
				@click="addStep"
			/>
		</div>

		<div v-else class="plan-input__field">
			<label for="oracle-freeform"
				>Paste your messy plan - the oracle will structure it</label
			>
			<Textarea
				id="oracle-freeform"
				v-model="freeformText"
				rows="8"
				auto-resize
				:maxlength="MAX_FREEFORM_CHARS"
				placeholder="Paste a plan, a ticket, a Slack message… the oracle infers the steps."
			/>
		</div>

		<div class="plan-input__field">
			<label for="oracle-notes"
				>Context notes <span class="plan-input__optional">(optional)</span></label
			>
			<Textarea
				id="oracle-notes"
				v-model="plan.contextNotes"
				rows="2"
				auto-resize
				:maxlength="MAX_ORACLE_NOTES_CHARS"
				placeholder="Codebase size, data volume, constraints…"
			/>
		</div>

		<div class="plan-input__submit">
			<Button
				label="Run Dry-Run"
				icon="fa-solid fa-cloud-arrow-down"
				:disabled="!canSubmit"
				:loading="props.loading"
				@click="submit"
			/>
			<div v-if="props.loading" class="plan-input__progress" role="status">
				<ProgressBar mode="indeterminate" style="height: 5px" />
				<span class="plan-input__status">{{ props.statusText }}</span>
			</div>
		</div>
	</section>
</template>

<style scoped>
.plan-input {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 14px;
	padding: 1.3rem 1.4rem;
}

.plan-input__row {
	display: flex;
	gap: 1rem;
	flex-wrap: wrap;
}

.plan-input__field {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	min-width: 0;
}

.plan-input__field--grow {
	flex: 1 1 260px;
}

.plan-input__field label {
	font-size: 0.8rem;
	font-weight: 700;
	color: #414042;
}

.plan-input__optional {
	font-weight: 400;
	color: #9b9aa0;
}

.plan-input__steps {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.plan-step {
	display: flex;
	gap: 0.7rem;
	align-items: flex-start;
}

.plan-step__order {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.1rem;
	padding-top: 0.2rem;
}

.plan-step__number {
	font-size: 0.8rem;
	font-weight: 700;
	color: #6b6a6d;
	width: 1.6rem;
	height: 1.6rem;
	display: grid;
	place-items: center;
	border-radius: 50%;
	background: rgba(39, 169, 224, 0.1);
}

.plan-step__fields {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	min-width: 0;
}

.plan-step__fields :deep(textarea) {
	width: 100%;
}

.plan-step__meta {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
	align-items: center;
}

.plan-step__tools {
	flex: 1 1 180px;
	max-width: 100%;
}

:deep(.plan-step__iters) {
	width: 6.5rem;
}

.plan-input__submit {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	align-items: flex-start;
}

.plan-input__progress {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.plan-input__status {
	font-size: 0.85rem;
	color: #1f8fc0;
	font-style: italic;
}

@media (max-width: 480px) {
	.plan-input {
		padding: 1rem;
	}

	.plan-step {
		flex-direction: column;
	}

	.plan-step__order {
		flex-direction: row;
	}
}

html.dark .plan-input {
	background: var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark .plan-input__field label {
	color: var(--dm-text-1);
}

html.dark .plan-input__optional {
	color: var(--dm-text-3);
}

html.dark .plan-step__number {
	color: var(--dm-text-2);
	background: rgba(102, 198, 239, 0.12);
}

html.dark .plan-input__status {
	color: var(--dm-blue-soft);
}
</style>
