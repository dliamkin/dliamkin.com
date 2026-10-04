<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import FileUpload, { type FileUploadSelectEvent } from "primevue/fileupload";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import Toast from "primevue/toast";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import NoiseResults from "@/components/projects/NoiseResults.vue";
import NoiseSkeleton from "@/components/projects/NoiseSkeleton.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import { NOISE_SAMPLES } from "@/data/noise-samples";
import { NOISE_SAMPLE_AUDIO, NOISE_SAMPLE_SPECTROGRAMS } from "@/data/noise-sample-assets";
import rawSampleResults from "@/data/noise-sample-results.json";
import { measureFeatures } from "@/lib/audio-analysis/features";
import { MAX_CAPTURE_SECONDS, preprocessAudio } from "@/lib/audio-analysis/preprocess";
import {
	computeSpectrogram,
	drawSpectrogram,
	SPECTROGRAM_HEIGHT,
	SPECTROGRAM_WIDTH,
} from "@/lib/audio-analysis/spectrogram";
import type { MeasuredFeatures, QualityIssue, RecordingQuality } from "@/lib/audio-analysis/types";
import {
	AudioCaptureError,
	decodeAudioBlob,
	startRecording,
	type RecordingHandle,
} from "@/lib/audio-capture";
import {
	evaluateSafetyGate,
	MACHINE_TYPE_LABELS,
	MAX_CONTEXT_FIELD_CHARS,
	MAX_IMAGE_BYTES,
	type DescribeNoiseResponse,
	type NoiseContext,
} from "@/lib/noise-translator";

// One Sonnet vision call over a small fixed-size image - 90s is generous
// headroom for cold starts.
const REQUEST_TIMEOUT_MS = 90_000;

interface SampleEntry {
	features: MeasuredFeatures;
	response: DescribeNoiseResponse;
}
const SAMPLE_RESULTS = rawSampleResults as unknown as Record<string, SampleEntry>;

// ---------------------------------------------------------------------------
// Capture + client-side analysis state

type RecordingState = "idle" | "recording";
const recordingState = ref<RecordingState>("idle");
const level = ref(0);
const elapsedS = ref(0);
let handle: RecordingHandle | null = null;
let meterFrame = 0;

interface AnalyzedClip {
	features: MeasuredFeatures;
	quality: RecordingQuality;
	/** data: URL for on-page preview and the prep sheet. */
	spectrogramDataUrl: string;
	/** Raw base64 (no prefix) - the network payload. */
	spectrogramBase64: string;
	/** Object URL of the original clip, for playback review. */
	audioUrl: string;
}

const analyzed = ref<AnalyzedClip | null>(null);
const analyzing = ref(false);
const clipError = ref("");
const waveformCanvas = ref<HTMLCanvasElement | null>(null);

const activeTab = ref("record");

const blockingIssues = computed<QualityIssue[]>(
	() =>
		analyzed.value?.quality.issues.filter((i) => i === "near_silent" || i === "too_short") ??
		[],
);
const isClipped = computed(() => analyzed.value?.quality.issues.includes("clipped") ?? false);

const QUALITY_TIPS: Record<QualityIssue, string> = {
	too_short: "Capture 3–10 seconds with 2–3 repetitions of the sound.",
	near_silent: "Move the phone closer to the machine and hold it steady.",
	clipped:
		"The recording is distorted from being too loud - move back a little or lower input volume.",
};

async function startCapture() {
	clipError.value = "";
	try {
		handle = await startRecording();
	} catch (error) {
		clipError.value =
			error instanceof AudioCaptureError ? error.message : "Couldn't start recording.";
		return;
	}
	recordingState.value = "recording";
	const meter = () => {
		if (!handle || recordingState.value !== "recording") return;
		level.value = handle.level();
		elapsedS.value = handle.elapsedS();
		meterFrame = requestAnimationFrame(meter);
	};
	meterFrame = requestAnimationFrame(meter);
	void handle.done
		.then((blob) => {
			recordingState.value = "idle";
			cancelAnimationFrame(meterFrame);
			level.value = 0;
			void analyzeClip(blob);
		})
		.catch(() => {
			recordingState.value = "idle";
			cancelAnimationFrame(meterFrame);
			clipError.value = "Recording failed. Please try again.";
		});
}

