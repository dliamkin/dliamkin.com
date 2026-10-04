// Eval suite for the Noise Translator. The fixtures are the three committed
// synthesized clips (exact planted ground truth - see the recipes in
// scripts/generate-noise-samples.mjs) plus a hard-clipped tone: each case
// feeds the committed spectrogram PNG and the DSP-measured features through
// the production describe-noise pipeline and asserts, deterministically:
// measured numbers appear unaltered in the summary (the anti-fabrication
// headline check), zero diagnosis-language hits survive, characterization
// words are drawn from a plausible-for-the-fixture allow-set (the 3.8 kHz
// tone must not come back "low rumbling"), the likely questions fit the
// machine type, and the clipped fixture yields a non-null recording_notes.
// The DSP itself (rates, regularity, gates) is covered by vitest unit tests
// against synthesized signals - see src/lib/audio-analysis/__tests__/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckResult } from "../../../src/lib/evals";
import type { MeasuredFeatures } from "../../../src/lib/audio-analysis/types";
import {
	findDiagnosisLanguage,
	findFabricatedNumbers,
	NOISE_TRANSLATOR_SYSTEM_PROMPT,
	type DescribeNoiseResponse,
	type NoiseContext,
} from "../../../src/lib/noise-translator";
import {
	DESCRIBE_NOISE_DEFAULT_MODEL,
	describeNoise,
} from "../../../src/lib/pipelines/describe-noise";
import { defineSuite, fieldNonNull, setContains, type EvalCase } from "../harness";
import { NOISE_SAMPLES } from "../../../src/data/noise-samples";
import rawSampleResults from "../../../src/data/noise-sample-results.json";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

interface NoiseInput {
	/** Repo-relative path to the fixture spectrogram PNG. */
	pngPath: string;
	features: MeasuredFeatures;
	context: NoiseContext;
}

// The committed sample results carry the DSP-measured features for each clip;
// re-reading them here keeps the suite's inputs byte-identical to what the
// demo page renders. Keep ids in sync with src/data/noise-samples.ts.
const SAMPLE_DATA = rawSampleResults as unknown as Record<
	string,
	{ features: MeasuredFeatures; response: DescribeNoiseResponse }
>;

const sampleInput = (id: string): NoiseInput => {
	const sample = NOISE_SAMPLES.find((s) => s.id === id);
	const data = SAMPLE_DATA[id];
	if (!sample || !data) throw new Error(`Unknown noise sample id: ${id}`);
	return {
		pngPath: `src/assets/noise-samples/${id}.png`,
		features: data.features,
		context: sample.context,
	};
};

const clippedFixture = (): NoiseInput => {
	const parsed = JSON.parse(
		readFileSync(path.join(fixtureDir, "noise-clipped.features.json"), "utf8"),
	) as { features: MeasuredFeatures };
	return {
		pngPath: "scripts/evals/fixtures/noise-clipped.png",
		features: parsed.features,
		context: {
			machine_type: "washer",
			machine_type_other: "",
			when_it_happens: "constant",
			changes_with_speed: "unsure",
			how_long: "since yesterday",
			recent_changes: "",
			safety_screen: "no",
			safety_screen_detail: "",
		},
	};
};

const renderDescriptor = (c: DescribeNoiseResponse["description"]["characterizations"][number]) =>
	`"${c.descriptor}" [${c.confidence}]`;

const renderQuestion = (q: DescribeNoiseResponse["description"]["likely_questions"][number]) =>
	`"${q.question}"`;

