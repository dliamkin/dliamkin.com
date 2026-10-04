<script setup lang="ts">
import Carousel from "primevue/carousel";
import { useInView } from "@/composables/useInView";

interface Conference {
	name: string;
	year: number;
	location: string;
	theme: string;
	accent: string;
	/**
	 * Drop a JPG at public/images/conferences/<slug>.jpg, run
	 * `npm run optimize:images` (emits <slug>.webp + <slug>-380.webp), and set
	 * this to "/images/conferences/<slug>.webp". Null renders a placeholder.
	 */
	image: string | null;
}

const conferences: Conference[] = [
	{
		name: "NMHC OPTECH",
		year: 2022,
		location: "Las Vegas, NV",
		theme: "Multifamily proptech & data",
		accent: "#5cb85c",
		image: "/images/conferences/image7-2022.webp",
	},
	{
		name: "Progressive Web Experience",
		year: 2021,
		location: "Clearwater, FL",
		theme: "PWAs, performance & modern front-end",
		accent: "#27a9e0",
		image: "/images/conferences/image6-2021.webp",
	},
	{
		name: "Progressive Web Experience",
		year: 2019,
		location: "Clearwater, FL",
		theme: "PWAs, performance & modern front-end",
		accent: "#27a9e0",
		image: "/images/conferences/image5-2019.webp",
	},
	{
		name: "MozCon",
		year: 2018,
		location: "Seattle, WA",
		theme: "SEO & search marketing",
		accent: "#e0413a",
		image: "/images/conferences/image4-2018.webp",
	},
	{
		name: "NMHC OPTECH",
		year: 2018,
		location: "Orlando, FL",
		theme: "Multifamily proptech & data",
		accent: "#5cb85c",
		image: "/images/conferences/image3-2018.webp",
	},
	{
		name: "NMHC OPTECH",
		year: 2017,
		location: "Las Vegas, NV",
		theme: "Multifamily proptech & data",
		accent: "#5cb85c",
		image: "/images/conferences/image2-2017.webp",
	},
	{
		name: "Angular Summit",
		year: 2016,
		location: "Boston, MA",
		theme: "Angular 2 & TypeScript",
		accent: "#c08552",
		image: "/images/conferences/image1-2016.webp",
	},
];

const responsiveOptions = [
	{ breakpoint: "1100px", numVisible: 2, numScroll: 1 },
	{ breakpoint: "680px", numVisible: 1, numScroll: 1 },
];

const { target, inView } = useInView({ threshold: 0.15 });
</script>

<template>
	<section id="conferences" ref="target" class="confs" :class="{ 'in-view': inView }">
		<div class="confs-head">
			<p class="eyebrow">// On the Road</p>
			<h2>Conferences &amp; community</h2>
			<p class="sub">
				Seven conferences across a decade - FE, SEO, and MFNH PropTech - because the best
				ideas usually show up in hallway conversations.
			</p>
		</div>

		<Carousel
			:value="conferences"
			:num-visible="3"
			:num-scroll="1"
			:responsive-options="responsiveOptions"
			circular
			:autoplay-interval="5500"
			class="confs-carousel"
		>
			<template #item="{ data, index }">
				<article
					class="conf-card"
					:style="{ '--accent': data.accent, '--delay': `${index * 0.1}s` }"
				>
					<div class="conf-media">
						<img
							v-if="data.image"
							:src="data.image"
							:srcset="`${data.image.replace(/\.webp$/, '-380.webp')} 380w, ${data.image} 760w`"
							sizes="(max-width: 680px) 90vw, (max-width: 1100px) 45vw, 370px"
							width="760"
							height="570"
							:alt="`${data.name} ${data.year}`"
							loading="lazy"
							decoding="async"
						/>
						<div v-else class="conf-placeholder" aria-hidden="true">
							<i class="fa-solid fa-camera"></i>
							<span>Photo coming soon</span>
						</div>
						<span class="conf-year">{{ data.year }}</span>
					</div>
					<div class="conf-body">
						<h3>{{ data.name }}</h3>
						<p class="conf-theme">{{ data.theme }}</p>
						<p class="conf-loc">
							<i class="fa-solid fa-location-dot"></i> {{ data.location }}
						</p>
					</div>
				</article>
			</template>
		</Carousel>
	</section>