function stopCapture() {
	handle?.stop();
}

function onFileSelect(event: FileUploadSelectEvent) {
	const file = Array.isArray(event.files) ? event.files[0] : event.files;
	if (file instanceof File) void analyzeClip(file);
}

/** The whole client pipeline: decode → preprocess → measure → render. Raw audio goes no further. */
async function analyzeClip(blob: Blob) {
	analyzing.value = true;
	clipError.value = "";
	discardResult();
	try {
		const decoded = await decodeAudioBlob(blob);
		const pre = preprocessAudio(decoded.channels, decoded.sampleRate);
		const { features, quality } = measureFeatures(
			pre.pcm,
			pre.sampleRate,
			pre.clippingRatio,
			pre.peakDb,
		);
		const spec = computeSpectrogram(pre.pcm, pre.sampleRate);
		const canvas = document.createElement("canvas");
		canvas.width = SPECTROGRAM_WIDTH;
		canvas.height = SPECTROGRAM_HEIGHT;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D unavailable");
		drawSpectrogram(ctx, spec);
		const spectrogramDataUrl = canvas.toDataURL("image/png");
		const spectrogramBase64 = spectrogramDataUrl.split(",")[1] ?? "";
		if (Math.floor((spectrogramBase64.length * 3) / 4) > MAX_IMAGE_BYTES) {
			throw new Error("Spectrogram unexpectedly large");
		}
		if (analyzed.value) URL.revokeObjectURL(analyzed.value.audioUrl);
		analyzed.value = {
			features,
			quality,
			spectrogramDataUrl,
			spectrogramBase64,
			audioUrl: URL.createObjectURL(blob),
		};
		requestAnimationFrame(() => drawWaveform(pre.pcm));
	} catch (error) {
		analyzed.value = null;
		clipError.value =
			error instanceof AudioCaptureError
				? error.message
				: "Couldn't analyze that clip. Please try a different recording.";
	} finally {
		analyzing.value = false;
	}
}

/** Min/max waveform for playback review. */
function drawWaveform(pcm: Float32Array) {
	const canvas = waveformCanvas.value;
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const { width, height } = canvas;
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = "#27a9e0";
	const samplesPerColumn = Math.max(1, Math.floor(pcm.length / width));
	for (let x = 0; x < width; x++) {
		let min = 1;
		let max = -1;
		for (let i = x * samplesPerColumn; i < (x + 1) * samplesPerColumn && i < pcm.length; i++) {
			const v = pcm[i] ?? 0;
			if (v < min) min = v;
			if (v > max) max = v;
		}
		const y0 = ((1 - max) / 2) * height;
		const y1 = ((1 - min) / 2) * height;
		ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
	}
}

function discardClip() {
	if (analyzed.value) URL.revokeObjectURL(analyzed.value.audioUrl);
	analyzed.value = null;
	clipError.value = "";
	discardResult();
}

// ---------------------------------------------------------------------------
// Context form + safety gate

const context = reactive<NoiseContext>({
	machine_type: "car",
	machine_type_other: "",
	when_it_happens: "intermittent",
	changes_with_speed: "unsure",
	how_long: "",
	recent_changes: "",
	safety_screen: "no",
	safety_screen_detail: "",
});

const MACHINE_OPTIONS = Object.entries(MACHINE_TYPE_LABELS).map(([value, label]) => ({
	value,
	label,
}));
const WHEN_OPTIONS = [
	{ value: "startup_only", label: "Only at startup" },
	{ value: "constant", label: "Constant" },
	{ value: "intermittent", label: "Comes and goes" },
	{ value: "under_load", label: "Only under load / at speed" },
];
const SPEED_OPTIONS = [
	{ value: "tracks_speed", label: "Yes - tracks speed" },
	{ value: "constant", label: "No - stays constant" },
	{ value: "unsure", label: "Not sure" },
];
const YES_NO = [
	{ value: "no", label: "No" },
	{ value: "yes", label: "Yes" },
];

