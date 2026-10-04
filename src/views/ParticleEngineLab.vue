<script setup lang="ts">
// Token Field playground - the project page for the particle system running
// behind the whole site. There is no second canvas here: the page takes
// manual control of the one persistent engine (the director steps aside on
// this route) and hands the visitor the controls.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import Card from "primevue/card";
import InputText from "primevue/inputtext";
import Panel from "primevue/panel";
import SelectButton from "primevue/selectbutton";
import Slider from "primevue/slider";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import ProjectBreadcrumb from "@/components/projects/ProjectBreadcrumb.vue";
import { useParticleDirector } from "@/composables/useParticleDirector";
import { DEFAULT_TEXT, MAX_TEXT_LENGTH } from "@/engine/particles/formations";
import type { FormationName } from "@/engine/particles/types";

const INTRO_SEEN_KEY = "token-field-intro-seen";

const director = useParticleDirector();

const isStatic = computed(() => director.status.value === "static");
const engineReady = computed(
	() => director.engine.value !== null && director.status.value === "running",
);

const formationOptions: { label: string; value: FormationName }[] = [
	{ label: "Storm", value: "storm" },
	{ label: "Text", value: "text" },
	{ label: "Distribution", value: "distribution" },
	{ label: "Columns", value: "columns" },
];
const formation = ref<FormationName>("storm");
const customText = ref("");

const particleCount = ref(3000);
const repulsionRadius = ref(90);
const trailPersistence = ref(0.16);

const fps = ref(0);
let fpsTimer: ReturnType<typeof setInterval> | undefined;
let countDebounce: ReturnType<typeof setTimeout> | undefined;
const introTimers: ReturnType<typeof setTimeout>[] = [];

function applyFormation(name: FormationName): void {
	const engine = director.engine.value;
	if (!engine || isStatic.value) return;
	formation.value = name;
	if (name === "text") {
		engine.setFormation("text", { text: customText.value.trim() || DEFAULT_TEXT });
	} else {
		engine.setFormation(name);
	}
}

/** Any visitor-driven change cancels the intro so its timers can't stomp it. */
function userApplyFormation(name: FormationName): void {
	introTimers.forEach(clearTimeout);
	introTimers.length = 0;
	applyFormation(name);
}

function formCustomText(): void {
	userApplyFormation("text");
}

watch(particleCount, (count) => {
	clearTimeout(countDebounce);
	countDebounce = setTimeout(() => {
		director.engine.value?.setParticleCount(count);
	}, 300);
});

watch(repulsionRadius, (radius) => {
	director.engine.value?.setRepulsionRadius(radius);
});

watch(trailPersistence, (fade) => {
	director.engine.value?.setTrailFade(fade);
});

/**
 * Intro choreography, first visit per session: storm (2.2s) → the field
 * spells DLIAMKIN (2.8s) → releases back to the storm. Repeat visitors (and
 * reduced-motion/static visitors) skip straight to the ambient storm.
 */
function runIntroOnce(): void {
	if (sessionStorage.getItem(INTRO_SEEN_KEY)) return;
	try {
		sessionStorage.setItem(INTRO_SEEN_KEY, "1");
	} catch {
		// Storage unavailable - the intro just replays next visit.
	}
	introTimers.push(
		setTimeout(() => {
			applyFormation("text");
			introTimers.push(setTimeout(() => applyFormation("storm"), 2800));
		}, 2200),
	);
}

function initWhenReady(): void {
	const engine = director.engine.value;
	if (!engine || director.status.value !== "running") return;
	particleCount.value = engine.getParticleCount();
	engine.setRepulsionRadius(repulsionRadius.value);
	engine.setTrailFade(trailPersistence.value);
	runIntroOnce();
}

watch(engineReady, (isReady) => {
	if (isReady) initWhenReady();
});

onMounted(() => {
	initWhenReady();
	fpsTimer = setInterval(() => {
		fps.value = Math.round(director.engine.value?.getFps() ?? 0);
	}, 500);
});

onBeforeUnmount(() => {
	clearInterval(fpsTimer);
	clearTimeout(countDebounce);
	introTimers.forEach(clearTimeout);
});
</script>

