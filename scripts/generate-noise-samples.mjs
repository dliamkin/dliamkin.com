// Regenerates the Noise Translator's committed sample artifacts, in three
// stages:
//   1. Synthesize the three demo clips with exact known ground truth (seeded
//      PRNG - same waveform every run, no real recordings) and write them as
//      WAVs to src/assets/noise-samples/.
//   2. Run each clip through the exact client pipeline headless - preprocess,
//      feature measurement, spectrogram render (@napi-rs/canvas stands in for
//      the browser canvas) - writing spectrogram PNGs next to the WAVs, plus
//      poor-quality eval fixtures (clipped / near-silent) into
//      scripts/evals/fixtures/.
//   3. Run spectrogram + features + context preset through the same
//      describe-noise pipeline worker/index.ts uses and write the results to
//      src/data/noise-sample-results.json.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... npm run generate:noise-samples
//   npm run generate:noise-samples -- --render-only   (skip the API stage)
//
// Runs via tsx (see package.json): the pipeline modules use extensionless TS
// imports, which Node's native type stripping can't resolve.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import Anthropic from "@anthropic-ai/sdk";
import { preprocessAudio } from "../src/lib/audio-analysis/preprocess.ts";
import { measureFeatures } from "../src/lib/audio-analysis/features.ts";
import {
	computeSpectrogram,
	drawSpectrogram,
	SPECTROGRAM_HEIGHT,
	SPECTROGRAM_WIDTH,
} from "../src/lib/audio-analysis/spectrogram.ts";
import {
	amplitudeWobble,
	clickTrain,
	lowNoise,
	mix,
	poissonClicks,
	sine,
} from "../src/lib/audio-analysis/synth.ts";
import { encodeWavPcm16 } from "../src/lib/audio-analysis/wav.ts";
import { NOISE_SAMPLES } from "../src/data/noise-samples.ts";
import { describeNoise } from "../src/lib/pipelines/describe-noise.ts";

const renderOnly = process.argv.includes("--render-only");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = path.join(root, "src/assets/noise-samples");
const fixtureDir = path.join(root, "scripts/evals/fixtures");
const dataDir = path.join(root, "src/data");

const SR = 22050;

// Synthesis recipes - the planted ground truth. Keep ids in sync with
// NOISE_SAMPLES in src/data/noise-samples.ts and with the eval suite's
// expectations in scripts/evals/suites/noise-translator.ts.
const RECIPES = {
	// 2.0 Hz low thumps over a low noise bed: expect pattern=intermittent,
	// event_rate ~2.0, highly_regular.
	"rhythmic-thumping": () =>
		mix(
			clickTrain(2.0, 8, SR, { clickFreqHz: 130, decayS: 0.03, amplitude: 0.85 }),
			lowNoise(8, SR, 160, 0.14, 11),
		),
	// Steady 3.8 kHz tone, slow wobble, faint rumble: expect continuous, high,
	// dominant band ~3800.
	"high-pitched-whine": () =>
		mix(
			amplitudeWobble(sine(3800, 7, SR, 0.6), 1.4, 0.25, SR),
			lowNoise(7, SR, 120, 0.07, 12),
		),
	// Poisson-timed mid-band transients: expect intermittent, erratic.
	"erratic-rattle": () => poissonClicks(2.2, 6, SR, 42, { clickFreqHz: 900, decayS: 0.02, amplitude: 0.8 }),
};

/** Run the real client pipeline headless: preprocess → features → spectrogram PNG. */
function analyzeClip(signal) {
	const pre = preprocessAudio([signal], SR);
	const { features, quality } = measureFeatures(pre.pcm, pre.sampleRate, pre.clippingRatio, pre.peakDb);
	const spec = computeSpectrogram(pre.pcm, pre.sampleRate);
	const canvas = createCanvas(SPECTROGRAM_WIDTH, SPECTROGRAM_HEIGHT);
	drawSpectrogram(canvas.getContext("2d"), spec);
	return { features, quality, png: canvas.toBuffer("image/png") };
}

fs.mkdirSync(assetDir, { recursive: true });

// Stages 1 + 2: synthesize, analyze, render.
const analyzed = {};
for (const sample of NOISE_SAMPLES) {
	const recipe = RECIPES[sample.id];
	if (!recipe) throw new Error(`No synthesis recipe for sample id "${sample.id}"`);
	const signal = recipe();
	fs.writeFileSync(path.join(assetDir, `${sample.id}.wav`), encodeWavPcm16(signal, SR));
	analyzed[sample.id] = analyzeClip(signal);
	fs.writeFileSync(path.join(assetDir, `${sample.id}.png`), analyzed[sample.id].png);
	console.log(
		`Synthesized "${sample.id}": pattern=${analyzed[sample.id].features.pattern}` +
			` rate=${analyzed[sample.id].features.event_rate_hz}` +
			` regularity=${analyzed[sample.id].features.regularity}` +
			` bands=${JSON.stringify(analyzed[sample.id].features.dominant_bands_hz)}`,
	);
}

// Poor-quality eval fixture: a hard-clipped tone. The eval suite feeds its
// spectrogram + features through the model and asserts recording_notes is
// non-null; the DSP unit tests cover the deterministic gate itself.
{
	const loud = sine(700, 4, SR, 1.8);
	for (let i = 0; i < loud.length; i++) {
		loud[i] = Math.max(-1, Math.min(1, loud[i]));
	}
	const clipped = analyzeClip(loud);
	fs.writeFileSync(path.join(fixtureDir, "noise-clipped.png"), clipped.png);
	fs.writeFileSync(
		path.join(fixtureDir, "noise-clipped.features.json"),
		`${JSON.stringify({ features: clipped.features, quality: clipped.quality }, null, "\t")}\n`,
	);
	console.log(
		`Rendered clipped eval fixture: clipping_ratio=${clipped.quality.clipping_ratio} issues=${JSON.stringify(clipped.quality.issues)}`,
	);
}

if (renderOnly) {
	console.log("--render-only: skipping the API stage.");
	process.exit(0);
}

// Stage 3: pre-generate model results through the production pipeline.
const anthropic = new Anthropic();
const results = {};
for (const sample of NOISE_SAMPLES) {
	console.log(`Describing "${sample.id}"...`);
	const { features, png } = analyzed[sample.id];
	// Match worker/index.ts: NOISE_TRANSLATOR_MODEL overrides the pipeline default.
	results[sample.id] = {
		features,
		response: await describeNoise(
			anthropic,
			png.toString("base64"),
			features,
			sample.context,
			process.env.NOISE_TRANSLATOR_MODEL,
		),
	};
	const { description, stripped } = results[sample.id].response;
	console.log(
		`  ${description.characterizations.length} characterizations, ` +
			`${description.likely_questions.length} questions` +
			(stripped.length > 0 ? `, ${stripped.length} STRIPPED sentences (review!)` : ""),
	);
}

const outPath = path.join(dataDir, "noise-sample-results.json");
fs.writeFileSync(outPath, `${JSON.stringify(results, null, "\t")}\n`);
console.log(`Wrote ${outPath}`);
