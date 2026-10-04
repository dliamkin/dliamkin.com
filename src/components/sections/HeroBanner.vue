<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const typedWords = ["Development", "Design", "Architecture", "Solutions", "Systems"];
const activeWord = ref(typedWords[0]!);
const wordWidth = ref<number | null>(null);
const measurerEl = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

const wallVisible = ref(false);
const waveActive = ref(false);

const splitCaps = (word: string) => ({ first: word.slice(0, 1), rest: word.slice(1) });
const activeWordParts = computed(() => splitCaps(activeWord.value));

const measureWidth = (word: string) => {
	if (!measurerEl.value) return 0;
	const { first, rest } = splitCaps(word);
	measurerEl.value.innerHTML = "";
	const firstSpan = document.createElement("span");
	firstSpan.className = "cap";
	firstSpan.textContent = first;
	const restSpan = document.createElement("span");
	restSpan.className = "cap-rest";
	restSpan.textContent = rest;
	measurerEl.value.append(firstSpan, restSpan);
	return measurerEl.value.offsetWidth;
};

onMounted(() => {
	setTimeout(() => {
		wallVisible.value = true;
	}, 150);
	setTimeout(() => {
		waveActive.value = true;
		setTimeout(() => {
			waveActive.value = false;
		}, 1500);
	}, 1400);

	let i = 0;
	const cycle = () => {
		i = (i + 1) % typedWords.length;
		const next = typedWords[i]!;
		wordWidth.value = measureWidth(next);
		activeWord.value = next;
		timer = setTimeout(cycle, 2000);
	};
	// The initial measure reads offsetWidth, which forces layout - done inside
	// the mount task (whole page dirty) it cost ~60ms of main-thread time
	// right in the LCP window. Until it runs, the wrapper is width:auto around
	// the same word, so deferring past first paint changes nothing visually.
	requestAnimationFrame(() => {
		timer = setTimeout(() => {
			wordWidth.value = measureWidth(activeWord.value);
			timer = setTimeout(cycle, 2000);
		}, 0);
	});
});

onUnmounted(() => {
	clearTimeout(timer);
});

const scrollToContact = () => {
	const el = document.getElementById("contact");
	if (!el) return;
	const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
};

// The first four form the wall's top two rows. Desktop's LCP element is
// usually in row one, but on mobile the wall shifts right so row TWO's left
// image (index 3) becomes the largest visible element - index.html preloads
// all four, so keep the lists in sync.
// Rendered width of one wall image in CSS px, mirroring the wall's breakpoint
// styles below. High-DPR screens multiply this and land on the 500w file;
// 1x screens land on the 340w variant.
const wallImageSizes = [
	"(max-width: 600px) 440px",
	"(max-width: 1024px) 510px",
	"calc(clamp(760px, 50vw, 1440px) / 2 - 40px)",
].join(", ");

const portfolioImages = [
	"entomology.webp",
	"resetu.webp",
	"oakwood.webp",
	"ole.webp",
	"firsteyefilm.webp",
	"toolsoffitness.webp",
	"spicegalgourmet.webp",
	"plumbingeasy.webp",
	"aptsintally.webp",
	"grenninglab.webp",
];

