<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";
import type { MeasuredFeatures } from "@/lib/audio-analysis/types";
import type { DescribeNoiseResponse, SoundCharacterization } from "@/lib/noise-translator";

// The battle card. House rule made visible: every measured number rendered
// here comes from the client's own features object - the model's text is
// displayed alongside but is never the source of a number.

const props = defineProps<{
	features: MeasuredFeatures;
	response: DescribeNoiseResponse;
	spectrogramUrl: string;
}>();

const emit = defineEmits<{ (e: "record-again"): void }>();

const toast = useToast();
const answers = ref<string[]>(props.response.description.likely_questions.map(() => ""));
const openHints = ref<Set<number>>(new Set());

function toggleHint(index: number) {
	const next = new Set(openHints.value);
	if (next.has(index)) next.delete(index);
	else next.add(index);
	openHints.value = next;
}

const confidenceSeverity = (confidence: SoundCharacterization["confidence"]): string => {
	switch (confidence) {
		case "high":
			return "success";
		case "medium":
			return "warn";
		default:
			return "secondary";
	}
};

const PATTERN_LABELS: Record<MeasuredFeatures["pattern"], string> = {
	continuous: "Continuous",
	intermittent: "Intermittent",
	single_event: "Single event",
};

const REGULARITY_LABELS: Record<NonNullable<MeasuredFeatures["regularity"]>, string> = {
	highly_regular: "Highly regular",
	somewhat_regular: "Somewhat regular",
	erratic: "Erratic",
};

const CHARACTER_LABELS: Record<MeasuredFeatures["spectral_character"], string> = {
	low: "Low (rumble range)",
	mid: "Mid",
	high: "High (whine range)",
	broadband: "Broadband",
};

const TREND_LABELS: Record<MeasuredFeatures["pitch_trend"], string> = {
	steady: "Steady",
	rising: "Rising",
	falling: "Falling",
	varying: "Varying",
};

const formatBand = (hz: number): string =>
	hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;

