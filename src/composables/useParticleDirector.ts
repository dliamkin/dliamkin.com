import { ref, shallowRef } from "vue";
import type { Router, RouteLocationNormalizedGeneric } from "vue-router";
import type { ParticleEngine } from "@/engine/particles/engine";
import type { FormationName, FormationParams } from "@/engine/particles/types";

/**
 * The director is the only module that decides WHAT the field does; the
 * engine stays dumb. It watches the route and registered page sections and
 * issues setFormation/setAmbient/pause/resume calls.
 *
 * Route policy:
 *  - /projects/particle-engine → "playground": the playground page takes
 *    manual control; the director only sets full presence and steps aside.
 *  - tool pages (meta.recedeField, or any /projects/<tool> route) → "recede":
 *    ambient 0 AND a full pause. Adaptation note: the brief's recede keeps a
 *    dim field running behind the tools, but this site's tool views have
 *    opaque backgrounds, so a running field would be invisible work - pausing
 *    gives the instruments every frame. Flip a tool view's background to
 *    transparent and remove the pause here if visible ambient texture is
 *    ever wanted.
 *  - everywhere else → "site": ambient storm; registered sections may morph it.
 *
 * Registering a section formation is one line in any component:
 *   const { registerSection } = useParticleDirector();
 *   onMounted(() => registerSection(el, "distribution"));   // cleanup fn returned
 */

export type FieldMode = "site" | "playground" | "recede";
export type FieldStatus = "pending" | "running" | "static";

/** Minimum ms between formation switches so fast scrolling doesn't thrash. */
const MIN_SWITCH_MS = 600;
const SECTION_THRESHOLD = 0.45;

const engineRef = shallowRef<ParticleEngine | null>(null);
const mode = ref<FieldMode>("site");
const status = ref<FieldStatus>("pending");

let activeSectionEl: Element | null = null;
let lastSwitchAt = 0;
let pendingSwitch: ReturnType<typeof setTimeout> | undefined;

function modeForRoute(route: RouteLocationNormalizedGeneric): FieldMode {
	if (route.name === "particle-engine") return "playground";
	if (route.meta.recedeField === true) return "recede";
	if (/^\/projects\/.+/.test(route.path)) return "recede";
	return "site";
}

function applyPolicy(route: RouteLocationNormalizedGeneric): void {
	mode.value = modeForRoute(route);
	activeSectionEl = null;
	clearTimeout(pendingSwitch);

	const engine = engineRef.value;
	if (!engine || status.value !== "running") return;

	if (mode.value === "recede") {
		engine.setAmbient(0);
		engine.setFormation("storm");
		engine.pause();
	} else if (mode.value === "playground") {
		engine.setAmbient(2);
		engine.setFormation("storm");
		engine.resume();
	} else {
		engine.setAmbient(1);
		engine.setFormation("storm");
		engine.resume();
	}
}

function requestFormation(name: FormationName, params: FormationParams = {}): void {
	if (mode.value !== "site" || status.value !== "running") return;
	clearTimeout(pendingSwitch);
	const apply = (): void => {
		lastSwitchAt = performance.now();
		engineRef.value?.setFormation(name, params);
	};
	const elapsed = performance.now() - lastSwitchAt;
	if (elapsed >= MIN_SWITCH_MS) apply();
	else pendingSwitch = setTimeout(apply, MIN_SWITCH_MS - elapsed);
}

/**
 * When `el` becomes the dominant section in the viewport, the field morphs
 * into `formation`; when it leaves, the field releases back to the storm.
 * Returns a cleanup function.
 */
function registerSection(
	el: Element,
	formation: FormationName,
	params: FormationParams = {},
): () => void {
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					activeSectionEl = el;
					requestFormation(formation, params);
				} else if (activeSectionEl === el) {
					activeSectionEl = null;
					requestFormation("storm");
				}
			}
		},
		{ threshold: SECTION_THRESHOLD },
	);
	observer.observe(el);
	return () => {
		observer.disconnect();
		if (activeSectionEl === el) {
			activeSectionEl = null;
			requestFormation("storm");
		}
	};
}

/** Called once by ParticleField when the lazily-loaded engine is ready. */
function attachEngine(engine: ParticleEngine, router: Router): void {
	engineRef.value = engine;
	status.value = "running";
	applyPolicy(router.currentRoute.value);
	router.afterEach((to) => applyPolicy(to));
}

/** Downgrades to the static-frame fallback: the loop stays off for good. */
function markStatic(): void {
	status.value = "static";
	clearTimeout(pendingSwitch);
	engineRef.value?.pause();
}

export function useParticleDirector() {
	return {
		engine: engineRef,
		mode,
		status,
		attachEngine,
		markStatic,
		registerSection,
		requestFormation,
	};
}
