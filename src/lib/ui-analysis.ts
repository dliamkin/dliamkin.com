import type Anthropic from "@anthropic-ai/sdk";

// Shared between the Vue app, the Cloudflare Worker (worker/index.ts), and
// scripts/generate-screenshot-samples.mjs. Keep the TypeScript interfaces and
// the tool JSON schema below in 1:1 sync - the schema is what actually
// constrains the model's output.

// Server-side cap on the decoded image payload. The client compresses to
// ≤ ~1.2 MB before upload, so anything larger than this is not from our UI.
export const MAX_IMAGE_BYTES = 1_500_000;

// Client-side compression target - reject after re-encode if still above this.
export const MAX_CLIENT_IMAGE_BYTES = 1_200_000;

// Longest edge after client-side downscaling (matches the model's native
// vision resolution, so larger uploads gain nothing).
export const MAX_IMAGE_EDGE_PX = 1568;

export const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

// The scaffold SFC needs room; 3,000 proved too tight in practice (a
// mapping-heavy screenshot truncated before scaffold_code was emitted), and
// 4,000 still truncated occasionally (shot-pricing, eval run 2026-07-08).
// Output is billed per token generated, so a generous cap costs nothing on
// typical responses.
export const UI_ANALYSIS_MAX_TOKENS = 8000;

// The worker only ever receives canvas-re-encoded JPEG from our client, but
// the API accepts these too (used by the sample-generation script for PNGs).
export const ALLOWED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export interface ComponentMapping {
	detected_element: string; // e.g. "Top navigation bar with logo and links"
	primevue_component: string; // e.g. "Menubar"
	rationale: string; // one sentence
	key_props: string[]; // e.g. ["model (MenuItem[])", "end slot for actions"]
	confidence: "high" | "medium" | "low";
}

export interface UiAnalysis {
	is_ui_screenshot: boolean;
	reason: string | null; // populated when is_ui_screenshot is false
	ui_type: string | null; // e.g. "admin dashboard", "login page"
	layout_summary: string | null; // 2-3 sentences on overall structure
	mappings: ComponentMapping[];
	scaffold_code: string | null; // complete Vue SFC as a string
	gaps: string[]; // elements with no clean PrimeVue equivalent
}

export const UI_ANALYSIS_SYSTEM_PROMPT = `You are a UI analysis engine inside a technical demo for a Vue/PrimeVue developer's portfolio. You receive one image. First decide whether it is a screenshot of a software user interface (web, mobile, or desktop). If it is not, set is_ui_screenshot to false, give a one-sentence polite reason, and leave all other fields empty. If it is a UI screenshot: identify the major visible UI elements and map each to the closest PrimeVue v4 component (e.g. DataTable, Card, Button, InputText, Select, Menubar, TabView, Chart, Tag, Avatar, Dialog, Toolbar, Paginator). For each mapping include a short rationale and key props/slots you'd configure. Then produce one clean Vue 3 <script setup lang="ts"> single-file-component scaffold that approximates the layout using those PrimeVue components with sensible placeholder data - structure and composition matter more than pixel fidelity. Rules: the scaffold must render every mapped element with its mapped PrimeVue component - a data table must appear as <DataTable> with <Column> children, never a raw <table>; never transcribe personal data visible in the screenshot (names, emails, numbers, message contents) - use generic placeholders instead; never describe or identify people; do not reproduce logos or brand assets in the scaffold, use neutral placeholder text; if part of the UI has no good PrimeVue equivalent, say so in gaps rather than forcing a bad mapping.`;

const nullableString = { type: ["string", "null"] };

// Mirrors UiAnalysis 1:1. `strict: true` plus additionalProperties: false
// means the API validates the model's output against this schema before it
// ever reaches us.
export const UI_ANALYSIS_TOOL: Anthropic.Tool = {
	name: "record_ui_analysis",
	description:
		"Record the structured analysis of an image: whether it is a UI screenshot and, if so, the PrimeVue component mapping and scaffold code that would reconstruct it.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			is_ui_screenshot: { type: "boolean" },
			reason: {
				type: ["string", "null"],
				description:
					"One polite sentence explaining why the image is not a UI screenshot; null when it is one",
			},
			ui_type: nullableString,
			layout_summary: {
				type: ["string", "null"],
				description: "2-3 sentences on the overall structure",
			},
			mappings: {
				type: "array",
				items: {
					type: "object",
					properties: {
						detected_element: { type: "string" },
						primevue_component: { type: "string" },
						rationale: { type: "string" },
						key_props: { type: "array", items: { type: "string" } },
						confidence: { type: "string", enum: ["high", "medium", "low"] },
					},
					required: [
						"detected_element",
						"primevue_component",
						"rationale",
						"key_props",
						"confidence",
					],
					additionalProperties: false,
				},
			},
			scaffold_code: {
				type: ["string", "null"],
				description:
					'A complete Vue 3 <script setup lang="ts"> single-file component as a string',
			},
			gaps: { type: "array", items: { type: "string" } },
		},
		required: [
			"is_ui_screenshot",
			"reason",
			"ui_type",
			"layout_summary",
			"mappings",
			"scaffold_code",
			"gaps",
		],
		additionalProperties: false,
	},
};
