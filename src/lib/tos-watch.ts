import type Anthropic from "@anthropic-ai/sdk";

// Shared between the Vue page (src/views/TosWatchView.vue), the nightly
// watchdog scripts (scripts/tos-watch/), and the eval suite. Keep the
// TypeScript interfaces and the tool JSON schema below in 1:1 sync - the
// schema is what actually constrains the model's output.

// Hard editorial cap: the public site quotes at most this many words per
// excerpt. The prompt asks for it, post-processing enforces it with
// truncation, and the eval suite checks it - never republish document text.
export const EXCERPT_MAX_WORDS = 25;

// Changelog retention in public/tos-watch/changelog.json; older entries
// overflow into changelog-archive.json so the record stays complete.
export const CHANGELOG_MAX_ENTRIES = 500;

export type TosChangeCategory =
	| "privacy_and_data"
	| "arbitration_and_disputes"
	| "liability"
	| "content_and_ip_rights"
	| "account_and_termination"
	| "pricing_and_billing"
	| "ai_and_automated_processing"
	| "other";

export const TOS_CHANGE_CATEGORIES: TosChangeCategory[] = [
	"privacy_and_data",
	"arbitration_and_disputes",
	"liability",
	"content_and_ip_rights",
	"account_and_termination",
	"pricing_and_billing",
	"ai_and_automated_processing",
	"other",
];

// "favors_provider" rather than "favors_company": monitored providers include
// university departments, not just companies.
export type TosChangeImpact = "favors_provider" | "favors_user" | "neutral" | "unclear";

export interface TosChange {
	title: string; // e.g. "Arbitration clause added"
	category: TosChangeCategory;
	new_excerpt: string; // <= EXCERPT_MAX_WORDS words, enforced in code
	old_excerpt: string | null; // same cap, or null if the clause is newly added
	explanation: string; // 1-3 neutral sentences
	practical_effect: string; // one sentence: what it means for a user
	impact: TosChangeImpact;
	severity: "high" | "medium" | "low";
}

export interface TosChangeReport {
	substantive: boolean;
	cosmetic_note: string | null; // set when substantive is false
	changes: TosChange[]; // ordered by severity, high first
	summary: string; // 1-2 neutral sentences for the feed
}

// What actually gets published in changelog.json.
export interface ChangelogEntry {
	id: string; // `${service_id}/${document slug}/${detected date}`
	service_id: string;
	service_name: string;
	document_label: string;
	document_url: string;
	detected_at: string; // ISO date. "Detected", never "changed": nightly
	// monitoring only knows when a change was first observed.
	report: TosChangeReport;
	model: string;
	pipeline_version: string;
}

export type DocumentStatus = "monitored" | "unreachable" | "robots_skipped";

export interface DocumentState {
	service_id: string;
	service_name: string;
	document_label: string;
	document_url: string;
	last_checked_at: string | null; // ISO timestamp
	last_changed_at: string | null; // ISO timestamp of last *detected* change
	content_hash: string | null; // sha256 of normalized text
	consecutive_failures: number;
	status: DocumentStatus;
	// The document's own "last updated" line, captured during normalization as
	// display metadata. Never hashed - a date bump alone must not read as a
	// change.
	self_reported_updated: string | null;
}

export interface TosWatchState {
	generated_at: string;
	monitoring_since: string; // ISO date of the baseline run - the page's
	// honest empty state cites this.
	documents: DocumentState[];
}

// ---------------------------------------------------------------------------
// Editorial safety helpers. Pure functions so the page, the scripts, and the
// eval suite all measure with the same ruler.

export function countWords(text: string): number {
	const words = text.trim().split(/\s+/);
	return words[0] === "" ? 0 : words.length;
}

// Hard cap, applied after the model call: the prompt asks for <= 25 words,
// this guarantees it. Truncation is marked with a trailing "…" - consumers
// that verbatim-match excerpts against source text must strip it first.
export function truncateExcerpt(excerpt: string, maxWords: number = EXCERPT_MAX_WORDS): string {
	const words = excerpt.trim().split(/\s+/);
	if (words.length <= maxWords) return excerpt.trim();
	return words.slice(0, maxWords).join(" ") + "…";
}

// Applies the excerpt cap to a whole report. Called at the pipeline boundary
// (explainTosChange) so the TosChangeReport type's "<= EXCERPT_MAX_WORDS,
// enforced in code" promise holds for every consumer - the nightly runner,
// the site, and the eval suite all receive already-capped excerpts.
export function capExcerpts(report: TosChangeReport): TosChangeReport {
	return {
		...report,
		changes: report.changes.map((change) => ({
			...change,
			new_excerpt: truncateExcerpt(change.new_excerpt),
			old_excerpt: change.old_excerpt === null ? null : truncateExcerpt(change.old_excerpt),
		})),
	};
}

// Loaded/editorializing language the project's neutral posture forbids. The
// prompt already bans these; this list is the code-level backstop. A match
// blocks auto-publish and routes the entry to owner review instead.
export const LOADED_LANGUAGE = [
	"quietly",
	"sneaky",
	"sneakily",
	"snuck",
	"buried",
	"burying",
	"slipped in",
	"under the radar",
	"covertly",
	"covert",
	"surreptitious",
	"surreptitiously",
	"stealthily",
	"stealthy",
	"secretly",
	"deceptive",
	"deceptively",
	"devious",
	"sly",
	"underhanded",
	"scheme",
	"trick",
] as const;

