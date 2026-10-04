// Spectrogram computation and rendering. The rendered PNG is a *document* the
// model reads, not decoration: time and frequency axes are burned into the
// image so timings and pitches can be read straight off it. The draw path is
// written against a minimal structural canvas interface so the exact same
// code runs on a browser <canvas> and on @napi-rs/canvas in Node (sample
// generation and evals).

import { magnitudeSpectrum } from "./fft";

export const SPECTROGRAM_WIDTH = 1200;
export const SPECTROGRAM_HEIGHT = 400;
/** Upper edge of the rendered frequency axis - machine noise lives below this. */
export const SPECTROGRAM_MAX_HZ = 8000;
/** Rendered dynamic range below the loudest bin, dB. */
const DYNAMIC_RANGE_DB = 70;

const FFT_SIZE = 1024;

export interface SpectrogramData {
	/** Log-magnitude values in dB, frame-major: db[frame * bins + bin]. */
	db: Float32Array;
	frames: number;
	bins: number;
	/** Seconds per frame hop. */
	hopS: number;
	/** Hz per bin. */
	binHz: number;
	maxDb: number;
	durationS: number;
}

/** STFT → log-magnitude spectrogram. Hop is chosen so ~1 frame per rendered pixel column. */
export function computeSpectrogram(pcm: Float32Array, sampleRate: number): SpectrogramData {
	const durationS = pcm.length / sampleRate;
	const plotWidth = SPECTROGRAM_WIDTH - AXIS_LEFT - AXIS_RIGHT;
	const hop = Math.max(64, Math.floor(pcm.length / plotWidth));
	const frames = Math.max(1, Math.floor((pcm.length - FFT_SIZE) / hop) + 1);
	const bins = FFT_SIZE / 2 + 1;
	const db = new Float32Array(frames * bins);
	let maxDb = -160;
	for (let f = 0; f < frames; f++) {
		const frame = pcm.subarray(f * hop, f * hop + FFT_SIZE);
		const mags = magnitudeSpectrum(frame, FFT_SIZE);
		for (let b = 0; b < bins; b++) {
			const v = 20 * Math.log10((mags[b] ?? 0) + 1e-9);
			db[f * bins + b] = v;
			maxDb = Math.max(maxDb, v);
		}
	}
	return {
		db,
		frames,
		bins,
		hopS: hop / sampleRate,
		binHz: sampleRate / FFT_SIZE,
		maxDb,
		durationS,
	};
}

// Inferno-like perceptual colormap: dark violet → red → orange → pale yellow.
// Anchors sampled from matplotlib's inferno; linear interpolation between them.
const COLORMAP: [number, number, number][] = [
	[0, 0, 4],
	[31, 12, 72],
	[85, 15, 109],
	[136, 34, 106],
	[186, 54, 85],
	[227, 89, 51],
	[249, 140, 10],
	[249, 201, 50],
	[252, 255, 164],
];

/** Map t in [0,1] to an RGB triple on the colormap. */
export function colormap(t: number): [number, number, number] {
	const clamped = Math.min(1, Math.max(0, t));
	const pos = clamped * (COLORMAP.length - 1);
	const i = Math.min(COLORMAP.length - 2, Math.floor(pos));
	const frac = pos - i;
	const a = COLORMAP[i] ?? [0, 0, 0];
	const b = COLORMAP[i + 1] ?? [0, 0, 0];
	return [
		Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac),
		Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac),
		Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac),
	];
}

// Plot margins: room for the burned-in axes.
const AXIS_LEFT = 64;
const AXIS_RIGHT = 16;
const AXIS_TOP = 14;
const AXIS_BOTTOM = 46;

/**
 * Minimal structural subset of CanvasRenderingContext2D used by
 * drawSpectrogram - satisfied by both the DOM context and @napi-rs/canvas.
 */
