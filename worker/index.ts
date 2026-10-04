import Anthropic from "@anthropic-ai/sdk";
import { MAX_LEASE_CHARS, type LeaseComparison } from "../src/lib/lease-diff";
import { MAX_NOTE_CHARS, type StructuredNote } from "../src/lib/structured-note";
import {
	ALLOWED_MEDIA_TYPES,
	MAX_IMAGE_BYTES,
	type AllowedMediaType,
	type UiAnalysis,
} from "../src/lib/ui-analysis";
import {
	MAX_PAPERWORK_CHARS,
	MAX_PAPERWORK_IMAGES,
	type ObligationExtraction,
} from "../src/lib/paperwork";
import { todayUtcIso } from "../src/lib/paperwork-dates";
import { analyzeScreenshot } from "../src/lib/pipelines/analyze-screenshot";
import { compareLeases } from "../src/lib/pipelines/compare-leases";
import {
	extractObligations,
	type PaperworkImage,
	type PaperworkInput,
} from "../src/lib/pipelines/extract-obligations";
import { describeNoise } from "../src/lib/pipelines/describe-noise";
import { PipelineOutputError } from "../src/lib/pipelines/shared";
import {
	evaluateSafetyGate,
	validateDescribeNoiseRequest,
	type DescribeNoiseResponse,
} from "../src/lib/noise-translator";
import { planUpgrades } from "../src/lib/pipelines/plan-upgrades";
import { simulatePlan } from "../src/lib/pipelines/simulate-plan";
import { structureNote } from "../src/lib/pipelines/structure-note";
import { validateSimulateRequest, type SimulationResult } from "../src/lib/dry-run-oracle";
import {
	validatePlanRequestFacts,
	type UpgradePlanResult,
} from "../src/lib/upgrade-planner";

// Each handler here is a thin wrapper: rate limiting, input validation, and
// error mapping. The actual model pipelines (prompt assembly, API call,
// schema-validated parse) live in src/lib/pipelines/ and are shared with the
// sample-generation scripts and the eval runner (scripts/evals/), so the
// published eval results exercise exactly this production code path.

interface Env {
	// Set via `wrangler secret put ANTHROPIC_API_KEY` (or the Cloudflare
	// dashboard). Never lives in the repo or the client bundle.
	ANTHROPIC_API_KEY: string;
	// Optional model override for the lease comparison endpoint only.
	LEASE_DIFF_MODEL?: string;
	// Optional model override for the paperwork extraction endpoint. The
	// pipeline defaults to Sonnet because Haiku missed month-boundary date
	// arithmetic (see extract-obligations.ts) - don't downgrade without the
	// eval suite's computed-date cases passing.
	PAPERWORK_MODEL?: string;
	// Optional model override for the upgrade-plan synthesis endpoint. Haiku
	// by default - see plan-upgrades.ts for why the cheap model is safe here.
	UPGRADE_PLANNER_MODEL?: string;
	// Optional model override for the Dry-Run Oracle simulation endpoint.
	// Haiku by default - the demo's entire premise is a cheap-model forecast.
	DRY_RUN_ORACLE_MODEL?: string;
	// Optional model override for the noise-description endpoint. Sonnet by
	// default - spectrogram reading is hard perception work (see
	// describe-noise.ts); Haiku is the cheap fallback if cost ever matters
	// more than characterization quality.
	NOISE_TRANSLATOR_MODEL?: string;
}

// Simple in-memory limiters. Workers isolates are ephemeral and per-PoP, so
// these are best-effort rather than global guarantees - fine for a demo whose
// real cost ceilings are the input caps and the small model.
function createRateLimiter(max: number, windowMs: number) {
	const log = new Map<string, number[]>();
	return (ip: string): boolean => {
		const now = Date.now();
		const recent = (log.get(ip) ?? []).filter((t) => now - t < windowMs);
		if (recent.length >= max) {
			log.set(ip, recent);
			return true;
		}
		recent.push(now);
		log.set(ip, recent);
		return false;
	};
}

