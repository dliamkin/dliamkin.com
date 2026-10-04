import type Anthropic from "@anthropic-ai/sdk";

// Shared between the Vue app, the Cloudflare Worker (worker/index.ts), and
// scripts/generate-samples.mjs. Keep the TypeScript interfaces and the tool
// JSON schema below in 1:1 sync - the schema is what actually constrains the
// model's output.

export const MAX_NOTE_CHARS = 4000;

export interface Medication {
	name: string;
	dose: string | null; // e.g. "10 mg"
	route: string | null; // e.g. "oral"
	frequency: string | null; // e.g. "twice daily"
	status: "active" | "new" | "discontinued" | "unknown";
}

export interface Vitals {
	blood_pressure: string | null; // e.g. "128/82"
	heart_rate: string | null;
	temperature: string | null;
	respiratory_rate: string | null;
	oxygen_saturation: string | null;
	weight: string | null;
}

export interface FollowUp {
	action: string; // e.g. "Schedule lipid panel"
	timeframe: string | null; // e.g. "within 2 weeks"
}

export interface StructuredNote {
	chief_complaint: string | null;
	history_of_present_illness: string | null; // 2–3 sentence summary
	medications: Medication[];
	allergies: string[];
	vitals: Vitals;
	assessment: string[]; // problem list / impressions
	plan: string[];
	follow_ups: FollowUp[];
	red_flags: string[]; // urgent items explicitly flagged in the note
	extraction_notes: string[]; // ambiguities the model chose not to guess about
}

export const STRUCTURE_NOTE_SYSTEM_PROMPT = `You are a clinical documentation structuring engine inside a technical demo. You will receive a free-text clinical visit note that is SYNTHETIC (fictional). Extract its contents into the structured schema provided via the tool. Rules: extract only what is present in the note - never invent, infer, or embellish clinical facts. If a field is not mentioned, return null or an empty array for it. Preserve medication names, doses, and frequencies exactly as written. Anything ambiguous goes into the extraction_notes field rather than being guessed. Populate red_flags only with items the note itself explicitly identifies as urgent or concerning. Do not provide medical advice, diagnosis, or treatment recommendations beyond what the note states.`;

const nullableString = { type: ["string", "null"] };

// Mirrors StructuredNote 1:1. `strict: true` on the tool definition plus
// additionalProperties: false means the API validates the model's output
// against this schema before it ever reaches us.
export const STRUCTURE_NOTE_TOOL: Anthropic.Tool = {
	name: "record_structured_note",
	description:
		"Record the structured extraction of a synthetic free-text clinical visit note. Every field must reflect only information explicitly present in the note.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			chief_complaint: nullableString,
			history_of_present_illness: {
				type: ["string", "null"],
				description: "2-3 sentence summary of the history of present illness",
			},
			medications: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						dose: nullableString,
						route: nullableString,
						frequency: nullableString,
						status: {
							type: "string",
							enum: ["active", "new", "discontinued", "unknown"],
						},
					},
					required: ["name", "dose", "route", "frequency", "status"],
					additionalProperties: false,
				},
			},
			allergies: { type: "array", items: { type: "string" } },
			vitals: {
				type: "object",
				properties: {
					blood_pressure: nullableString,
					heart_rate: nullableString,
					temperature: nullableString,
					respiratory_rate: nullableString,
					oxygen_saturation: nullableString,
					weight: nullableString,
				},
				required: [
					"blood_pressure",
					"heart_rate",
					"temperature",
					"respiratory_rate",
					"oxygen_saturation",
					"weight",
				],
				additionalProperties: false,
			},
			assessment: { type: "array", items: { type: "string" } },
			plan: { type: "array", items: { type: "string" } },
			follow_ups: {
				type: "array",
				items: {
					type: "object",
					properties: {
						action: { type: "string" },
						timeframe: nullableString,
					},
					required: ["action", "timeframe"],
					additionalProperties: false,
				},
			},
			red_flags: { type: "array", items: { type: "string" } },
			extraction_notes: { type: "array", items: { type: "string" } },
		},
		required: [
			"chief_complaint",
			"history_of_present_illness",
			"medications",
			"allergies",
			"vitals",
			"assessment",
			"plan",
			"follow_ups",
			"red_flags",
			"extraction_notes",
		],
		additionalProperties: false,
	},
};
