// The deterministic half of the Noise Translator's split brain: everything a
// number can say about a recording is measured here, in plain TypeScript, and
// passed through the pipeline verbatim. The model narrates; it never measures.
//
// The headline measurement is the onset train: spectral-flux onset detection
// gives an event rate ("clicks per second"), and autocorrelation of the onset
// strength gives timing regularity - a highly regular 2 Hz click reads very
// differently to a mechanic than erratic clicking.

import { magnitudeSpectrum } from "./fft";
import type { MeasuredFeatures, QualityIssue, RecordingQuality } from "./types";

export const FFT_SIZE = 1024;
export const HOP_SIZE = 256;

/** Band edges for the plain-language spectral labels. */
export const LOW_BAND_MAX_HZ = 200;
export const HIGH_BAND_MIN_HZ = 2000;

export interface FrameAnalysis {
	/** Per-frame RMS level, dBFS. */
	rmsDb: Float64Array;
	/** Per-frame spectral flux (half-wave rectified magnitude increase) - the onset strength envelope. */
	flux: Float64Array;
	/** Per-frame spectral centroid, Hz (0 for silent frames). */
	centroidHz: Float64Array;
	/** Mean magnitude spectrum across active frames. */
	meanSpectrum: Float64Array;
	/** Frames per second. */
	frameRate: number;
	/** Hz per FFT bin. */
	binHz: number;
}

/** One STFT pass computing every per-frame series the feature set needs. */
export function analyzeFrames(pcm: Float32Array, sampleRate: number): FrameAnalysis {
	const frameCount = Math.max(0, Math.floor((pcm.length - FFT_SIZE) / HOP_SIZE) + 1);
	const bins = FFT_SIZE / 2 + 1;
	const rmsDb = new Float64Array(frameCount);
	const flux = new Float64Array(frameCount);
	const centroidHz = new Float64Array(frameCount);
	const meanSpectrum = new Float64Array(bins);
	const binHz = sampleRate / FFT_SIZE;
	let previous: Float64Array = new Float64Array(bins);
	for (let f = 0; f < frameCount; f++) {
		const start = f * HOP_SIZE;
		const frame = pcm.subarray(start, start + FFT_SIZE);
		let sum = 0;
		for (let i = 0; i < frame.length; i++) {
			const v = frame[i] ?? 0;
			sum += v * v;
		}
		const rms = Math.sqrt(sum / FFT_SIZE);
		rmsDb[f] = rms < 1e-6 ? -120 : 20 * Math.log10(rms);

		const mags = magnitudeSpectrum(frame, FFT_SIZE);
		let fluxSum = 0;
		let weighted = 0;
		let total = 0;
		for (let b = 0; b < bins; b++) {
			const m = mags[b] ?? 0;
			const rise = m - (previous[b] ?? 0);
			if (rise > 0) fluxSum += rise;
			weighted += m * b * binHz;
			total += m;
			meanSpectrum[b] = (meanSpectrum[b] ?? 0) + m;
		}
		// Frame 0 has no predecessor - comparing against zeros would plant a
		// huge artificial transient that poisons the onset statistics.
		flux[f] = f === 0 ? 0 : fluxSum;
		centroidHz[f] = total > 1e-9 ? weighted / total : 0;
		previous = mags;
	}
	if (frameCount > 0) {
		for (let b = 0; b < bins; b++) {
			meanSpectrum[b] = (meanSpectrum[b] ?? 0) / frameCount;
		}
	}
	return { rmsDb, flux, centroidHz, meanSpectrum, frameRate: sampleRate / HOP_SIZE, binHz };
}

/**
 * Onset times from the spectral-flux envelope: a frame is an onset when its
 * flux is a local maximum, clears median + 2·MAD (robust to a noisy floor),
 * and sits at least 60 ms after the previous onset.
 */
