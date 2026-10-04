import type Anthropic from "@anthropic-ai/sdk";

// Shared between the nightly CI pipeline (scripts/site-health/) and the
// SiteHealthWidget component. Keep the TypeScript interfaces and the tool
// JSON schema below in 1:1 sync - the schema is what actually constrains the
// model's output. Unlike the demos, the model call here happens in CI only:
// the site just fetches the committed JSON, so nothing in this file may pull
// in runtime code (the Anthropic import is type-only).

export const SITE_ORIGIN = "https://dliamkin.com";

// Every route in src/router/index.ts - the spec caps the audit at 5 pages and
// the router has exactly 5. Keep in sync with the router when adding routes.
export const AUDIT_PAGES = [
	{ path: "/", label: "Home" },
	{ path: "/about", label: "About" },
	{ path: "/projects", label: "Projects index" },
	{ path: "/projects/note-structurer", label: "Note Structurer" },
	{ path: "/projects/screenshot-to-primevue", label: "Screenshot to PrimeVue" },
] as const;

// One vision call per day, so judgment quality matters more than cost -
// Sonnet rather than Haiku. claude-haiku-4-5 is the cheap fallback if the
// nightly spend ever needs trimming.
export const AUDIT_MODEL = "claude-sonnet-4-6";

export const AUDIT_MAX_TOKENS = 4000;

// Screenshot capture sizes and the downscale limit applied before the images
// are sent to the model (JPEG, longest edge capped - full-page captures can
// be very tall, and the model gains nothing beyond its native resolution).
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const MAX_SCREENSHOT_EDGE_PX = 1400;

export const HEALTH_STATUSES = ["healthy", "warnings", "regression", "audit_error"] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface PageAudit {
	path: string; // e.g. "/projects/note-structurer"
	lighthouse: {
		performance: number; // 0-100
		accessibility: number;
		best_practices: number;
		seo: number;
		lcp_ms: number | null;
		cls: number | null;
		tbt_ms: number | null;
	};
	visual_findings: string[]; // empty when the page looks right
	visual_fingerprint: string; // one sentence: what "correct" looks like tonight
}

export interface HealthReport {
	audited_at: string; // ISO timestamp
	status: HealthStatus;
	summary: string; // 1-2 sentences, public-facing
	pages: PageAudit[];
	score_deltas: string[]; // e.g. "Home performance 96 → 91 (within jitter)"
	top_fix: string | null;
	should_file_issue: boolean;
	issue_title: string | null;
	issue_body: string | null; // markdown
	issue_fingerprint: string | null; // stable slug for dedupe, e.g. "mobile-overflow-demos-index"
	error_reason: string | null; // populated only when status is "audit_error"
}

// Trimmed per-night entry appended to history.json (capped at 90 entries) -
// enough for the widget's score sparkline without keeping findings around.
export interface HealthHistoryEntry {
	audited_at: string;
	status: HealthStatus;
	scores: {
		performance: number;
		accessibility: number;
		best_practices: number;
		seo: number;
	}; // averages across audited pages, rounded
}

export const HISTORY_MAX_ENTRIES = 90;

export const AUDIT_SYSTEM_PROMPT = `You are the nightly maintenance auditor for a developer's portfolio site. You receive: current screenshots of key pages (desktop and mobile), current Lighthouse scores and metrics, and the previous audit report. Compare current state against the previous report. Your job is judgment, not alarm: Lighthouse scores routinely jitter by a few points - only treat a score change as a regression if it drops more than 5 points or falls below 85, or a metric degrades materially. For visuals, look for genuine breakage: overlapping or clipped text, broken images, layout overflow on mobile, missing sections, unstyled content, contrast problems. For each page, write a one-sentence visual_fingerprint describing its current correct appearance - the next audit will use these as its memory of what the site looked like. Identify at most one top_fix: the single highest-impact improvement. Set should_file_issue to true only for real regressions or breakage a developer should act on this week - never for stable-but-imperfect scores or subjective style opinions. Be specific and terse; this report is displayed publicly on the site itself.`;

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

// Mirrors HealthReport 1:1. `strict: true` plus additionalProperties: false
// means the API validates the model's output against this schema before it
// ever reaches us. The pipeline overrides audited_at and each page's
// lighthouse block with the measured values after the call, so transcription
// slips by the model can't corrupt the published numbers.
export const RECORD_HEALTH_REPORT_TOOL: Anthropic.Tool = {
	name: "record_health_report",
	description:
		"Record the structured nightly health report comparing the site's current state against the previous audit.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			audited_at: { type: "string", description: "ISO 8601 timestamp of this audit" },
			status: { type: "string", enum: [...HEALTH_STATUSES] },
			summary: {
				type: "string",
				description: "1-2 public-facing sentences on the site's current health",
			},
			pages: {
				type: "array",
				items: {
					type: "object",
					properties: {
						path: { type: "string" },
						lighthouse: {
							type: "object",
							properties: {
								performance: { type: "number" },
								accessibility: { type: "number" },
								best_practices: { type: "number" },
								seo: { type: "number" },
								lcp_ms: nullableNumber,
								cls: nullableNumber,
								tbt_ms: nullableNumber,
							},
							required: [
								"performance",
								"accessibility",
								"best_practices",
								"seo",
								"lcp_ms",
								"cls",
								"tbt_ms",
							],
							additionalProperties: false,
						},
						visual_findings: {
							type: "array",
							items: { type: "string" },
							description:
								"Genuine visual breakage only; empty when the page looks right",
						},
						visual_fingerprint: {
							type: "string",
							description:
								"One sentence describing the page's current correct appearance - the next audit's memory",
						},
					},
					required: ["path", "lighthouse", "visual_findings", "visual_fingerprint"],
					additionalProperties: false,
				},
			},
			score_deltas: {
				type: "array",
				items: { type: "string" },
				description: 'e.g. "Home performance 96 → 91 (within jitter)"',
			},
			top_fix: {
				type: ["string", "null"],
				description: "The single highest-impact improvement, or null",
			},
			should_file_issue: {
				type: "boolean",
				description: "True only for real regressions or breakage worth acting on this week",
			},
			issue_title: nullableString,
			issue_body: {
				type: ["string", "null"],
				description: "Markdown issue body; null when should_file_issue is false",
			},
			issue_fingerprint: {
				type: ["string", "null"],
				description:
					'Stable kebab-case slug identifying the underlying problem for dedupe, e.g. "mobile-overflow-demos-index"',
			},
			error_reason: nullableString,
		},
		required: [
			"audited_at",
			"status",
			"summary",
			"pages",
			"score_deltas",
			"top_fix",
			"should_file_issue",
			"issue_title",
			"issue_body",
			"issue_fingerprint",
			"error_reason",
		],
		additionalProperties: false,
	},
};
