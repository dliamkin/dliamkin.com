<script setup lang="ts">
import { computed, ref } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import Message from "primevue/message";
import Textarea from "primevue/textarea";
import EvalBadge from "@/components/EvalBadge.vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import StructuredNoteResults from "@/components/projects/StructuredNoteResults.vue";
import StructuredNoteSkeleton from "@/components/projects/StructuredNoteSkeleton.vue";
import { SAMPLE_NOTES } from "@/data/sample-notes";
import rawSampleResults from "@/data/sample-note-results.json";
import { MAX_NOTE_CHARS, type StructuredNote } from "@/lib/structured-note";

const SAMPLE_RESULTS = rawSampleResults as unknown as Record<string, StructuredNote>;

const REQUEST_TIMEOUT_MS = 60_000;

const noteText = ref("");
const status = ref<"idle" | "loading" | "done" | "error">("idle");
const result = ref<StructuredNote | null>(null);
const errorMessage = ref("");
const resultSource = ref<"sample" | "live" | null>(null);

const charCount = computed(() => noteText.value.length);
const overLimit = computed(() => charCount.value > MAX_NOTE_CHARS);
const canSubmit = computed(
	() => noteText.value.trim().length > 0 && !overLimit.value && status.value !== "loading",
);

function loadSample(id: string) {
	const sample = SAMPLE_NOTES.find((s) => s.id === id);
	if (sample) noteText.value = sample.text;
}

function clearAll() {
	noteText.value = "";
	status.value = "idle";
	result.value = null;
	errorMessage.value = "";
	resultSource.value = null;
}

