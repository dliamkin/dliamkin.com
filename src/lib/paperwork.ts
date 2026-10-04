import type Anthropic from "@anthropic-ai/sdk";

// Shared between the Vue app, the Cloudflare Worker (worker/index.ts), and
// scripts/generate-paperwork-samples.mjs. Keep the TypeScript interfaces and
// the tool JSON schema below in 1:1 sync - the schema is what actually
// constrains the model's output.

// Enforced client-side AND server-side. A lease, scholarship letter, or
// policy summary fits comfortably; this cap exists purely to bound spend.
export const MAX_PAPERWORK_CHARS = 15_000;

// Photographed paper documents: up to 3 pages per request (multi-page
// letters), reusing the screenshot demo's client-side compression pipeline
// and per-image size limits (see ui-analysis.ts).
export const MAX_PAPERWORK_IMAGES = 3;

// A dense document tops out around ~20 events with excerpts - 4k covers that
// with headroom before extractToolInput's max_tokens truncation guard trips.
export const PAPERWORK_MAX_TOKENS = 4000;

export type EventCategory =
	| "deadline"
	| "notice_window_opens"
	| "notice_window_closes"
	| "payment"
	| "renewal_or_expiration"
	| "required_action"
	| "informational";

export const EVENT_CATEGORIES: EventCategory[] = [
	"deadline",
	"notice_window_opens",
	"notice_window_closes",
	"payment",
	"renewal_or_expiration",
	"required_action",
	"informational",
];

export interface RecurrenceRule {
	frequency: "weekly" | "monthly" | "yearly";
	day_of_month: number | null; // for monthly, e.g. 1 for "rent due on the 1st"
	description: string; // human-readable, e.g. "monthly on the 1st"
}

// The structured half of a computed or unresolved date: the model identifies
// WHAT math is needed (which anchor, which offset), and the arithmetic runs
// in tested code (paperwork-dates.ts) - server-side for computed dates
// (reconcileComputedDates overrides any model arithmetic slip) and client-
// side for unresolved ones once the visitor supplies the anchor. The model's
// own arithmetic is never the final word.
export interface DateResolution {
	anchor_label: string; // e.g. "policy start date"
	anchor_date: string | null; // the anchor's ISO date when the document
	// states it (computed dates); null when it's missing (unresolved dates)
	offset_days: number; // non-negative
	offset_months: number; // non-negative
	direction: "before" | "after"; // offset applied before or after the anchor
}

export interface ObligationEvent {
	id: string; // stable slug within this result
	title: string; // calendar-ready, e.g. "Lease non-renewal notice deadline"
	category: EventCategory;
	date: string | null; // ISO date (YYYY-MM-DD); null when unresolved
	date_basis: "stated" | "computed" | "unresolved";
	computation: string | null; // arithmetic shown, or what's needed to resolve
	resolution: DateResolution | null; // structured need; only when unresolved
	recurrence: RecurrenceRule | null;
	in_past: boolean;
	source_excerpt: string; // exact quote this event came from
	details: string; // 1-2 sentences for the event body
	suggested_reminder_days: number; // lead time before the date
	stakes: "high" | "medium" | "low";
}

export interface ObligationExtraction {
	is_obligation_document: boolean;
	reason: string | null; // when false
	document_label: string | null; // e.g. "Residential lease agreement"
	anchor_dates: { label: string; date: string }[]; // e.g. lease start/end found in doc
	events: ObligationEvent[];
	ambiguities: string[]; // things the model declined to guess
}

// {TODAY} is substituted by the pipeline (extract-obligations.ts) with the
// server's UTC date - date arithmetic needs an anchor for "past deadline"
// detection and relative expressions.
export const EXTRACT_OBLIGATIONS_SYSTEM_PROMPT = `You are an obligation-extraction engine inside a technical demo. Today's date is {TODAY}. You receive a document as text or as photographed pages. First decide whether it is a document containing obligations, deadlines, or scheduled commitments; if not, set is_obligation_document to false with a one-sentence reason and stop. Otherwise extract every dated or datable obligation: deadlines, notice windows (extract BOTH the window-opens and window-closes dates when computable), renewal and expiration dates, recurring payments, required actions. For each event, quote the exact source excerpt it came from. Date rules - these are strict: if the document states an explicit date, use it with date_basis: "stated". If a date must be computed from an anchor plus an offset (e.g. "60 days before the lease end date") and the anchor is present in the document, compute it, set date_basis: "computed", show your arithmetic in computation (e.g. "2026-08-31 minus 60 days = 2026-07-02"), and fill resolution with the anchor's label, the anchor's ISO date from the document, and the offset as numbers - the application re-runs that arithmetic in code and corrects any slip. If the anchor is missing or ambiguous, set date: null, date_basis: "unresolved", state in computation exactly what date is needed and the offset to apply (e.g. "needs: policy start date; then add 6 months"), and fill resolution with the anchor's label, anchor_date: null, and the offset - the application runs the arithmetic in code once the reader supplies the anchor. Leave resolution null only when a date is stated outright or a computed date has no single anchor-plus-offset derivation (e.g. the next occurrence of a recurring payment). When computing a date, count actual calendar days carefully - mind each month's true length and leap years (February has 29 days in leap years such as 2028) - and verify the arithmetic in your computation string before recording it. Never guess a date. Never invent obligations not in the document. Mark events whose dates are already in the past with in_past: true. For recurring obligations, extract the recurrence pattern rather than expanding instances, and set date to the first upcoming occurrence on or after today when the pattern makes it directly computable (e.g. monthly on the 1st), with date_basis: "computed". Suggest a reminder lead time per event based on stakes: long-notice items (lease non-renewal, contract cancellation windows) get 14 days, payments and filings get 3-7 days, informational dates get 1 day. Ignore and never transcribe personal identifiers (names, account numbers, SSNs) - refer to parties generically. Do not advise the reader what to do; describe what the document requires.`;

