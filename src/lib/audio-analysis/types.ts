// DSP-domain types for the Noise Translator's measurement half. The
// split-brain contract: MeasuredFeatures is computed by deterministic DSP in
// the browser and passed through the whole pipeline verbatim - the model
// reads it, quotes it, and is never allowed to restate a number. The
// model-facing contract (NoiseDescription, prompt, tool schema) lives in
// src/lib/noise-translator.ts.

/** Deterministically measured acoustic features. Computed client-side; the model never alters these. */
export interface MeasuredFeatures {
	duration_s: number;
	/** Non-silent portion of the recording, in seconds. */
	effective_duration_s: number;
	pattern: "continuous" | "intermittent" | "single_event";
	/** Events per second from onset detection; null for continuous sounds. */
	event_rate_hz: number | null;
	/** Autocorrelation-based timing regularity of the onset train; null when there is no event train. */
	regularity: "highly_regular" | "somewhat_regular" | "erratic" | null;
	spectral_character: "low" | "mid" | "high" | "broadband";
	/** Up to 3 dominant frequency bands, in Hz, strongest first. */
	dominant_bands_hz: number[];
	pitch_trend: "steady" | "rising" | "falling" | "varying";
}

/** Recording-quality measurements that feed the deterministic quality gate. */
export interface RecordingQuality {
	/** Fraction of samples at or near full scale (0..1). */
	clipping_ratio: number;
	/** Estimated noise floor in dBFS (10th-percentile frame RMS). */
	noise_floor_db: number;
	/** Peak sample level in dBFS. */
	peak_db: number;
	issues: QualityIssue[];
}

export type QualityIssue = "too_short" | "near_silent" | "clipped";
