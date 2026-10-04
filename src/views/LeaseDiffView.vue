<script setup lang="ts">
import { computed, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import FileUpload, { type FileUploadSelectEvent } from "primevue/fileupload";
import Message from "primevue/message";
import Textarea from "primevue/textarea";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import LeaseDiffResults from "@/components/projects/LeaseDiffResults.vue";
import LeaseDiffSkeleton from "@/components/projects/LeaseDiffSkeleton.vue";
import { LEASE_SAMPLE_PAIRS } from "@/data/lease-samples";
import rawSampleResults from "@/data/lease-sample-results.json";
import { MAX_LEASE_CHARS, type LeaseComparison } from "@/lib/lease-diff";
import { extractLeaseText, LeaseFileError } from "@/lib/lease-file-extract";

const SAMPLE_RESULTS = rawSampleResults as unknown as Record<string, LeaseComparison>;

// Two full-length documents on Sonnet plus a long structured response - allow
// generous headroom for cold starts and large inputs.
const REQUEST_TIMEOUT_MS = 120_000;

type Side = "original" | "revised";

const toast = useToast();

const originalText = ref("");
const revisedText = ref("");
const status = ref<"idle" | "loading" | "done" | "error">("idle");
const result = ref<LeaseComparison | null>(null);
const errorMessage = ref("");
const identicalNotice = ref(false);
const resultSource = ref<"sample" | "live" | null>(null);
const extracting = ref<Record<Side, boolean>>({ original: false, revised: false });

const sides: { key: Side; label: string; model: typeof originalText }[] = [
	{ key: "original", label: "Original lease", model: originalText },
	{ key: "revised", label: "Revised lease", model: revisedText },
];

const overLimit = (text: string) => text.length > MAX_LEASE_CHARS;

const canSubmit = computed(
	() =>
		originalText.value.trim().length > 0 &&
		revisedText.value.trim().length > 0 &&
		!overLimit(originalText.value) &&
		!overLimit(revisedText.value) &&
		status.value !== "loading" &&
		!extracting.value.original &&
		!extracting.value.revised,
);

function loadSamplePair(id: string) {
	const pair = LEASE_SAMPLE_PAIRS.find((p) => p.id === id);
	if (!pair) return;
	originalText.value = pair.originalText;
	revisedText.value = pair.revisedText;
	identicalNotice.value = false;
	errorMessage.value = "";
	if (status.value !== "loading") status.value = "idle";
}

function clearAll() {
	originalText.value = "";
	revisedText.value = "";
	status.value = "idle";
	result.value = null;
	errorMessage.value = "";
	identicalNotice.value = false;
	resultSource.value = null;
}

function onFileSelect(side: Side, event: FileUploadSelectEvent) {
	const file = Array.isArray(event.files) ? event.files[0] : event.files;
	if (file instanceof File) void extractInto(side, file);
}

async function extractInto(side: Side, file: File) {
	extracting.value[side] = true;
	try {
		// pdfjs-dist itself stays lazy - extractLeaseText only imports it
		// when the chosen file is actually a PDF.
		const text = await extractLeaseText(file);
		if (side === "original") originalText.value = text;
		else revisedText.value = text;
		if (text.length > MAX_LEASE_CHARS) {
			toast.add({
				severity: "warn",
				summary: "Document too long",
				detail: `The extracted text is over ${MAX_LEASE_CHARS.toLocaleString()} characters - please trim it before comparing.`,
				life: 6000,
			});
		}
	} catch (error) {
		toast.add({
			severity: "error",
			summary: "Couldn't read file",
			detail:
				error instanceof LeaseFileError
					? error.message
					: "Something went wrong reading that file. Please paste the text instead.",
			life: 6000,
		});
	} finally {
		extracting.value[side] = false;
	}
}

async function compareLeases() {
	if (!canSubmit.value) return;
	identicalNotice.value = false;

	// Identical documents: short-circuit client-side - don't spend an API call.
	if (originalText.value.trim() === revisedText.value.trim()) {
		identicalNotice.value = true;
		return;
	}

	// Unmodified bundled sample pairs render their pre-generated result
	// instantly - no API call, no cost.
	const pair = LEASE_SAMPLE_PAIRS.find(
		(p) =>
			p.originalText.trim() === originalText.value.trim() &&
			p.revisedText.trim() === revisedText.value.trim(),
	);
	const bundled = pair ? SAMPLE_RESULTS[pair.id] : undefined;
	if (bundled) {
		result.value = bundled;
		resultSource.value = "sample";
		status.value = "done";
		errorMessage.value = "";
		return;
	}

	status.value = "loading";
	errorMessage.value = "";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch("/api/compare-leases", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				originalText: originalText.value,
				revisedText: revisedText.value,
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
				serverError ??
				(response.status === 429
					? "Too many requests right now - please wait a minute and try again."
					: "Something went wrong comparing the leases. Please try again.");
			status.value = "error";
			return;
		}

		if (body === null || typeof body !== "object" || !("changes" in body)) {
			errorMessage.value = "The server returned an unexpected response. Please try again.";
			status.value = "error";
			return;
		}

		result.value = body as LeaseComparison;
		resultSource.value = "live";
		status.value = "done";
	} catch (error) {
		errorMessage.value =
			error instanceof DOMException && error.name === "AbortError"
				? "The comparison timed out. Please try again."
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
				<ProjectBreadcrumb current="Lease Diff Explainer" />
				<h1>Lease Diff Explainer</h1>
				<EvalBadge project-id="lease-diff" class="header-eval-badge" />
				<p class="intro">
					Paste two versions of a lease - the original and a renewal or revision - and get
					a plain-English breakdown of every substantive change: who it favors, how much
					it matters, and what a tenant should ask before signing. A classical text diff
					grounds the model call, so mechanical change detection and semantic explanation
					each do what they're best at. Built from my real-estate background, with fully
					fictional sample documents.
				</p>
			</header>

			<Message severity="warn" :closable="false" class="legal-warning">
				This is a technical demo, not legal advice, and it makes no jurisdiction-specific
				legal conclusions.
				<strong>
					Don't paste real signed leases containing personal information - use the
					synthetic samples or redacted text.
				</strong>
				Documents are processed in memory and never stored.
			</Message>

			<section class="input-section" aria-label="Lease input">
				<div class="samples-row">
					<p class="hint">Load a fictional sample pair, or paste your own text:</p>
					<div class="sample-buttons">
						<Button
							v-for="pair in LEASE_SAMPLE_PAIRS"
							:key="pair.id"
							v-tooltip.bottom="pair.description"
							:label="pair.label"
							severity="secondary"
							outlined
							size="small"
							@click="loadSamplePair(pair.id)"
						/>
					</div>
				</div>

				<div class="lease-grid">
					<div v-for="side in sides" :key="side.key" class="lease-panel">
						<div class="panel-header">
							<h2>{{ side.label }}</h2>
							<FileUpload
								mode="basic"
								custom-upload
								auto
								choose-label="Upload PDF or .txt"
								choose-icon="fa-solid fa-file-arrow-up"
								accept=".pdf,.txt,application/pdf,text/plain"
								class="upload-button"
								:disabled="extracting[side.key] || status === 'loading'"
								@select="onFileSelect(side.key, $event)"
							/>
						</div>
						<Textarea
							v-model="side.model.value"
							auto-resize
							rows="14"
							class="lease-input"
							:invalid="overLimit(side.model.value)"
							:placeholder="
								side.key === 'original'
									? 'Paste the original lease text here…'
									: 'Paste the revised lease text here…'
							"
							:aria-label="side.label"
						/>
						<div class="panel-footer">
							<span
								class="char-counter"
								:class="{ over: overLimit(side.model.value) }"
							>
								{{ side.model.value.length.toLocaleString() }} /
								{{ MAX_LEASE_CHARS.toLocaleString() }}
							</span>
							<Button
								label="Clear"
								severity="secondary"
								text
								size="small"
								:disabled="side.model.value.length === 0 || status === 'loading'"
								@click="side.model.value = ''"
							/>
						</div>
						<p v-if="extracting[side.key]" class="extract-note">
							<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
							Extracting text in your browser - the file never leaves it.
						</p>
					</div>
				</div>

				<div class="actions">
					<Button
						label="Compare leases"
						icon="fa-solid fa-code-compare"
						:disabled="!canSubmit"
						:loading="status === 'loading'"
						@click="compareLeases"
					/>
					<Button
						label="Clear all"
						severity="secondary"
						text
						:disabled="status === 'loading'"
						@click="clearAll"
					/>
				</div>
				<p class="cost-note">
					PDF text extraction happens entirely in your browser - only the text is sent.
					The two sample pairs render instantly from pre-generated results; only custom or
					edited text calls the live API.
				</p>
			</section>

			<section class="results-section" aria-label="Comparison results" aria-live="polite">
				<Message v-if="identicalNotice" severity="info" :closable="false">
					These two documents look identical - there's nothing to compare. Edit one of
					them and try again.
				</Message>

				<LeaseDiffSkeleton v-if="status === 'loading'" />

				<Message v-else-if="status === 'error'" severity="error" :closable="false">
					{{ errorMessage }}
				</Message>

				<template v-else-if="status === 'done' && result">
					<p v-if="resultSource === 'sample'" class="source-note">
						<i class="fa-solid fa-bolt" aria-hidden="true"></i>
						Rendered from the bundled pre-generated result - zero API calls.
					</p>
					<LeaseDiffResults :result="result" />
				</template>

				<div v-else-if="!identicalNotice" class="placeholder">
					<i class="fa-solid fa-code-compare" aria-hidden="true"></i>
					<p>The change-by-change breakdown will appear here.</p>
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
							Compare two leases first - the exact JSON returned by the comparison
							schema will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>How this works &amp; guardrail design</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								This is a hybrid pipeline, not a single prompt. Before the model is
								called, the server runs a classical text diff: both documents are
								normalized, split into clauses, and reduced to a compact list of
								added, removed, and modified blocks. That mechanical summary goes to
								the model alongside both full texts and acts as a checklist -
								deterministic change detection does what it's reliably good at, and
								the model spends its capacity on the part only it can do: explaining
								what each change means in plain English. The response comes back
								through a forced tool call whose JSON schema mirrors this page's
								TypeScript types exactly, validated by the API before my code sees
								it.
							</p>
							<p>
								Anything legal-adjacent needs "explain, don't advise" enforced in
								layers, because any single layer fails eventually. The system prompt
								forbids legal conclusions and sign/don't-sign recommendations; the
								schema makes negotiation notes question-framed by design rather than
								hoping the model phrases them gently; and the UI pins a not-legal-
								advice disclaimer above every result. If one layer slips, the others
								hold - that layering, not any single rule, is what makes a real
								legal-tech product defensible.
							</p>
							<p>
								Privacy follows the same design-it-in approach as my other projects:
								PDF text extraction runs entirely in the browser via a lazy-loaded
								pdf.js, so uploaded files never leave your machine - only extracted
								text you can edit or redact first is sent. Server-side, both
								documents live in memory for the single API call and are never
								stored; logs record only sizes, duration, and outcome. Cost is
								bounded by a 75,000-character cap per document enforced on both
								client and server, per-IP rate limits, and sample pairs that ship
								with pre-generated results and never touch the API.
							</p>
							<p>
								Honest limitations: no OCR for scanned documents, a character cap
								that comfortably fits a full-length residential or commercial lease
									but not a book-length master agreement, and -
								deliberately - no jurisdiction awareness, since tenancy law varies
								enough by state and city that pretending otherwise would be worse
								than staying silent. A production version would add a clause
								library, jurisdiction-specific rules, and an attorney review loop -
								the pipeline shape stays the same; the controls around it become the
								product.
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
	margin: 0;
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

.lease-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1.5rem;
	align-items: start;
}

.lease-panel {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	flex-wrap: wrap;
	margin-bottom: 0.6rem;
}

.upload-button :deep(.p-button) {
	font-size: 0.85rem;
	padding: 0.35rem 0.75rem;
}

.lease-input {
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

.extract-note {
	margin-top: 0.4rem;
	font-size: 0.85rem;
	color: #6b6a6d;
}

.extract-note i {
	color: #27a9e0;
	margin-right: 0.35rem;
}

.actions {
	display: flex;
	gap: 0.75rem;
	align-items: center;
	margin-top: 1.25rem;
}

.cost-note {
	margin-top: 0.75rem;
	font-size: 0.85rem;
	color: #9b9aa0;
}

.results-section {
	margin-top: 2rem;
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

	.lease-grid {
		grid-template-columns: minmax(0, 1fr);
	}

	h1 {
		font-size: 1.75rem;
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
html.dark .extract-note {
	color: var(--dm-text-2);
}

html.dark .char-counter,
html.dark .cost-note,
html.dark .placeholder,
html.dark .empty {
	color: var(--dm-text-3);
}

html.dark .char-counter.over {
	color: #ff6b6b;
}

html.dark .placeholder {
	border-color: rgba(255, 255, 255, 0.16);
}
</style>
