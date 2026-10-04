// Minimal radix-2 FFT for the audio-analysis pipeline. No dependencies so the
// exact same code runs in the browser and headless in Node (sample generation
// and evals). Sizes are always powers of two (we control every call site).

/** In-place iterative Cooley–Tukey FFT. `re` and `im` must share a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	if (n !== im.length || (n & (n - 1)) !== 0) {
		throw new Error(`fft: length must be a power of two, got ${n}`);
	}
	// Bit-reversal permutation.
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i] ?? 0;
			re[i] = re[j] ?? 0;
			re[j] = tr;
			const ti = im[i] ?? 0;
			im[i] = im[j] ?? 0;
			im[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (-2 * Math.PI) / len;
		const wRe = Math.cos(angle);
		const wIm = Math.sin(angle);
		for (let i = 0; i < n; i += len) {
			let curRe = 1;
			let curIm = 0;
			for (let k = 0; k < len / 2; k++) {
				const evenIdx = i + k;
				const oddIdx = i + k + len / 2;
				const oddRe = (re[oddIdx] ?? 0) * curRe - (im[oddIdx] ?? 0) * curIm;
				const oddIm = (re[oddIdx] ?? 0) * curIm + (im[oddIdx] ?? 0) * curRe;
				re[oddIdx] = (re[evenIdx] ?? 0) - oddRe;
				im[oddIdx] = (im[evenIdx] ?? 0) - oddIm;
				re[evenIdx] = (re[evenIdx] ?? 0) + oddRe;
				im[evenIdx] = (im[evenIdx] ?? 0) + oddIm;
				const nextRe = curRe * wRe - curIm * wIm;
				curIm = curRe * wIm + curIm * wRe;
				curRe = nextRe;
			}
		}
	}
}

/** Periodic Hann window of length n (cached per size - frame loops reuse it thousands of times). */
const hannCache = new Map<number, Float64Array>();
export function hannWindow(n: number): Float64Array {
	const cached = hannCache.get(n);
	if (cached) return cached;
	const w = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
	}
	hannCache.set(n, w);
	return w;
}

/**
 * Magnitude spectrum of one Hann-windowed frame: returns fftSize/2 + 1 bins.
 * `frame` may be shorter than fftSize (zero-padded).
 */
export function magnitudeSpectrum(
	frame: Float64Array | Float32Array,
	fftSize: number,
): Float64Array {
	const re = new Float64Array(fftSize);
	const im = new Float64Array(fftSize);
	const window = hannWindow(Math.min(frame.length, fftSize));
	const n = Math.min(frame.length, fftSize);
	for (let i = 0; i < n; i++) {
		re[i] = (frame[i] ?? 0) * (window[i] ?? 0);
	}
	fft(re, im);
	const bins = fftSize / 2 + 1;
	const mags = new Float64Array(bins);
	for (let i = 0; i < bins; i++) {
		mags[i] = Math.hypot(re[i] ?? 0, im[i] ?? 0);
	}
	return mags;
}