// Procedurally generated animated low-poly background
const bgTris = (() => {
	const COLS = 13,
		ROWS = 8,
		W = 1920,
		H = 1080;
	const cw = W / COLS,
		ch = H / ROWS;
	type Pt = [number, number];
	const grid: Pt[][] = [];
	for (let r = 0; r <= ROWS; r++) {
		const row: Pt[] = [];
		for (let c = 0; c <= COLS; c++) {
			row.push([
				c * cw + (c > 0 && c < COLS ? (Math.random() - 0.5) * cw * 0.42 : 0),
				r * ch + (r > 0 && r < ROWS ? (Math.random() - 0.5) * ch * 0.42 : 0),
			]);
		}
		grid.push(row);
	}

	const polys: {
		pts: string;
		fill: string;
		fillDark: string;
		g: number;
		delay: number;
		anim: boolean;
	}[] = [];

	const addPoly = (pts: Pt[]) => {
		const n = pts.length;
		const nx = pts.reduce((s, p) => s + p[0], 0) / (n * W);
		const ny = pts.reduce((s, p) => s + p[1], 0) / (n * H);
		// "U" shape: top is pure white; bottom corners are deepest blue; bottom center stays medium blue
		// "edge" = how far from horizontal center (0=center, 1=edge)
		const edge = Math.abs(nx - 0.5) * 2;
		// power curve on shifted ny keeps transition feathered - no harsh white-to-gray step
		const ny2 = Math.pow(Math.max(0, (ny - 0.2) / 0.8), 1.5);
		const t = Math.min(ny2 * 0.65 + edge * ny2 * 0.35, 1);
		// per-polygon noise: amplitude is (1-t)*0.10 so it's strongest in the white zone and
		// fades to zero at the deep-blue bottom - a few top shapes pick up a soft blue-gray tint
		const tc = Math.min(t + Math.random() * (1 - t) * 0.05, 1);
		const hue = 200 + tc * 10; // 200 (ice blue) → 210 (deeper blue)
		const sat = 40 + tc * 40; // 40% floor - transition zone reads as soft blue
		const lit = 99 - tc * 69; // 99% at top (white) → 30% at bottom corners
		// Dark-scheme twin of the same "U": lightness runs the other way, so the
		// headline zone is near-black slate and the bottom corners glow ice blue.
		const satDark = 18 + tc * 60; // desaturated slate up top → vivid blue below
		const litDark = 9 + tc * 27; // 9% (near-black) → 36% (glowing blue)
		polys.push({
			pts: pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "),
			fill: `hsl(${hue.toFixed(0)},${sat.toFixed(0)}%,${lit.toFixed(0)}%)`,
			fillDark: `hsl(${hue.toFixed(0)},${satDark.toFixed(0)}%,${litDark.toFixed(0)}%)`,
			g: Math.floor(Math.random() * 8),
			delay: +(Math.random() * 10).toFixed(2),
			anim: ny >= 0.4, // top 40% is static - keeps headline zone readable
		});
	};

	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const a = grid[r]![c]!,
				b = grid[r]![c + 1]!;
			const d = grid[r + 1]![c]!,
				e = grid[r + 1]![c + 1]!;
			if (Math.random() < 0.25) {
				addPoly([a, b, e, d]);
			} else {
				addPoly([a, b, d]);
				addPoly([b, e, d]);
			}
		}
	}
	return polys;
})();
</script>

<template>
	<section id="home" class="hero">
		<svg
			class="poly-bg"
			viewBox="0 0 1920 1080"
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
			focusable="false"
		>
			<polygon
				v-for="(tri, i) in bgTris"
				:key="i"
				:points="tri.pts"
				stroke-width="1"
				:class="tri.anim ? `tri-g${tri.g}` : undefined"
				:style="{
					'--fill-light': tri.fill,
					'--fill-dark': tri.fillDark,
					...(tri.anim ? { animationDelay: `${tri.delay}s` } : {}),
				}"
			/>
		</svg>

		<div class="hero-copy">
			<h1 class="headline">
				<span class="app-word"
					><span class="cap">A</span><span class="cap-rest">pp</span></span
				>
				<span
					class="word-wrapper"
					:style="{ width: wordWidth !== null ? `${wordWidth}px` : 'auto' }"
				>
					<Transition name="fade" mode="out-in">
						<span :key="activeWord" class="typed-word">
							<span class="cap">{{ activeWordParts.first }}</span
							><span class="cap-rest">{{ activeWordParts.rest }}</span>
						</span>
					</Transition>
				</span>
				<span ref="measurerEl" class="word-measurer" aria-hidden="true"></span>
			</h1>
			<a href="#contact" class="contact-me-btn" @click.prevent="scrollToContact"
				>Send Me a Message!</a
			>
		</div>

		<div class="portfolio-wall" :class="{ 'wall-visible': wallVisible }" aria-hidden="true">
			<div class="portfolio-row">
				<div
					v-for="(image, idx) in portfolioImages"
					:key="image"
					class="portfolio-column"
					:class="{ 'wave-active': waveActive }"
					:style="{ '--wave-delay': `${idx * 0.075}s` }"
				>
					<div class="item-card">
						<figure class="item-thumb">
							<!-- The 340w variants come from scripts/optimize-images.mjs;
							     sizes mirrors the .portfolio-wall/.portfolio-column CSS
							     (50% of the wall minus 40px padding) so 1x screens pull
							     the small file. Keep in sync with index.html's preloads. -->
							<img
								:src="`/images/${image}`"
								:srcset="`/images/${image.replace('.webp', '-340.webp')} 340w, /images/${image} 500w`"
								:sizes="wallImageSizes"
								alt=""
								width="500"
								height="320"
								:loading="idx < 4 ? 'eager' : 'lazy'"
								:fetchpriority="idx < 4 ? 'high' : undefined"
							/>
							<span class="item-shadow"></span>
						</figure>
					</div>
				</div>
			</div>
		</div>
	</section>
