<script setup lang="ts">
// The policy knobs. Every change emits a full new Policy and re-simulates
// (debounced upstream). "Pin as baseline" freezes the current distribution
// as a ghost overlay - the before/after comparison IS the product.
import { computed } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Slider from "primevue/slider";
import ToggleSwitch from "primevue/toggleswitch";
import {
	MODEL_LABELS,
	RETRY_CAP_UNCAPPED,
	type ModelKey,
	type Policy,
	type TrialCount,
} from "@/lib/tail-risk/types";

const props = defineProps<{
	policy: Policy;
	targetModel: ModelKey;
	baselinePinned: boolean;
}>();

const emit = defineEmits<{
	"update:policy": [policy: Policy];
	"update:targetModel": [model: ModelKey];
	pin: [];
	clearPin: [];
}>();

function patch(partial: Partial<Policy>): void {
	emit("update:policy", { ...props.policy, ...partial });
}

const retryCap = computed({
	get: () => props.policy.retryCap,
	set: (v: number | number[]) => patch({ retryCap: Array.isArray(v) ? (v[0] ?? 1) : v }),
});

const retryCapLabel = computed(() =>
	props.policy.retryCap >= RETRY_CAP_UNCAPPED ? "uncapped" : `${props.policy.retryCap}`,
);

const capEnabled = computed({
	get: () => props.policy.outputTokenCapK !== null,
	set: (on: boolean) => patch({ outputTokenCapK: on ? 8 : null }),
});

const capValue = computed({
	get: () => props.policy.outputTokenCapK ?? 8,
	set: (v: number | null) => patch({ outputTokenCapK: Math.max(1, v ?? 8) }),
});

const modelOptions = (Object.keys(MODEL_LABELS) as ModelKey[]).map((key) => ({
	key,
	label: MODEL_LABELS[key],
}));

const model = computed({
	get: () => props.targetModel,
	set: (v: ModelKey) => emit("update:targetModel", v),
});

const trialOptions: { label: string; value: TrialCount }[] = [
	{ label: "1K", value: 1000 },
	{ label: "5K", value: 5000 },
	{ label: "20K", value: 20000 },
];

const trials = computed({
	get: () => props.policy.trials,
	set: (v: TrialCount | null) => {
		if (v !== null) patch({ trials: v });
	},
});

const seed = computed({
	get: () => props.policy.seed,
	set: (v: number | null) => patch({ seed: Math.abs(Math.round(v ?? 0)) }),
});

function randomizeSeed(): void {
	// Math.random is fine here: this generates a *new* seed on request; the
	// simulation itself stays deterministic for whatever seed lands.
	patch({ seed: Math.floor(Math.random() * 2 ** 31) });
}
</script>

<template>
	<div class="policy-panel">
		<div class="knob knob-retry">
			<label for="tail-risk-retry-cap">
				Retry cap <span class="knob-value">{{ retryCapLabel }}</span>
			</label>
			<Slider
				id="tail-risk-retry-cap"
				v-model="retryCap"
				:min="1"
				:max="RETRY_CAP_UNCAPPED"
				:step="1"
				class="retry-slider"
			/>
		</div>

		<div class="knob">
			<label for="tail-risk-output-cap">Output cap / step</label>
			<div class="knob-inline">
				<ToggleSwitch v-model="capEnabled" aria-label="Toggle output token cap" />
				<InputNumber
					v-if="capEnabled"
					id="tail-risk-output-cap"
					v-model="capValue"
					:min="1"
					:max="500"
					suffix="K"
					size="small"
					:input-style="{ width: '4.5rem' }"
				/>
				<span v-else class="knob-off">off</span>
			</div>
		</div>

		<div class="knob">
			<label for="tail-risk-model">Target model</label>
			<Select
				id="tail-risk-model"
				v-model="model"
				:options="modelOptions"
				option-label="label"
				option-value="key"
				size="small"
			/>
		</div>

		<div class="knob">
			<label>Trials</label>
			<SelectButton
				v-model="trials"
				:options="trialOptions"
				option-label="label"
				option-value="value"
				:allow-empty="false"
				size="small"
			/>
		</div>

		<div class="knob">
			<label for="tail-risk-seed">Seed</label>
			<div class="knob-inline">
				<InputNumber
					id="tail-risk-seed"
					v-model="seed"
					:min="0"
					:use-grouping="false"
					size="small"
					:input-style="{ width: '6rem' }"
				/>
				<Button
					icon="fa-solid fa-dice"
					severity="secondary"
					text
					size="small"
					aria-label="Randomize seed"
					@click="randomizeSeed"
				/>
			</div>
		</div>

		<div class="knob knob-pin">
			<label>Baseline</label>
			<div class="knob-inline">
				<Button
					:label="baselinePinned ? 'Re-pin' : 'Pin as baseline'"
					icon="fa-solid fa-thumbtack"
					severity="secondary"
					outlined
					size="small"
					@click="emit('pin')"
				/>
				<Button
					v-if="baselinePinned"
					icon="fa-solid fa-xmark"
					severity="secondary"
					text
					size="small"
					aria-label="Clear baseline"
					@click="emit('clearPin')"
				/>
			</div>
		</div>
	</div>
</template>

<style scoped>
.policy-panel {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 1rem 1.5rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 10px;
	background: #fff;
	padding: 0.9rem 1.1rem;
}

.knob {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	min-width: 0;
}

.knob > label {
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: #6b6a6d;
}

.knob-value {
	color: #27a9e0;
	text-transform: none;
	letter-spacing: normal;
	font-variant-numeric: tabular-nums;
}

.knob-inline {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	min-height: 2rem;
}

.knob-off {
	font-size: 0.85rem;
	color: #6b6a6d;
}

.retry-slider {
	width: 150px;
	margin-bottom: 0.55rem;
}

.knob-pin {
	margin-left: auto;
}

@media (max-width: 680px) {
	.knob-pin {
		margin-left: 0;
	}
}

html.dark .policy-panel {
	background: var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark .knob > label,
html.dark .knob-off {
	color: var(--dm-text-3);
}

html.dark .knob-value {
	color: var(--dm-blue-soft);
}
</style>
