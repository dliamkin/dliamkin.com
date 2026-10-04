// Shared between the Vue app, the Cloudflare Worker (worker/index.ts), and
// scripts/generate-noise-samples.mjs. Keep the TypeScript interfaces and the
// tool JSON schema below in 1:1 sync - the schema is what actually constrains
// the model's output.
//
// This module also holds the demo's two deterministic guardrails:
// - the safety gate (runs in the browser BEFORE any API call - a danger
//   phrase in the user's answers short-circuits the whole flow), and
// - the diagnosis deny-list (runs in the worker AFTER the model call -
//   diagnosis language is stripped and logged; the demo describes, it never
//   diagnoses).
// Both are plain functions with unit tests, mirroring the ToS watchdog's
// loaded-language backstop: the prompt bans it, the code guarantees it.

import type Anthropic from "@anthropic-ai/sdk";
import { SPECTROGRAM_MAX_HZ } from "./audio-analysis/spectrogram";
import type { MeasuredFeatures } from "./audio-analysis/types";

// ---------------------------------------------------------------------------
// Caps

// The spectrogram is a fixed 1200x400 PNG (~100-300 KB) - the vision demos'
// shared image cap is generous headroom, reused so client and server enforce
// the same number. See src/lib/ui-analysis.ts for the constant's rationale.
export { MAX_IMAGE_BYTES } from "./ui-analysis";

export const MAX_CONTEXT_FIELD_CHARS = 500;

// Characterizations + summary + 6 questions fits comfortably in ~1,500
// tokens; 3,000 leaves headroom for verbose question hints without inviting
// rambling.
export const NOISE_TRANSLATOR_MAX_TOKENS = 3000;

// ---------------------------------------------------------------------------
// Context form

export const MACHINE_TYPES = [
	"car",
	"clothes_dryer",
	"washer",
	"furnace_hvac",
	"refrigerator",
	"dishwasher",
	"other",
] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

export const WHEN_IT_HAPPENS = ["startup_only", "constant", "intermittent", "under_load"] as const;
export type WhenItHappens = (typeof WHEN_IT_HAPPENS)[number];

export const SPEED_RESPONSES = ["tracks_speed", "constant", "unsure"] as const;
export type SpeedResponse = (typeof SPEED_RESPONSES)[number];

/** The guided context form. Every field feeds the model; the safety answer feeds the deterministic gate. */
export interface NoiseContext {
	machine_type: MachineType;
	/** Free text when machine_type is "other". */
	machine_type_other: string;
	when_it_happens: WhenItHappens;
	changes_with_speed: SpeedResponse;
	how_long: string;
	recent_changes: string;
	/** "Any burning smell, smoke, gas odor, or braking problems?" */
	safety_screen: "yes" | "no";
	safety_screen_detail: string;
}

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
	car: "Car",
	clothes_dryer: "Clothes dryer",
	washer: "Washing machine",
	furnace_hvac: "Furnace / HVAC",
	refrigerator: "Refrigerator",
	dishwasher: "Dishwasher",
	other: "Other",
};

// ---------------------------------------------------------------------------
// Model output

export interface SoundCharacterization {
	/** e.g. "metallic clicking" */
	descriptor: string;
	/** Which measurement or spectrogram trait supports it. */
	evidence: string;
	confidence: "high" | "medium" | "low";
}

export interface ProfessionalQuestion {
	/** What the pro will ask. */
	question: string;
	/** How the user can prepare the answer. */
	how_to_find_out: string;
}

/** The model's synthesized output - description only, never diagnosis. */
export interface NoiseDescription {
	/** 1–3 characterizations, best first. */
	characterizations: SoundCharacterization[];
	/** From user context, 1–2 sentences. */
	conditions_summary: string;
	/** The read-aloud paragraph the user brings to a professional. */
	professional_summary: string;
	/** 4–6 questions a professional will plausibly ask next. */
	likely_questions: ProfessionalQuestion[];
	/** Quality caveats about the recording, or null. */
	recording_notes: string | null;
}