async function copySummary() {
	try {
		await navigator.clipboard.writeText(props.response.description.professional_summary);
		toast.add({
			severity: "success",
			summary: "Copied",
			detail: "Summary copied - paste it into a message or read it aloud.",
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

// The printable prep sheet - the artifact someone takes to the shop. Built as
// a self-contained document in a print window: no dependency, prints clean.
function downloadPrepSheet() {
	const description = props.response.description;
	const esc = (text: string): string =>
		text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const qa = description.likely_questions
		.map((q, i) => {
			const answer = answers.value[i]?.trim();
			return `<div class="qa"><p class="q">${esc(q.question)}</p><p class="a">${
				answer ? esc(answer) : "&nbsp;"
			}</p></div>`;
		})
		.join("");
	const measured = [
		`Pattern: ${PATTERN_LABELS[props.features.pattern]}`,
		props.features.event_rate_hz !== null
			? `Event rate: ${props.features.event_rate_hz.toFixed(1)} per second`
			: null,
		props.features.regularity !== null
			? `Regularity: ${REGULARITY_LABELS[props.features.regularity]}`
			: null,
		`Frequency character: ${CHARACTER_LABELS[props.features.spectral_character]}`,
		props.features.dominant_bands_hz.length > 0
			? `Dominant bands: ${props.features.dominant_bands_hz.map(formatBand).join(", ")}`
			: null,
		`Pitch trend: ${TREND_LABELS[props.features.pitch_trend]}`,
		`Clip length: ${props.features.duration_s.toFixed(1)} s`,
	]
		.filter((line): line is string => line !== null)
		.map((line) => `<li>${esc(line)}</li>`)
		.join("");

	const printWindow = window.open("", "_blank", "width=800,height=900");
	if (!printWindow) {
		toast.add({
			severity: "error",
			summary: "Pop-up blocked",
			detail: "Allow pop-ups for this site to print the prep sheet.",
			life: 5000,
		});
		return;
	}
	printWindow.document
		.write(`<!doctype html><html><head><title>Noise description - prep sheet</title>
<style>
	body { font-family: Georgia, serif; color: #222; max-width: 680px; margin: 2rem auto; line-height: 1.55; }
	h1 { font-size: 1.3rem; border-bottom: 2px solid #222; padding-bottom: 0.4rem; }
	h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 1.5rem; }
	blockquote { font-size: 1.05rem; border-left: 3px solid #888; margin: 0.75rem 0; padding: 0.25rem 0 0.25rem 1rem; }
	ul { padding-left: 1.2rem; }
	.qa { margin-bottom: 0.9rem; }
	.q { font-weight: bold; margin: 0 0 0.2rem; }
	.a { border-bottom: 1px dotted #999; min-height: 1.3rem; margin: 0; }
	img { max-width: 100%; border: 1px solid #ccc; margin-top: 0.5rem; }
	.disclaimer { margin-top: 1.5rem; font-size: 0.85rem; color: #555; border-top: 1px solid #ccc; padding-top: 0.6rem; }
	@media print { body { margin: 0.5rem auto; } }
</style></head><body>
<h1>Machine noise - description for a professional</h1>
<h2>What to say</h2>
<blockquote>${esc(description.professional_summary)}</blockquote>
<p>${esc(description.conditions_summary)}</p>
<h2>Measured from the recording</h2>
<ul>${measured}</ul>
<h2>Questions they may ask - my answers</h2>
${qa}
<h2>Spectrogram</h2>
<img src="${props.spectrogramUrl}" alt="Spectrogram of the recording" />
<p class="disclaimer">Generated by a description aid (dliamkin.com/projects/noise-translator). Not a diagnosis,
not a safety assessment, not repair advice - measurements are from browser-side signal analysis of a short clip.</p>
</body></html>`);
	printWindow.document.close();
	// Print from the opener (same-origin about:blank) once assets are in -
	// an inline <script> in the sheet would terminate this SFC's script block.
	printWindow.addEventListener("load", () => printWindow.print(), { once: true });
}
</script>

<template>
	<div class="noise-results">
		<figure class="spectrogram">
			<img :src="spectrogramUrl" alt="Spectrogram of the analyzed recording" />
			<figcaption>
				What you're looking at: time runs left to right, frequency bottom to top, brighter =
				louder. The model reads this image; the numbers below are measured in your browser.
			</figcaption>
		</figure>

		<Message
			v-if="response.description.recording_notes"
			severity="info"
			:closable="false"
			class="recording-notes"
		>
			<span>{{ response.description.recording_notes }}</span>
			<Button
				label="Record again"
				size="small"
				text
				icon="fa-solid fa-microphone"
				@click="emit('record-again')"
			/>
		</Message>

		<div class="characterizations">
			<Tag
				v-for="c in response.description.characterizations"
				:key="c.descriptor"
				v-tooltip.bottom="c.evidence"
				:value="c.descriptor"
				:severity="confidenceSeverity(c.confidence)"
			/>
			<span class="tag-hint">confidence: green high · amber medium - hover for evidence</span>
		</div>

		<div class="measured">
			<h3>Measured in your browser</h3>
			<dl>
				<div class="fact">
					<dt>Pattern</dt>
					<dd>{{ PATTERN_LABELS[features.pattern] }}</dd>
				</div>
				<div v-if="features.event_rate_hz !== null" class="fact">
					<dt>Event rate</dt>
					<dd>{{ features.event_rate_hz.toFixed(1) }} / second</dd>
				</div>
				<div v-if="features.regularity !== null" class="fact">
					<dt>Regularity</dt>
					<dd>{{ REGULARITY_LABELS[features.regularity] }}</dd>
				</div>
				<div class="fact">
					<dt>Frequency character</dt>
					<dd>{{ CHARACTER_LABELS[features.spectral_character] }}</dd>
				</div>
				<div v-if="features.dominant_bands_hz.length > 0" class="fact">
					<dt>Dominant bands</dt>
					<dd>{{ features.dominant_bands_hz.map(formatBand).join(", ") }}</dd>
				</div>
				<div class="fact">
					<dt>Pitch trend</dt>
					<dd>{{ TREND_LABELS[features.pitch_trend] }}</dd>
				</div>
				<div class="fact">
					<dt>Clip length</dt>
					<dd>{{ features.duration_s.toFixed(1) }} s</dd>
				</div>
			</dl>
		</div>

		<p class="conditions">{{ response.description.conditions_summary }}</p>

		<div class="summary-card">
			<h3>Read this to the professional</h3>
			<blockquote>{{ response.description.professional_summary }}</blockquote>
			<div class="summary-actions">
				<Button label="Copy" icon="fa-solid fa-copy" size="small" @click="copySummary" />
				<Button
					label="Download prep sheet"
					icon="fa-solid fa-print"
					size="small"
					severity="secondary"
					outlined
					@click="downloadPrepSheet"
				/>
			</div>
		</div>

		<div class="questions">
			<h3>Questions they'll likely ask - prepare your answers</h3>
			<div
				v-for="(q, index) in response.description.likely_questions"
				:key="q.question"
				class="question"
			>
				<div class="question-row">
					<i class="fa-regular fa-circle-question" aria-hidden="true"></i>
					<p>{{ q.question }}</p>
					<Button
						:aria-label="openHints.has(index) ? 'Hide hint' : 'How to find out'"
						:icon="
							openHints.has(index)
								? 'fa-solid fa-chevron-up'
								: 'fa-solid fa-lightbulb'
						"
						text
						size="small"
						@click="toggleHint(index)"
					/>
				</div>
				<p v-if="openHints.has(index)" class="hint-text">{{ q.how_to_find_out }}</p>
				<InputText
					v-model="answers[index]"
					class="answer-input"
					placeholder="Your answer (goes on the prep sheet)"
					:aria-label="`Your answer to: ${q.question}`"
				/>
			</div>
		</div>

		<p v-if="response.stripped.length > 0" class="stripped-note">
			<i class="fa-solid fa-filter" aria-hidden="true"></i>
			{{ response.stripped.length }}
			{{ response.stripped.length === 1 ? "sentence was" : "sentences were" }} removed by the
			deny-list because {{ response.stripped.length === 1 ? "it" : "they" }} drifted toward
			diagnosis - this demo describes, professionals conclude.
		</p>
	</div>
</template>

<style scoped>
.noise-results {
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
}

.spectrogram img {
	width: 100%;
	border-radius: 8px;
	border: 1px solid rgba(0, 0, 0, 0.12);
}

.spectrogram figcaption {
	font-size: 0.85rem;
	color: #6b6a6d;
	margin-top: 0.4rem;
}

.recording-notes :deep(.p-message-text) {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.characterizations {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.characterizations :deep(.p-tag) {
	font-size: 0.95rem;
	cursor: help;
}

.tag-hint {
	font-size: 0.78rem;
	color: #9b9aa0;
}

.measured h3,
.summary-card h3,
.questions h3 {
	font-size: 0.85rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	margin-bottom: 0.6rem;
	color: #6b6a6d;
}

.measured dl {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 0.75rem;
	margin: 0;
}

.fact {
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 8px;
	padding: 0.6rem 0.8rem;
}

.fact dt {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: #9b9aa0;
}

.fact dd {
	margin: 0.15rem 0 0;
	font-weight: 700;
	color: #414042;
}

.conditions {
	line-height: 1.6;
	color: #6b6a6d;
}

.summary-card {
	border: 1px solid rgba(39, 169, 224, 0.4);
	background: rgba(39, 169, 224, 0.05);
	border-radius: 10px;
	padding: 1rem 1.25rem;
}

.summary-card blockquote {
	margin: 0 0 0.75rem;
	font-size: 1.05rem;
	line-height: 1.7;
	border-left: 3px solid #27a9e0;
	padding-left: 1rem;
	font-style: italic;
}

.summary-actions {
	display: flex;
	gap: 0.5rem;
}

.question {
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 8px;
	padding: 0.75rem 0.9rem;
	margin-bottom: 0.75rem;
}

.question-row {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.question-row i {
	color: #27a9e0;
}

.question-row p {
	flex: 1;
	margin: 0;
	font-weight: 600;
}

.hint-text {
	font-size: 0.88rem;
	color: #6b6a6d;
	margin: 0.4rem 0 0 1.9rem;
}

.answer-input {
	width: 100%;
	margin-top: 0.6rem;
}

.stripped-note {
	font-size: 0.85rem;
	color: #9b9aa0;
}

.stripped-note i {
	margin-right: 0.35rem;
}

html.dark .spectrogram img {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .spectrogram figcaption,
html.dark .conditions,
html.dark .hint-text {
	color: var(--dm-text-2);
}

html.dark .measured h3,
html.dark .summary-card h3,
html.dark .questions h3 {
	color: var(--dm-text-3);
}

html.dark .fact,
html.dark .question {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .fact dd {
	color: var(--dm-text-1);
}

html.dark .summary-card {
	background: rgba(39, 169, 224, 0.08);
}
</style>
