<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import DatePicker from "primevue/datepicker";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Tag from "primevue/tag";
import ToggleSwitch from "primevue/toggleswitch";
import { useToast } from "primevue/usetoast";
import { buildIcs, buildRrule, googleCalendarUrl, type IcsEvent } from "@/lib/ics";
import {
	describeResolution,
	formatOffset,
	isPast,
	resolveDate,
} from "@/lib/paperwork-dates";
import type { ObligationEvent, ObligationExtraction } from "@/lib/paperwork";

// The review-and-edit step: nothing goes on a calendar un-reviewed. The
// visitor resolves unresolved dates (deterministic arithmetic in
// paperwork-dates.ts - the model only identified what math was needed),
// toggles events, edits titles and reminder lead times, then exports a
// client-side .ics. The export never round-trips through a server.

const props = defineProps<{
	extraction: ObligationExtraction;
	todayIso: string; // the "today" the extraction was produced against
}>();

const toast = useToast();

const NOT_ADVICE_LINE =
	"Automated extraction for demonstration - verify every date against your document. Not legal or financial advice.";

type ReviewBasis = "stated" | "computed" | "unresolved" | "computed_from_input";

interface ReviewEvent {
	source: ObligationEvent;
	included: boolean;
	title: string;
	date: string | null;
	basis: ReviewBasis;
	computation: string | null;
	reminderDays: number;
	recurring: boolean; // export as RRULE vs single next occurrence
	expanded: boolean;
	anchorInput: Date | null; // resolve-panel date picker model
}

const REMINDER_OPTIONS = [1, 3, 7, 14, 30].map((days) => ({
	label: `${days} day${days === 1 ? "" : "s"} before`,
	value: days,
}));

function toReviewEvent(event: ObligationEvent): ReviewEvent {
	return {
		source: event,
		// Dateless (unresolved), already-passed, and informational events
		// default off - they'd pollute the calendar; resolving or re-checking
		// includes them.
		included: event.date !== null && !event.in_past && event.category !== "informational",
		title: event.title,
		date: event.date,
		basis: event.date_basis,
		computation: event.computation,
		reminderDays: normalizeReminder(event.suggested_reminder_days),
		recurring: event.recurrence !== null,
		expanded: false,
		anchorInput: null,
	};
}

function normalizeReminder(days: number): number {
	// Snap the model's suggestion onto the editable options.
	return REMINDER_OPTIONS.reduce(
		(best, option) =>
			Math.abs(option.value - days) < Math.abs(best - days) ? option.value : best,
		REMINDER_OPTIONS[0]!.value,
	);
}

const events = reactive<ReviewEvent[]>(props.extraction.events.map(toReviewEvent));
watch(
	() => props.extraction,
	(extraction) => {
		events.splice(0, events.length, ...extraction.events.map(toReviewEvent));
		showPast.value = false;
	},
);

const showPast = ref(false);

const upcoming = computed(() => events.filter((e) => !e.source.in_past));
const past = computed(() => events.filter((e) => e.source.in_past));
const unresolved = computed(() => events.filter((e) => e.basis === "unresolved"));

// Checked events float to the top (soonest first); unchecked and unresolved
// ones sink below so the list reads as "what's going on the calendar".
// The TransitionGroup in the template animates the move.
const sortedUpcoming = computed(() => {
	const byDate = (a: ReviewEvent, b: ReviewEvent) =>
		(a.date ?? "9999-99-99") < (b.date ?? "9999-99-99") ? -1 : 1;
	const checked = upcoming.value.filter((e) => e.included).sort(byDate);
	const unchecked = upcoming.value.filter((e) => !e.included).sort(byDate);
	return [...checked, ...unchecked];
});

const selected = computed(() =>
	events.filter((e) => e.included && e.date !== null && e.basis !== "unresolved"),
);

