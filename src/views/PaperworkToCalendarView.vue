<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import FileUpload, { type FileUploadSelectEvent } from "primevue/fileupload";
import Message from "primevue/message";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import Textarea from "primevue/textarea";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import PaperworkReviewPanel from "@/components/projects/PaperworkReviewPanel.vue";
import PaperworkSkeleton from "@/components/projects/PaperworkSkeleton.vue";
import { PAPERWORK_SAMPLES, PAPERWORK_SAMPLE_TODAY } from "@/data/paperwork-samples";
import rawSampleResults from "@/data/paperwork-sample-results.json";
import { ImagePrepError, prepareScreenshot, type PreparedImage } from "@/lib/image-prep";
import {
	MAX_PAPERWORK_CHARS,
	MAX_PAPERWORK_IMAGES,
	type ObligationExtraction,
} from "@/lib/paperwork";
import { todayUtcIso } from "@/lib/paperwork-dates";
import {
	extractPaperworkText,
	PaperworkFileError,
	ScannedPdfError,
} from "@/lib/paperwork-file-extract";

const SAMPLE_RESULTS = rawSampleResults as unknown as Record<string, ObligationExtraction>;

// Text extraction plus a structured response - generous headroom for cold
// starts and 3-image vision requests.
const REQUEST_TIMEOUT_MS = 90_000;

const toast = useToast();

const activeTab = ref("paste");
const documentText = ref("");
const status = ref<"idle" | "preparing" | "loading" | "done" | "error">("idle");
const result = ref<ObligationExtraction | null>(null);
const errorMessage = ref("");
const resultSource = ref<"sample" | "live" | null>(null);
const resultToday = ref(todayUtcIso());
const extracting = ref(false);

// Photo tab: up to 3 photographed pages, compressed client-side.
interface PhotoPage {
	prepared: PreparedImage;
	name: string;
}
const photos = ref<PhotoPage[]>([]);
const photoInput = ref<HTMLInputElement | null>(null);

const overLimit = computed(() => documentText.value.length > MAX_PAPERWORK_CHARS);
const busy = computed(() => status.value === "preparing" || status.value === "loading");

const canSubmitText = computed(
	() => documentText.value.trim().length > 0 && !overLimit.value && !busy.value && !extracting.value,
);
const canSubmitPhotos = computed(() => photos.value.length > 0 && !busy.value);

function loadSample(id: string) {
	const sample = PAPERWORK_SAMPLES.find((s) => s.id === id);
	if (!sample) return;
	documentText.value = sample.text;
	activeTab.value = "paste";
	errorMessage.value = "";
	if (!busy.value) status.value = "idle";
}

function clearAll() {
	documentText.value = "";
	clearPhotos();
	result.value = null;
	errorMessage.value = "";
	resultSource.value = null;
	status.value = "idle";
}

// --- Upload tab -------------------------------------------------------------

function onFileSelect(event: FileUploadSelectEvent) {
	const file = Array.isArray(event.files) ? event.files[0] : event.files;
	if (file instanceof File) void extractFromFile(file);
}

async function extractFromFile(file: File) {
	extracting.value = true;
	try {
		// pdfjs-dist and mammoth stay lazy - extractPaperworkText only imports
		// the parser the chosen file actually needs.
		const text = await extractPaperworkText(file);
		documentText.value = text;
		activeTab.value = "paste";
		toast.add({
			severity: "success",
			summary: "Text extracted in your browser",
			detail: "Review or redact the text below, then extract the obligations.",
			life: 5000,
		});
		if (text.length > MAX_PAPERWORK_CHARS) {
			toast.add({
				severity: "warn",
				summary: "Document too long",
				detail: `The extracted text is over ${MAX_PAPERWORK_CHARS.toLocaleString()} characters - please trim it to the sections with deadlines.`,
				life: 6000,
			});
		}
	} catch (error) {
		toast.add({
			severity: error instanceof ScannedPdfError ? "warn" : "error",
			summary:
				error instanceof ScannedPdfError ? "Scanned PDF detected" : "Couldn't read file",
			detail:
				error instanceof PaperworkFileError
					? error.message
					: "Something went wrong reading that file. Please paste the text instead.",
			life: 7000,
		});
	} finally {
		extracting.value = false;
	}
}