</template>

<style scoped>
.hero {
	position: relative;
	height: 100vh;
	overflow: hidden;
	background-color: hsl(200, 40%, 96%);
	display: flex;
	flex-direction: column;
	align-items: center;
	padding-top: 12rem;
}

.hero-copy {
	text-align: center;
	z-index: 2;
}

.eyebrow {
	font-family: "Raleway", sans-serif;
	text-transform: uppercase;
	letter-spacing: 0.2em;
	font-weight: 700;
	color: #c08552;
	margin-bottom: 0.5rem;
}

.headline {
	font-family: "Quicksand", sans-serif;
	font-weight: 300;
	letter-spacing: 0.02em;
	font-size: clamp(3.5rem, 8vw, 8rem);
	color: #6b6b6e;
	margin: 0 0 1.5rem;
}

:global(.cap) {
	font-weight: 300;
}

:global(.cap-rest) {
	font-weight: 300;
	font-size: 0.66em;
	text-transform: uppercase;
	letter-spacing: 0.03em;
}

.word-wrapper {
	display: inline-block;
	overflow: hidden;
	vertical-align: bottom;
	white-space: nowrap;
	margin-left: 0.25em;
	transition: width 0.35s ease;
}

.typed-word {
	display: inline-block;
	white-space: nowrap;
}

.word-measurer {
	position: absolute;
	visibility: hidden;
	height: 0;
	overflow: hidden;
	white-space: nowrap;
	pointer-events: none;
}

.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.4s ease;
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}

.contact-me-btn {
	display: inline-block;
	padding: 0.9rem 2rem;
	/* AA-contrast green (5.5:1 with white) - keep in sync with .nav-cta and .submit-btn. */
	background-color: #337733;
	color: #fff;
	text-decoration: none;
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 1.1rem;
	border-radius: 5px;
	transition: background-color 0.3s ease;
}

.contact-me-btn:hover {
	background-color: #275f27;
}

.poly-bg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	z-index: 0;
}

/* Each polygon carries both theme fills as inline vars; the html.dark class
   picks one, so the banner flips instantly when the visitor toggles themes. */
.poly-bg polygon {
	fill: var(--fill-light);
	stroke: var(--fill-light);
}

html.dark .hero {
	background-color: hsl(210, 28%, 7%);
}

html.dark .poly-bg polygon {
	fill: var(--fill-dark);
	stroke: var(--fill-dark);
}

html.dark .headline {
	color: #ccd2da;
}

@keyframes tp0 {
	0%,
	100% {
		filter: brightness(1);
	}
	50% {
		filter: brightness(1.12);
	}
}
@keyframes tp1 {
	0%,
	100% {
		filter: brightness(0.91);
	}
	50% {
		filter: brightness(1.07);
	}
}
@keyframes tp2 {
	0%,
	100% {
		filter: brightness(1.08);
	}
	50% {
		filter: brightness(0.9);
	}
}
@keyframes tp3 {
	0%,
	100% {
		filter: brightness(0.93);
	}
	50% {
		filter: brightness(1.1);
	}
}
@keyframes tp4 {
	0%,
	100% {
		filter: brightness(1);
	}
	50% {
		filter: brightness(0.88);
	}
}
@keyframes tp5 {
	0%,
	100% {
		filter: brightness(0.94);
	}
	50% {
		filter: brightness(1.11);
	}
}
@keyframes tp6 {
	0%,
	100% {
		filter: brightness(1.06);
	}
	50% {
		filter: brightness(0.91);
	}
}
@keyframes tp7 {
	0%,
	100% {
		filter: brightness(0.92);
	}
	50% {
		filter: brightness(1.08);
	}
}