// Mirrors ObligationExtraction 1:1. `strict: true` plus
// additionalProperties: false means the API validates the model's output
// against this schema before it ever reaches us.
export const EXTRACT_OBLIGATIONS_TOOL: Anthropic.Tool = {
	name: "record_obligations",
	description:
		"Record the structured extraction of a document's obligations: whether it is an obligation-bearing document and, if so, every deadline, notice window, renewal, recurring payment, and required action with its date provenance.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			is_obligation_document: { type: "boolean" },
			reason: {
				type: ["string", "null"],
				description:
					"One polite sentence explaining why the input is not an obligation-bearing document; null when it is one",
			},
			document_label: {
				type: ["string", "null"],
				description: 'Short label for the document, e.g. "Residential lease agreement"',
			},
			anchor_dates: {
				type: "array",
				items: {
					type: "object",
					properties: {
						label: { type: "string" },
						date: { type: "string", description: "ISO date (YYYY-MM-DD)" },
					},
					required: ["label", "date"],
					additionalProperties: false,
				},
				description: "Key dates stated in the document, e.g. lease start and end",
			},
			events: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "Stable kebab-case slug unique within this result",
						},
						title: {
							type: "string",
							description:
								'Calendar-ready title, e.g. "Lease non-renewal notice deadline"',
						},
						category: { type: "string", enum: EVENT_CATEGORIES },
						date: {
							type: ["string", "null"],
							description: "ISO date (YYYY-MM-DD); null when unresolved",
						},
						date_basis: {
							type: "string",
							enum: ["stated", "computed", "unresolved"],
						},
						computation: {
							type: ["string", "null"],
							description:
								"For computed dates the arithmetic shown; for unresolved dates what is needed; null for stated dates",
						},
						resolution: {
							type: ["object", "null"],
							properties: {
								anchor_label: {
									type: "string",
									description: 'The anchor, e.g. "policy start date"',
								},
								anchor_date: {
									type: ["string", "null"],
									description:
										"The anchor's ISO date (YYYY-MM-DD) when the document states it (computed dates); null when it is missing (unresolved dates)",
								},
								offset_days: { type: "number", description: "Non-negative integer" },
								offset_months: {
									type: "number",
									description: "Non-negative integer",
								},
								direction: { type: "string", enum: ["before", "after"] },
							},
							required: [
								"anchor_label",
								"anchor_date",
								"offset_days",
								"offset_months",
								"direction",
							],
							additionalProperties: false,
							description:
								"Structured anchor-plus-offset for computed and unresolved dates so the application can run (or re-run) the arithmetic in code; null for stated dates and pattern-derived recurring dates",
						},
						recurrence: {
							type: ["object", "null"],
							properties: {
								frequency: { type: "string", enum: ["weekly", "monthly", "yearly"] },
								day_of_month: {
									type: ["number", "null"],
									description: 'For monthly, e.g. 1 for "rent due on the 1st"',
								},
								description: {
									type: "string",
									description: 'Human-readable, e.g. "monthly on the 1st"',
								},
							},
							required: ["frequency", "day_of_month", "description"],
							additionalProperties: false,
						},
						in_past: { type: "boolean" },
						source_excerpt: {
							type: "string",
							description: "Exact quote from the document this event came from",
						},
						details: {
							type: "string",
							description: "1-2 sentences for the calendar event body",
						},
						suggested_reminder_days: {
							type: "number",
							description: "Reminder lead time in days before the date",
						},
						stakes: { type: "string", enum: ["high", "medium", "low"] },
					},
					required: [
						"id",
						"title",
						"category",
						"date",
						"date_basis",
						"computation",
						"resolution",
						"recurrence",
						"in_past",
						"source_excerpt",
						"details",
						"suggested_reminder_days",
						"stakes",
					],
					additionalProperties: false,
				},
			},
			ambiguities: {
				type: "array",
				items: { type: "string" },
				description: "Things the model declined to guess",
			},
		},
		required: [
			"is_obligation_document",
			"reason",
			"document_label",
			"anchor_dates",
			"events",
			"ambiguities",
		],
		additionalProperties: false,
	},
};