// --- Photo tab --------------------------------------------------------------

function openPhotoPicker() {
	photoInput.value?.click();
}

async function onPhotoChange(event: Event) {
	const input = event.target as HTMLInputElement;
	const files = Array.from(input.files ?? []);
	input.value = ""; // allow re-selecting the same file
	for (const file of files) {
		if (photos.value.length >= MAX_PAPERWORK_IMAGES) {
			toast.add({
				severity: "warn",
				summary: "Page limit",
				detail: `Up to ${MAX_PAPERWORK_IMAGES} pages per document.`,
				life: 4000,
			});
			break;
		}
		try {
			// Same client-side downscale/re-encode pipeline as the screenshot
			// demo - EXIF (GPS, device) is stripped as a side effect.
			const prepared = await prepareScreenshot(file);
			photos.value.push({ prepared, name: file.name });
		} catch (error) {
			toast.add({
				severity: "error",
				summary: "Couldn't process photo",
				detail:
					error instanceof ImagePrepError
						? error.message
						: "That file doesn't look like a readable image.",
				life: 6000,
			});
		}
	}
}

function removePhoto(index: number) {
	const [removed] = photos.value.splice(index, 1);
	if (removed) URL.revokeObjectURL(removed.prepared.previewUrl);
}

function clearPhotos() {
	for (const photo of photos.value) URL.revokeObjectURL(photo.prepared.previewUrl);
	photos.value = [];
}

onBeforeUnmount(clearPhotos);

// --- Submission -------------------------------------------------------------

async function submitText() {
	if (!canSubmitText.value) return;

	// Unmodified bundled samples render their pre-generated result instantly -
	// no API call, no cost.
	const sample = PAPERWORK_SAMPLES.find((s) => s.text.trim() === documentText.value.trim());
	const bundled = sample ? SAMPLE_RESULTS[sample.id] : undefined;
	if (bundled) {
		result.value = bundled;
		resultSource.value = "sample";
		resultToday.value = PAPERWORK_SAMPLE_TODAY;
		status.value = "done";
		errorMessage.value = "";
		return;
	}

	await callApi({ documentText: documentText.value });
}

async function submitPhotos() {
	if (!canSubmitPhotos.value) return;
	await callApi({
		images: photos.value.map((photo) => ({
			imageData: photo.prepared.base64,
			mediaType: photo.prepared.mediaType,
		})),
	});
}

async function callApi(body: Record<string, unknown>) {
	status.value = "loading";
	errorMessage.value = "";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch("/api/extract-obligations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
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
					: "Something went wrong extracting the obligations. Please try again.");
			status.value = "error";
			return;
		}

		if (
			payload === null ||
			typeof payload !== "object" ||
			!("is_obligation_document" in payload)
		) {
			errorMessage.value = "The server returned an unexpected response. Please try again.";
			status.value = "error";
			return;
		}

		result.value = payload as ObligationExtraction;
		resultSource.value = "live";
		resultToday.value = todayUtcIso();
		status.value = "done";
	} catch (error) {
		errorMessage.value =
			error instanceof DOMException && error.name === "AbortError"
				? "The extraction timed out. Please try again."
				: "Couldn't reach the server. Check your connection and try again.";
		status.value = "error";
	} finally {
		clearTimeout(timeout);
	}
}
</script>

