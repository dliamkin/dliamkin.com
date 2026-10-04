import type Anthropic from "@anthropic-ai/sdk";

// Shared between the Vue app, the Cloudflare Worker (worker/index.ts), and
// scripts/generate-lease-samples.mjs. Keep the TypeScript interfaces and the
// tool JSON schema below in 1:1 sync - the schema is what actually constrains
// the model's output.

// Per-document cap, enforced client-side AND server-side. Sized to fit a full
// real-world lease (~75k chars); two of them plus the mechanical diff make
// this by far the most token-heavy demo endpoint. Still well within the
// models' context windows (~40-55k input tokens worst case).
export const MAX_LEASE_CHARS = 75_000;

// Output isn't proportional to input - it scales with the number of changes.
// 8k leaves headroom for a heavily-revised lease (~30 changes with excerpts)
// while staying under the ~16k threshold where a non-streaming call would risk
// SDK timeouts. Thinking is disabled server-side so the whole budget is output.
export const LEASE_DIFF_MAX_TOKENS = 8000;

export type ChangeCategory =
	| "rent_and_deposits"
	| "fees"
	| "term_and_renewal"
	| "termination"
	| "maintenance_and_repairs"
	| "utilities"
	| "rules_and_use"
	| "liability_and_insurance"
	| "entry_and_privacy"
	| "other";

export const CHANGE_CATEGORIES: ChangeCategory[] = [
	"rent_and_deposits",
	"fees",
	"term_and_renewal",
	"termination",
	"maintenance_and_repairs",
	"utilities",
	"rules_and_use",
	"liability_and_insurance",
	"entry_and_privacy",
	"other",
];

export interface LeaseChange {
	title: string; // e.g. "Monthly rent increased"
	category: ChangeCategory;
	original_excerpt: string | null; // shortest relevant quote; null if newly added
	revised_excerpt: string | null; // null if removed
	explanation: string; // 1-3 plain-English sentences
	impact: "favors_landlord" | "favors_tenant" | "neutral" | "unclear";
	severity: "high" | "medium" | "low";
	negotiation_note: string | null; // question-framed, or null
}

export interface LeaseComparison {
	overall_summary: string; // 2-3 sentences
	changes: LeaseChange[]; // ordered by severity, high first
	questions_to_ask: string[]; // concrete, tied to the changes
	formatting_notes: string | null; // renumbering etc., mentioned once
	ambiguities: string[]; // things the model declined to guess about
}

export const COMPARE_LEASES_SYSTEM_PROMPT = `You are a lease comparison engine inside a technical demo. You receive an original lease, a revised lease, and a mechanical diff of changed blocks (use it as a checklist so nothing is missed, but read both documents fully - the diff can fragment a single conceptual change). Identify every substantive change and describe each in plain English a first-time renter would understand. For each change: quote the shortest relevant excerpt from each version (or null if the clause is newly added/removed), categorize it, judge who it favors, rate its practical significance, and where genuinely useful add a short note on what a tenant might ask or negotiate - framed as questions, never as advice. Rules: never invent changes not present in the documents; ignore pure formatting/renumbering changes but note them once in formatting_notes; do not give legal advice, jurisdiction-specific legal conclusions, or any recommendation to sign or not sign; do not speculate about the landlord's motives; if wording is ambiguous, say so in the change's explanation rather than guessing. Order changes by severity, high first. Generate questions_to_ask as concrete questions tied to specific changes, not generic renting tips. These are demo documents - treat all names and figures as fictional.`;

const nullableString = { type: ["string", "null"] };

// Mirrors LeaseComparison 1:1. `strict: true` plus additionalProperties: false
// means the API validates the model's output against this schema before it
// ever reaches us.
export const COMPARE_LEASES_TOOL: Anthropic.Tool = {
	name: "record_lease_comparison",
	description:
		"Record the structured comparison of two versions of a synthetic lease: every substantive change with excerpts, plain-English explanation, impact, and severity, plus questions a tenant should ask.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			overall_summary: {
				type: "string",
				description: "2-3 sentence plain-English summary of what changed overall",
			},
			changes: {
				type: "array",
				items: {
					type: "object",
					properties: {
						title: { type: "string" },
						category: { type: "string", enum: CHANGE_CATEGORIES },
						original_excerpt: {
							type: ["string", "null"],
							description:
								"Shortest relevant quote from the original lease; null if the clause is newly added",
						},
						revised_excerpt: {
							type: ["string", "null"],
							description:
								"Shortest relevant quote from the revised lease; null if the clause was removed",
						},
						explanation: {
							type: "string",
							description:
								"1-3 plain-English sentences a first-time renter would understand",
						},
						impact: {
							type: "string",
							enum: ["favors_landlord", "favors_tenant", "neutral", "unclear"],
						},
						severity: { type: "string", enum: ["high", "medium", "low"] },
						negotiation_note: {
							type: ["string", "null"],
							description:
								"Question-framed note on what a tenant might ask or negotiate; null if not genuinely useful",
						},
					},
					required: [
						"title",
						"category",
						"original_excerpt",
						"revised_excerpt",
						"explanation",
						"impact",
						"severity",
						"negotiation_note",
					],
					additionalProperties: false,
				},
			},
			questions_to_ask: {
				type: "array",
				items: { type: "string" },
				description:
					"Concrete questions tied to specific changes, not generic renting tips",
			},
			formatting_notes: nullableString,
			ambiguities: { type: "array", items: { type: "string" } },
		},
		required: [
			"overall_summary",
			"changes",
			"questions_to_ask",
			"formatting_notes",
			"ambiguities",
		],
		additionalProperties: false,
	},
};