const noteLimiter = createRateLimiter(10, 60_000); // 10/min/IP
// Vision calls cost more - stricter per-minute limit plus a modest daily cap.
const screenshotLimiter = createRateLimiter(5, 60_000); // 5/min/IP
const screenshotDailyLimiter = createRateLimiter(40, 86_400_000); // 40/day/IP
// Two full-length documents on Sonnet make this by far the most token-heavy
// endpoint - tighter caps than the other demos bound the worst-case spend.
const leaseLimiter = createRateLimiter(6, 60_000); // 6/min/IP
const leaseDailyLimiter = createRateLimiter(20, 86_400_000); // 20/day/IP
// Paperwork extraction accepts text or up to 3 vision images per request -
// vision-call pricing sets the daily cap, like the screenshot endpoint.
const paperworkLimiter = createRateLimiter(6, 60_000); // 6/min/IP
const paperworkDailyLimiter = createRateLimiter(30, 86_400_000); // 30/day/IP
// Upgrade-plan synthesis is text-only Haiku with a hard-capped facts payload
// - cheap per call, but the input is fully attacker-shapeable JSON, so the
// same per-minute/daily pattern applies.
const upgradePlanLimiter = createRateLimiter(6, 60_000); // 6/min/IP
const upgradePlanDailyLimiter = createRateLimiter(30, 86_400_000); // 30/day/IP
// The oracle is text-only Haiku with a 1.5K output cap - cheap per call, and
// the client also caches forecasts by plan hash, so repeat submissions of an
// unchanged plan never reach this endpoint at all.
const simulatePlanLimiter = createRateLimiter(6, 60_000); // 6/min/IP
const simulatePlanDailyLimiter = createRateLimiter(40, 86_400_000); // 40/day/IP
// One Sonnet vision call per request over a small fixed-size spectrogram PNG
// - same cost profile as the other vision endpoints, same cap pattern.
const describeNoiseLimiter = createRateLimiter(6, 60_000); // 6/min/IP
const describeNoiseDailyLimiter = createRateLimiter(30, 86_400_000); // 30/day/IP

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
		},
	});
}

function friendlyApiError(error: unknown, malformedMessage: string): Response {
	if (error instanceof PipelineOutputError) {
		return json({ error: malformedMessage }, 502);
	}
	if (error instanceof Anthropic.RateLimitError) {
		return json(
			{ error: "The AI service is busy right now. Please try again in a moment." },
			429,
		);
	}
	if (error instanceof Anthropic.APIConnectionError) {
		return json({ error: "Couldn't reach the AI service. Please try again." }, 502);
	}
	if (error instanceof Anthropic.APIError) {
		console.error("Anthropic API error", error.status, error.message);
		return json(
			{ error: "Something went wrong analyzing the request. Please try again." },
			502,
		);
	}
	console.error("Unexpected error", error);
	return json({ error: "Unexpected server error. Please try again." }, 500);
}

async function handleStructureNote(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (noteLimiter(ip)) {
		return json(
			{ error: "Whoa - that's a lot of notes! Please wait a minute and try again." },
			429,
		);
	}

	let noteText: unknown;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		noteText = body.noteText;
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	if (typeof noteText !== "string" || noteText.trim().length === 0) {
		return json({ error: "noteText must be a non-empty string." }, 400);
	}
	if (noteText.length > MAX_NOTE_CHARS) {
		return json(
			{ error: `noteText must be at most ${MAX_NOTE_CHARS} characters.` },
			400,
		);
	}

	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	try {
		const result: StructuredNote = await structureNote(anthropic, noteText);
		return json(result, 200);
	} catch (error) {
		return friendlyApiError(
			error,
			"The model did not return a structured result. Please try again.",
		);
	}
}

async function handleAnalyzeScreenshot(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (screenshotLimiter(ip)) {
		return json(
			{ error: "Please wait a minute between batches of screenshots and try again." },
			429,
		);
	}
	if (screenshotDailyLimiter(ip)) {
		return json(
			{ error: "You've hit today's analysis limit for this demo. Come back tomorrow!" },
			429,
		);
	}

	let imageData: unknown;
	let mediaType: unknown;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		imageData = body.imageData;
		mediaType = body.mediaType;
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	if (typeof imageData !== "string" || imageData.length === 0) {
		return json({ error: "imageData must be a non-empty base64 string." }, 400);
	}
	if (
		typeof mediaType !== "string" ||
		!ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)
	) {
		return json(
			{ error: `mediaType must be one of: ${ALLOWED_MEDIA_TYPES.join(", ")}.` },
			400,
		);
	}
	if (!/^[A-Za-z0-9+/]+=*$/.test(imageData)) {
		return json({ error: "imageData is not valid base64." }, 400);
	}
	const decodedBytes = Math.floor((imageData.length * 3) / 4);
	if (decodedBytes > MAX_IMAGE_BYTES) {
		return json(
			{ error: "Image is too large. Please upload a smaller screenshot." },
			400,
		);
	}

	// Privacy: the image is held in memory for this request only - never
	// written to storage and never logged (metadata only, below).
	const startedAt = Date.now();
	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	try {
		const result: UiAnalysis = await analyzeScreenshot(
			anthropic,
			imageData,
			mediaType as AllowedMediaType,
		);
		console.log(
			`analyze-screenshot outcome=ok bytes=${decodedBytes} duration_ms=${Date.now() - startedAt}`,
		);
		return json(result, 200);
	} catch (error) {
		const outcome = error instanceof PipelineOutputError ? "malformed" : "error";
		console.log(
			`analyze-screenshot outcome=${outcome} bytes=${decodedBytes} duration_ms=${Date.now() - startedAt}`,
		);
		return friendlyApiError(
			error,
			"The model did not return a complete analysis. Please try again.",
		);
	}
}