<template>
	<div class="project-page">
		<AppNavbar />
		<Toast position="bottom-right" />

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="Paperwork → Calendar" />
				<h1>Paperwork → Calendar</h1>
				<EvalBadge project-id="paperwork-to-calendar" class="header-eval-badge" />
				<p class="intro">
					Paste, upload, or photograph any document with obligations buried in it - a
					lease, a scholarship letter, an insurance policy - and get back real calendar
					events: every deadline, notice window, renewal date, and recurring payment,
					reviewable and editable, then exported as a downloadable .ics file with
					reminders set <em>before</em> each deadline, not on it.
				</p>
			</header>

			<Message severity="warn" :closable="false" class="legal-warning">
				This is a technical demo, not legal or financial advice.
				<strong>
					Don't upload real documents containing personal information - use the
					synthetic samples or redact first.
				</strong>
				Documents are processed in memory and never stored.
			</Message>

			<section class="input-section" aria-label="Document input">
				<div class="samples-row">
					<p class="hint">Load a fictional sample, or bring your own document:</p>
					<div class="sample-buttons">
						<Button
							v-for="sample in PAPERWORK_SAMPLES"
							:key="sample.id"
							v-tooltip.bottom="sample.description"
							:label="sample.label"
							severity="secondary"
							outlined
							size="small"
							@click="loadSample(sample.id)"
						/>
					</div>
				</div>

				<Tabs v-model:value="activeTab">
					<TabList>
						<Tab value="paste">
							<i class="fa-solid fa-paste" aria-hidden="true"></i>
							Paste text
						</Tab>
						<Tab value="upload">
							<i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
							Upload a file
						</Tab>
						<Tab value="photo">
							<i class="fa-solid fa-camera" aria-hidden="true"></i>
							Photograph it
						</Tab>
					</TabList>
					<TabPanels>
						<TabPanel value="paste">
							<Textarea
								v-model="documentText"
								auto-resize
								rows="12"
								class="document-input"
								:invalid="overLimit"
								placeholder="Paste the document text here - a lease, award letter, policy summary, gym contract…"
								aria-label="Document text"
							/>
							<div class="panel-footer">
								<span class="char-counter" :class="{ over: overLimit }">
									{{ documentText.length.toLocaleString() }} /
									{{ MAX_PAPERWORK_CHARS.toLocaleString() }}
								</span>
								<Button
									label="Clear"
									severity="secondary"
									text
									size="small"
									:disabled="documentText.length === 0 || busy"
									@click="documentText = ''"
								/>
							</div>
							<div class="actions">
								<Button
									label="Extract obligations"
									icon="fa-solid fa-calendar-check"
									:disabled="!canSubmitText"
									:loading="status === 'loading'"
									@click="submitText"
								/>
								<Button
									label="Clear all"
									severity="secondary"
									text
									:disabled="busy"
									@click="clearAll"
								/>
							</div>
						</TabPanel>

						<TabPanel value="upload">
							<div class="upload-zone">
								<i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
								<p>Upload a .txt, PDF, or .docx document</p>
								<FileUpload
									mode="basic"
									custom-upload
									auto
									choose-label="Choose file"
									accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
									:disabled="extracting || busy"
									@select="onFileSelect"
								/>
								<p class="formats">
									Text is extracted entirely in your browser - the file never
									leaves it. The extracted text lands in the paste tab so you can
									review or redact it before anything is sent.
								</p>
							</div>
							<p v-if="extracting" class="extract-note">
								<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
								Extracting text in your browser…
							</p>
						</TabPanel>

						<TabPanel value="photo">
							<div class="photo-zone">
								<i class="fa-solid fa-camera" aria-hidden="true"></i>
								<p>
									Photograph the paper document - up to
									{{ MAX_PAPERWORK_IMAGES }} pages
								</p>
								<input
									ref="photoInput"
									type="file"
									accept="image/png,image/jpeg,image/webp"
									capture="environment"
									multiple
									class="visually-hidden-input"
									aria-label="Photograph document pages"
									@change="onPhotoChange"
								/>
								<Button
									label="Take or choose photos"
									icon="fa-solid fa-camera"
									severity="secondary"
									outlined
									:disabled="busy || photos.length >= MAX_PAPERWORK_IMAGES"
									@click="openPhotoPicker"
								/>
								<p class="formats">
									Photos are downscaled and re-encoded in your browser first -
									EXIF metadata (location, device) is stripped before anything is
									sent.
								</p>
							</div>

							<div v-if="photos.length > 0" class="photo-previews">
								<div
									v-for="(photo, index) in photos"
									:key="photo.prepared.previewUrl"
									class="photo-preview"
								>
									<img
										:src="photo.prepared.previewUrl"
										:alt="`Page ${index + 1}`"
									/>
									<span class="page-label">Page {{ index + 1 }}</span>
									<Button
										icon="fa-regular fa-trash-can"
										severity="secondary"
										text
										size="small"
										:aria-label="`Remove page ${index + 1}`"
										:disabled="busy"
										@click="removePhoto(index)"
									/>
								</div>
							</div>

							<div class="actions">
								<Button
									label="Extract obligations from photos"
									icon="fa-solid fa-calendar-check"
									:disabled="!canSubmitPhotos"
									:loading="status === 'loading'"
									@click="submitPhotos"
								/>
								<Button
									label="Remove all photos"
									severity="secondary"
									text
									:disabled="photos.length === 0 || busy"
									@click="clearPhotos"
								/>
							</div>
						</TabPanel>
					</TabPanels>
				</Tabs>

				<p class="cost-note">
					All file handling is client-side: PDF/.docx text extraction and photo
					compression happen in your browser, and the exported .ics is generated in your
					browser too - the server only ever sees text or compressed images, transiently.
					The three samples render instantly from pre-generated results and never call
					the live API.
				</p>
			</section>

			<section class="results-section" aria-label="Extracted events" aria-live="polite">
				<template v-if="status === 'loading'">
					<p class="stage-note">Extracting obligations…</p>
					<PaperworkSkeleton />
				</template>

				<Message v-else-if="status === 'error'" severity="error" :closable="false">
					{{ errorMessage }}
				</Message>

				<template v-else-if="status === 'done' && result">
					<Message
						v-if="!result.is_obligation_document"
						severity="warn"
						:closable="false"
					>
						{{
							result.reason ??
							"That doesn't look like a document with obligations or deadlines, so there's nothing to put on a calendar."
						}}
					</Message>
					<Message
						v-else-if="result.events.length === 0"
						severity="info"
						:closable="false"
					>
						This looks like a document with obligations, but none of them carry a date
						a calendar event could be made from. Nothing was extracted.
					</Message>
					<template v-else>
						<p v-if="resultSource === 'sample'" class="source-note">
							<i class="fa-solid fa-bolt" aria-hidden="true"></i>
							Rendered from the bundled pre-generated result - zero API calls.
						</p>
						<PaperworkReviewPanel :extraction="result" :today-iso="resultToday" />
					</template>
				</template>

				<div v-else class="placeholder">
					<i class="fa-solid fa-calendar-days" aria-hidden="true"></i>
					<p>
						The extracted deadlines will appear here - review and edit them, then
						download the .ics.
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
							Extract a document first - the exact JSON returned by the extraction
							schema will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works &amp; date-integrity design</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								The insight behind this demo is about delivery format:
								deadline-bearing documents are write-once-read-never, and calendars
								are where obligations actually get honored. So the output isn't a
								summary to read once - it's an .ics file that plugs into the tool
								you already check every day, with reminders set before each
								deadline rather than on it. The generator is a small hand-rolled
								RFC 5545 module (escaping, line folding, RRULEs, alarms, stable
								UIDs so re-imports update instead of duplicate), unit-tested in
								normal CI.
							</p>
							<p>
								A calendar tool that invents a deadline is worse than useless, so
								date integrity is the design's first-class concern. Every date
								carries a basis: <em>stated</em> in the document, <em>computed</em>
								from an anchor with the arithmetic shown ("lease end minus 60 days
								= July 2"), or <em>unresolved</em> - surfaced to you to fill in,
								never guessed. The model only identifies what math is needed - the
								arithmetic itself always runs in tested code. For computed dates the
								model reports the anchor and offset it found and the server re-runs
								the calculation, overriding any slip (LLM day-counting is genuinely
								unreliable around month lengths and leap years); when you supply a
								missing anchor, the same date module runs client-side. The eval
								suite hard-fails
								if an unresolvable date ever comes back filled in, and verifies
								computed dates to the day across month boundaries.
							</p>
							<p>
								Privacy follows the same design-it-in approach as my other
								projects: PDF and .docx text extraction run in the browser
								(lazy-loaded pdf.js and mammoth), photos are downscaled and
								re-encoded client-side (stripping EXIF location data), and the .ics
								export is assembled in the browser from the reviewed events - it
								never round-trips through a server. Server-side, the document lives
								in memory for the single API call; logs record only sizes,
								duration, and outcome. The prompt additionally instructs the model
								never to transcribe names or account numbers.
							</p>
							<p>
								Honest limitations: no OCR beyond the photo path's vision model,
								single-document scope, and genuinely ambiguous legal language
								("within a reasonable time") still needs human review - which is
								why the review step exists and why every event shows the exact
								excerpt it came from. A production version would add multi-document
								batching, jurisdiction-aware date rules, and calendar-API sync; the
								extraction pipeline stays the same.
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
	max-width: 720px;
	margin-bottom: 1.5rem;
}