const nextUp = computed(() => {
	const future = selected.value
		.filter((e) => e.date !== null && !isPast(e.date, props.todayIso))
		.sort((a, b) => (a.date! < b.date! ? -1 : 1));
	return future[0] ?? null;
});

// --- Resolve-flow -----------------------------------------------------------

// Plain-language question and consequence for each unresolved date, built
// from the structured resolution the model returned.
function resolveQuestion(event: ReviewEvent): string {
	return event.source.resolution
		? `When is the ${event.source.resolution.anchor_label}?`
		: "What date should this be?";
}

function resolveConsequence(event: ReviewEvent): string {
	const res = event.source.resolution;
	if (!res) return "The date you pick becomes this event's date.";
	if (res.offset_days === 0 && res.offset_months === 0) {
		return "This event lands on the date you pick.";
	}
	return `We'll count ${formatOffset(res)} ${res.direction} the date you pick - calculated in your browser, never guessed.`;
}

// DatePicker yields a local-time Date; format via local parts (not
// toISOString, which can shift the day across the UTC boundary).
function pickedToIso(picked: Date): string {
	const y = picked.getFullYear();
	const m = String(picked.getMonth() + 1).padStart(2, "0");
	const d = String(picked.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function applyAnchor(event: ReviewEvent) {
	if (!event.anchorInput) return;
	const anchorIso = pickedToIso(event.anchorInput);
	if (event.source.resolution) {
		// The model identified the offset; the arithmetic runs here, in code.
		event.date = resolveDate(anchorIso, event.source.resolution);
		event.computation = describeResolution(anchorIso, event.source.resolution);
	} else {
		// No structured offset - the picked date IS the event date.
		event.date = anchorIso;
		event.computation = "date supplied directly by you";
	}
	event.basis = "computed_from_input";
	if (!event.source.in_past && event.source.category !== "informational") {
		event.included = true;
	}
}

function basisTag(event: ReviewEvent): { label: string; severity: string; tooltip: string } {
	switch (event.basis) {
		case "stated":
			return {
				label: "in the document",
				severity: "success",
				tooltip: "This date is written in the document.",
			};
		case "computed":
			return {
				label: "calculated",
				severity: "info",
				tooltip: event.computation ?? "Calculated from an anchor date in the document.",
			};
		case "computed_from_input":
			return {
				label: "from your date",
				severity: "info",
				tooltip: event.computation ?? "Calculated from the date you supplied.",
			};
		case "unresolved":
			return {
				label: "needs your input",
				severity: "warn",
				tooltip:
					event.computation ??
					"The document doesn't contain the date needed to place this.",
			};
	}
}

const CATEGORY_LABELS: Record<ObligationEvent["category"], string> = {
	deadline: "deadline",
	notice_window_opens: "notice window opens",
	notice_window_closes: "notice window closes",
	payment: "payment",
	renewal_or_expiration: "renewal / expiration",
	required_action: "required action",
	informational: "informational",
};

// --- Export -----------------------------------------------------------------

function toIcsEvent(event: ReviewEvent): IcsEvent {
	const reminderLine = `Reminder set for ${event.reminderDays} day${event.reminderDays === 1 ? "" : "s"} before.`;
	return {
		id: event.source.id,
		uidSeed: event.source.source_excerpt,
		summary: event.title,
		description: [
			event.source.details,
			`Source: "${event.source.source_excerpt}"`,
			reminderLine,
			NOT_ADVICE_LINE,
		].join("\n"),
		date: event.date!,
		rrule:
			event.recurring && event.source.recurrence
				? buildRrule(event.source.recurrence)
				: null,
		reminderDaysBefore: event.reminderDays,
	};
}

const calendarName = computed(() => props.extraction.document_label ?? "Paperwork deadlines");

function downloadIcs() {
	const ics = buildIcs(selected.value.map(toIcsEvent), {
		calendarName: calendarName.value,
	});
	const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${(props.extraction.document_label ?? "paperwork").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-events.ics`;
	link.click();
	URL.revokeObjectURL(url);
}

async function copyAsText() {
	const lines = selected.value
		.slice()
		.sort((a, b) => (a.date! < b.date! ? -1 : 1))
		.map((e) => {
			const recurring =
				e.recurring && e.source.recurrence ? ` (${e.source.recurrence.description})` : "";
			return `${e.date} - ${e.title}${recurring} - reminder ${e.reminderDays} day${e.reminderDays === 1 ? "" : "s"} before`;
		});
	try {
		await navigator.clipboard.writeText(lines.join("\n"));
		toast.add({
			severity: "success",
			summary: "Copied",
			detail: `${lines.length} event${lines.length === 1 ? "" : "s"} copied as text.`,
			life: 3000,
		});
	} catch {
		toast.add({
			severity: "error",
			summary: "Couldn't copy",
			detail: "Your browser blocked clipboard access.",
			life: 4000,
		});
	}
}

function googleLink(event: ReviewEvent): string {
	return googleCalendarUrl(toIcsEvent(event));
}
</script>

<template>
	<div class="review-panel">
		<p class="not-advice">
			<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
			Automated extraction for demonstration - verify every date against your document.
			Not legal or financial advice.
		</p>

		<div class="doc-line">
			<span v-if="extraction.document_label" class="doc-label">
				{{ extraction.document_label }}
			</span>
			<span
				v-for="anchor in extraction.anchor_dates"
				:key="anchor.label"
				class="anchor-chip"
			>
				{{ anchor.label }}: <strong>{{ anchor.date }}</strong>
			</span>
		</div>

		<div v-if="unresolved.length > 0" class="resolve-panel">
			<div class="resolve-head">
				<i class="fa-regular fa-circle-question" aria-hidden="true"></i>
				<div>
					<p class="resolve-title">
						{{ unresolved.length === 1 ? "One date" : `${unresolved.length} dates` }}
						need{{ unresolved.length === 1 ? "s" : "" }} a detail from you
					</p>
					<p class="resolve-sub">
						The document mentions {{ unresolved.length === 1 ? "a date" : "dates" }} it
						never pins down. Fill in what you know - nothing here is guessed.
					</p>
				</div>
			</div>
			<div v-for="event in unresolved" :key="event.source.id" class="resolve-row">
				<div class="resolve-info">
					<strong>{{ event.title }}</strong>
					<span class="resolve-question">{{ resolveQuestion(event) }}</span>
					<span class="resolve-consequence">{{ resolveConsequence(event) }}</span>
				</div>
				<div class="resolve-input">
					<DatePicker
						v-model="event.anchorInput"
						placeholder="Pick a date"
						date-format="yy-mm-dd"
						show-icon
						icon-display="input"
					/>
					<Button
						label="Set date"
						size="small"
						:disabled="!event.anchorInput"
						@click="applyAnchor(event)"
					/>
				</div>
			</div>
		</div>

		<TransitionGroup name="rows" tag="ul" class="event-list" aria-label="Extracted events">
			<li
				v-for="event in sortedUpcoming"
				:key="event.source.id"
				class="event-row"
				:class="{ excluded: !event.included }"
			>
				<div class="row-main">
					<Checkbox
						v-model="event.included"
						binary
						:disabled="event.date === null"
						:aria-label="`Include ${event.title}`"
					/>
					<div class="row-fields">
						<div class="row-top">
							<InputText
								v-model="event.title"
								class="title-input"
								:aria-label="`Title for ${event.source.title}`"
							/>
							<button
								type="button"
								class="expand-toggle"
								:aria-expanded="event.expanded"
								@click="event.expanded = !event.expanded"
							>
								<i
									:class="
										event.expanded
											? 'fa-solid fa-chevron-up'
											: 'fa-solid fa-chevron-down'
									"
									aria-hidden="true"
								></i>
								<span class="visually-hidden">Toggle details</span>
							</button>
						</div>
						<div class="row-meta">
							<span class="event-date" :class="{ missing: event.date === null }">
								{{ event.date ?? "no date yet" }}
							</span>
							<Tag
								v-tooltip.top="basisTag(event).tooltip"
								:value="basisTag(event).label"
								:severity="basisTag(event).severity"
								class="basis-tag"
							/>
							<span class="meta-text">{{
								CATEGORY_LABELS[event.source.category]
							}}</span>
							<Tag
								v-if="event.source.stakes === 'high'"
								value="high stakes"
								severity="danger"
								class="stakes-tag"
							/>
							<span v-if="event.source.recurrence" class="meta-text recurring">
								<i class="fa-solid fa-repeat" aria-hidden="true"></i>
								{{ event.source.recurrence.description }}
							</span>
							<Select
								v-model="event.reminderDays"
								:options="REMINDER_OPTIONS"
								option-label="label"
								option-value="value"
								class="reminder-select"
								:aria-label="`Reminder lead time for ${event.title}`"
							/>
						</div>
					</div>
				</div>
				<div v-if="event.expanded" class="row-expansion">
					<blockquote class="source-excerpt">
						“{{ event.source.source_excerpt }}”
					</blockquote>
					<p class="event-details">{{ event.source.details }}</p>
					<p v-if="event.computation" class="event-computation">
						<i class="fa-solid fa-calculator" aria-hidden="true"></i>
						{{ event.computation }}
					</p>
					<div class="expansion-actions">
						<label v-if="event.source.recurrence" class="recurring-toggle">
							<ToggleSwitch v-model="event.recurring" />
							<span>{{
								event.recurring
									? "Recurring event (repeats in your calendar)"
									: "Single event (next occurrence only)"
							}}</span>
						</label>
						<a
							v-if="event.date"
							:href="googleLink(event)"
							target="_blank"
							rel="noopener noreferrer"
							class="google-link"
						>
							<i class="fa-brands fa-google" aria-hidden="true"></i>
							Add to Google Calendar
						</a>
					</div>
				</div>
			</li>
		</TransitionGroup>

		<details v-if="past.length > 0" class="past-section" :open="showPast">
			<summary @click.prevent="showPast = !showPast">
				<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
				Already passed ({{ past.length }}) - excluded from the export by default
			</summary>
			<ul class="event-list">
				<li
					v-for="event in past"
					:key="event.source.id"
					class="event-row past"
					:class="{ excluded: !event.included }"
				>
					<div class="row-main">
						<Checkbox
							v-model="event.included"
							binary
							:aria-label="`Include ${event.title}`"
						/>
						<div class="row-fields">
							<div class="row-top">
								<span class="past-title">{{ event.title }}</span>
							</div>
							<div class="row-meta">
								<span class="event-date overdue">
									<i
										class="fa-solid fa-triangle-exclamation"
										aria-hidden="true"
									></i>
									{{ event.date }}
								</span>
								<span class="meta-text">{{
									CATEGORY_LABELS[event.source.category]
								}}</span>
								<span class="past-note">already passed</span>
							</div>
						</div>
					</div>
				</li>
			</ul>
		</details>

		<div v-if="extraction.ambiguities.length > 0" class="ambiguities">
			<p class="ambiguities-title">
				<i class="fa-solid fa-circle-question" aria-hidden="true"></i>
				The model declined to guess:
			</p>
			<ul>
				<li v-for="(item, index) in extraction.ambiguities" :key="index">{{ item }}</li>
			</ul>
		</div>

		<div class="summary-bar">
			<div class="summary-info">
				<strong>{{ selected.length }}</strong>
				event{{ selected.length === 1 ? "" : "s" }} selected
				<span v-if="nextUp" class="next-up">
					· next up: {{ nextUp.title }} on {{ nextUp.date }}
				</span>
			</div>
			<div class="summary-actions">
				<Button
					label="Download calendar (.ics)"
					icon="fa-solid fa-calendar-plus"
					:disabled="selected.length === 0"
					@click="downloadIcs"
				/>
				<Button
					label="Copy as text"
					icon="fa-regular fa-copy"
					severity="secondary"
					outlined
					:disabled="selected.length === 0"
					@click="copyAsText"
				/>
			</div>
		</div>

		<details class="ics-help">
			<summary>
				<i class="fa-regular fa-circle-question" aria-hidden="true"></i>
				What's an .ics file, and how do I get these onto my calendar?
			</summary>
			<div class="ics-help-body">
				<p>
					An .ics file is the standard format calendar apps use to exchange events -
					every major calendar can import it. Download it above, then:
				</p>
				<ul>
					<li>
						<strong>Google Calendar:</strong> open
						<a
							href="https://calendar.google.com"
							target="_blank"
							rel="noopener noreferrer"
							>Google Calendar</a
						>
						in a browser, click the gear icon (Settings) →
						<em>Import &amp; export</em> → <em>Select file from your computer</em>.
					</li>
					<li>
						<strong>Apple Calendar:</strong> open the app, go to
						<em>File → Import</em>, and select the .ics file. On iPhone, open the
						file from Files or Mail and tap <em>Add All</em>.
					</li>
					<li>
						<strong>Outlook (web):</strong> go to Outlook.com, open the Calendar
						view, click <em>Add calendar</em> → <em>Upload from file</em>.
					</li>
				</ul>
				<p>
					Prefer one event at a time? Expand any event above and use its
					<em>Add to Google Calendar</em> link - no file needed. If you edit events
					here and download again, re-importing the new file updates your calendar
					instead of creating duplicates.
				</p>
			</div>
		</details>

		<p class="export-note">
			The calendar file is generated entirely in your browser from the reviewed events
			above - it never touches a server.
		</p>
	</div>
</template>

<style scoped>
.review-panel {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.not-advice {
	font-size: 0.85rem;
	font-weight: 700;
	color: #8a5a00;
	background: #fdf0d7;
	border: 1px solid #ecd7a3;
	border-radius: 6px;
	padding: 0.5rem 0.75rem;
}

.not-advice i {
	margin-right: 0.4rem;
}

.doc-line {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.doc-label {
	font-weight: 700;
	font-size: 1.05rem;
}

.anchor-chip {
	font-size: 0.8rem;
	color: #6b6a6d;
	background: #f2f4f6;
	border-radius: 999px;
	padding: 0.2rem 0.65rem;
}

.resolve-panel {
	border: 1px solid #ecd7a3;
	border-left: 4px solid #e0a92e;
	background: #fefaf0;
	border-radius: 8px;
	padding: 1rem 1.15rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.resolve-head {
	display: flex;
	align-items: flex-start;
	gap: 0.75rem;
}

.resolve-head > i {
	font-size: 1.4rem;
	color: #e0a92e;
	margin-top: 0.15rem;
}

.resolve-title {
	font-weight: 700;
	font-size: 1rem;
	color: #414042;
}

.resolve-sub {
	font-size: 0.85rem;
	color: #6b6a6d;
}

.resolve-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.75rem 0 0.25rem;
	margin-top: 0.5rem;
	border-top: 1px solid rgba(224, 169, 46, 0.25);
}

.resolve-info {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	min-width: 240px;
	flex: 1;
}

.resolve-info strong {
	font-size: 0.92rem;
}

.resolve-question {
	font-size: 0.9rem;
	color: #414042;
}

.resolve-consequence {
	font-size: 0.8rem;
	color: #9b9aa0;
}

.resolve-input {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.event-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	position: relative;
}

.rows-move {
	transition: transform 0.35s ease;
}

.event-row {
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 8px;
	padding: 0.7rem 0.9rem;
	background: #fff;
	transition: opacity 0.15s ease;
}

.event-row.excluded {
	opacity: 0.55;
	background: #fafafa;
}

.event-row.past {
	background: #fbf7f7;
}

.row-main {
	display: flex;
	align-items: flex-start;
	gap: 0.75rem;
}

.row-fields {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.row-top {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

/* The title reads as text until you interact with it - a visible input box
   on every row was the single biggest source of visual noise. */
.title-input {
	flex: 1;
	font-weight: 600;
	font-size: 0.92rem;
	border-color: transparent;
	background: transparent;
	box-shadow: none;
	padding-left: 0.25rem;
}

.title-input:hover {
	border-color: rgba(0, 0, 0, 0.18);
}

.title-input:focus {
	border-color: #27a9e0;
	background: #fff;
}

.past-title {
	font-weight: 600;
	font-size: 0.92rem;
}

.expand-toggle {
	border: none;
	background: none;
	cursor: pointer;
	color: #6b6a6d;
	padding: 0.35rem;
	border-radius: 4px;
}

.expand-toggle:hover {
	background: #f2f4f6;
}

.visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
}

.row-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem 0.65rem;
	padding-left: 0.25rem;
}

.event-date {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	font-size: 0.9rem;
}

.event-date.missing {
	color: #b98a1d;
	font-weight: 600;
	font-style: italic;
}

.event-date.overdue {
	color: #c0392b;
}

.event-date.overdue i {
	margin-right: 0.3rem;
}

/* Soft, quiet tag treatment - one accent per row at most. */
.basis-tag,
.stakes-tag {
	text-transform: none;
	font-size: 0.72rem;
	font-weight: 600;
	padding: 0.15rem 0.5rem;
}

.meta-text {
	font-size: 0.8rem;
	color: #9b9aa0;
}

.meta-text.recurring {
	max-width: 260px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.meta-text.recurring i {
	margin-right: 0.25rem;
	font-size: 0.7rem;
}

.reminder-select {
	margin-left: auto;
	font-size: 0.82rem;
}

.row-expansion {
	margin-top: 0.7rem;
	padding-top: 0.7rem;
	border-top: 1px dashed rgba(0, 0, 0, 0.12);
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.source-excerpt {
	margin: 0;
	padding: 0.5rem 0.85rem;
	border-left: 3px solid #27a9e0;
	background: #f4fafd;
	font-style: italic;
	font-size: 0.88rem;
	color: #414042;
}

.event-details {
	font-size: 0.88rem;
	color: #6b6a6d;
}

.event-computation {
	font-size: 0.85rem;
	color: #1a6d94;
	font-variant-numeric: tabular-nums;
}

.event-computation i {
	margin-right: 0.35rem;
}

.expansion-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.recurring-toggle {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.85rem;
	cursor: pointer;
}

.google-link {
	font-size: 0.85rem;
	font-weight: 600;
	color: #27a9e0;
	text-decoration: none;
}

.google-link:hover {
	text-decoration: underline;
}

.google-link i {
	margin-right: 0.3rem;
}

.past-section summary {
	cursor: pointer;
	font-size: 0.9rem;
	font-weight: 600;
	color: #8a5a00;
	padding: 0.5rem 0;
}

.past-section summary i {
	margin-right: 0.4rem;
}

.past-section .event-list {
	margin-top: 0.6rem;
}

.past-note {
	font-size: 0.8rem;
	color: #c0392b;
	font-weight: 600;
}

.ambiguities {
	font-size: 0.88rem;
	color: #6b6a6d;
	background: #f8f9fa;
	border-radius: 8px;
	padding: 0.75rem 1rem;
}

.ambiguities-title {
	font-weight: 700;
	margin-bottom: 0.35rem;
}

.ambiguities ul {
	margin: 0;
	padding-left: 1.2rem;
}

.summary-bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	border: 1px solid rgba(39, 169, 224, 0.35);
	/* Solid fill - the bar is sticky and floats over event rows while
	   scrolling, so any transparency lets row content bleed through. */
	background: #eef8fd;
	border-radius: 8px;
	padding: 0.85rem 1rem;
	position: sticky;
	bottom: 0.75rem;
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}

.summary-info {
	font-size: 0.92rem;
}

.next-up {
	color: #6b6a6d;
	font-size: 0.85rem;
}

.summary-actions {
	display: flex;
	gap: 0.6rem;
}

.ics-help summary {
	cursor: pointer;
	font-size: 0.9rem;
	font-weight: 600;
	color: #414042;
	padding: 0.35rem 0;
}

.ics-help summary i {
	color: #27a9e0;
	margin-right: 0.4rem;
}

.ics-help-body {
	font-size: 0.88rem;
	color: #6b6a6d;
	line-height: 1.65;
	padding: 0.5rem 0.25rem 0.25rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.ics-help-body ul {
	margin: 0;
	padding-left: 1.2rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.ics-help-body a {
	color: #27a9e0;
}

.export-note {
	font-size: 0.82rem;
	color: #9b9aa0;
}

@media (max-width: 700px) {
	.reminder-select {
		margin-left: 0;
	}

	.summary-bar {
		position: static;
	}
}

html.dark .not-advice {
	color: #ffd28a;
	background: rgba(224, 169, 46, 0.12);
	border-color: rgba(224, 169, 46, 0.35);
}

html.dark .anchor-chip {
	color: var(--dm-text-2);
	background: var(--dm-bg-mute);
}

html.dark .resolve-panel {
	background: rgba(224, 169, 46, 0.08);
	border-color: rgba(224, 169, 46, 0.3);
	border-left-color: #e0a92e;
}

html.dark .resolve-title {
	color: var(--dm-text-1);
}

html.dark .resolve-sub,
html.dark .resolve-question {
	color: var(--dm-text-2);
}

html.dark .resolve-consequence {
	color: var(--dm-text-3);
}

html.dark .event-row {
	background: var(--dm-bg-soft);
	border-color: rgba(255, 255, 255, 0.12);
}

html.dark .event-row.excluded {
	background: var(--dm-bg);
}

html.dark .event-row.past {
	background: rgba(255, 107, 107, 0.06);
}

html.dark .title-input:hover {
	border-color: rgba(255, 255, 255, 0.25);
}

html.dark .title-input:focus {
	border-color: #27a9e0;
	background: var(--dm-bg);
}

html.dark .expand-toggle {
	color: var(--dm-text-2);
}

html.dark .expand-toggle:hover {
	background: var(--dm-bg-mute);
}

html.dark .event-date.missing {
	color: #e3b341;
}

html.dark .event-date.overdue {
	color: #ff7b6e;
}

html.dark .meta-text,
html.dark .resolve-consequence,
html.dark .export-note {
	color: var(--dm-text-3);
}

html.dark .row-expansion {
	border-top-color: rgba(255, 255, 255, 0.15);
}

html.dark .source-excerpt {
	background: rgba(39, 169, 224, 0.1);
	color: var(--dm-text-2);
}

html.dark .event-details,
html.dark .next-up,
html.dark .ambiguities,
html.dark .ics-help-body {
	color: var(--dm-text-2);
}

html.dark .event-computation {
	color: var(--dm-blue-soft);
}

html.dark .past-section summary {
	color: #e3b341;
}

html.dark .past-note {
	color: #ff8f8f;
}

html.dark .ambiguities {
	background: var(--dm-bg-soft);
}

/* Still a solid fill for the same bleed-through reason - just a dark one. */
html.dark .summary-bar {
	background: #14242e;
	border-color: rgba(39, 169, 224, 0.4);
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}

html.dark .ics-help summary {
	color: var(--dm-text-1);
}
</style>
