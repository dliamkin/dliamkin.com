// Vite-resolved asset URLs for the bundled noise samples - kept separate from
// noise-samples.ts so the metadata module stays importable from Node (the
// generation script), same split as screenshot-sample-images.ts.
import erraticRattlePng from "@/assets/noise-samples/erratic-rattle.png";
import erraticRattleWav from "@/assets/noise-samples/erratic-rattle.wav";
import highPitchedWhinePng from "@/assets/noise-samples/high-pitched-whine.png";
import highPitchedWhineWav from "@/assets/noise-samples/high-pitched-whine.wav";
import rhythmicThumpingPng from "@/assets/noise-samples/rhythmic-thumping.png";
import rhythmicThumpingWav from "@/assets/noise-samples/rhythmic-thumping.wav";

export const NOISE_SAMPLE_SPECTROGRAMS: Record<string, string> = {
	"rhythmic-thumping": rhythmicThumpingPng,
	"high-pitched-whine": highPitchedWhinePng,
	"erratic-rattle": erraticRattlePng,
};

export const NOISE_SAMPLE_AUDIO: Record<string, string> = {
	"rhythmic-thumping": rhythmicThumpingWav,
	"high-pitched-whine": highPitchedWhineWav,
	"erratic-rattle": erraticRattleWav,
};