h1 {
	font-size: 2.25rem;
	font-weight: 700;
	margin-bottom: 0.75rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.legal-warning {
	margin-bottom: 2rem;
}

.samples-row {
	margin-bottom: 1rem;
}

.hint {
	color: #6b6a6d;
	margin-bottom: 0.6rem;
}

.sample-buttons {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.document-input {
	width: 100%;
	font-family: inherit;
	line-height: 1.6;
	font-size: 0.9rem;
}

.panel-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 0.25rem;
}

.char-counter {
	font-size: 0.8rem;
	color: #9b9aa0;
}

.char-counter.over {
	color: #d32f2f;
	font-weight: 700;
}

.actions {
	display: flex;
	gap: 0.75rem;
	align-items: center;
	margin-top: 1.25rem;
	flex-wrap: wrap;
}

.upload-zone,
.photo-zone {
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

.upload-zone i,
.photo-zone i {
	font-size: 2rem;
	color: #27a9e0;
}

.formats {
	font-size: 0.8rem;
	color: #9b9aa0;
	max-width: 480px;
}

.extract-note {
	margin-top: 0.6rem;
	font-size: 0.85rem;
	color: #6b6a6d;
}

.extract-note i {
	color: #27a9e0;
	margin-right: 0.35rem;
}

.visually-hidden-input {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
}

.photo-previews {
	display: flex;
	flex-wrap: wrap;
	gap: 0.75rem;
	margin-top: 1rem;
}

.photo-preview {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.25rem;
}

.photo-preview img {
	max-width: 140px;
	max-height: 180px;
	border: 1px solid rgba(0, 0, 0, 0.12);
	border-radius: 6px;
	object-fit: contain;
}

.page-label {
	font-size: 0.78rem;
	color: #6b6a6d;
}

.cost-note {
	margin-top: 0.75rem;
	font-size: 0.85rem;
	color: #9b9aa0;
}

.results-section {
	margin-top: 2rem;
}

.stage-note {
	color: #6b6a6d;
	font-size: 0.9rem;
	margin-bottom: 0.75rem;
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
}

html.dark .project-page {
	color: var(--dm-text-2);
	background: var(--dm-bg);
}

html.dark h1 {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .hint,
html.dark .extract-note,
html.dark .stage-note,
html.dark .page-label {
	color: var(--dm-text-2);
}

html.dark .char-counter,
html.dark .cost-note,
html.dark .formats,
html.dark .placeholder,
html.dark .empty {
	color: var(--dm-text-3);
}

html.dark .char-counter.over {
	color: #ff6b6b;
}

html.dark .upload-zone,
html.dark .photo-zone {
	background: rgba(39, 169, 224, 0.07);
}

html.dark .photo-preview img {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .placeholder {
	border-color: rgba(255, 255, 255, 0.16);
}
</style>