export function detectOnsets(flux: Float64Array, frameRate: number): number[] {
	const n = flux.length;
	if (n < 3) return [];
	const sorted = Array.from(flux).sort((a, b) => a - b);
	const median = sorted[Math.floor(n / 2)] ?? 0;
	const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
	const mad = deviations[Math.floor(n / 2)] ?? 0;
	const maxFlux = sorted[n - 1] ?? 0;
	// Median + 2·MAD is robust to a noisy floor; the 5%-of-max floor kills the
	// near-zero ghost peaks a ringing transient leaves behind (measured: real
	// onsets carry ≥ ~70% of max flux, ghosts < 1%).
	const threshold = Math.max(
		median + 2 * (mad > 1e-9 ? mad : median * 0.5 + 1e-9) * 1.4826,
		maxFlux * 0.05,
	);
	const minGapFrames = Math.max(1, Math.round(frameRate * 0.06));
	const onsets: number[] = [];
	let lastOnset = -minGapFrames;
	for (let f = 1; f < n - 1; f++) {
		const v = flux[f] ?? 0;
		if (v <= threshold) continue;
		if (v < (flux[f - 1] ?? 0) || v < (flux[f + 1] ?? 0)) continue;
		if (f - lastOnset < minGapFrames) continue;
		onsets.push(f / frameRate);
		lastOnset = f;
	}
	return onsets;
}

export interface Periodicity {
	/** Repetition period in seconds. */
	periodS: number;
	/** Normalized autocorrelation peak height at that period (0..1). */
	peak: number;
}

/**
 * Periodicity of the onset train via normalized autocorrelation of the
 * mean-removed flux envelope, searched over lags of 0.1–2 s. Picks the
 * shortest lag within 85% of the best peak so a 2 Hz train is reported as
 * 0.5 s, not one of its multiples.
 */
export function onsetPeriodicity(flux: Float64Array, frameRate: number): Periodicity | null {
	const n = flux.length;
	const minLag = Math.max(2, Math.round(frameRate * 0.1));
	const maxLag = Math.min(n - 2, Math.round(frameRate * 2));
	if (maxLag <= minLag) return null;
	let mean = 0;
	for (let i = 0; i < n; i++) mean += flux[i] ?? 0;
	mean /= n;
	let energy = 0;
	const centered = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		centered[i] = (flux[i] ?? 0) - mean;
		energy += (centered[i] ?? 0) ** 2;
	}
	if (energy < 1e-12) return null;
	const corr = new Float64Array(maxLag + 1);
	for (let lag = minLag; lag <= maxLag; lag++) {
		let sum = 0;
		for (let i = 0; i + lag < n; i++) {
			sum += (centered[i] ?? 0) * (centered[i + lag] ?? 0);
		}
		corr[lag] = sum / energy;
	}
	let best = 0;
	for (let lag = minLag; lag <= maxLag; lag++) {
		best = Math.max(best, corr[lag] ?? 0);
	}
	if (best <= 0) return null;
	for (let lag = minLag; lag <= maxLag; lag++) {
		const v = corr[lag] ?? 0;
		if (v >= best * 0.85 && v > (corr[lag - 1] ?? 0) && v >= (corr[lag + 1] ?? 0)) {
			return { periodS: lag / frameRate, peak: v };
		}
	}
	return { periodS: 0, peak: best };
}

/** Up to 3 dominant spectral peaks (Hz, strongest first) with a minimum separation so one wide peak isn't reported thrice. */
export function dominantBands(meanSpectrum: Float64Array, binHz: number): number[] {
	const bins = meanSpectrum.length;
	// Light smoothing so bin-to-bin jitter doesn't create fake peaks.
	const smoothed = new Float64Array(bins);
	for (let b = 0; b < bins; b++) {
		const a = meanSpectrum[Math.max(0, b - 1)] ?? 0;
		const c = meanSpectrum[Math.min(bins - 1, b + 1)] ?? 0;
		smoothed[b] = ((meanSpectrum[b] ?? 0) + a + c) / 3;
	}
	let max = 0;
	for (let b = 1; b < bins; b++) max = Math.max(max, smoothed[b] ?? 0);
	if (max < 1e-9) return [];
	const candidates: { hz: number; mag: number }[] = [];
	for (let b = 2; b < bins - 1; b++) {
		const v = smoothed[b] ?? 0;
		if (v < max * 0.1) continue;
		if (v <= (smoothed[b - 1] ?? 0) || v < (smoothed[b + 1] ?? 0)) continue;
		candidates.push({ hz: b * binHz, mag: v });
	}
	candidates.sort((a, b) => b.mag - a.mag);
	const picked: number[] = [];
	for (const c of candidates) {
		const minSeparation = Math.max(150, c.hz * 0.2);
		if (picked.every((hz) => Math.abs(hz - c.hz) >= minSeparation)) {
			picked.push(Math.round(c.hz));
		}
		if (picked.length === 3) break;
	}
	return picked;
}

