<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import FileUpload, { type FileUploadSelectEvent } from "primevue/fileupload";
import Message from "primevue/message";
import Toast from "primevue/toast";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import UiAnalysisResults from "@/components/projects/UiAnalysisResults.vue";
import UiAnalysisSkeleton from "@/components/projects/UiAnalysisSkeleton.vue";
import { SCREENSHOT_SAMPLES } from "@/data/screenshot-samples";
import {
	SCREENSHOT_SAMPLE_IMAGES,
	SCREENSHOT_SAMPLE_THUMBS,
} from "@/data/screenshot-sample-images";
import rawSampleResults from "@/data/screenshot-sample-results.json";
import { ImagePrepError, prepareScreenshot } from "@/lib/image-prep";
import type { UiAnalysis } from "@/lib/ui-analysis";

const SAMPLE_RESULTS = rawSampleResults as unknown as Record<string, UiAnalysis>;

// Vision + a long scaffold can take a while on cold starts.
const REQUEST_TIMEOUT_MS = 90_000;

const status = ref<"idle" | "preparing" | "loading" | "done" | "error">("idle");
const result = ref<UiAnalysis | null>(null);
const errorMessage = ref("");
const imageUrl = ref<string | null>(null);
const resultSource = ref<"sample" | "live" | null>(null);
let objectUrl: string | null = null;

function setImage(url: string, isObjectUrl: boolean) {
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = isObjectUrl ? url : null;
	imageUrl.value = url;
}

function clearAll() {
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = null;
	imageUrl.value = null;
	result.value = null;
	errorMessage.value = "";
	resultSource.value = null;
	status.value = "idle";
}

onBeforeUnmount(() => {
	if (objectUrl) URL.revokeObjectURL(objectUrl);
});

function loadSample(id: string) {
	const bundled = SAMPLE_RESULTS[id];
	const image = SCREENSHOT_SAMPLE_IMAGES[id];
	if (!bundled || !image) return;
	setImage(image, false);
	result.value = bundled;
	resultSource.value = "sample";
	errorMessage.value = "";
	status.value = "done";
}

function onFileSelect(event: FileUploadSelectEvent) {
	const file = Array.isArray(event.files) ? event.files[0] : event.files;
	if (file instanceof File) void analyzeFile(file);
}

function onDrop(event: DragEvent) {
	const file = event.dataTransfer?.files?.[0];
	if (file) void analyzeFile(file);
}