async function structureNote() {
	if (!canSubmit.value) return;

	// Unmodified bundled samples render their pre-generated result instantly -
	// no API call, no cost.
	const trimmed = noteText.value.trim();
	const sample = SAMPLE_NOTES.find((s) => s.text.trim() === trimmed);
	const bundled = sample ? SAMPLE_RESULTS[sample.id] : undefined;
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
		const response = await fetch("/api/structure-note", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ noteText: noteText.value }),
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
					: "Something went wrong structuring the note. Please try again.");
			status.value = "error";
			return;
		}

		if (body === null || typeof body !== "object") {
			errorMessage.value = "The server returned an unexpected response. Please try again.";
			status.value = "error";
			return;
		}

		result.value = body as StructuredNote;
		resultSource.value = "live";
		status.value = "done";
	} catch (error) {
		errorMessage.value =
			error instanceof DOMException && error.name === "AbortError"
				? "The request timed out. Please try again."
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

		<main class="project-main">
			<header class="project-header">
				<ProjectBreadcrumb current="Clinical Note Structurer" />
				<h1>Clinical Note Structurer</h1>
				<EvalBadge project-id="note-structurer" class="header-eval-badge" />
				<p class="intro">
					Paste a messy free-text visit note and watch it become structured, typed data -
					chief complaint, medications, vitals, follow-ups - in seconds. Under the hood, a
					Cloudflare Worker calls the Anthropic API with a forced tool-use schema, so the
					output is guaranteed-valid JSON rather than "hopefully JSON." This mirrors real
					telehealth engineering work I've done, rebuilt here from scratch with synthetic
					data.
				</p>
			</header>

			<Message severity="warn" :closable="false" class="phi-warning">
				This is a technical demo, not a medical tool, and it provides no medical advice. The
				sample notes are fully synthetic (fictional).
				<strong>Do not paste real patient information (PHI).</strong>
			</Message>

			<div class="project-grid">
				<section class="input-panel" aria-label="Note input">
					<h2>Visit note</h2>
					<p class="hint">Load a synthetic sample, or write your own:</p>
					<div class="sample-buttons">
						<Button
							v-for="sample in SAMPLE_NOTES"
							:key="sample.id"
							:label="sample.label"
							severity="secondary"
							outlined
							size="small"
							@click="loadSample(sample.id)"
						/>
					</div>

					<Textarea
						v-model="noteText"
						auto-resize
						rows="12"
						class="note-input"
						:maxlength="MAX_NOTE_CHARS"
						:invalid="overLimit"
						placeholder="Pt is a 58 y/o male here for f/u on HTN and T2DM..."
						aria-label="Free-text visit note"
					/>
					<div class="char-counter" :class="{ over: overLimit }">
						{{ charCount }} / {{ MAX_NOTE_CHARS }}
					</div>

					<div class="actions">
						<Button
							label="Structure this note"
							icon="fa-solid fa-wand-magic-sparkles"
							:disabled="!canSubmit"
							:loading="status === 'loading'"
							@click="structureNote"
						/>
						<Button
							label="Clear"
							severity="secondary"
							text
							:disabled="status === 'loading'"
							@click="clearAll"
						/>
					</div>
					<p class="cost-note">
						The three samples render instantly from pre-generated results - only custom
						or edited text calls the live API.
					</p>
				</section>

				<section class="results-panel" aria-label="Structured results" aria-live="polite">
					<h2>Structured result</h2>

					<StructuredNoteSkeleton v-if="status === 'loading'" />

					<Message v-else-if="status === 'error'" severity="error" :closable="false">
						{{ errorMessage }}
					</Message>

					<template v-else-if="status === 'done' && result">
						<p v-if="resultSource === 'sample'" class="source-note">
							<i class="fa-solid fa-bolt" aria-hidden="true"></i>
							Rendered from the bundled pre-generated result - zero API calls.
						</p>
						<StructuredNoteResults :result="result" />
					</template>

					<div v-else class="placeholder">
						<i class="fa-regular fa-file-lines" aria-hidden="true"></i>
						<p>Structured output will appear here.</p>
					</div>
				</section>
			</div>

			<Accordion class="details-accordion" :value="null">
				<AccordionPanel value="raw-json">
					<AccordionHeader>View raw JSON</AccordionHeader>
					<AccordionContent>
						<pre v-if="result" class="raw-json">{{
							JSON.stringify(result, null, 2)
						}}</pre>
						<p v-else class="empty">
							Structure a note first - the exact JSON returned by the extraction
							schema will appear here.
						</p>
					</AccordionContent>
				</AccordionPanel>
				<AccordionPanel value="architecture">
					<AccordionHeader>
						How this works &amp; HIPAA-safe architecture notes
					</AccordionHeader>
					<AccordionContent>
						<div class="architecture-notes">
							<p>
								This demo deliberately refuses real patient data. The bundled notes
								are fully synthetic, the UI warns against pasting PHI, and nothing
								typed here is stored. That's not an accident of scope - knowing
								where the PHI boundary sits, and never letting a project cross it, is
								the first thing healthcare engineering demands. Having built
								patient-facing telehealth systems professionally, I treat "can I use
								real data?" as a compliance question, never a convenience question.
							</p>
							<p>
								A production, HIPAA-eligible version of this pipeline would look
								meaningfully different: a Business Associate Agreement (BAA) with
								the AI vendor, zero-retention API configuration so prompts are never
								persisted, PHI redaction or de-identification before any third-party
								call, encryption in transit and at rest, audit logging of every
								access, and role-based access controls in front of it all. The
								extraction logic itself would barely change - the controls around it
								are the product.
							</p>
							<p>
								The structured output comes from tool use (function calling) rather
								than asking the model to "please respond in JSON." The API is given
								one tool whose input schema mirrors the TypeScript interface
								exactly, with tool choice forced and strict validation enabled - so
								the response is schema-validated before my code ever sees it. No
								regex extraction, no hoping the model didn't wrap the JSON in prose,
								and the types are shared between client and server so they can't
								drift.
							</p>
							<p>
								Cost and latency are designed in, not bolted on: the three sample
								notes ship with pre-generated results and never hit the API, live
								calls use a small fast model (Claude Haiku) behind a serverless
								proxy, input is capped at 4,000 characters on both client and
								server, and requests are rate-limited per IP. The API key lives only
								in a server-side secret - it never reaches the browser bundle.
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

.phi-warning {
	margin-bottom: 2rem;
}

.project-grid {
	display: grid;
	grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
	gap: 2rem;
	align-items: start;
}

.hint {
	color: #6b6a6d;
	margin-bottom: 0.6rem;
}

.sample-buttons {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-bottom: 0.75rem;
}

.note-input {
	width: 100%;
	font-family: inherit;
	line-height: 1.6;
}

.char-counter {
	text-align: right;
	font-size: 0.8rem;
	color: #9b9aa0;
	margin: 0.25rem 0 0.75rem;
}

.char-counter.over {
	color: #d32f2f;
	font-weight: 700;
}

.actions {
	display: flex;
	gap: 0.75rem;
	align-items: center;
}

.cost-note {
	margin-top: 0.75rem;
	font-size: 0.85rem;
	color: #9b9aa0;
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

	.project-grid {
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
html.dark .hint {
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