/** Round to 1 decimal for rates, matching what the UI and prompt display. */
const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The full measurement pass: preprocessed mono PCM in, MeasuredFeatures +
 * RecordingQuality out. `clippingRatioValue` and `peakDbValue` come from the
 * preprocessor because they must be measured before normalization.
 */
export function measureFeatures(
	pcm: Float32Array,
	sampleRate: number,
	clippingRatioValue: number,
	peakDbValue: number,
): { features: MeasuredFeatures; quality: RecordingQuality } {
	const durationS = pcm.length / sampleRate;
	const frames = analyzeFrames(pcm, sampleRate);
	const { rmsDb, flux, centroidHz, meanSpectrum, frameRate, binHz } = frames;

	// Noise floor and activity. A frame is "active" when it clears the floor
	// by 10 dB - but for a constant sound the floor IS the signal level, so
	// the threshold is capped at 25 dB below the loudest frame. Effective
	// duration is the active time.
	const sortedRms = Array.from(rmsDb).sort((a, b) => a - b);
	const noiseFloorDb = sortedRms[Math.floor(sortedRms.length * 0.1)] ?? -120;
	const maxRmsDb = sortedRms[sortedRms.length - 1] ?? -120;
	const activeThresholdDb = Math.min(noiseFloorDb + 10, maxRmsDb - 25);
	let activeCount = 0;
	for (let f = 0; f < rmsDb.length; f++) {
		if ((rmsDb[f] ?? -120) >= activeThresholdDb) activeCount++;
	}
	const activeRatio = rmsDb.length > 0 ? activeCount / rmsDb.length : 0;
	const effectiveDurationS = round1((activeCount / Math.max(1, rmsDb.length)) * durationS);

	// Envelope variability among audible frames - the steady/eventful divider.
	const audible = Array.from(rmsDb).filter((v) => v > -90);
	const envMean = audible.reduce((a, b) => a + b, 0) / Math.max(1, audible.length);
	const envStd = Math.sqrt(
		audible.reduce((a, b) => a + (b - envMean) ** 2, 0) / Math.max(1, audible.length),
	);

	const onsets = detectOnsets(flux, frameRate);
	const periodicity = onsetPeriodicity(flux, frameRate);

	// Pattern: a flat envelope is continuous no matter what the flux detector
	// thinks it saw (white noise trips naive onset pickers); an eventful
	// envelope with one burst is a single event; otherwise intermittent.
	let pattern: MeasuredFeatures["pattern"];
	if (envStd < 3 && activeRatio > 0.6) {
		pattern = "continuous";
	} else if (onsets.length <= 1) {
		pattern = activeRatio > 0.6 ? "continuous" : "single_event";
	} else {
		pattern = "intermittent";
	}

	let eventRateHz: number | null = null;
	let regularity: MeasuredFeatures["regularity"] = null;
	if (pattern === "intermittent") {
		// Rate from the autocorrelation period when the train is periodic
		// (robust to a missed onset); raw onset count over active time otherwise.
		if (periodicity && periodicity.peak >= 0.4 && periodicity.periodS > 0) {
			eventRateHz = round1(1 / periodicity.periodS);
		} else {
			const span = Math.max(0.5, (onsets[onsets.length - 1] ?? 0) - (onsets[0] ?? 0));
			eventRateHz = round1((onsets.length - 1) / span);
		}
		const peak = periodicity?.peak ?? 0;
		regularity = peak >= 0.5 ? "highly_regular" : peak >= 0.25 ? "somewhat_regular" : "erratic";
	}

	// Spectral character. Broadband is detected by spectral flatness first -
	// band-energy shares alone would call white noise "high" purely because
	// the high band is 9 kHz wide and the low band 200 Hz.
	let lowEnergy = 0;
	let midEnergy = 0;
	let highEnergy = 0;
	let logSum = 0;
	let linSum = 0;
	let flatBins = 0;
	for (let b = 1; b < meanSpectrum.length; b++) {
		const hz = b * binHz;
		const m = meanSpectrum[b] ?? 0;
		const e = m ** 2;
		if (hz < LOW_BAND_MAX_HZ) lowEnergy += e;
		else if (hz < HIGH_BAND_MIN_HZ) midEnergy += e;
		else highEnergy += e;
		logSum += Math.log(m + 1e-12);
		linSum += m;
		flatBins++;
	}
	const totalEnergy = lowEnergy + midEnergy + highEnergy;
	const flatness =
		flatBins > 0 && linSum > 1e-12 ? Math.exp(logSum / flatBins) / (linSum / flatBins) : 0;
	let spectralCharacter: MeasuredFeatures["spectral_character"] = "broadband";
	if (totalEnergy > 1e-12 && flatness < 0.35) {
		const shares: [MeasuredFeatures["spectral_character"], number][] = [
			["low", lowEnergy / totalEnergy],
			["mid", midEnergy / totalEnergy],
			["high", highEnergy / totalEnergy],
		];
		shares.sort((a, b) => b[1] - a[1]);
		const top = shares[0];
		if (top && top[1] >= 0.55) spectralCharacter = top[0];
	}

	// Pitch trend: least-squares slope of the centroid over audible frames.
	const activeCentroids: { t: number; hz: number }[] = [];
	for (let f = 0; f < centroidHz.length; f++) {
		if ((rmsDb[f] ?? -120) >= activeThresholdDb && (centroidHz[f] ?? 0) > 0) {
			activeCentroids.push({ t: f / frameRate, hz: centroidHz[f] ?? 0 });
		}
	}
	let pitchTrend: MeasuredFeatures["pitch_trend"] = "steady";
	if (activeCentroids.length >= 8) {
		const cn = activeCentroids.length;
		const meanT = activeCentroids.reduce((a, p) => a + p.t, 0) / cn;
		const meanHz = activeCentroids.reduce((a, p) => a + p.hz, 0) / cn;
		let num = 0;
		let den = 0;
		for (const p of activeCentroids) {
			num += (p.t - meanT) * (p.hz - meanHz);
			den += (p.t - meanT) ** 2;
		}
		const slope = den > 1e-9 ? num / den : 0; // Hz per second
		const totalChange = slope * durationS;
		const std = Math.sqrt(activeCentroids.reduce((a, p) => a + (p.hz - meanHz) ** 2, 0) / cn);
		const residualStd = Math.sqrt(
			activeCentroids.reduce((a, p) => {
				const fit = meanHz + slope * (p.t - meanT);
				return a + (p.hz - fit) ** 2;
			}, 0) / cn,
		);
		if (Math.abs(totalChange) > Math.max(0.15 * meanHz, 100)) {
			pitchTrend = totalChange > 0 ? "rising" : "falling";
		} else if (residualStd > 0.25 * meanHz && std > 150) {
			pitchTrend = "varying";
		}
	}

	const issues: QualityIssue[] = [];
	if (effectiveDurationS < 1) issues.push("too_short");
	if (peakDbValue < -35 || activeRatio < 0.05) issues.push("near_silent");
	if (clippingRatioValue > 0.01) issues.push("clipped");

	return {
		features: {
			duration_s: round1(durationS),
			effective_duration_s: effectiveDurationS,
			pattern,
			event_rate_hz: eventRateHz,
			regularity,
			spectral_character: spectralCharacter,
			dominant_bands_hz: dominantBands(meanSpectrum, binHz),
			pitch_trend: pitchTrend,
		},
		quality: {
			clipping_ratio: Math.round(clippingRatioValue * 10000) / 10000,
			noise_floor_db: Math.round(noiseFloorDb * 10) / 10,
			peak_db: Math.round(peakDbValue * 10) / 10,
			issues,
		},
	};
}