.tri-g0 {
	animation: tp0 4.3s ease-in-out infinite;
}
.tri-g1 {
	animation: tp1 5.7s ease-in-out infinite;
}
.tri-g2 {
	animation: tp2 3.8s ease-in-out infinite;
}
.tri-g3 {
	animation: tp3 6.4s ease-in-out infinite;
}
.tri-g4 {
	animation: tp4 4.9s ease-in-out infinite;
}
.tri-g5 {
	animation: tp5 7.1s ease-in-out infinite;
}
.tri-g6 {
	animation: tp6 3.5s ease-in-out infinite;
}
.tri-g7 {
	animation: tp7 5.2s ease-in-out infinite;
}

.portfolio-wall {
	position: absolute;
	top: 15%;
	right: 20%;
	width: clamp(760px, 50vw, 1440px);
	perspective: 3500px;
	pointer-events: none;
	z-index: 1;
	transform: translateY(60px);
	/* Transform-only entrance, deliberately no opacity fade: the browser only
	   records a paint (and thus LCP - usually a wall image) once opacity is
	   non-zero, so any fade-in delays the metric by its full duration while a
	   translateY rise costs nothing. */
	transition: transform 1s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.portfolio-wall.wall-visible {
	transform: translateY(0);
}

.portfolio-row {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	transform: rotateX(60deg) rotateZ(-45deg);
	transform-style: preserve-3d;
	pointer-events: auto;
}

.portfolio-column {
	width: 50%;
	max-width: 50%;
	flex: 1 1 50%;
	padding: 20px;
	position: relative;
	transform-style: preserve-3d;
}

.item-card {
	position: relative;
	transform-style: preserve-3d;
}

.item-thumb {
	position: relative;
	margin: 0;
	transform-style: preserve-3d;
}

.item-thumb img {
	position: relative;
	z-index: 1;
	display: block;
	width: 100%;
	height: auto;
	transform: translate3d(0, 0, 20px);
	transition: transform 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
}

.item-shadow {
	display: block;
	position: absolute;
	inset: 0;
	background-color: rgba(0, 0, 0, 0.1);
	box-shadow: 0 0 5px 1px rgba(0, 0, 0, 0.1);
	opacity: 0.9;
	transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
}

.portfolio-column:hover .item-thumb img {
	transform: translate3d(0, 0, 50px) rotateX(-5deg);
	transform-origin: center bottom;
}

.portfolio-column:hover .item-shadow {
	opacity: 0.6;
	box-shadow: 0 0 10px 6px rgba(0, 0, 0, 0.1);
}

@keyframes wave-rise {
	0% {
		transform: translate3d(0, 0, 20px);
	}
	45% {
		transform: translate3d(0, 0, 50px) rotateX(-5deg);
	}
	100% {
		transform: translate3d(0, 0, 20px);
	}
}

@keyframes wave-shadow {
	0%,
	100% {
		opacity: 0.9;
		box-shadow: 0 0 5px 1px rgba(0, 0, 0, 0.1);
	}
	45% {
		opacity: 0.6;
		box-shadow: 0 0 10px 6px rgba(0, 0, 0, 0.1);
	}
}

.wave-active .item-thumb img {
	animation: wave-rise 0.42s ease-in-out var(--wave-delay, 0s) both;
	transform-origin: center bottom;
}

.wave-active .item-shadow {
	animation: wave-shadow 0.42s ease-in-out var(--wave-delay, 0s) both;
}

@media (min-width: 1921px) {
	.portfolio-wall {
		perspective: 5000px;
	}
}

@media (max-width: 1024px) {
	.hero {
		padding-top: 20rem;
	}

	.portfolio-wall {
		top: 28%;
		right: -15%;
		width: 1100px;
		perspective: 4000px;
	}
}

@media (max-width: 600px) {
	.hero {
		padding-top: 10rem;
	}

	.headline {
		line-height: 0.9;
		margin-bottom: 2.5rem;
	}

	.app-word {
		display: block;
	}

	.word-wrapper {
		width: auto !important;
		margin-left: 0;
	}

	.portfolio-wall {
		top: 5%;
		right: -85%;
		width: 960px;
		perspective: 3500px;
	}
}
</style>
