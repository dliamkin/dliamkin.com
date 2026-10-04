import type { ColumnSpec, FormationName, FormationParams } from "./types";

/**
 * Formation target generators. Each is a pure function
 * (n, width, height, params) → Float32Array of interleaved [x, y] targets in
 * CSS pixels. "storm" has no targets (the engine runs flow-field physics
 * instead) and returns null.
 *
 * Determinism: generators use golden-ratio / hash sequences instead of
 * Math.random so the same inputs always produce the same shape - this keeps
 * them unit-testable and makes formation transitions repeatable.
 */

export const MAX_TEXT_LENGTH = 12;
export const DEFAULT_TEXT = "DLIAMKIN";

const GOLDEN = 0.6180339887498949;

/** Distance kept between the bottom of a shape and the viewport bottom. */
const BASELINE_OFFSET = 70;

export const DEFAULT_COLUMNS: ColumnSpec[] = [
	{ fraction: 0.45, paletteIndex: 1 },
	{ fraction: 0.8, paletteIndex: 0 },
	{ fraction: 0.3, paletteIndex: 2 },
	{ fraction: 0.55, paletteIndex: 3 },
];

const frac = (v: number): number => v - Math.floor(v);

/** Deterministic per-index shuffle position in [0, mod). */
const hashIndex = (i: number, mod: number): number => ((i * 0x9e3779b1) >>> 0) % mod;

/**
 * Canvas creation is injectable so the text sampler can run under vitest's
 * jsdom (which has no 2D context) with a node canvas implementation.
 */
export interface TextCanvas2D {
	font: string;
	textAlign: string;
	textBaseline: string;
	fillStyle: string | CanvasGradient | CanvasPattern;
	fillText(text: string, x: number, y: number): void;
	getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

export type CanvasFactory = (width: number, height: number) => TextCanvas2D | null;

const domCanvasFactory: CanvasFactory = (width, height) => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas.getContext("2d", { willReadFrequently: true });
};

/**
 * Rasterizes `text` to an offscreen canvas and samples filled pixels on a 3px
 * grid. Returns interleaved [x, y] pairs; empty when the text renders to
 * nothing (empty string, no canvas support).
 */
