// Preprocessing: decoded audio (any rate, any channel count) → the fixed-rate
// mono PCM the feature extractor and spectrogram consume. Clipping is measured
// BEFORE normalization - normalizing first would hide it.

export const ANALYSIS_SAMPLE_RATE = 22050;

/** Recording length hard cap, seconds - enforced at capture and again here. */
export const MAX_CAPTURE_SECONDS = 15;

export interface PreprocessedAudio {
	/** Mono PCM at ANALYSIS_SAMPLE_RATE, silence-trimmed, peak-normalized. */
	pcm: Float32Array;
	sampleRate: number;
	/** Duration of the original (untrimmed) capture, seconds. */
	originalDurationS: number;
	/** Fraction of original samples at or near full scale - measured pre-normalization. */
	clippingRatio: number;
	/** Peak level of the original capture, dBFS. */
	peakDb: number;
}

/** Average channels down to mono. */
export function toMono(channels: Float32Array[]): Float32Array {
	const first = channels[0];
	if (!first) return new Float32Array(0);
	if (channels.length === 1) return first;
	const out = new Float32Array(first.length);
	for (const channel of channels) {
		for (let i = 0; i < out.length; i++) {
			out[i] = (out[i] ?? 0) + (channel[i] ?? 0);
		}
	}
	for (let i = 0; i < out.length; i++) {
		out[i] = (out[i] ?? 0) / channels.length;
	}
	return out;
}

/** Linear-interpolation resampler. Fine for analysis: we measure timing and coarse spectra, not audiophile fidelity. */
export function resampleLinear(
	input: Float32Array,
	fromRate: number,
	toRate: number,
): Float32Array {
	if (fromRate === toRate) return input;
	const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate));
	const out = new Float32Array(outLength);
	const ratio = fromRate / toRate;
	for (let i = 0; i < outLength; i++) {
		const pos = i * ratio;
		const idx = Math.floor(pos);
		const frac = pos - idx;
		const a = input[idx] ?? 0;
		const b = input[idx + 1] ?? a;
		out[i] = a + (b - a) * frac;
	}
	return out;
}

/**
 * Trim leading/trailing frames whose RMS sits below `thresholdDb` relative to
 * full scale, keeping a 100 ms margin on each side so onsets at the edges of
 * the sound survive.
 */
export function trimSilence(
	pcm: Float32Array,
	sampleRate: number,
	thresholdDb = -48,
): Float32Array {
	const frame = Math.max(1, Math.round(sampleRate * 0.02));
	const threshold = Math.pow(10, thresholdDb / 20);
	const frames = Math.floor(pcm.length / frame);
	let firstActive = -1;
	let lastActive = -1;
	for (let f = 0; f < frames; f++) {
		let sum = 0;
		for (let i = f * frame; i < (f + 1) * frame; i++) {
			const v = pcm[i] ?? 0;
			sum += v * v;
		}
		const rms = Math.sqrt(sum / frame);
		if (rms >= threshold) {
			if (firstActive < 0) firstActive = f;
			lastActive = f;
		}
	}
	if (firstActive < 0) return pcm; // all silence - let the quality gate report it
	const margin = Math.round(sampleRate * 0.1);
	const start = Math.max(0, firstActive * frame - margin);
	const end = Math.min(pcm.length, (lastActive + 1) * frame + margin);
	return pcm.slice(start, end);
}

/** Scale so the peak sits at `target` (no-op for silence). */
export function normalizePeak(pcm: Float32Array, target = 0.95): Float32Array {
	let peak = 0;
	for (let i = 0; i < pcm.length; i++) {
		peak = Math.max(peak, Math.abs(pcm[i] ?? 0));
	}
	if (peak < 1e-6) return pcm;
	const gain = target / peak;
	const out = new Float32Array(pcm.length);
	for (let i = 0; i < pcm.length; i++) {
		out[i] = (pcm[i] ?? 0) * gain;
	}
	return out;
}

/** Fraction of samples at or near digital full scale. */
export function clippingRatio(pcm: Float32Array): number {
	if (pcm.length === 0) return 0;
	let clipped = 0;
	for (let i = 0; i < pcm.length; i++) {
		if (Math.abs(pcm[i] ?? 0) >= 0.985) clipped++;
	}
	return clipped / pcm.length;
}

/** Peak level in dBFS (floored at -120 for silence). */
export function peakDb(pcm: Float32Array): number {
	let peak = 0;
	for (let i = 0; i < pcm.length; i++) {
		peak = Math.max(peak, Math.abs(pcm[i] ?? 0));
	}
	return peak < 1e-6 ? -120 : 20 * Math.log10(peak);
}

/** Full preprocessing chain: mono → fixed rate → measure clipping/peak → trim → normalize. */
export function preprocessAudio(channels: Float32Array[], fromRate: number): PreprocessedAudio {
	const mono = toMono(channels);
	const capped = mono.slice(0, Math.round(fromRate * MAX_CAPTURE_SECONDS));
	const resampled = resampleLinear(capped, fromRate, ANALYSIS_SAMPLE_RATE);
	const clip = clippingRatio(resampled);
	const peak = peakDb(resampled);
	const trimmed = trimSilence(resampled, ANALYSIS_SAMPLE_RATE);
	return {
		pcm: normalizePeak(trimmed),
		sampleRate: ANALYSIS_SAMPLE_RATE,
		originalDurationS: capped.length / fromRate,
		clippingRatio: clip,
		peakDb: peak,
	};
}
