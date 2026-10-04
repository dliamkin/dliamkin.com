<script setup lang="ts">
// Thin host for the ONE persistent canvas behind the entire site. Mounted
// once in App.vue and never unmounted on navigation - formations change, the
// field persists (that continuity is the entire point). All behavior
// decisions live in useParticleDirector; all physics in engine/particles.
//
// The engine chunk lazy-loads after first paint - the site renders fine
// without it, then the canvas fades in over 600ms once ready.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useParticleDirector } from "@/composables/useParticleDirector";
import { useTheme } from "@/composables/useTheme";
import type { ParticleEngine } from "@/engine/particles/engine";
import type { RenderConfig } from "@/engine/particles/types";

type SnapshotModule = typeof import("@/engine/particles/snapshot");

// Appearance profiles. The playground is a dark canvas by design regardless
// of the site theme (trails + additive glow need dark ground); site-wide the
// canvas is transparent over the page and adapts to the theme - additive
// teal/blue glow on dark, muted source-over inks on light, trails off in
// both (they'd need an opaque background fill).
const DARK_PALETTE = ["#5DCAA5", "#5DA9E9", "#7F77DD", "#E6E4DC"];
const LIGHT_PALETTE = ["#2E8F6F", "#2E76B5", "#5A52B8", "#8A8778"];

const PLAYGROUND_RENDER: Partial<RenderConfig> = {
	background: "#0D0D12",
	trails: true,
	additive: true,
	trailFade: 0.16,
	baseAlpha: 1,
};
const SITE_DARK_RENDER: Partial<RenderConfig> = {
	background: null,
	trails: false,
	additive: true,
	baseAlpha: 0.55,
};
const SITE_LIGHT_RENDER: Partial<RenderConfig> = {
	background: null,
	trails: false,
	additive: false,
	baseAlpha: 0.45,
};

const canvasEl = ref<HTMLCanvasElement | null>(null);
const ready = ref(false);
const router = useRouter();
const { theme } = useTheme();
const director = useParticleDirector();

let engine: ParticleEngine | null = null;
let snapshotModule: SnapshotModule | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;

function applyAppearance(): void {
	if (!engine) return;
	if (director.mode.value === "playground") {
		engine.setRenderConfig(PLAYGROUND_RENDER);
		engine.setPalette(DARK_PALETTE);
	} else if (theme.value === "dark") {
		engine.setRenderConfig(SITE_DARK_RENDER);
		engine.setPalette(DARK_PALETTE);
	} else {
		engine.setRenderConfig(SITE_LIGHT_RENDER);
		engine.setPalette(LIGHT_PALETTE);
	}
	// A static field never redraws on its own - recompose after any
	// appearance change (theme toggle, playground entry) repaints the canvas.
	if (director.status.value === "static" && snapshotModule) {
		void snapshotModule.renderSnapshot(engine);
	}
}

watch([() => director.mode.value, theme], applyAppearance);

const onPointerMove = (event: PointerEvent): void => {
	engine?.setPointer(event.clientX, event.clientY);
};
const onPointerGone = (): void => {
	engine?.clearPointer();
};
const onResize = (): void => {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(() => {
		if (!engine) return;
		engine.resize();
		if (director.status.value === "static" && snapshotModule) {
			void snapshotModule.renderSnapshot(engine);
		}
	}, 150);
};

async function start(): Promise<void> {
	const [{ ParticleEngine: Engine }, snapshot] = await Promise.all([
		import("@/engine/particles/engine"),
		import("@/engine/particles/snapshot"),
	]);
	if (!canvasEl.value) return;
	snapshotModule = snapshot;
	engine = new Engine(canvasEl.value);
	director.attachEngine(engine, router);
	applyAppearance();

	if (snapshot.shouldUseSnapshot()) {
		// Mark static first so a route change can't restart the loop while
		// the composition's chunks are still yielding to the event loop.
		director.markStatic();
		await snapshot.renderSnapshot(engine);
	} else {
		engine.onBenchmark = (fps) => {
			if (fps < snapshot.BENCHMARK_MIN_FPS && engine) {
				director.markStatic();
				void snapshot.renderSnapshot(engine);
			}
		};
	}
	ready.value = true;
}

onMounted(() => {
	// Defer the engine chunk until the page has fully loaded AND the browser
	// is idle - first paint and LCP must never wait on generative art. Idle
	// alone isn't enough: on a throttled mobile load the idle timeout fires
	// mid-load and the engine's chunks + rAF loop compete with the LCP paint.
	const idle: (cb: () => void) => unknown =
		typeof window.requestIdleCallback === "function"
			? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
			: (cb) => setTimeout(cb, 500);
	const kickoff = () => idle(() => void start());
	if (document.readyState === "complete") kickoff();
	else window.addEventListener("load", kickoff, { once: true });

	// The canvas has pointer-events: none so it never intercepts clicks -
	// pointer position comes from a window listener instead.
	window.addEventListener("pointermove", onPointerMove, { passive: true });
	window.addEventListener("blur", onPointerGone);
	document.addEventListener("pointerleave", onPointerGone);
	window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
	// Only reached on full app teardown - the component itself never unmounts
	// during navigation.
	window.removeEventListener("pointermove", onPointerMove);
	window.removeEventListener("blur", onPointerGone);
	document.removeEventListener("pointerleave", onPointerGone);
	window.removeEventListener("resize", onResize);
	clearTimeout(resizeTimer);
	engine?.destroy();
	engine = null;
});
</script>

<template>
	<canvas
		ref="canvasEl"
		class="particle-field"
		:class="{ ready }"
		aria-hidden="true"
	></canvas>
</template>

<style scoped>
.particle-field {
	position: fixed;
	inset: 0;
	width: 100%;
	height: 100%;
	z-index: 0;
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.6s ease;
}

.particle-field.ready {
	opacity: 1;
}
</style>