async function handleCompareLeases(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (leaseLimiter(ip)) {
		return json(
			{ error: "Please wait a minute between comparisons and try again." },
			429,
		);
	}
	if (leaseDailyLimiter(ip)) {
		return json(
			{ error: "You've hit today's comparison limit for this demo. Come back tomorrow!" },
			429,
		);
	}

	let originalText: unknown;
	let revisedText: unknown;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		originalText = body.originalText;
		revisedText = body.revisedText;
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	if (typeof originalText !== "string" || originalText.trim().length === 0) {
		return json({ error: "originalText must be a non-empty string." }, 400);
	}
	if (typeof revisedText !== "string" || revisedText.trim().length === 0) {
		return json({ error: "revisedText must be a non-empty string." }, 400);
	}
	if (originalText.length > MAX_LEASE_CHARS || revisedText.length > MAX_LEASE_CHARS) {
		return json(
			{ error: `Each document must be at most ${MAX_LEASE_CHARS} characters.` },
			400,
		);
	}
	// Defense in depth behind the client-side short-circuit.
	if (originalText.trim() === revisedText.trim()) {
		return json(
			{ error: "The two documents are identical - there's nothing to compare." },
			400,
		);
	}

	// Privacy: both documents are held in memory for this request only -
	// never written to storage and never logged (metadata only, below).
	const startedAt = Date.now();
	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	try {
		const result: LeaseComparison = await compareLeases(
			anthropic,
			originalText,
			revisedText,
			env.LEASE_DIFF_MODEL,
		);
		console.log(
			`compare-leases outcome=ok original_chars=${originalText.length} revised_chars=${revisedText.length} duration_ms=${Date.now() - startedAt}`,
		);
		return json(result, 200);
	} catch (error) {
		const outcome = error instanceof PipelineOutputError ? "malformed" : "error";
		console.log(
			`compare-leases outcome=${outcome} original_chars=${originalText.length} revised_chars=${revisedText.length} duration_ms=${Date.now() - startedAt}`,
		);
		return friendlyApiError(
			error,
			"The model did not return a complete comparison. Please try again.",
		);
	}
}

// Validates one image entry of the paperwork request body. Reuses the
// screenshot endpoint's limits - the client sends the same canvas-re-encoded
// JPEGs through the same prep pipeline.
function validatePaperworkImage(value: unknown): PaperworkImage | string {
	if (value === null || typeof value !== "object") {
		return "Each image must be an object with imageData and mediaType.";
	}
	const { imageData, mediaType } = value as Record<string, unknown>;
	if (typeof imageData !== "string" || imageData.length === 0) {
		return "imageData must be a non-empty base64 string.";
	}
	if (
		typeof mediaType !== "string" ||
		!ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)
	) {
		return `mediaType must be one of: ${ALLOWED_MEDIA_TYPES.join(", ")}.`;
	}
	if (!/^[A-Za-z0-9+/]+=*$/.test(imageData)) {
		return "imageData is not valid base64.";
	}
	if (Math.floor((imageData.length * 3) / 4) > MAX_IMAGE_BYTES) {
		return "An image is too large. Please retake or crop the photo.";
	}
	return { imageData, mediaType: mediaType as AllowedMediaType };
}