// Shared by every case: the never-diagnose and never-fabricate invariants.
// `stripped` empty means the model needed no deny-list rescue - the gate would
// keep the output safe either way, but a strip is prompt-discipline drift the
// dashboard should surface.
const integrityChecks = (input: NoiseInput): EvalCase<NoiseInput, DescribeNoiseResponse>["checks"] => [
	{
		name: "no diagnosis language anywhere in the output",
		run: (output) => {
			const texts = [
				...output.description.characterizations.map((c) => `${c.descriptor}. ${c.evidence}`),
				output.description.conditions_summary,
				output.description.professional_summary,
				output.description.recording_notes ?? "",
			];
			const offending = texts.find((t) => findDiagnosisLanguage(t));
			return {
				passed: offending === undefined,
				expected: "no causal claims or culprit parts in any descriptive field",
				actual: offending === undefined ? "clean" : `"${offending}"`,
			};
		},
	},
	{
		name: "model needed no deny-list strips",
		run: (output) => ({
			passed: output.stripped.length === 0,
			expected: "0 stripped sentences",
			actual:
				output.stripped.length === 0
					? "0 stripped sentences"
					: `${output.stripped.length}: ${output.stripped.join(" | ")}`,
		}),
	},
	{
		name: "every number in the summary matches a measurement",
		run: (output) => {
			const offending = findFabricatedNumbers(output.description.professional_summary, input.features);
			return {
				passed: offending.length === 0,
				expected: "all unit-bearing numbers within rounding of the measured features",
				actual: offending.length === 0 ? "all match" : `fabricated: ${offending.join(" | ")}`,
			};
		},
	},
	{
		name: "4-6 likely questions with preparation hints",
		run: (output) => {
			const qs = output.description.likely_questions;
			const allHinted = qs.every((q) => q.how_to_find_out.trim().length > 0);
			return {
				passed: qs.length >= 4 && qs.length <= 6 && allHinted,
				expected: "4-6 questions, each with a non-empty how_to_find_out",
				actual: `${qs.length} questions${allHinted ? "" : ", some missing hints"}`,
			};
		},
	},
];

/** The measured event rate (or dominant band) must be quoted somewhere in the summary. */
function quotesMeasurement(output: DescribeNoiseResponse, input: NoiseInput): CheckResult {
	const summary = output.description.professional_summary;
	const targets: string[] = [];
	if (input.features.event_rate_hz !== null) {
		targets.push(
			input.features.event_rate_hz.toFixed(1),
			String(Math.round(input.features.event_rate_hz)),
		);
	}
	for (const hz of input.features.dominant_bands_hz) {
		targets.push(String(Math.round(hz)), (hz / 1000).toFixed(1));
	}
	const found = targets.find((t) => summary.includes(t));
	return {
		passed: found !== undefined,
		expected: `summary quotes one of the measured values (${targets.join(", ")})`,
		actual: found !== undefined ? `quotes "${found}"` : `"${summary}"`,
	};
}