const safetyBlock = ref<string[] | null>(null);

// ---------------------------------------------------------------------------
// Submission

const status = ref<"idle" | "loading" | "done" | "error">("idle");
const errorMessage = ref("");
const result = ref<DescribeNoiseResponse | null>(null);
const resultFeatures = ref<MeasuredFeatures | null>(null);
const resultSpectrogram = ref("");
const resultSource = ref<"sample" | "live" | null>(null);

const busy = computed(() => analyzing.value || status.value === "loading");
const canSubmit = computed(
	() => analyzed.value !== null && blockingIssues.value.length === 0 && !busy.value,
);

function discardResult() {
	result.value = null;
	resultFeatures.value = null;
	resultSource.value = null;
	safetyBlock.value = null;
	if (status.value === "done" || status.value === "error") status.value = "idle";
}

async function submit() {
	if (!canSubmit.value || !analyzed.value) return;

	// The deterministic safety gate - code, not model behavior. A hit means
	// no analysis and no network request at all.
	const gate = evaluateSafetyGate(context);
	if (gate.blocked) {
		safetyBlock.value = gate.reasons;
		status.value = "idle";
		result.value = null;
		return;
	}
	safetyBlock.value = null;

	status.value = "loading";
	errorMessage.value = "";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch("/api/describe-noise", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				spectrogramPngBase64: analyzed.value.spectrogramBase64,
				features: analyzed.value.features,
				context,
			}),
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
			errorMessage.value =
				serverError ??
				(response.status === 429
					? "Too many requests right now - please wait a minute and try again."
					: "Something went wrong describing the sound. Please try again.");
			status.value = "error";
			return;
		}

		if (payload === null || typeof payload !== "object" || !("description" in payload)) {
			errorMessage.value = "The server returned an unexpected response. Please try again.";
			status.value = "error";
			return;
		}

		result.value = payload as DescribeNoiseResponse;
		resultFeatures.value = analyzed.value.features;
		resultSpectrogram.value = analyzed.value.spectrogramDataUrl;
		resultSource.value = "live";
		status.value = "done";
	} catch (error) {
		errorMessage.value =
			error instanceof DOMException && error.name === "AbortError"
				? "The description timed out. Please try again."
				: "Couldn't reach the server. Check your connection and try again.";
		status.value = "error";
	} finally {
		clearTimeout(timeout);
	}
}

// Unmodified bundled samples render their pre-generated result instantly -
// no API call, no cost.
function loadSample(id: string) {
	const bundled = SAMPLE_RESULTS[id];
	const spectrogram = NOISE_SAMPLE_SPECTROGRAMS[id];
	if (!bundled || !spectrogram) return;
	result.value = bundled.response;
	resultFeatures.value = bundled.features;
	resultSpectrogram.value = spectrogram;
	resultSource.value = "sample";
	safetyBlock.value = null;
	errorMessage.value = "";
	status.value = "done";
}

function recordAgain() {
	discardClip();
	activeTab.value = "record";
	document.querySelector(".input-section")?.scrollIntoView({ behavior: "smooth" });
}

onBeforeUnmount(() => {
	handle?.stop();
	cancelAnimationFrame(meterFrame);
	if (analyzed.value) URL.revokeObjectURL(analyzed.value.audioUrl);
});
</script>