/** POST /api/describe-noise request body. Raw audio never appears here - only its derived artifacts. */
export interface DescribeNoiseRequest {
	/** Spectrogram PNG as base64 (no data: prefix). */
	spectrogramPngBase64: string;
	features: MeasuredFeatures;
	context: NoiseContext;
}

export interface DescribeNoiseResponse {
	description: NoiseDescription;
	/** Sentences removed by the deny-list or measured-number check, if any (shown for transparency). */
	stripped: string[];
}

// ---------------------------------------------------------------------------
// System prompt

export const NOISE_TRANSLATOR_SYSTEM_PROMPT = `You are a sound-description engine inside a technical demo. You receive: a spectrogram image with labeled time and frequency axes, deterministically measured acoustic features, and the user's answers about the machine and when the sound occurs. The measured features are ground truth - quote them exactly and never contradict or restate them with different numbers. Your job is translation, not diagnosis: characterize the sound in the plain physical vocabulary a technician uses (clicking, grinding, whining, squealing, rumbling, hissing, knocking, rattling), choosing only words consistent with the measurements and the spectrogram, and mark each characterization's confidence. Weave the user's context into a conditions summary. Then write a professional_summary: a short first-person paragraph the user can read aloud when calling a mechanic or technician - sound character, measured rate and regularity, frequency character, when it occurs, duration of the problem. Then list the questions a professional will most plausibly ask next for this machine type and sound pattern, each with a hint about how to find the answer, so the user can prepare. Absolute rules: never name a cause, a faulty part, or a repair - not even hedged ("it might be the bearings" is forbidden); never assess safety or tell the user the sound is or isn't serious - the surrounding application handles safety separately; if the spectrogram and features are ambiguous or the recording seems poor, say so plainly and suggest what a better recording would capture; any number you cite must be one of the measured values (or the spectrogram's labeled axis bounds) - never introduce your own numeric estimates of rates, frequencies, or durations, and that includes approximate bounds read off the image: "under about 2000 Hz" or "up to around 3 kHz" are violations unless that exact value was measured. When you want to place energy the measurements don't pin down, use qualitative wording instead - "in the low end", "well below the main tone", "toward the top of the visible range". You describe; professionals conclude.`;

// ---------------------------------------------------------------------------
// Tool schema

const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

// Mirrors NoiseDescription 1:1. `strict: true` plus additionalProperties:
// false means the API validates the model's output against this schema before
// it ever reaches us.
export const NOISE_TRANSLATOR_TOOL: Anthropic.Tool = {
	name: "record_noise_description",
	description:
		"Record the structured, non-diagnostic description of a machine sound: plain-vocabulary characterizations grounded in the measured features and spectrogram, a read-aloud professional summary, and the questions a professional will likely ask next.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			characterizations: {
				type: "array",
				description: "1-3 plain-language sound characterizations, best-supported first.",
				items: {
					type: "object",
					properties: {
						descriptor: {
							type: "string",
							description:
								"Plain physical vocabulary, e.g. 'metallic clicking', 'high-pitched whine'",
						},
						evidence: {
							type: "string",
							description:
								"The measurement or spectrogram trait that supports this word choice",
						},
						confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
					},
					required: ["descriptor", "evidence", "confidence"],
					additionalProperties: false,
				},
			},
			conditions_summary: {
				type: "string",
				description:
					"1-2 sentences weaving in the user's context answers: when it happens, speed dependence, history",
			},
			professional_summary: {
				type: "string",
				description:
					"Short first-person paragraph to read aloud to a mechanic or technician, quoting the measured numbers exactly as given and citing no other numbers - describe unmeasured regions qualitatively, never with your own Hz/kHz estimates",
			},
			likely_questions: {
				type: "array",
				description:
					"4-6 questions a professional will plausibly ask next for this machine type and sound pattern",
				items: {
					type: "object",
					properties: {
						question: { type: "string" },
						how_to_find_out: {
							type: "string",
							description: "How the user can prepare the answer before calling",
						},
					},
					required: ["question", "how_to_find_out"],
					additionalProperties: false,
				},
			},
			recording_notes: {
				type: ["string", "null"],
				description:
					"Caveats when the recording seems poor or ambiguous, with what a better recording would capture; null when the recording is adequate",
			},
		},
		required: [
			"characterizations",
			"conditions_summary",
			"professional_summary",
			"likely_questions",
			"recording_notes",
		],
		additionalProperties: false,
	},
};