async function analyzeFile(file: File) {
	if (status.value === "preparing" || status.value === "loading") return;
	status.value = "preparing";
	errorMessage.value = "";
	result.value = null;

	let prepared;
	try {
		prepared = await prepareScreenshot(file);
	} catch (error) {
		errorMessage.value =
			error instanceof ImagePrepError
				? error.message
				: "Couldn't process that image. Please try a different file.";
		status.value = "error";
		return;
	}

	setImage(prepared.previewUrl, true);
	status.value = "loading";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch("/api/analyze-screenshot", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				imageData: prepared.base64,
				mediaType: prepared.mediaType,
			}),
			signal: controller.signal,
		});

		let body: unknown = null;
		try {
			body = await response.json();
		} catch {
			// fall through - handled by response.ok check below
		}

		if (!response.ok) {
			const serverError =
				body !== null &&
				typeof body === "object" &&
				"error" in body &&
				typeof body.error === "string"
					? body.error
					: null;
			errorMessage.value =
				serverError ?? "Something went wrong analyzing the screenshot. Please try again.";
			status.value = "error";
			return;
		}

		if (body === null || typeof body !== "object" || !("is_ui_screenshot" in body)) {
			errorMessage.value = "The server returned an unexpected response. Please try again.";
			status.value = "error";
			return;
		}

		result.value = body as UiAnalysis;
		resultSource.value = "live";
		status.value = "done";
	} catch (error) {
		errorMessage.value =
			error instanceof DOMException && error.name === "AbortError"
				? "The analysis timed out. Please try again."
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
				<ProjectBreadcrumb current="Screenshot → PrimeVue" />
				<h1>Screenshot → PrimeVue</h1>
				<EvalBadge project-id="screenshot-to-primevue" class="header-eval-badge" />
				<p class="intro">
					Drop in a screenshot of any UI, and a vision model maps what it sees to the
					PrimeVue components that would rebuild it - then writes a scaffold Vue component
					to get you started. Uploaded images are processed transiently in memory and
					never stored.
				</p>
			</header>

			<div class="project-grid">
				<section class="input-panel" aria-label="Screenshot input">
					<h2>Screenshot</h2>
					<div
						class="drop-zone"
						:class="{ busy: status === 'preparing' || status === 'loading' }"
						@dragover.prevent
						@drop.prevent="onDrop"
					>
						<i class="fa-regular fa-image" aria-hidden="true"></i>
						<p>Drag &amp; drop a UI screenshot here, or</p>
						<FileUpload
							mode="basic"
							custom-upload
							auto
							choose-label="Choose image"
							accept="image/png,image/jpeg,image/webp"
							:disabled="status === 'preparing' || status === 'loading'"
							@select="onFileSelect"
						/>
						<p class="formats">
							PNG, JPEG, or WebP - compressed in your browser before upload
						</p>
					</div>

					<p class="privacy-note">
						<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
						Images are analyzed in memory and never stored. Please don't upload
						screenshots containing sensitive personal information.
					</p>

					<div v-if="imageUrl && resultSource !== 'sample'" class="preview">
						<img :src="imageUrl" alt="Upload preview" />
						<Button
							label="Remove"
							icon="fa-regular fa-trash-can"
							severity="secondary"
							text
							size="small"
							:disabled="status === 'preparing' || status === 'loading'"
							@click="clearAll"
						/>
					</div>

					<h2 class="samples-heading">Or try a sample</h2>
					<p class="hint">
						Rendered by this repo's own Playwright pipeline - these never call the live
						API.
					</p>
					<div class="samples">
						<button
							v-for="sample in SCREENSHOT_SAMPLES"
							:key="sample.id"
							type="button"
							class="sample"
							@click="loadSample(sample.id)"
						>
							<img
								:src="SCREENSHOT_SAMPLE_THUMBS[sample.id]"
								:alt="sample.label"
								width="576"
								height="360"
							/>
							<span>{{ sample.label }}</span>
						</button>
					</div>
				</section>
			</div>

			<section class="results-section" aria-label="Analysis results" aria-live="polite">
				<template v-if="status === 'preparing' || status === 'loading'">
					<p class="stage-note">
						{{
							status === "preparing"
								? "Compressing image in your browser…"
								: "Analyzing screenshot…"
						}}
					</p>
					<UiAnalysisSkeleton />
				</template>

				<Message v-else-if="status === 'error'" severity="error" :closable="false">
					{{ errorMessage }}
				</Message>

				<template v-else-if="status === 'done' && result">
					<Message v-if="!result.is_ui_screenshot" severity="warn" :closable="false">
						{{
							result.reason ??
							"That doesn't look like a UI screenshot, so there's nothing to map."
						}}
					</Message>
					<template v-else>
						<p v-if="resultSource === 'sample'" class="source-note">
							<i class="fa-solid fa-bolt" aria-hidden="true"></i>
							Rendered from the bundled pre-generated result - zero API calls.
						</p>
						<UiAnalysisResults v-if="imageUrl" :result="result" :image-url="imageUrl" />
					</template>
				</template>

				<div v-else class="placeholder">
					<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
					<p>
						Upload a screenshot or pick a sample - the component mapping and scaffold
						will appear here.
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
							Analyze a screenshot first - the exact JSON returned by the analysis
							schema will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								The interesting problem here is turning an unstructured image into
								data a UI can actually render. The screenshot goes to a vision model
								as an image block, but the response comes back through a forced tool
								call whose JSON schema mirrors this page's TypeScript types exactly
								- <code>is_ui_screenshot</code>, component mappings with confidence
								levels, the scaffold string. The API validates the output against
								that schema before my code sees it, so the mapping table and code
								block render from typed data, not from parsing prose.
							</p>
							<p>
								Privacy is designed in before the image ever leaves your browser:
								it's downscaled and re-encoded to JPEG on a canvas, which strips
								EXIF metadata (GPS location, device identifiers) as a side effect.
								Server-side, the image lives in memory for the single API call and
								is never written to storage; logs record only metadata - size,
								duration, outcome - never image contents. The system prompt
								additionally instructs the model to ignore any personal data visible
								in a screenshot and never describe people.
							</p>
							<p>
								Cost engineering mirrors my other project: client-side compression
								caps the payload before upload, the server enforces its own size
								limit independently, a small fast model (Claude Haiku) does the
								analysis, per-minute and daily rate limits bound the spend, and the
								three bundled samples - generated by this repo's own Playwright
								pipeline - ship with pre-computed results and never touch the API.
							</p>
							<p>
								Honest limitations: the scaffold approximates structure and
								composition rather than cloning pixels, and anything without a clean
								PrimeVue equivalent lands in the "gaps" list instead of being
								force-fitted to the wrong component. For a portfolio project that's
								the right trade - it shows the mapping judgment, which is the part
								that requires actually knowing the component library.
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

.project-grid {
	margin-bottom: 2rem;
}

.drop-zone {
	border: 2px dashed rgba(39, 169, 224, 0.5);
	border-radius: 10px;
	padding: 2rem 1.5rem;
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	background: rgba(39, 169, 224, 0.04);
	transition: border-color 0.2s ease;
}

.drop-zone.busy {
	opacity: 0.6;
	pointer-events: none;
}

.drop-zone i {
	font-size: 2rem;
	color: #27a9e0;
}

.drop-zone .formats {
	font-size: 0.8rem;
	color: #9b9aa0;
}

.privacy-note {
	margin-top: 0.75rem;
	font-size: 0.85rem;
	color: #6b6a6d;
}

.privacy-note i {
	color: #5cb85c;
	margin-right: 0.35rem;
}

.preview {
	margin-top: 1rem;
	display: flex;
	align-items: flex-start;
	gap: 0.75rem;
}

.preview img {
	max-width: 220px;
	max-height: 160px;
	border: 1px solid rgba(0, 0, 0, 0.12);
	border-radius: 6px;
	object-fit: contain;
}

.samples-heading {
	margin-top: 1.75rem;
}

.hint {
	color: #6b6a6d;
	margin-bottom: 0.75rem;
	font-size: 0.9rem;
}

.samples {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 1rem;
	max-width: 720px;
}

.sample {
	border: 1px solid rgba(0, 0, 0, 0.12);
	border-radius: 8px;
	background: #fff;
	padding: 0.5rem;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	transition:
		border-color 0.2s ease,
		box-shadow 0.2s ease;
	font-family: inherit;
}

.sample:hover {
	border-color: #27a9e0;
	box-shadow: 0 4px 14px rgba(39, 169, 224, 0.18);
}

.sample img {
	width: 100%;
	border-radius: 4px;
	aspect-ratio: 16 / 10;
	object-fit: cover;
	object-position: top;
}

.sample span {
	font-size: 0.85rem;
	font-weight: 700;
	color: #414042;
}

.results-section {
	margin-top: 1rem;
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

.architecture-notes code {
	background: #f2f4f6;
	padding: 0.1rem 0.35rem;
	border-radius: 4px;
	font-size: 0.85em;
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
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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
html.dark .stage-note {
	color: var(--dm-text-2);
}

html.dark .drop-zone .formats,
html.dark .placeholder,
html.dark .empty {
	color: var(--dm-text-3);
}

html.dark .drop-zone {
	background: rgba(39, 169, 224, 0.07);
}

html.dark .preview img {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .sample {
	background: var(--dm-bg-soft);
	border-color: rgba(255, 255, 255, 0.14);
}

html.dark .sample span {
	color: var(--dm-text-1);
}

html.dark .sample:hover {
	border-color: #27a9e0;
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}

html.dark .placeholder {
	border-color: rgba(255, 255, 255, 0.16);
}

html.dark .architecture-notes code {
	background: var(--dm-bg-mute);
}
</style>
