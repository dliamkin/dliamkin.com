import {
	env,
	pipeline,
	type TokenClassificationPipeline,
} from "@huggingface/transformers";
import { assembleMedications } from "../med-extractor/assembler";
import { decodeBio, type TokenTag } from "../med-extractor/decode";
import type { BioLabel } from "../med-extractor/labels";
import type { Medication } from "../structured-note";

// Browser-side inference for the distilled medication extractor. The model runs
// ENTIRELY in the visitor's browser: it is served from this site's own origin
// (/models/med-extractor/), never the Hugging Face hub, and makes zero network
// calls at inference time. It downloads only on an explicit user action (the
// "Load local model" button), caches via the browser Cache API for instant
// repeat visits, and reports which backend actually ran.

// Never resolve models from the HF hub - only from our own /models/ path.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
// Serve the ONNX-runtime WASM binaries from our own origin too (copied into
// public/ort by the build) so a WASM run also never phones home.
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";

const MODEL_ID = "med-extractor";

export type Backend = "webgpu" | "wasm";

export interface LoadProgress {
	stage: "downloading" | "loading" | "ready";
	file?: string;
	/** 0–100 overall download progress, best-effort across files. */
	percent: number;
	fromCache: boolean;
}

export interface LocalModelInfo {
	backend: Backend;
	loadMs: number;
	/** True when the weights came from the Cache API rather than the network. */
	fromCache: boolean;
}

export interface LocalInference {
	medications: Medication[];
	latencyMs: number;
	backend: Backend;
}

let pipe: TokenClassificationPipeline | null = null;
let info: LocalModelInfo | null = null;

async function webgpuAvailable(): Promise<boolean> {
	const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
	if (!nav.gpu) return false;
	try {
		return (await nav.gpu.requestAdapter()) != null;
	} catch {
		return false;
	}
}

/** Whether the model is already resident in this tab (no download needed). */
export function isLoaded(): boolean {
	return pipe != null;
}

export function loadedInfo(): LocalModelInfo | null {
	return info;
}

// A raw per-token result from the token-classification pipeline (aggregation
// 'none'): a label plus character offsets into the input.
interface RawToken {
	entity: string;
	start: number;
	end: number;
}

/**
 * Download (if needed) and initialize the model. Tries WebGPU, falls back to
 * WASM. `onProgress` fires during the one-time download with a real percentage.
 */
export async function loadLocalModel(onProgress?: (p: LoadProgress) => void): Promise<LocalModelInfo> {
	if (info) return info;
	const started = performance.now();
	let sawDownload = false;

	const progress = (event: { status: string; file?: string; progress?: number }) => {
		if (event.status === "progress") {
			sawDownload = true;
			onProgress?.({ stage: "downloading", file: event.file, percent: Math.round(event.progress ?? 0), fromCache: false });
		} else if (event.status === "ready" || event.status === "done") {
			onProgress?.({ stage: "loading", percent: 100, fromCache: !sawDownload });
		}
	};

	// pipeline()'s overloads infer a union across every task type that TS can't
	// represent; retype the function to the single signature we use so it is
	// never computed.
	const createPipeline = pipeline as unknown as (
		task: "token-classification",
		model: string,
		options: Record<string, unknown>,
	) => Promise<TokenClassificationPipeline>;
	const makePipe = (device: Backend) =>
		createPipeline("token-classification", MODEL_ID, {
			dtype: "q8", // loads onnx/model_quantized.onnx (int8)
			device,
			progress_callback: progress,
		});

	const backend: Backend = (await webgpuAvailable()) ? "webgpu" : "wasm";
	try {
		pipe = await makePipe(backend);
		info = { backend, loadMs: performance.now() - started, fromCache: !sawDownload };
	} catch (error) {
		if (backend === "webgpu") {
			// WebGPU init can fail on some drivers - fall back to WASM once.
			pipe = await makePipe("wasm");
			info = { backend: "wasm", loadMs: performance.now() - started, fromCache: !sawDownload };
		} else {
			throw error;
		}
	}
	onProgress?.({ stage: "ready", percent: 100, fromCache: info.fromCache });
	return info;
}

/**
 * Run the loaded model on one note and assemble Medication[] via the shared,
 * unit-tested decoder + assembler (the same code the eval runner uses).
 */
export async function extractLocal(note: string): Promise<LocalInference> {
	if (!pipe || !info) throw new Error("Local model not loaded - call loadLocalModel() first.");
	const started = performance.now();
	// aggregation_strategy 'none' + ignore_labels [] → one result per token,
	// including O, so the BIO decoder sees run boundaries. The pipeline's own
	// call signature is a very wide union; narrow it to the shape we use.
	const run = pipe as unknown as (
		text: string,
		options?: Record<string, unknown>,
	) => Promise<RawToken[]>;
	const raw = await run(note, { ignore_labels: [] });
	const tokens: TokenTag[] = raw
		.filter((t) => typeof t.start === "number" && typeof t.end === "number")
		.map((t) => ({ start: t.start, end: t.end, label: t.entity as BioLabel }));
	const medications = assembleMedications(note, decodeBio(note, tokens));
	return { medications, latencyMs: performance.now() - started, backend: info.backend };
}