async function handleExtractObligations(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (paperworkLimiter(ip)) {
		return json(
			{ error: "Please wait a minute between documents and try again." },
			429,
		);
	}
	if (paperworkDailyLimiter(ip)) {
		return json(
			{ error: "You've hit today's extraction limit for this demo. Come back tomorrow!" },
			429,
		);
	}

	let documentText: unknown;
	let images: unknown;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		documentText = body.documentText;
		images = body.images;
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	// Exactly one input mode: pasted/extracted text, or photographed pages.
	if ((documentText === undefined) === (images === undefined)) {
		return json({ error: "Provide either documentText or images, not both." }, 400);
	}

	let input: PaperworkInput;
	let sizeLabel: string;
	if (documentText !== undefined) {
		if (typeof documentText !== "string" || documentText.trim().length === 0) {
			return json({ error: "documentText must be a non-empty string." }, 400);
		}
		if (documentText.length > MAX_PAPERWORK_CHARS) {
			return json(
				{ error: `documentText must be at most ${MAX_PAPERWORK_CHARS} characters.` },
				400,
			);
		}
		input = { documentText };
		sizeLabel = `chars=${documentText.length}`;
	} else {
		if (!Array.isArray(images) || images.length === 0 || images.length > MAX_PAPERWORK_IMAGES) {
			return json(
				{ error: `images must contain 1 to ${MAX_PAPERWORK_IMAGES} entries.` },
				400,
			);
		}
		const validated: PaperworkImage[] = [];
		for (const entry of images) {
			const result = validatePaperworkImage(entry);
			if (typeof result === "string") return json({ error: result }, 400);
			validated.push(result);
		}
		input = { images: validated };
		sizeLabel = `images=${validated.length}`;
	}

	// Privacy: the document (text or photos) is held in memory for this
	// request only - never written to storage and never logged (metadata
	// only, below).
	const startedAt = Date.now();
	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	try {
		const result: ObligationExtraction = await extractObligations(
			anthropic,
			input,
			todayUtcIso(),
			env.PAPERWORK_MODEL,
		);
		console.log(
			`extract-obligations outcome=ok ${sizeLabel} duration_ms=${Date.now() - startedAt}`,
		);
		return json(result, 200);
	} catch (error) {
		const outcome = error instanceof PipelineOutputError ? "malformed" : "error";
		console.log(
			`extract-obligations outcome=${outcome} ${sizeLabel} duration_ms=${Date.now() - startedAt}`,
		);
		return friendlyApiError(
			error,
			"The model did not return a complete extraction. Please try again.",
		);
	}
}

async function handlePlanUpgrades(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (upgradePlanLimiter(ip)) {
		return json({ error: "Please wait a minute between plans and try again." }, 429);
	}
	if (upgradePlanDailyLimiter(ip)) {
		return json(
			{ error: "You've hit today's planning limit for this demo. Come back tomorrow!" },
			429,
		);
	}

	let rawFacts: unknown;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		rawFacts = body.facts;
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	// The payload is the distilled DependencyFact projection the browser
	// computed against the npm registry - validated field by field (shape,
	// entry cap, per-string caps, total size) before it can reach the prompt.
	const facts = validatePlanRequestFacts(rawFacts);
	if (typeof facts === "string") {
		return json({ error: facts }, 400);
	}

	// Privacy: the dependency list is held in memory for this request only -
	// never written to storage and never logged (metadata only, below).
	const startedAt = Date.now();
	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	try {
		const result: UpgradePlanResult = await planUpgrades(
			anthropic,
			facts,
			env.UPGRADE_PLANNER_MODEL,
		);
		console.log(
			`plan-upgrades outcome=ok facts=${facts.length} warnings=${result.validation_warnings.length} duration_ms=${Date.now() - startedAt}`,
		);
		return json(result, 200);
	} catch (error) {
		const outcome = error instanceof PipelineOutputError ? "malformed" : "error";
		console.log(
			`plan-upgrades outcome=${outcome} facts=${facts.length} duration_ms=${Date.now() - startedAt}`,
		);
		return friendlyApiError(
			error,
			"The model did not return a complete upgrade plan. Please try again.",
		);
	}
}