<template>
	<div class="project-page">
		<AppNavbar />
		<Toast position="bottom-right" />

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="Noise Translator" />
				<h1>Noise Translator</h1>
				<EvalBadge project-id="noise-translator" class="header-eval-badge" />
				<p class="intro">
					Record the sound your car, dryer, or furnace is making - or upload a clip - and
					your browser turns it into a spectrogram and measured acoustic facts: event
					rate, regularity, frequency character. A model then translates those
					measurements into the precise description a mechanic or technician actually
					needs, plus the questions they'll ask you next. It never diagnoses; it turns
					"it's making a weird noise" into vocabulary that gets you taken seriously on the
					phone.
				</p>
			</header>

			<Message severity="warn" :closable="false" class="legal-warning">
				A description aid for talking to professionals.
				<strong>Not a diagnosis, not a safety assessment, not repair advice.</strong>
				Your audio never leaves the browser - only the rendered spectrogram image, the
				measured numbers, and your form answers are sent (transiently, never stored).
			</Message>

			<section class="input-section" aria-label="Sound input">
				<h2>1 · Capture the sound</h2>

				<div class="samples-row">
					<p class="hint">
						Try a synthesized sample - exact ground truth, generated by this repo's own
						DSP pipeline, never a real recording. These render instantly and never call
						the live API:
					</p>
					<div class="samples">
						<div v-for="sample in NOISE_SAMPLES" :key="sample.id" class="sample">
							<button
								type="button"
								class="sample-load"
								:title="sample.description"
								@click="loadSample(sample.id)"
							>
								<img
									:src="NOISE_SAMPLE_SPECTROGRAMS[sample.id]"
									:alt="`Spectrogram: ${sample.label}`"
								/>
								<span>{{ sample.label }}</span>
							</button>
							<audio
								:src="NOISE_SAMPLE_AUDIO[sample.id]"
								controls
								preload="none"
								class="sample-audio"
							/>
						</div>
					</div>
				</div>

				<Tabs v-model:value="activeTab">
					<TabList>
						<Tab value="record"
							><i class="fa-solid fa-microphone" aria-hidden="true"></i> Record</Tab
						>
						<Tab value="upload"
							><i class="fa-solid fa-file-audio" aria-hidden="true"></i> Upload a
							clip</Tab
						>
					</TabList>
					<TabPanels>
						<TabPanel value="record">
							<p class="privacy-note">
								<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
								Record the machine, not conversations - avoid talking during
								capture; the spectrogram is derived from whatever the mic hears. The
								mic is released the moment recording stops.
							</p>
							<div class="record-controls">
								<Button
									v-if="recordingState === 'idle'"
									label="Start recording"
									icon="fa-solid fa-microphone"
									size="large"
									:disabled="busy"
									@click="startCapture"
								/>
								<template v-else>
									<Button
										label="Stop"
										icon="fa-solid fa-stop"
										severity="danger"
										size="large"
										@click="stopCapture"
									/>
									<div class="meter-wrap" aria-hidden="true">
										<div class="meter">
											<div
												class="meter-fill"
												:style="{ width: `${Math.round(level * 100)}%` }"
											></div>
										</div>
										<span class="countdown">
											{{
												Math.max(0, MAX_CAPTURE_SECONDS - elapsedS).toFixed(
													0,
												)
											}}s left
										</span>
									</div>
								</template>
							</div>
						</TabPanel>
						<TabPanel value="upload">
							<div class="upload-zone">
								<i class="fa-solid fa-file-audio" aria-hidden="true"></i>
								<FileUpload
									mode="basic"
									custom-upload
									auto
									choose-label="Choose an audio file"
									accept="audio/*"
									:disabled="busy"
									@select="onFileSelect"
								/>
								<p class="formats">
									wav, mp3, m4a, webm - decoded and analyzed entirely in your
									browser; only the first {{ MAX_CAPTURE_SECONDS }} seconds are
									used.
								</p>
							</div>
						</TabPanel>
					</TabPanels>
				</Tabs>

				<Message v-if="clipError" severity="error" :closable="false">{{
					clipError
				}}</Message>
				<p v-if="analyzing" class="stage-note">Analyzing audio in your browser…</p>

				<div v-if="analyzed" class="clip-review">
					<div class="clip-review-header">
						<h3>Your recording, reviewed</h3>
						<Button
							label="Discard"
							severity="secondary"
							text
							size="small"
							@click="discardClip"
						/>
					</div>
					<canvas
						ref="waveformCanvas"
						width="900"
						height="70"
						class="waveform"
						aria-hidden="true"
					></canvas>
					<audio :src="analyzed.audioUrl" controls class="clip-audio" />
					<img
						:src="analyzed.spectrogramDataUrl"
						alt="Spectrogram of your recording"
						class="clip-spectrogram"
					/>

					<Message v-if="blockingIssues.length > 0" severity="warn" :closable="false">
						<p class="gate-title">
							This recording won't analyze well - here's how to get a better one:
						</p>
						<ul class="gate-tips">
							<li v-for="issue in blockingIssues" :key="issue">
								{{ QUALITY_TIPS[issue] }}
							</li>
							<li>Reduce wind and background noise where you can.</li>
						</ul>
					</Message>
					<Message v-else-if="isClipped" severity="warn" :closable="false">
						{{ QUALITY_TIPS.clipped }} You can still analyze it, but the frequency
						measurements will be less trustworthy.
					</Message>
				</div>
			</section>

			<section
				v-if="analyzed && blockingIssues.length === 0"
				class="context-section"
				aria-label="Context questions"
			>
				<h2>2 · A few questions the description needs</h2>
				<div class="form-grid">
					<div class="field">
						<label for="machine-type">What's making the sound?</label>
						<Select
							id="machine-type"
							v-model="context.machine_type"
							:options="MACHINE_OPTIONS"
							option-label="label"
							option-value="value"
						/>
						<InputText
							v-if="context.machine_type === 'other'"
							v-model="context.machine_type_other"
							placeholder="What is it?"
							:maxlength="MAX_CONTEXT_FIELD_CHARS"
							aria-label="Describe the machine"
						/>
					</div>
					<div class="field">
						<label for="when-happens">When does it happen?</label>
						<Select
							id="when-happens"
							v-model="context.when_it_happens"
							:options="WHEN_OPTIONS"
							option-label="label"
							option-value="value"
						/>
					</div>
					<div class="field">
						<label for="speed-dep">Does it change with speed or intensity?</label>
						<Select
							id="speed-dep"
							v-model="context.changes_with_speed"
							:options="SPEED_OPTIONS"
							option-label="label"
							option-value="value"
						/>
					</div>
					<div class="field">
						<label for="how-long">How long has it been happening?</label>
						<InputText
							id="how-long"
							v-model="context.how_long"
							placeholder="e.g. two weeks"
							:maxlength="MAX_CONTEXT_FIELD_CHARS"
						/>
					</div>
					<div class="field field-wide">
						<label for="recent-changes">Anything recently changed? (optional)</label>
						<InputText
							id="recent-changes"
							v-model="context.recent_changes"
							placeholder="e.g. new tires, moved the dryer, filter replaced"
							:maxlength="MAX_CONTEXT_FIELD_CHARS"
						/>
					</div>
					<div class="field field-wide safety-field">
						<label id="safety-label">
							Any burning smell, smoke, gas odor, or braking problems?
						</label>
						<SelectButton
							v-model="context.safety_screen"
							:options="YES_NO"
							option-label="label"
							option-value="value"
							:allow-empty="false"
							aria-labelledby="safety-label"
						/>
						<InputText
							v-if="context.safety_screen === 'yes'"
							v-model="context.safety_screen_detail"
							placeholder="Briefly, what did you notice?"
							:maxlength="MAX_CONTEXT_FIELD_CHARS"
							aria-label="Describe the safety concern"
						/>
					</div>
				</div>

				<Message v-if="safetyBlock" severity="error" :closable="false" class="safety-block">
					<p class="gate-title">
						<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
						Stop - this isn't a job for a description tool.
					</p>
					<p>
						Because {{ safetyBlock.join("; ") }}, stop using the equipment and contact a
						professional or emergency service now. No analysis was run and nothing was
						sent - a safety signal ends this flow by design.
					</p>
				</Message>

				<div class="actions">
					<Button
						label="Describe this sound"
						icon="fa-solid fa-language"
						:disabled="!canSubmit"
						:loading="status === 'loading'"
						@click="submit"
					/>
				</div>
				<p class="cost-note">
					All audio handling is client-side: capture, decoding, feature measurement, and
					the spectrogram render happen in your browser. The request carries only the
					spectrogram image, the measured numbers, and these answers - transiently, never
					stored. The three samples render instantly from pre-generated results and never
					call the live API.
				</p>
			</section>

			<section class="results-section" aria-label="Sound description" aria-live="polite">
				<template v-if="status === 'loading'">
					<p class="stage-note">
						Translating the measurements into professional vocabulary…
					</p>
					<NoiseSkeleton />
				</template>

				<Message v-else-if="status === 'error'" severity="error" :closable="false">
					{{ errorMessage }}
				</Message>

				<template v-else-if="status === 'done' && result && resultFeatures">
					<p v-if="resultSource === 'sample'" class="source-note">
						<i class="fa-solid fa-bolt" aria-hidden="true"></i>
						Rendered from the bundled pre-generated result - zero API calls. This clip
						is synthesized with exact known ground truth.
					</p>
					<NoiseResults
						:features="resultFeatures"
						:response="result"
						:spectrogram-url="resultSpectrogram"
						@record-again="recordAgain"
					/>
				</template>

				<div v-else class="placeholder">
					<i class="fa-solid fa-ear-listen" aria-hidden="true"></i>
					<p>
						The description card will appear here - characterizations, the measured
						numbers, a read-aloud summary, and the questions a professional will ask
						next.
					</p>
				</div>
			</section>

			<Accordion class="details-accordion" :value="null">
				<AccordionPanel value="raw-json">
					<AccordionHeader>View raw JSON</AccordionHeader>
					<AccordionContent>
						<pre v-if="result" class="raw-json">{{
							JSON.stringify(result, null, 2)
						}}</pre>
						<p v-else class="empty">
							Analyze a sound first - the exact JSON returned by the description
							schema will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works &amp; never-diagnose design</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								Language models don't hear. This demo works because the browser
								converts sound into two things a model <em>can</em> use: a
								spectrogram image and deterministically measured numbers. The Web
								Audio API decodes the clip, plain TypeScript resamples and trims it,
								and a tested DSP module measures event rate (spectral-flux onset
								detection), timing regularity (autocorrelation of the onset train),
								dominant frequency bands, and pitch trend. The spectrogram gets its
								time and frequency axes burned into the pixels - that turns it from
								decoration into a legible document the model can read timings off.
							</p>
							<p>
								It's the split-brain pattern in a new modality: code measures, the
								model narrates. The measured features travel through the pipeline
								verbatim and the results card renders every number from the client's
								own features object - never from the model's text. Server-side, a
								post-validation pass regex-extracts every number with an acoustic
								unit from the model's summary and strips any sentence whose numbers
								don't match the measurements. The DSP is unit-tested against
								synthesized signals with exact ground truth - a click train
								generated at precisely 3.0 per second must be detected within
								tolerance, which is the most rigorous testing story on this site.
							</p>
							<p>
								The never-diagnose posture is enforced twice, in code. Before any
								network request, a deterministic safety gate scans the form answers
								for danger signals - burning smell, smoke, gas odor, brake failure -
								and a hit ends the flow with a stop-and-call-someone message: no
								analysis, no API call. On the way out, the model's output passes a
								diagnosis deny-list ("the cause is", "it might be the bearings",
								named culprit parts) that strips violations and logs them, the same
								prompt-bans-it-code-guarantees-it pattern as the ToS watchdog's
								loaded-language scan. Description-not-diagnosis is also the
								genuinely useful choice: a professional diagnoses better from a good
								description than from a customer's guess.
							</p>
							<p>
								Honest limitations: phone mics, codec compression, and ambient noise
								bound what any analysis can claim, and spectrogram-based
								characterization is coarse - which is exactly why the guided context
								answers carry real weight in the output, why every characterization
								carries a confidence level, and why a poor recording gets a "here's
								what a better one would capture" note instead of false precision.
								Cost engineering is the house standard: client-side rendering caps
								the payload, the server enforces its own size limit, per-minute and
								daily rate limits bound the spend, and the three synthesized samples
								ship with pre-computed results and never touch the API.
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

