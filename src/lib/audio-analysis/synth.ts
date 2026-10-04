// Deterministic signal synthesis with known ground truth. Used by the DSP unit
// tests (generate a click train at exactly 3.0/sec, assert detection within
// tolerance) and by the sample-generation script (the three committed demo
// clips). Seeded PRNG throughout - same inputs, same waveform, forever.

/** mulberry32 - tiny seeded PRNG, plenty for noise synthesis. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Steady sine tone. */
export function sine(
	freqHz: number,
	durationS: number,
	sampleRate: number,
	amplitude = 0.5,
): Float32Array {
	const n = Math.round(durationS * sampleRate);
	const out = new Float32Array(n);
	const step = (2 * Math.PI * freqHz) / sampleRate;
	for (let i = 0; i < n; i++) {
		out[i] = amplitude * Math.sin(step * i);
	}
	return out;
}

/** Seeded white noise. */
export function whiteNoise(
	durationS: number,
	sampleRate: number,
	amplitude = 0.5,
	seed = 1,
): Float32Array {
	const rand = mulberry32(seed);
	const n = Math.round(durationS * sampleRate);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = amplitude * (rand() * 2 - 1);
	}
	return out;
}

/**
 * Low-passed noise (single-pole IIR) - the "rumble" bed under machine sounds.
 * cutoffHz is approximate; good enough for a low-band synthetic fixture.
 */
export function lowNoise(
	durationS: number,
	sampleRate: number,
	cutoffHz: number,
	amplitude = 0.5,
	seed = 2,
): Float32Array {
	const raw = whiteNoise(durationS, sampleRate, 1, seed);
	const out = new Float32Array(raw.length);
	const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
	let y = 0;
	let peak = 1e-9;
	for (let i = 0; i < raw.length; i++) {
		y += alpha * ((raw[i] ?? 0) - y);
		out[i] = y;
		peak = Math.max(peak, Math.abs(y));
	}
	for (let i = 0; i < out.length; i++) {
		out[i] = ((out[i] ?? 0) / peak) * amplitude;
	}
	return out;
}

export interface ClickOptions {
	/** Damped-sine carrier frequency of each click - sets its "metallic" pitch. */
	clickFreqHz?: number;
	/** Exponential decay time constant of each click, seconds. */
	decayS?: number;
	amplitude?: number;
	/** Offset of the first click, seconds. */
	startS?: number;
}

/** Place one damped-sine click at each of `timesS` (seconds). */
export function clicksAt(
	timesS: number[],
	durationS: number,
	sampleRate: number,
	options: ClickOptions = {},
): Float32Array {
	const { clickFreqHz = 3000, decayS = 0.012, amplitude = 0.8 } = options;
	const n = Math.round(durationS * sampleRate);
	const out = new Float32Array(n);
	const clickLen = Math.round(decayS * 6 * sampleRate);
	const step = (2 * Math.PI * clickFreqHz) / sampleRate;
	for (const t of timesS) {
		const start = Math.round(t * sampleRate);
		for (let i = 0; i < clickLen && start + i < n; i++) {
			const env = Math.exp(-i / (decayS * sampleRate));
			out[start + i] = (out[start + i] ?? 0) + amplitude * env * Math.sin(step * i);
		}
	}
	return out;
}

/** Perfectly periodic click train at exactly `rateHz` - the regular-event ground-truth fixture. */
export function clickTrain(
	rateHz: number,
	durationS: number,
	sampleRate: number,
	options: ClickOptions = {},
): Float32Array {
	const times: number[] = [];
	const start = options.startS ?? 0.05;
	for (let t = start; t < durationS - 0.05; t += 1 / rateHz) {
		times.push(t);
	}
	return clicksAt(times, durationS, sampleRate, options);
}

/** Poisson-timed clicks at `meanRateHz` - the erratic-event ground-truth fixture. */
export function poissonClicks(
	meanRateHz: number,
	durationS: number,
	sampleRate: number,
	seed = 3,
	options: ClickOptions = {},
): Float32Array {
	const rand = mulberry32(seed);
	const times: number[] = [];
	let t = 0.05;
	// Exponential inter-arrival times, with a small refractory floor so two
	// clicks never merge into one onset.
	while (t < durationS - 0.05) {
		times.push(t);
		t += Math.max(0.06, -Math.log(1 - rand()) / meanRateHz);
	}
	return clicksAt(times, durationS, sampleRate, options);
}

/** Sum signals sample-wise into a new buffer sized to the longest input. */
export function mix(...signals: Float32Array[]): Float32Array {
	const n = Math.max(0, ...signals.map((s) => s.length));
	const out = new Float32Array(n);
	for (const s of signals) {
		for (let i = 0; i < s.length; i++) {
			out[i] = (out[i] ?? 0) + (s[i] ?? 0);
		}
	}
	return out;
}

/** Multiply a signal by a slow sinusoidal amplitude wobble (tremolo), depth in [0,1]. */
export function amplitudeWobble(
	signal: Float32Array,
	wobbleHz: number,
	depth: number,
	sampleRate: number,
): Float32Array {
	const out = new Float32Array(signal.length);
	const step = (2 * Math.PI * wobbleHz) / sampleRate;
	for (let i = 0; i < signal.length; i++) {
		out[i] = (signal[i] ?? 0) * (1 - depth / 2 + (depth / 2) * Math.sin(step * i));
	}
	return out;
}