export function sampleTextPoints(
	text: string,
	width: number,
	height: number,
	canvasFactory: CanvasFactory = domCanvasFactory,
): Float32Array {
	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));
	const label = text.trim().slice(0, MAX_TEXT_LENGTH).toUpperCase();
	if (!label) return new Float32Array(0);

	const ctx = canvasFactory(w, h);
	if (!ctx) return new Float32Array(0);

	const fontSize = Math.min(150, w / 6.4);
	ctx.font = `900 ${fontSize}px "Raleway", sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#ffffff";
	ctx.fillText(label, w / 2, h / 2);

	const data = ctx.getImageData(0, 0, w, h).data;
	const points: number[] = [];
	for (let sy = 0; sy < h; sy += 3) {
		const rowOffset = sy * w;
		for (let sx = 0; sx < w; sx += 3) {
			if (data[(rowOffset + sx) * 4 + 3]! > 128) points.push(sx, sy);
		}
	}
	return Float32Array.from(points);
}

function textFormation(
	n: number,
	width: number,
	height: number,
	text: string,
	canvasFactory?: CanvasFactory,
): Float32Array {
	const points = sampleTextPoints(text, width, height, canvasFactory);
	const pairCount = points.length / 2;
	// Unrenderable text (or no canvas) degrades to the converge cluster rather
	// than leaving stale targets around.
	if (pairCount === 0) return convergeFormation(n, width, height);

	const out = new Float32Array(n * 2);
	for (let i = 0; i < n; i++) {
		const p = hashIndex(i, pairCount) * 2;
		out[i * 2] = points[p]! + (frac(i * GOLDEN) - 0.5) * 2.4;
		out[i * 2 + 1] = points[p + 1]! + (frac(i * GOLDEN * 7 + 0.29) - 0.5) * 2.4;
	}
	return out;
}

/**
 * The fat-tailed cost curve from the Tail Risk Lab: a lognormal-ish density -
 * sharp bump near the left, long exponential-looking right tail. Particles
 * fill the area under the curve via inverse-CDF sampling so horizontal
 * density follows the curve mass.
 */
function distributionDensity(u: number): number {
	if (u <= 0.004) return 0;
	const z = (Math.log(u) - Math.log(0.22)) / 0.6;
	return Math.exp((-z * z) / 2) / u;
}

function distributionFormation(n: number, width: number, height: number): Float32Array {
	const out = new Float32Array(n * 2);
	const baseline = height - BASELINE_OFFSET;
	const left = width * 0.08;
	const span = width * 0.84;
	const maxShapeHeight = Math.min(height * 0.5, baseline - height * 0.15);

	const BINS = 256;
	const cdf = new Float32Array(BINS);
	let total = 0;
	let peak = 0;
	for (let b = 0; b < BINS; b++) {
		const d = distributionDensity((b + 0.5) / BINS);
		total += d;
		peak = Math.max(peak, d);
		cdf[b] = total;
	}

	let bin = 0;
	for (let i = 0; i < n; i++) {
		const q = ((i + 0.5) / n) * total;
		while (bin < BINS - 1 && cdf[bin]! < q) bin++;
		const u = (bin + frac(i * GOLDEN * 3 + 0.17)) / BINS;
		const curveHeight = (distributionDensity(u) / peak) * maxShapeHeight;
		out[i * 2] = left + u * span;
		out[i * 2 + 1] = baseline - frac(i * GOLDEN) * Math.max(curveHeight, 1.5);
	}
	return out;
}

/** Particle count per column, proportional to fraction, summing to exactly n. */
export function columnCounts(n: number, specs: readonly ColumnSpec[]): number[] {
	const totalFraction = specs.reduce((sum, s) => sum + s.fraction, 0) || 1;
	const counts = specs.map((s) => Math.floor((s.fraction / totalFraction) * n));
	let assigned = counts.reduce((sum, c) => sum + c, 0);
	for (let c = 0; assigned < n; c = (c + 1) % counts.length) {
		counts[c]!++;
		assigned++;
	}
	return counts;
}

function columnsFormation(
	n: number,
	width: number,
	height: number,
	specs: readonly ColumnSpec[],
): Float32Array {
	const out = new Float32Array(n * 2);
	const counts = columnCounts(n, specs);
	const baseline = height - BASELINE_OFFSET;
	const bandWidth = (width * 0.7) / specs.length;
	const barWidth = bandWidth * 0.62;
	const x0 = width * 0.15;
	const maxFraction = specs.reduce((max, s) => Math.max(max, s.fraction), 0) || 1;
	const maxShapeHeight = Math.min(height * 0.5, baseline - height * 0.15);

	let i = 0;
	for (let c = 0; c < specs.length; c++) {
		const columnHeight = Math.max((specs[c]!.fraction / maxFraction) * maxShapeHeight, 4);
		const columnLeft = x0 + c * bandWidth + (bandWidth - barWidth) / 2;
		for (let j = 0; j < counts[c]!; j++, i++) {
			out[i * 2] = columnLeft + frac(i * GOLDEN) * barWidth;
			out[i * 2 + 1] = baseline - frac(i * GOLDEN * 7 + 0.37) * columnHeight;
		}
	}
	return out;
}

/** Tight ring cluster at the viewport center - used mid-route-transition. */
function convergeFormation(n: number, width: number, height: number): Float32Array {
	const out = new Float32Array(n * 2);
	const cx = width / 2;
	const cy = height / 2;
	const radius = Math.min(width, height) * 0.14;
	const GOLDEN_ANGLE = 2.399963229728653;
	for (let i = 0; i < n; i++) {
		const a = i * GOLDEN_ANGLE;
		const r = radius * (0.75 + 0.5 * frac(i * GOLDEN));
		out[i * 2] = cx + Math.cos(a) * r;
		out[i * 2 + 1] = cy + Math.sin(a) * r;
	}
	return out;
}

export function computeFormation(
	name: FormationName,
	n: number,
	width: number,
	height: number,
	params: FormationParams = {},
	canvasFactory?: CanvasFactory,
): Float32Array | null {
	switch (name) {
		case "storm":
			return null;
		case "text":
			return textFormation(n, width, height, params.text ?? DEFAULT_TEXT, canvasFactory);
		case "distribution":
			return distributionFormation(n, width, height);
		case "columns":
			return columnsFormation(n, width, height, params.columns ?? DEFAULT_COLUMNS);
		case "converge":
			return convergeFormation(n, width, height);
	}
}