// ---------------------------------------------------------------------------
// Safety gate (client-side, BEFORE any API call)

export interface SafetyHit {
	/** Short human-readable label for the danger signal, mirrored back to the user. */
	label: string;
	/** The text fragment that matched. */
	matched: string;
}

// Danger signals that end the flow: no analysis, no API call - an unmissable
// "stop using the equipment and call a professional now" message instead.
// Word-boundary regexes so e.g. "gas" doesn't fire on "gasket".
const DANGER_PATTERNS: { label: string; pattern: RegExp }[] = [
	{
		label: "burning smell",
		pattern:
			/\bburn(?:ing|t)\s+(?:smell|odou?r|rubber|plastic)|\bsmells?\s+(?:like\s+)?(?:it'?s\s+)?burn(?:ing|t)\b/i,
	},
	{ label: "smoke", pattern: /\bsmoke\b|\bsmoking\b/i },
	{ label: "sparks", pattern: /\bsparks?\b|\bsparking\b/i },
	{
		label: "gas odor",
		pattern: /\bgas\s+(?:smell|odou?r|leak)|\bsmells?\s+(?:like\s+)?gas\b|\brotten\s+eggs?\b/i,
	},
	{
		label: "fuel leak",
		pattern:
			/\bfuel\s+leak|\bleaking\s+(?:fuel|gasoline)|\bgasoline\s+smell|\bsmells?\s+(?:like\s+)?gasoline\b/i,
	},
	{
		label: "brake problem",
		pattern:
			/\bbrakes?\s+(?:(?:are|is|were|keeps?|won't|don't|doesn't)\s+)?(?:grind|grinding|fail|failing|failure|gone|not\s+work|stop)|\bgrinding\s+brakes?\b|\bbrake\s+pedal\s+(?:is\s+)?(?:soft|sinks?|to\s+the\s+floor)/i,
	},
	{ label: "carbon monoxide", pattern: /\bcarbon\s+monoxide\b|\bCO\s+(?:alarm|detector)\b/i },
	{
		label: "electrical heat",
		pattern:
			/\b(?:electrical|outlet|wiring|wire|plug)\b.{0,40}\b(?:hot|heat|buzz|buzzing|melt|melting)|\b(?:hot|buzzing|melting)\b.{0,40}\b(?:outlet|wiring|wire|plug)\b/i,
	},
];

/** Scan one free-text answer for danger signals. */
export function scanForDanger(text: string): SafetyHit[] {
	const hits: SafetyHit[] = [];
	for (const { label, pattern } of DANGER_PATTERNS) {
		const match = pattern.exec(text);
		if (match) hits.push({ label, matched: match[0] });
	}
	return hits;
}

export interface SafetyGateResult {
	blocked: boolean;
	/** Human-readable reasons, mirrored back in the warning message. */
	reasons: string[];
}

/**
 * The deterministic pre-flight safety gate. A "yes" on the safety screen or a
 * danger phrase in any free-text answer blocks the flow entirely - this runs
 * in the browser before any network request, and it is code, not model
 * behavior.
 */
export function evaluateSafetyGate(context: NoiseContext): SafetyGateResult {
	const reasons: string[] = [];
	if (context.safety_screen === "yes") {
		reasons.push(
			context.safety_screen_detail.trim().length > 0
				? `you reported: "${context.safety_screen_detail.trim()}"`
				: "you answered yes to the safety question",
		);
	}
	const freeText: [string, string][] = [
		["safety detail", context.safety_screen_detail],
		["recent changes", context.recent_changes],
		["how long", context.how_long],
		["machine type", context.machine_type_other],
	];
	for (const [, text] of freeText) {
		for (const hit of scanForDanger(text)) {
			const reason = `you mentioned ${hit.label} ("${hit.matched}")`;
			if (!reasons.includes(reason)) reasons.push(reason);
		}
	}
	return { blocked: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// Diagnosis deny-list (server-side, AFTER the model call)

const PART_WORDS =
	"bearings?|belts?|pumps?|compressors?|motors?|alternators?|pulleys?|valves?|fans?|filters?|coils?|spark plugs?|brake pads?|rotors?|drums?|igniters?|thermostats?|solenoids?|bushings?|CV joints?|struts?|shocks?|tensioners?|blowers?|capacitors?";

// Causal-claim language: forbidden everywhere in the output. A question like
// "When were the brake pads last replaced?" is legitimate professional
// vocabulary, so bare part names are NOT on this list - only claims.
const CAUSAL_PATTERNS: RegExp[] = [
	/\bthe\s+cause\s+is\b/i,
	/\bcaused\s+by\s+(?:a|an|the|your)\b/i,
	/\byou\s+(?:need|should|have)\s+to\s+replace\b/i,
	/\bneeds?\s+(?:a\s+)?(?:replacement|replacing|to\s+be\s+replaced)\b/i,
	/\bthis\s+means\s+(?:your|the|that)\b/i,
	/\bdiagnos(?:is|ed|e)\b/i,
];

// Part-diagnosis language: naming a component as the (possible) culprit.
// Forbidden in descriptive fields; questions are exempt because professionals'
// questions legitimately name parts.
const PART_DIAGNOSIS_PATTERNS: RegExp[] = [
	new RegExp(
		`\\b(?:it|this|that|the\\s+(?:sound|noise|problem|issue))(?:'s|\\s+is)?\\s+(?:probably|likely|possibly|might\\s+be|may\\s+be|could\\s+be|sounds?\\s+like)?\\s*(?:a|an|the|your)\\s+(?:worn|bad|failing|broken|loose|faulty)?\\s*(?:${PART_WORDS})\\b`,
		"i",
	),
	new RegExp(`\\b(?:worn|bad|failing|broken|loose|faulty)\\s+(?:${PART_WORDS})\\b`, "i"),
	new RegExp(
		`\\b(?:${PART_WORDS})\\s+(?:is|are)\\s+(?:worn|bad|failing|broken|loose|faulty|going|shot)\\b`,
		"i",
	),
	new RegExp(`\\breplace\\s+(?:the|your|a)\\s+(?:${PART_WORDS})\\b`, "i"),
];

export interface DiagnosisHit {
	/** The field the violation appeared in. */
	field: string;
	/** The offending sentence (or fragment), removed from the output. */
	sentence: string;
}

/** Scan a text for diagnosis language. Questions get causal patterns only. */
export function findDiagnosisLanguage(text: string, includePartPatterns = true): boolean {
	for (const pattern of CAUSAL_PATTERNS) {
		if (pattern.test(text)) return true;
	}
	if (includePartPatterns) {
		for (const pattern of PART_DIAGNOSIS_PATTERNS) {
			if (pattern.test(text)) return true;
		}
	}
	return false;
}

const splitSentences = (text: string): string[] =>
	text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

/** Remove sentences containing diagnosis language; return the survivors and the removals. */
export function stripDiagnosisSentences(
	text: string,
	field: string,
	includePartPatterns = true,
): { text: string; removed: DiagnosisHit[] } {
	const removed: DiagnosisHit[] = [];
	const kept = splitSentences(text).filter((sentence) => {
		if (findDiagnosisLanguage(sentence, includePartPatterns)) {
			removed.push({ field, sentence: sentence.trim() });
			return false;
		}
		return true;
	});
	return { text: kept.join(" "), removed };
}

// ---------------------------------------------------------------------------
// Measured-number post-validation

interface AllowedNumber {
	value: number;
	tolerance: number;
}

/**
 * Every number in professional_summary that carries an acoustic unit must
 * match a measured feature within rounding - the anti-fabrication check.
 * Returns the sentences containing fabricated numbers (to be stripped).
 */
export function findFabricatedNumbers(summary: string, features: MeasuredFeatures): string[] {
	const rates: AllowedNumber[] = [];
	if (features.event_rate_hz !== null) {
		rates.push({
			value: features.event_rate_hz,
			tolerance: Math.max(0.15, features.event_rate_hz * 0.1),
		});
	}
	const frequencies: AllowedNumber[] = features.dominant_bands_hz.map((hz) => ({
		value: hz,
		tolerance: Math.max(50, hz * 0.1),
	}));
	// The spectrogram's labeled axis ceiling is readable off the image itself
	// ("energy reaching up toward 8 kHz") - exact-match allowed, nothing near it.
	frequencies.push({ value: SPECTROGRAM_MAX_HZ, tolerance: 0 });
	const durations: AllowedNumber[] = [
		{ value: features.duration_s, tolerance: 0.6 },
		{ value: features.effective_duration_s, tolerance: 0.6 },
	];

	const matches = (value: number, allowed: AllowedNumber[]): boolean =>
		allowed.some((a) => Math.abs(value - a.value) <= a.tolerance);

	const offending: string[] = [];
	for (const sentence of splitSentences(summary)) {
		// Number followed by an acoustic unit: Hz/kHz, per-second rates, or seconds.
		const tokenPattern =
			/(~?\s*)(\d+(?:\.\d+)?)\s*(kHz|Hz|(?:times?\s+|clicks?\s+|events?\s+)?(?:per|a|\/)\s*sec(?:ond)?s?|seconds?|sec\b)/gi;
		let token: RegExpExecArray | null;
		let fabricated = false;
		while ((token = tokenPattern.exec(sentence)) !== null) {
			const value = Number.parseFloat(token[2] ?? "");
			const unit = (token[3] ?? "").toLowerCase();
			if (!Number.isFinite(value)) continue;
			if (unit === "khz") {
				if (!matches(value * 1000, frequencies)) fabricated = true;
			} else if (unit === "hz") {
				// Bare Hz is ambiguous: could be a frequency band or an event rate.
				if (!matches(value, frequencies) && !matches(value, rates)) fabricated = true;
			} else if (
				unit.includes("sec") &&
				!unit.includes("per") &&
				!unit.includes("/") &&
				!/\ba\s*sec/.test(unit)
			) {
				if (!matches(value, durations)) fabricated = true;
			} else {
				if (!matches(value, rates)) fabricated = true;
			}
		}
		if (fabricated) offending.push(sentence.trim());
	}
	return offending;
}

/**
 * The full server-side gate over the model's output: strip diagnosis language
 * everywhere (questions checked for causal claims only), strip
 * professional_summary sentences whose numbers don't match the measurements,
 * and report everything removed. Mirrors the ToS watchdog's editorial gate:
 * the prompt bans it, this guarantees it.
 */
export function applyDescriptionGate(
	raw: NoiseDescription,
	features: MeasuredFeatures,
): { description: NoiseDescription; stripped: string[] } {
	const removed: DiagnosisHit[] = [];

	const characterizations = raw.characterizations.filter((c) => {
		if (findDiagnosisLanguage(`${c.descriptor}. ${c.evidence}`)) {
			removed.push({
				field: "characterizations",
				sentence: `${c.descriptor} - ${c.evidence}`,
			});
			return false;
		}
		return true;
	});

	const conditions = stripDiagnosisSentences(raw.conditions_summary, "conditions_summary");
	removed.push(...conditions.removed);

	let summary = stripDiagnosisSentences(raw.professional_summary, "professional_summary");
	removed.push(...summary.removed);
	for (const sentence of findFabricatedNumbers(summary.text, features)) {
		removed.push({ field: "professional_summary (measured-number mismatch)", sentence });
		summary = {
			...summary,
			text: summary.text
				.replace(sentence, "")
				.replace(/\s{2,}/g, " ")
				.trim(),
		};
	}

	const likelyQuestions = raw.likely_questions.filter((q) => {
		if (findDiagnosisLanguage(`${q.question} ${q.how_to_find_out}`, false)) {
			removed.push({ field: "likely_questions", sentence: q.question });
			return false;
		}
		return true;
	});

	let notes: string | null = raw.recording_notes;
	if (notes !== null) {
		const cleaned = stripDiagnosisSentences(notes, "recording_notes");
		removed.push(...cleaned.removed);
		notes = cleaned.text.length > 0 ? cleaned.text : null;
	}

	return {
		description: {
			characterizations,
			conditions_summary: conditions.text,
			professional_summary: summary.text,
			likely_questions: likelyQuestions,
			recording_notes: notes,
		},
		stripped: removed.map((hit) => `[${hit.field}] ${hit.sentence}`),
	};
}

// ---------------------------------------------------------------------------
// Request validation (worker-side; also reused by evals)

const isMeasuredFeatures = (value: unknown): value is MeasuredFeatures => {
	if (value === null || typeof value !== "object") return false;
	const f = value as Record<string, unknown>;
	return (
		typeof f.duration_s === "number" &&
		typeof f.effective_duration_s === "number" &&
		(f.pattern === "continuous" ||
			f.pattern === "intermittent" ||
			f.pattern === "single_event") &&
		(f.event_rate_hz === null || typeof f.event_rate_hz === "number") &&
		(f.regularity === null ||
			f.regularity === "highly_regular" ||
			f.regularity === "somewhat_regular" ||
			f.regularity === "erratic") &&
		(f.spectral_character === "low" ||
			f.spectral_character === "mid" ||
			f.spectral_character === "high" ||
			f.spectral_character === "broadband") &&
		Array.isArray(f.dominant_bands_hz) &&
		f.dominant_bands_hz.length <= 3 &&
		f.dominant_bands_hz.every((b) => typeof b === "number" && Number.isFinite(b)) &&
		(f.pitch_trend === "steady" ||
			f.pitch_trend === "rising" ||
			f.pitch_trend === "falling" ||
			f.pitch_trend === "varying")
	);
};

const isShortString = (value: unknown): value is string =>
	typeof value === "string" && value.length <= MAX_CONTEXT_FIELD_CHARS;

const isNoiseContext = (value: unknown): value is NoiseContext => {
	if (value === null || typeof value !== "object") return false;
	const c = value as Record<string, unknown>;
	return (
		MACHINE_TYPES.includes(c.machine_type as MachineType) &&
		isShortString(c.machine_type_other) &&
		WHEN_IT_HAPPENS.includes(c.when_it_happens as WhenItHappens) &&
		SPEED_RESPONSES.includes(c.changes_with_speed as SpeedResponse) &&
		isShortString(c.how_long) &&
		isShortString(c.recent_changes) &&
		(c.safety_screen === "yes" || c.safety_screen === "no") &&
		isShortString(c.safety_screen_detail)
	);
};

/**
 * Validates a describe-noise request body. Returns the typed request or a
 * user-facing error string. The worker ALSO re-runs the safety gate here - a
 * defense-in-depth backstop in case a caller bypasses the client-side gate.
 */
export function validateDescribeNoiseRequest(value: unknown): DescribeNoiseRequest | string {
	if (value === null || typeof value !== "object") {
		return "Request body must be a JSON object.";
	}
	const body = value as Record<string, unknown>;
	const png = body.spectrogramPngBase64;
	if (typeof png !== "string" || png.length === 0) {
		return "spectrogramPngBase64 must be a non-empty base64 string.";
	}
	if (!/^[A-Za-z0-9+/]+=*$/.test(png)) {
		return "spectrogramPngBase64 is not valid base64.";
	}
	if (!isMeasuredFeatures(body.features)) {
		return "features does not match the measured-features shape.";
	}
	if (!isNoiseContext(body.context)) {
		return "context does not match the guided-form shape.";
	}
	return {
		spectrogramPngBase64: png,
		features: body.features,
		context: body.context,
	};
}
