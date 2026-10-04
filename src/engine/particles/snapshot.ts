import type { ParticleEngine } from "./engine";

/**
 * Static-frame fallback. A janky particle field is worse than none, so the
 * simulation never runs when:
 *  - the visitor asked for reduced motion,
 *  - the viewport is phone-sized (most recruiters open links on their phone
 *    first - they get a clean static composition, not 3000-particle physics
 *    on a mid-range SoC), or
 *  - the live 60-frame benchmark after startup averages under 45fps
 *    (BENCHMARK_MIN_FPS, checked by the host via engine.onBenchmark).
 */

export const BENCHMARK_MIN_FPS = 45;
export const MOBILE_MAX_WIDTH = 768;
const SNAPSHOT_STEPS = 90;

export function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export function isMobileViewport(): boolean {
	return typeof window !== "undefined" && window.innerWidth < MOBILE_MAX_WIDTH;
}

/** Static-gate check made before the engine ever starts a loop. */
export function shouldUseSnapshot(): boolean {
	return prefersReducedMotion() || isMobileViewport();
}

/**
 * Composes one natural-looking static frame: ~90 simulation steps, then
 * stops. The canvas simply keeps the last composition as a static image; no
 * rAF loop ever runs.
 *
 * Composition runs on exactly the devices the fallback exists for, so it is
 * budgeted two ways: only draws that contribute to the final image happen
 * (transparent modes clear every frame - one final draw suffices; trail
 * modes fade old frames below visibility after ~30 fills), and steps are
 * chunked across the event loop so no single task blocks long enough to
 * register against TBT during page load.
 */
export async function renderSnapshot(engine: ParticleEngine): Promise<void> {
	engine.pause();
	const drawSteps = engine.hasTrails() ? 30 : 1;
	const CHUNK = 15;
	for (let i = 0; i < SNAPSHOT_STEPS; i++) {
		engine.step(16.667);
		if (i >= SNAPSHOT_STEPS - drawSteps) engine.drawFrame();
		if ((i + 1) % CHUNK === 0) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
}

/** True when `frames` (ms per frame) average at least `minFps`. Exposed for tests. */
export function meetsFpsFloor(frames: readonly number[], minFps: number): boolean {
	if (frames.length === 0) return false;
	const total = frames.reduce((sum, f) => sum + f, 0);
	if (total <= 0) return false;
	return (1000 * frames.length) / total >= minFps;
}