h2 {
	font-size: 1.15rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	margin-bottom: 0.75rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.header-eval-badge {
	margin-bottom: 0.75rem;
}

.legal-warning {
	margin-bottom: 2rem;
}

.input-section,
.context-section {
	margin-bottom: 2.5rem;
	max-width: 960px;
}

.samples-row {
	margin-bottom: 1.25rem;
}

.hint {
	color: #6b6a6d;
	margin-bottom: 0.6rem;
}

.samples {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 1rem;
	max-width: 860px;
}

.sample {
	border: 1px solid rgba(0, 0, 0, 0.12);
	border-radius: 8px;
	background: #fff;
	padding: 0.5rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.sample-load {
	border: none;
	background: none;
	padding: 0;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	font-family: inherit;
	text-align: left;
}

.sample-load img {
	width: 100%;
	border-radius: 4px;
	aspect-ratio: 3 / 1;
	object-fit: cover;
	transition: box-shadow 0.2s ease;
}

.sample-load:hover img {
	box-shadow: 0 4px 14px rgba(39, 169, 224, 0.35);
}

.sample-load span {
	font-size: 0.85rem;
	font-weight: 700;
	color: #414042;
}

.sample-audio {
	width: 100%;
	height: 32px;
}

.privacy-note {
	margin: 0.5rem 0 1rem;
	font-size: 0.85rem;
	color: #6b6a6d;
}

.privacy-note i {
	color: #5cb85c;
	margin-right: 0.35rem;
}

.record-controls {
	display: flex;
	align-items: center;
	gap: 1rem;
	flex-wrap: wrap;
}

.meter-wrap {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	flex: 1;
	min-width: 220px;
}

.meter {
	flex: 1;
	height: 12px;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.08);
	overflow: hidden;
}

.meter-fill {
	height: 100%;
	background: linear-gradient(90deg, #5cb85c, #f0ad4e, #d9534f);
	transition: width 80ms linear;
}

.countdown {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	color: #6b6a6d;
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

.stage-note {
	color: #6b6a6d;
	margin-bottom: 0.75rem;
}

.clip-review {
	margin-top: 1.25rem;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 10px;
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.clip-review-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.clip-review-header h3 {
	font-size: 0.85rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: #6b6a6d;
	margin: 0;
}

.waveform {
	width: 100%;
	height: 70px;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.03);
}

.clip-audio {
	width: 100%;
}

.clip-spectrogram {
	width: 100%;
	border-radius: 6px;
}

.gate-title {
	font-weight: 700;
	margin: 0 0 0.4rem;
}

.gate-tips {
	margin: 0;
	padding-left: 1.2rem;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: 1rem;
	margin-bottom: 1.25rem;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.field label {
	font-size: 0.88rem;
	font-weight: 600;
}

.field-wide {
	grid-column: 1 / -1;
}

.safety-field {
	border: 1px solid rgba(217, 83, 79, 0.35);
	border-radius: 8px;
	padding: 0.75rem;
}

.safety-block {
	margin-bottom: 1.25rem;
}

.safety-block .gate-title i {
	margin-right: 0.4rem;
}

.actions {
	display: flex;
	gap: 0.5rem;
	margin-bottom: 0.75rem;
}

.cost-note {
	font-size: 0.85rem;
	color: #9b9aa0;
	max-width: 720px;
}

.results-section {
	max-width: 960px;
	margin-bottom: 1rem;
}

.source-note {
	font-size: 0.85rem;
	color: #5cb85c;
	font-weight: 600;
	margin-bottom: 0.75rem;
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

	.samples {
		grid-template-columns: 1fr;
	}
}

html.dark .project-page {
	color: var(--dm-text-2);
	background: var(--dm-bg);
}

html.dark h1,
html.dark h2 {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .hint,
html.dark .privacy-note,
html.dark .stage-note,
html.dark .conditions {
	color: var(--dm-text-2);
}

html.dark .formats,
html.dark .placeholder,
html.dark .empty,
html.dark .cost-note {
	color: var(--dm-text-3);
}

html.dark .upload-zone {
	background: rgba(39, 169, 224, 0.07);
}

html.dark .sample,
html.dark .clip-review,
html.dark .placeholder {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .sample {
	background: var(--dm-bg-soft);
}

html.dark .sample-load span {
	color: var(--dm-text-1);
}

html.dark .clip-review-header h3 {
	color: var(--dm-text-3);
}

html.dark .waveform {
	background: rgba(255, 255, 255, 0.05);
}

html.dark .meter {
	background: rgba(255, 255, 255, 0.1);
}
</style>