</template>

<style scoped>
.confs {
	background: #fff;
	padding: 6rem 2rem 7rem;
	overflow: hidden;
}

.confs-head {
	max-width: 720px;
	margin: 0 auto 3rem;
	text-align: center;
}

.eyebrow {
	font-family: "JetBrains Mono", monospace;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-size: 0.85rem;
	font-weight: 500;
	color: #c08552;
	margin: 0 0 1rem;
}

.confs-head h2 {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: clamp(1.9rem, 3.5vw, 2.75rem);
	color: #414042;
	margin: 0 0 1rem;
}

.sub {
	font-family: "Raleway", sans-serif;
	font-size: 1.1rem;
	color: #6b6b6e;
	margin: 0;
}

.confs-carousel {
	max-width: 1150px;
	margin: 0 auto;
}

.conf-card {
	margin: 0 0.75rem 1rem;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 14px;
	background: #fff;
	overflow: hidden;
	opacity: 0;
	transform: translateY(26px);
	transition:
		opacity 0.55s ease var(--delay),
		transform 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) var(--delay),
		box-shadow 0.3s ease,
		border-color 0.3s ease;
}

.in-view .conf-card {
	opacity: 1;
	transform: translateY(0);
}

.conf-card:hover {
	border-color: var(--accent);
	box-shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
}

.conf-media {
	position: relative;
	aspect-ratio: 4 / 3;
	background: #f4f5f7;
}

.conf-media img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.conf-placeholder {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.6rem;
	background:
		radial-gradient(
			circle at 20% 15%,
			color-mix(in srgb, var(--accent) 35%, transparent),
			transparent 55%
		),
		radial-gradient(
			circle at 85% 90%,
			color-mix(in srgb, var(--accent) 22%, transparent),
			transparent 50%
		),
		linear-gradient(160deg, #2b2f36, #1a1d23);
	color: rgba(255, 255, 255, 0.55);
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	letter-spacing: 0.1em;
	text-transform: uppercase;
}

.conf-placeholder i {
	font-size: 1.6rem;
	color: color-mix(in srgb, var(--accent) 80%, #fff);
}

.conf-year {
	position: absolute;
	top: 0.85rem;
	left: 0.85rem;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.75rem;
	letter-spacing: 0.08em;
	padding: 0.3rem 0.6rem;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	backdrop-filter: blur(4px);
}

.conf-body {
	padding: 1.25rem 1.4rem 1.4rem;
	border-top: 3px solid var(--accent);
}

.conf-body h3 {
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 1.1rem;
	color: #414042;
	margin: 0 0 0.35rem;
}

.conf-theme {
	font-family: "Raleway", sans-serif;
	font-size: 0.9rem;
	color: #6b6b6e;
	margin: 0 0 0.7rem;
}

.conf-loc {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	letter-spacing: 0.06em;
	color: #8a8b8f;
	margin: 0;
}

.conf-loc i {
	color: var(--accent);
	margin-right: 0.3rem;
}

/* PrimeVue Carousel chrome */
.confs-carousel :deep(.p-carousel-indicator-button) {
	width: 1.5rem;
	height: 0.3rem;
	border-radius: 999px;
}

@media (max-width: 600px) {
	.confs {
		padding: 6rem 0.5rem 7rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.conf-card {
		opacity: 1;
		transform: none;
		transition:
			box-shadow 0.3s ease,
			border-color 0.3s ease;
	}
}

html.dark .confs {
	background: var(--dm-bg);
}

html.dark .confs-head h2,
html.dark .conf-body h3 {
	color: var(--dm-text-1);
}

html.dark .sub,
html.dark .conf-theme {
	color: var(--dm-text-2);
}

html.dark .conf-loc {
	color: var(--dm-text-3);
}

html.dark .conf-card {
	background: var(--dm-bg-soft);
	border-color: rgba(255, 255, 255, 0.09);
}

html.dark .conf-card:hover {
	border-color: var(--accent);
	box-shadow: 0 18px 40px rgba(0, 0, 0, 0.4);
}

html.dark .conf-media {
	background: var(--dm-bg-mute);
}
</style>
