// Plain metadata only - imported by both the Vue app and
// scripts/generate-noise-samples.mjs (Node), so no Vite asset imports here;
// the resolved audio/spectrogram URLs live in noise-sample-assets.ts.
//
// All three clips are SYNTHESIZED with exact known ground truth (see the
// recipes in scripts/generate-noise-samples.mjs) - no real recordings, per
// the house sample rule. Their analysis results are pre-generated into
// noise-sample-results.json (npm run generate:noise-samples) so selecting a
// sample never hits the live API. The generation script and the eval suite
// read the same ids - keep ids and filenames in sync.
// Relative import (not "@/") - this module is also compiled under the
// scripts tsconfig, which has no path alias.
import type { NoiseContext } from "../lib/noise-translator";

export interface NoiseSample {
	id: string;
	label: string;
	description: string;
	/** The guided-form answers this sample was generated with. */
	context: NoiseContext;
}

export const NOISE_SAMPLES: NoiseSample[] = [
	{
		id: "rhythmic-thumping",
		label: "Rhythmic thumping",
		description:
			"A synthesized 2.0 Hz thump train over a low noise bed - the classic dryer pattern",
		context: {
			machine_type: "clothes_dryer",
			machine_type_other: "",
			when_it_happens: "constant",
			changes_with_speed: "constant",
			how_long: "about two weeks",
			recent_changes: "",
			safety_screen: "no",
			safety_screen_detail: "",
		},
	},
	{
		id: "high-pitched-whine",
		label: "High-pitched whine",
		description:
			"A steady synthesized 3.8 kHz tone with a slow wobble over faint rumble - a speed-tracking whine",
		context: {
			machine_type: "car",
			machine_type_other: "",
			when_it_happens: "under_load",
			changes_with_speed: "tracks_speed",
			how_long: "a few days",
			recent_changes: "",
			safety_screen: "no",
			safety_screen_detail: "",
		},
	},
	{
		id: "erratic-rattle",
		label: "Erratic rattle",
		description:
			"Synthesized randomly-timed mid-band transients - an irregular rattle at startup",
		context: {
			machine_type: "furnace_hvac",
			machine_type_other: "",
			when_it_happens: "startup_only",
			changes_with_speed: "unsure",
			how_long: "since last month",
			recent_changes: "",
			safety_screen: "no",
			safety_screen_detail: "",
		},
	},
];