export interface SpectrogramContext {
	// string | object rather than the DOM's string | CanvasGradient |
	// CanvasPattern: this module is also type-checked under the worker
	// tsconfig, which has no DOM lib. Only strings are ever assigned here.
	fillStyle: string | object;
	strokeStyle: string | object;
	lineWidth: number;
	font: string;
	textAlign: string;
	textBaseline: string;
	fillRect(x: number, y: number, w: number, h: number): void;
	fillText(text: string, x: number, y: number): void;
	beginPath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	stroke(): void;
	save(): void;
	restore(): void;
	translate(x: number, y: number): void;
	rotate(angle: number): void;
	createImageData(
		w: number,
		h: number,
	): { data: Uint8ClampedArray; width: number; height: number };
	putImageData(
		imageData: { data: Uint8ClampedArray; width: number; height: number },
		x: number,
		y: number,
	): void;
}

/** Render the spectrogram with labeled axes onto a SPECTROGRAM_WIDTH × SPECTROGRAM_HEIGHT canvas context. */
export function drawSpectrogram(ctx: SpectrogramContext, spec: SpectrogramData): void {
	const width = SPECTROGRAM_WIDTH;
	const height = SPECTROGRAM_HEIGHT;
	const plotW = width - AXIS_LEFT - AXIS_RIGHT;
	const plotH = height - AXIS_TOP - AXIS_BOTTOM;

	ctx.fillStyle = "#0b0d12";
	ctx.fillRect(0, 0, width, height);

	// Heatmap into an ImageData buffer - one pixel at a time through fillRect
	// would be thousands of times slower.
	const image = ctx.createImageData(plotW, plotH);
	const floorDb = spec.maxDb - DYNAMIC_RANGE_DB;
	const maxBin = Math.min(spec.bins - 1, Math.floor(SPECTROGRAM_MAX_HZ / spec.binHz));
	for (let x = 0; x < plotW; x++) {
		const frame = Math.min(spec.frames - 1, Math.floor((x / plotW) * spec.frames));
		for (let y = 0; y < plotH; y++) {
			// y = 0 is the top of the plot = highest frequency.
			const hzFrac = 1 - y / plotH;
			const bin = Math.min(maxBin, Math.round(hzFrac * maxBin));
			const v = spec.db[frame * spec.bins + bin] ?? floorDb;
			const t = (v - floorDb) / DYNAMIC_RANGE_DB;
			const [r, g, b] = colormap(t);
			const idx = (y * plotW + x) * 4;
			image.data[idx] = r;
			image.data[idx + 1] = g;
			image.data[idx + 2] = b;
			image.data[idx + 3] = 255;
		}
	}
	ctx.putImageData(image, AXIS_LEFT, AXIS_TOP);

	// Axes: functional, not decorative - the model reads timings off them.
	ctx.strokeStyle = "#8b93a7";
	ctx.fillStyle = "#c8cede";
	ctx.lineWidth = 1;
	ctx.font = "12px sans-serif";

	// Time ticks: every second, or every 0.5 s for short clips.
	const tickStepS = spec.durationS <= 4 ? 0.5 : 1;
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	for (let t = 0; t <= spec.durationS + 1e-6; t += tickStepS) {
		const x = AXIS_LEFT + (t / spec.durationS) * plotW;
		if (x > width - AXIS_RIGHT + 1) break;
		ctx.beginPath();
		ctx.moveTo(x, AXIS_TOP + plotH);
		ctx.lineTo(x, AXIS_TOP + plotH + 5);
		ctx.stroke();
		ctx.fillText(t.toFixed(tickStepS < 1 ? 1 : 0), x, AXIS_TOP + plotH + 8);
	}
	ctx.fillText("Time (s)", AXIS_LEFT + plotW / 2, AXIS_TOP + plotH + 26);

	// Frequency ticks: every 1 kHz.
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	for (let khz = 0; khz <= SPECTROGRAM_MAX_HZ / 1000; khz++) {
		const y = AXIS_TOP + plotH - (khz * 1000 * plotH) / SPECTROGRAM_MAX_HZ;
		ctx.beginPath();
		ctx.moveTo(AXIS_LEFT - 5, y);
		ctx.lineTo(AXIS_LEFT, y);
		ctx.stroke();
		ctx.fillText(`${khz}k`, AXIS_LEFT - 8, y);
	}
	ctx.save();
	ctx.translate(14, AXIS_TOP + plotH / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("Frequency (Hz)", 0, 0);
	ctx.restore();

	// Legend line so the image is self-describing even out of context.
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	ctx.fillText("brighter = louder", width - AXIS_RIGHT, 1);
}