async function handleSimulatePlan(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (simulatePlanLimiter(ip)) {
		return json(
			{ error: "The oracle needs a breather - please wait a minute between forecasts." },
			429,
		);
	}
	if (simulatePlanDailyLimiter(ip)) {
		return json(
			{ error: "You've hit today's forecast limit for this demo. Come back tomorrow!" },
			429,
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	// Field-by-field validation (step caps, per-string caps, exactly one of
	// steps | freeform) before anything can reach the prompt.
	const simulateRequest = validateSimulateRequest(body);
	if (typeof simulateRequest === "string") {
		return json({ error: simulateRequest }, 400);
	}

	// Privacy: the plan is held in memory for this request only - never
	// written to storage and never logged (metadata only, below).
	const startedAt = Date.now();
	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	const sizeLabel =
		simulateRequest.freeform !== undefined
			? `freeform_chars=${simulateRequest.freeform.length}`
			: `steps=${simulateRequest.steps?.length ?? 0}`;

	try {
		const result: SimulationResult = await simulatePlan(
			anthropic,
			simulateRequest,
			env.DRY_RUN_ORACLE_MODEL,
		);
		console.log(
			`simulate-plan outcome=ok ${sizeLabel} oracle_cost_usd=${result.oracleCostUsd.toFixed(5)} duration_ms=${Date.now() - startedAt}`,
		);
		return json(result, 200);
	} catch (error) {
		const outcome = error instanceof PipelineOutputError ? "malformed" : "error";
		console.log(
			`simulate-plan outcome=${outcome} ${sizeLabel} duration_ms=${Date.now() - startedAt}`,
		);
		return friendlyApiError(
			error,
			"The oracle did not return a complete forecast. Please try again.",
		);
	}
}

async function handleDescribeNoise(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (describeNoiseLimiter(ip)) {
		return json(
			{ error: "Please wait a minute between recordings and try again." },
			429,
		);
	}
	if (describeNoiseDailyLimiter(ip)) {
		return json(
			{ error: "You've hit today's description limit for this demo. Come back tomorrow!" },
			429,
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Request body must be JSON." }, 400);
	}

	// Field-by-field validation (spectrogram base64 + size, features shape,
	// context enums and per-field caps) before anything can reach the prompt.
	const noiseRequest = validateDescribeNoiseRequest(body);
	if (typeof noiseRequest === "string") {
		return json({ error: noiseRequest }, 400);
	}
	const decodedBytes = Math.floor((noiseRequest.spectrogramPngBase64.length * 3) / 4);
	if (decodedBytes > MAX_IMAGE_BYTES) {
		return json({ error: "The spectrogram payload is too large." }, 400);
	}

	// Defense in depth: the browser runs this same gate before ever calling
	// the API, but a hand-crafted request could skip it - a danger phrase in
	// the context answers must never reach the model from any caller.
	const safety = evaluateSafetyGate(noiseRequest.context);
	if (safety.blocked) {
		return json(
			{
				error:
					"This describes a potential safety hazard. Stop using the equipment and contact a professional or emergency service now.",
			},
			400,
		);
	}

	// Privacy: only the derived artifacts ever arrive here - spectrogram PNG,
	// measured features, and form answers; raw audio never leaves the browser.
	// All of it is held in memory for this request only, never written to
	// storage and never logged (metadata only, below).
	const startedAt = Date.now();
	const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	try {
		const result: DescribeNoiseResponse = await describeNoise(
			anthropic,
			noiseRequest.spectrogramPngBase64,
			noiseRequest.features,
			noiseRequest.context,
			env.NOISE_TRANSLATOR_MODEL,
		);
		if (result.stripped.length > 0) {
			// The deny-list fired - log the count (never the content) so drift
			// in the model's discipline is visible in the logs.
			console.log(`describe-noise stripped=${result.stripped.length}`);
		}
		console.log(
			`describe-noise outcome=ok bytes=${decodedBytes} duration_ms=${Date.now() - startedAt}`,
		);
		return json(result, 200);
	} catch (error) {
		const outcome = error instanceof PipelineOutputError ? "malformed" : "error";
		console.log(
			`describe-noise outcome=${outcome} bytes=${decodedBytes} duration_ms=${Date.now() - startedAt}`,
		);
		return friendlyApiError(
			error,
			"The model did not return a complete description. Please try again.",
		);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		// Static assets handle everything else (see wrangler.jsonc
		// run_worker_first) - the Worker only ever sees /api/* requests.
		if (url.pathname === "/api/structure-note") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handleStructureNote(request, env);
		}
		if (url.pathname === "/api/analyze-screenshot") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handleAnalyzeScreenshot(request, env);
		}
		if (url.pathname === "/api/compare-leases") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handleCompareLeases(request, env);
		}
		if (url.pathname === "/api/extract-obligations") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handleExtractObligations(request, env);
		}
		if (url.pathname === "/api/plan-upgrades") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handlePlanUpgrades(request, env);
		}
		if (url.pathname === "/api/simulate-plan") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handleSimulatePlan(request, env);
		}
		if (url.pathname === "/api/describe-noise") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed." }, 405);
			}
			return handleDescribeNoise(request, env);
		}
		return json({ error: "Not found." }, 404);
	},
};