export interface LoadedLanguageViolation {
	field: string; // where in the report it appeared
	term: string; // which forbidden term matched
	text: string; // the offending text, for the review issue
}

function scanText(field: string, text: string | null): LoadedLanguageViolation[] {
	if (!text) return [];
	const violations: LoadedLanguageViolation[] = [];
	for (const term of LOADED_LANGUAGE) {
		// Word-boundary match so e.g. "trick" doesn't hit "restricted".
		const pattern = new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "i");
		if (pattern.test(text)) violations.push({ field, term, text });
	}
	return violations;
}

// Excerpts are exempt: they are verbatim quotes from the document itself, and
// the document's own words are facts we report, not editorial voice.
export function findLoadedLanguage(report: TosChangeReport): LoadedLanguageViolation[] {
	const violations: LoadedLanguageViolation[] = [
		...scanText("summary", report.summary),
		...scanText("cosmetic_note", report.cosmetic_note),
	];
	report.changes.forEach((change, i) => {
		violations.push(
			...scanText(`changes[${i}].title`, change.title),
			...scanText(`changes[${i}].explanation`, change.explanation),
			...scanText(`changes[${i}].practical_effect`, change.practical_effect),
		);
	});
	return violations;
}

// ---------------------------------------------------------------------------
// Model contract.

// Output scales with the number of substantive changes, not document length -
// the pipeline sends only changed blocks, never both full documents.
export const EXPLAIN_TOS_MAX_TOKENS = 4000;

export const EXPLAIN_TOS_SYSTEM_PROMPT = `You are a terms-of-service change analyst for a public monitoring project. You receive changed text blocks (with context) between two versions of a named service's legal document, detected by automated comparison. First gate: if every change is cosmetic - formatting, renumbering, typo fixes, date updates, wording shuffles with identical meaning - set substantive to false and stop. Otherwise, describe each substantive change in neutral, factual, plain English an ordinary user can understand. For each change: categorize it, quote the single most relevant excerpt from the NEW text at 25 words or fewer (and optionally the old text, same cap), assess who it favors and its practical significance, and note in one sentence what it means for a user in practice. Excerpt rules: an excerpt must be one contiguous span copied character-for-character from the document. Never join separate fragments with an ellipsis, skip words, or paraphrase - a spliced or reworded "quote" is a fabrication. When the relevant sentence runs past 25 words, quote only its most informative contiguous portion; a partial sentence that starts or ends mid-thought is fine and expected. Count the excerpt's words before committing to it. Strict rules: describe only what the text says - never speculate about the organization's motives or use loaded language (no "quietly," "buried," "sneaky"); never state when the change was made, only what differs between the two observed versions; if a change's meaning or effect is unclear, say so plainly and mark impact unclear rather than guessing; do not give advice about whether to accept terms or leave a service. Your output is published verbatim on a public record - accuracy and neutrality over color.`;

// Mirrors TosChangeReport 1:1. strict: true + additionalProperties: false
// means the API validates the model's output against this schema before it
// ever reaches us.
export const EXPLAIN_TOS_TOOL: Anthropic.Tool = {
	name: "record_tos_change_report",
	description:
		"Record the structured analysis of detected changes between two versions of a service's legal document: cosmetic gate, then each substantive change with a short excerpt, neutral explanation, practical effect, impact, and severity.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			substantive: {
				type: "boolean",
				description:
					"false when every change is cosmetic (formatting, renumbering, typos, date updates, identical-meaning rewording)",
			},
			cosmetic_note: {
				type: ["string", "null"],
				description:
					"When substantive is false: one neutral sentence describing the cosmetic nature of the changes. Null when substantive.",
			},
			changes: {
				type: "array",
				items: {
					type: "object",
					properties: {
						title: { type: "string" },
						category: { type: "string", enum: TOS_CHANGE_CATEGORIES },
						new_excerpt: {
							type: "string",
							description:
								"The single most relevant quote from the NEW text: one contiguous span copied character-for-character, 25 words or fewer. No ellipses joining fragments, no skipped words, no paraphrase - if the sentence is longer than 25 words, quote a contiguous portion of it",
						},
						old_excerpt: {
							type: ["string", "null"],
							description:
								"Quote from the OLD text under the same rules (contiguous, verbatim, 25 words or fewer); null if the clause is newly added",
						},
						explanation: {
							type: "string",
							description:
								"1-3 neutral, factual sentences an ordinary user can understand",
						},
						practical_effect: {
							type: "string",
							description: "One sentence: what this means for a user in practice",
						},
						impact: {
							type: "string",
							enum: ["favors_provider", "favors_user", "neutral", "unclear"],
						},
						severity: { type: "string", enum: ["high", "medium", "low"] },
					},
					required: [
						"title",
						"category",
						"new_excerpt",
						"old_excerpt",
						"explanation",
						"practical_effect",
						"impact",
						"severity",
					],
					additionalProperties: false,
				},
			},
			summary: {
				type: "string",
				description:
					"1-2 neutral sentences summarizing the change set, used in the RSS feed",
			},
		},
		required: ["substantive", "cosmetic_note", "changes", "summary"],
		additionalProperties: false,
	},
};
