// Browser audio capture and decode for the Noise Translator. Framework-free,
// same spirit as image-prep.ts. Privacy posture is enforced here, not just
// promised: recording starts only from an explicit user action, hard-caps at
// MAX_CAPTURE_SECONDS, and every MediaStream track is stopped the moment
// recording ends - the mic indicator must go dark immediately. The captured
// audio lives in memory only; the caller derives a spectrogram + features and
// discards the samples.

import { MAX_CAPTURE_SECONDS } from "./audio-analysis/preprocess";

export class AudioCaptureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AudioCaptureError";
	}
}

/** Container types decodeAudioData reliably handles across browsers. */
export const ALLOWED_AUDIO_EXTENSIONS = [
	".wav",
	".mp3",
	".m4a",
	".mp4",
	".webm",
	".ogg",
	".aac",
	".flac",
];

export const MAX_AUDIO_FILE_BYTES = 25_000_000;

export interface RecordingHandle {
	/** Stop early; also releases the microphone. Safe to call twice. */
	stop: () => void;
	/** Live input level (0..1) for the meter. */
	level: () => number;
	/** Seconds elapsed since recording started. */
	elapsedS: () => number;
	/** Resolves with the recorded clip once stopped (by the user or the cap). */
	done: Promise<Blob>;
}

/**
 * Start a microphone recording. Resolves once the mic is live; the returned
 * handle's `done` promise resolves with the compressed clip when recording
 * stops - via stop(), or automatically at MAX_CAPTURE_SECONDS.
 */
export async function startRecording(): Promise<RecordingHandle> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new AudioCaptureError("This browser doesn't support microphone capture.");
	}
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	} catch {
		throw new AudioCaptureError(
			"Microphone access was blocked. Allow microphone access for this site and try again.",
		);
	}

	// Level meter: a small analyser on the live stream, read on demand.
	const audioContext = new AudioContext();
	const source = audioContext.createMediaStreamSource(stream);
	const analyser = audioContext.createAnalyser();
	analyser.fftSize = 1024;
	source.connect(analyser);
	const levelBuffer = new Float32Array(analyser.fftSize);

	const recorder = new MediaRecorder(stream);
	const chunks: BlobPart[] = [];
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};

	const startedAt = performance.now();
	let stopped = false;

	const releaseEverything = (): void => {
		// The mic indicator must go dark NOW - stop every track, then tear
		// down the metering graph.
		for (const track of stream.getTracks()) track.stop();
		void audioContext.close().catch(() => undefined);
	};

	const done = new Promise<Blob>((resolve, reject) => {
		recorder.onstop = () => {
			releaseEverything();
			resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
		};
		recorder.onerror = () => {
			releaseEverything();
			reject(new AudioCaptureError("Recording failed. Please try again."));
		};
	});

	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		clearTimeout(capTimer);
		if (recorder.state !== "inactive") recorder.stop();
	};

	// Hard cap - recording never runs past this, whatever the UI does.
	const capTimer = setTimeout(stop, MAX_CAPTURE_SECONDS * 1000);

	recorder.start();

	return {
		stop,
		level: () => {
			analyser.getFloatTimeDomainData(levelBuffer);
			let sum = 0;
			for (let i = 0; i < levelBuffer.length; i++) {
				const v = levelBuffer[i] ?? 0;
				sum += v * v;
			}
			// RMS scaled so typical speech/machine noise fills the meter.
			return Math.min(1, Math.sqrt(sum / levelBuffer.length) * 4);
		},
		elapsedS: () => (performance.now() - startedAt) / 1000,
		done,
	};
}

export interface DecodedAudio {
	channels: Float32Array[];
	sampleRate: number;
}

/** Decode a recorded clip or an uploaded file to PCM. The decode is the real format gate. */
export async function decodeAudioBlob(blob: Blob): Promise<DecodedAudio> {
	if (blob.size > MAX_AUDIO_FILE_BYTES) {
		throw new AudioCaptureError("That file is too large - clips up to 15 seconds are plenty.");
	}
	const buffer = await blob.arrayBuffer();
	const context = new AudioContext();
	try {
		const decoded = await context.decodeAudioData(buffer);
		const channels: Float32Array[] = [];
		for (let c = 0; c < decoded.numberOfChannels; c++) {
			channels.push(decoded.getChannelData(c));
		}
		return { channels, sampleRate: decoded.sampleRate };
	} catch {
		throw new AudioCaptureError(
			"Couldn't decode that audio file. Please use a common format (wav, mp3, m4a, webm).",
		);
	} finally {
		void context.close().catch(() => undefined);
	}
}