const cases: EvalCase<NoiseInput, DescribeNoiseResponse>[] = [
	{
		id: "noise-dryer-thump",
		description:
			"Synthesized 2.0 Hz thump train over a low noise bed (dryer preset): thump/knock-family characterization, dryer-appropriate questions, measured rate quoted intact.",
		input: sampleInput("rhythmic-thumping"),
		checks: [
			{
				name: "characterized in the thump/knock family",
				run: (output) =>
					setContains(
						output.description.characterizations,
						"a descriptor like thumping, knocking, banging, or rhythmic clicking",
						(c) => /thump|knock|bang|thud|beat|click|tick|rhythm/i.test(c.descriptor),
						renderDescriptor,
					),
			},
			{
				// Best-first only: the sample's low noise bed makes a secondary
				// "hiss-like background" mention truthful, but the headline
				// characterization of a 2 Hz thump train must be percussive.
				name: "best characterization is not a whine or hiss",
				run: (output) => {
					const top = output.description.characterizations[0];
					return {
						passed: top !== undefined && !/whine|squeal|hiss/i.test(top.descriptor),
						expected: "a thump train must not lead with a whine/squeal/hiss descriptor",
						actual: top ? renderDescriptor(top) : "no characterizations at all",
					};
				},
			},
			{
				name: "summary quotes the measured rate or band",
				run: (output) => quotesMeasurement(output, sampleInput("rhythmic-thumping")),
			},
			{
				name: "questions fit a clothes dryer",
				run: (output) =>
					setContains(
						output.description.likely_questions,
						"a question about the drum, load, cycle, or venting",
						(q) => /drum|load|laundry|cycle|empty|vent|spin|tumble/i.test(q.question),
						renderQuestion,
					),
			},
			...integrityChecks(sampleInput("rhythmic-thumping")),
		],
	},
	{
		id: "noise-car-whine",
		description:
			"Synthesized steady 3.8 kHz whine over faint rumble (car preset): best characterization is in the whine/tone family - never low rumbling - with car-appropriate questions.",
		input: sampleInput("high-pitched-whine"),
		checks: [
			{
				name: "best characterization is in the whine/tone family",
				run: (output) => {
					const top = output.description.characterizations[0];
					return {
						passed: top !== undefined && /whine|whistle|tone|hum|squeal|high[- ]pitch/i.test(top.descriptor),
						expected: "first descriptor like high-pitched whine/whistle/tonal hum",
						actual: top ? renderDescriptor(top) : "no characterizations at all",
					};
				},
			},
			{
				name: "not described as low rumbling",
				run: (output) => {
					const top = output.description.characterizations[0];
					return {
						passed: top !== undefined && !/rumbl|thump|knock/i.test(top.descriptor),
						expected: "a 3.8 kHz tone must not lead with a rumble/thump descriptor",
						actual: top ? renderDescriptor(top) : "no characterizations at all",
					};
				},
			},
			{
				name: "summary quotes the measured band",
				run: (output) => quotesMeasurement(output, sampleInput("high-pitched-whine")),
			},
			{
				name: "questions fit a car",
				run: (output) =>
					setContains(
						output.description.likely_questions,
						"a question about speed, RPM, gear, or driving conditions",
						(q) => /speed|rpm|accelerat|gear|drive|driving|engine|coast|neutral|turn/i.test(q.question),
						renderQuestion,
					),
			},
			...integrityChecks(sampleInput("high-pitched-whine")),
		],
	},
	{
		id: "noise-furnace-rattle",
		description:
			"Synthesized Poisson-timed mid-band transients (furnace preset, startup only): rattle/click-family characterization that does not claim regularity, furnace-appropriate questions.",
		input: sampleInput("erratic-rattle"),
		checks: [
			{
				name: "characterized in the rattle/click family",
				run: (output) =>
					setContains(
						output.description.characterizations,
						"a descriptor like rattling, clicking, ticking, or clattering",
						(c) => /rattl|click|tick|knock|clatter|tap|pop/i.test(c.descriptor),
						renderDescriptor,
					),
			},
			{
				name: "summary does not claim the erratic pattern is regular",
				run: (output) => ({
					passed: !/highly regular|perfectly regular|very regular/i.test(
						output.description.professional_summary,
					),
					expected: "no regularity claim for an erratic onset train",
					actual: output.description.professional_summary,
				}),
			},
			{
				name: "questions fit a furnace/HVAC",
				run: (output) =>
					setContains(
						output.description.likely_questions,
						"a question about startup, filters, vents, ducts, or ignition",
						(q) => /furnace|filter|vent|duct|start|ignit|blower|hvac|thermostat|air|heat|cycle/i.test(q.question),
						renderQuestion,
					),
			},
			...integrityChecks(sampleInput("erratic-rattle")),
		],
	},
	{
		id: "noise-clipped-recording",
		description:
			"Hard-clipped tone fixture (63% of samples at full scale): the model must flag recording quality via a non-null recording_notes instead of describing with false precision.",
		input: clippedFixture(),
		checks: [
			{
				name: "recording_notes is non-null",
				run: (output) => fieldNonNull(output.description.recording_notes),
			},
			...integrityChecks(clippedFixture()),
		],
	},
];

// Match worker/index.ts: NOISE_TRANSLATOR_MODEL overrides the pipeline
// default, so the suite always runs whatever model production runs.
const model = process.env.NOISE_TRANSLATOR_MODEL ?? DESCRIBE_NOISE_DEFAULT_MODEL;

export const noiseTranslatorSuite = defineSuite({
	project_id: "noise-translator",
	project_label: "Noise Translator",
	model,
	prompt: NOISE_TRANSLATOR_SYSTEM_PROMPT,
	cases,
	execute: (client, input) =>
		describeNoise(
			client,
			readFileSync(path.join(root, input.pngPath)).toString("base64"),
			input.features,
			input.context,
			model,
		),
});