<template>
	<div class="lab-page">
		<AppNavbar />

		<header class="lab-overlay">
			<ProjectBreadcrumb current="Token Field" />
			<h1>Token Field</h1>
			<p class="tagline">
				The particle system behind this site - {{ particleCount.toLocaleString() }}
				simulated tokens, one persistent canvas, zero libraries. Drive it.
			</p>
		</header>

		<div v-if="!isStatic" class="fps-meter" :class="{ low: fps > 0 && fps < 50 }">
			{{ fps }} fps
		</div>

		<p v-if="isStatic" class="static-note">
			<i class="fa-solid fa-circle-info" aria-hidden="true"></i>
			Full simulation runs on desktop - this is a single composed frame of the field.
		</p>

		<Card v-else class="control-card">
			<template #content>
				<div class="control-stack">
					<div class="control-row">
						<label class="control-label" for="tf-formation">Formation</label>
						<SelectButton
							id="tf-formation"
							:model-value="formation"
							:options="formationOptions"
							option-label="label"
							option-value="value"
							:allow-empty="false"
							:disabled="!engineReady"
							size="small"
							@update:model-value="userApplyFormation($event as FormationName)"
						/>
					</div>

					<div class="control-row">
						<label class="control-label" for="tf-text">Form your own</label>
						<div class="text-row">
							<InputText
								id="tf-text"
								v-model="customText"
								:maxlength="MAX_TEXT_LENGTH"
								:disabled="!engineReady"
								placeholder="Type a word…"
								size="small"
								@keyup.enter="formCustomText"
							/>
							<Button
								label="Form it"
								size="small"
								:disabled="!engineReady || customText.trim().length === 0"
								@click="formCustomText"
							/>
						</div>
					</div>

					<div class="control-row">
						<label class="control-label" for="tf-count">
							Particles <span class="control-value">{{ particleCount.toLocaleString() }}</span>
						</label>
						<Slider
							id="tf-count"
							v-model="particleCount"
							:min="500"
							:max="6000"
							:step="100"
							:disabled="!engineReady"
						/>
					</div>

					<div class="control-row">
						<label class="control-label" for="tf-repulsion">
							Repulsion radius <span class="control-value">{{ repulsionRadius }}px</span>
						</label>
						<Slider
							id="tf-repulsion"
							v-model="repulsionRadius"
							:min="0"
							:max="200"
							:step="5"
							:disabled="!engineReady"
						/>
					</div>

					<div class="control-row">
						<label class="control-label" for="tf-trail">
							Trail persistence
							<span class="control-value">{{ trailPersistence.toFixed(2) }}</span>
						</label>
						<Slider
							id="tf-trail"
							v-model="trailPersistence"
							:min="0.05"
							:max="0.4"
							:step="0.01"
							:disabled="!engineReady"
						/>
					</div>

					<Panel header="About this engine" toggleable collapsed class="about-panel">
						<p>
							Every particle lives in preallocated typed arrays - six
							<code>Float32Array</code>s for position, velocity, and spring targets -
							so the frame loop touches contiguous memory and allocates nothing,
							which is what keeps 60fps honest at thousands of particles. Particles
							draw as 1–2px <code>fillRect</code> calls instead of <code>arc()</code>,
							roughly a 4× win at this count, grouped by color so the canvas state
							changes only four times per frame. Trails are a translucent background
							fill each frame, and <code>globalCompositeOperation: "lighter"</code>
							makes overlapping tokens glow additively. It's the same single canvas
							that runs behind the whole site: it mounts once, never unmounts on
							navigation, and a director maps routes and scroll positions to
							formations. On phones and for reduced-motion visitors the loop never
							starts - one composed frame is rendered and kept as a static image.
						</p>
					</Panel>
				</div>
			</template>
		</Card>
	</div>
</template>

<style scoped>
/* The page itself is transparent - the persistent canvas behind it paints
   the dark ground (#0D0D12) while this route is active, in both site themes. */
.lab-page {
	font-family: "Raleway", sans-serif;
	position: relative;
	min-height: 100vh;
}

.lab-overlay {
	max-width: 1280px;
	margin: 0 auto;
	padding: 7.5rem 1rem 0;
}

/* Text sits on the dark canvas in both themes - force light ink. */
.lab-overlay h1 {
	font-size: 2.25rem;
	font-weight: 700;
	color: #e8eaee;
	margin: 0 0 0.5rem;
}

.tagline {
	color: #98a0aa;
	max-width: 540px;
	line-height: 1.6;
	margin: 0;
}

.lab-overlay :deep(.crumb-current) {
	color: #98a0aa;
}

.lab-overlay :deep(.crumb-back) {
	color: #66c6ef;
}

.fps-meter {
	position: fixed;
	top: 5.5rem;
	right: 1.25rem;
	z-index: 2;
	font-family: monospace;
	font-size: 0.85rem;
	font-weight: 700;
	color: #5dcaa5;
	background: rgba(13, 13, 18, 0.55);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 6px;
	padding: 0.3rem 0.6rem;
}

.fps-meter.low {
	color: #e8963c;
}

.static-note {
	position: fixed;
	left: 50%;
	bottom: 2rem;
	transform: translateX(-50%);
	z-index: 2;
	margin: 0;
	color: #c3c8cf;
	background: rgba(13, 13, 18, 0.75);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 8px;
	padding: 0.6rem 1rem;
	font-size: 0.9rem;
	max-width: calc(100vw - 2rem);
}

.static-note i {
	color: #66c6ef;
	margin-right: 0.4rem;
}

.control-card {
	position: fixed;
	left: 1.25rem;
	bottom: 1.25rem;
	z-index: 2;
	width: min(340px, calc(100vw - 2.5rem));
	max-height: calc(100vh - 8rem);
	overflow-y: auto;
}

.control-stack {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.control-row {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.control-label {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	font-size: 0.8rem;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.control-value {
	font-family: monospace;
	font-weight: 400;
	text-transform: none;
	letter-spacing: 0;
}

.text-row {
	display: flex;
	gap: 0.5rem;
}

.text-row :deep(input) {
	flex: 1;
	min-width: 0;
}

.about-panel p {
	margin: 0;
	font-size: 0.85rem;
	line-height: 1.6;
}
</style>
