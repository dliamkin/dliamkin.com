<script setup lang="ts">
import { useInView } from "@/composables/useInView";

interface SideProject {
	accent: string;
	label: string;
	name: string;
	tagline: string;
	blurb: string;
	tags: string[];
	image: string;
	alt: string;
	url: string;
	domain: string;
	cta: string;
}

// Screenshots live in public/images/sideprojects as 1120w + 640w webp pairs
// (1280x800 captures of each site's landing page).
const projects: SideProject[] = [
	{
		accent: "#ff9db0",
		label: "Interview Prep",
		name: "CodeYouKnow",
		tagline: "Walk into the interview with code you know.",
		blurb: "Short, test-checked exercises for the live-coding round. Each one pairs a worked example with a twin problem you solve yourself in a real in-browser editor, with tests that answer the moment you run them. Free, and no account needed to start.",
		tags: ["JavaScript", "TypeScript", "Python", "SQL", "Rust", "C#"],
		image: "codeyouknow",
		alt: "CodeYouKnow landing page: Study it. Solve it. Get reviewed.",
		url: "https://codeyouknow.com/",
		domain: "codeyouknow.com",
		cta: "Start practicing",
	},
	{
		accent: "#6fcf97",
		label: "Cert Promo Tracker",
		name: "LatentData",
		tagline: "Free IT certification exams, tracked and verified.",
		blurb: "A live tracker for exam vouchers, discount codes and free training with badges from Microsoft, AWS, Google Cloud and 20+ other vendors. Every offer lists its dates and eligibility, checked against the vendor's own page.",
		tags: ["Exam vouchers", "Discount codes", "Free training", "Calendar", "Watch list"],
		image: "latentdata",
		alt: "LatentData offer tracker listing free and discounted IT certification exams",
		url: "https://latentdata.org/",
		domain: "latentdata.org",
		cta: "Browse open offers",
	},
];

const { target, inView } = useInView({ threshold: 0.1 });
</script>

<template>
	<section id="side-projects" ref="target" class="side" :class="{ 'in-view': inView }">
		<div class="side-head">
			<p class="eyebrow">// Side Projects</p>
			<h2>What I build after hours</h2>
			<p class="sub">Two products I designed, built, and run on my own. Both are live.</p>
		</div>

		<div class="side-grid">
			<article
				v-for="(project, idx) in projects"
				:key="project.name"
				class="project"
				:style="{ '--accent': project.accent, '--delay': `${idx * 0.12}s` }"
			>
				<a
					class="window"
					:href="project.url"
					target="_blank"
					rel="noopener"
					tabindex="-1"
					aria-hidden="true"
				>
					<div class="window-bar">
						<span class="wdot"></span><span class="wdot"></span
						><span class="wdot"></span>
						<span class="window-url">
							<i class="fa-solid fa-lock"></i>{{ project.domain }}
						</span>
					</div>
					<img
						:src="`/images/sideprojects/${project.image}.webp`"
						:srcset="`/images/sideprojects/${project.image}-640.webp 640w, /images/sideprojects/${project.image}.webp 1120w`"
						sizes="(max-width: 860px) 92vw, 540px"
						:alt="project.alt"
						width="1120"
						height="700"
						loading="lazy"
						decoding="async"
					/>
				</a>

				<div class="project-copy">
					<span class="project-label">{{ project.label }}</span>
					<h3>{{ project.name }}</h3>
					<p class="tagline">{{ project.tagline }}</p>
					<p class="blurb">{{ project.blurb }}</p>

					<ul class="tags">
						<li v-for="tag in project.tags" :key="tag">{{ tag }}</li>
					</ul>

					<a class="cta" :href="project.url" target="_blank" rel="noopener">
						{{ project.cta }}
						<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
					</a>
				</div>
			</article>
		</div>
	</section>
</template>

<style scoped>
.side {
	position: relative;
	background: #2b2f36;
	background-image:
		radial-gradient(circle at 20% 20%, rgba(39, 169, 224, 0.16), transparent 45%),
		radial-gradient(circle at 85% 75%, rgba(92, 184, 92, 0.14), transparent 45%);
	padding: 6rem 2rem;
	overflow: hidden;
}

.side-head {
	max-width: 720px;
	margin: 0 auto 3.5rem;
	text-align: center;
}

.eyebrow {
	font-family: "JetBrains Mono", monospace;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-size: 0.85rem;
	font-weight: 500;
	color: #66c6ef;
	margin: 0 0 1rem;
}

.side-head h2 {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: clamp(1.9rem, 3.5vw, 2.75rem);
	color: #fff;
	margin: 0 0 1rem;
}

.sub {
	font-family: "Raleway", sans-serif;
	font-size: 1.1rem;
	color: #aab1ba;
	margin: 0;
}

.side-grid {
	max-width: 1150px;
	margin: 0 auto;
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 2rem;
}

.project {
	display: flex;
	flex-direction: column;
	border-radius: 14px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.08);
	overflow: hidden;
	opacity: 0;
	transform: translateY(32px);
	transition:
		opacity 0.7s ease var(--delay),
		transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) var(--delay),
		border-color 0.3s ease;
}

.in-view .project {
	opacity: 1;
	transform: translateY(0);
}

.project:hover {
	border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}

.window {
	display: block;
	text-decoration: none;
	border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.window-bar {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.6rem 0.9rem;
	background: #20242a;
}

.wdot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: #4a4f58;
}

.window-url {
	margin-left: 0.75rem;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	color: #aab1ba;
	background: rgba(255, 255, 255, 0.06);
	padding: 0.2rem 0.7rem;
	border-radius: 20px;
	flex: 1;
}

.window-url i {
	color: #5cb85c;
	margin-right: 0.35rem;
	font-size: 0.65rem;
}

.window img {
	display: block;
	width: 100%;
	height: auto;
	aspect-ratio: 16 / 10;
	object-fit: cover;
	object-position: top;
	transition: transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.project:hover .window img {
	transform: scale(1.02);
}

.project-copy {
	display: flex;
	flex-direction: column;
	flex: 1;
	padding: 1.75rem 1.75rem 2rem;
}

.project-label {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--accent);
	margin-bottom: 0.5rem;
}

.project-copy h3 {
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: clamp(1.4rem, 2.5vw, 1.85rem);
	color: #fff;
	margin: 0 0 0.4rem;
}

.tagline {
	font-family: "Cormorant Garamond", serif;
	font-weight: 500;
	font-size: 1.3rem;
	line-height: 1.35;
	color: #eef1f4;
	margin: 0 0 1rem;
}

.blurb {
	font-family: "Raleway", sans-serif;
	font-size: 0.95rem;
	line-height: 1.65;
	color: #aab1ba;
	margin: 0;
}

.tags {
	list-style: none;
	margin: 1.25rem 0 1.75rem;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.tags li {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.73rem;
	padding: 0.32rem 0.65rem;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.06);
	color: #d5dae0;
	border: 1px solid rgba(255, 255, 255, 0.08);
}

.cta {
	align-self: flex-start;
	margin-top: auto;
	display: inline-flex;
	align-items: center;
	gap: 0.6rem;
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 0.95rem;
	padding: 0.8rem 1.4rem;
	border-radius: 8px;
	background: var(--accent);
	color: #1b1e23;
	text-decoration: none;
	transition:
		transform 0.2s ease,
		box-shadow 0.2s ease;
}

.cta i {
	font-size: 0.8rem;
}

.cta:hover {
	transform: translateY(-2px);
	box-shadow: 0 10px 24px color-mix(in srgb, var(--accent) 35%, transparent);
}

.cta:focus-visible {
	outline: 2px solid #fff;
	outline-offset: 3px;
}

@media (max-width: 860px) {
	.side-grid {
		grid-template-columns: 1fr;
		max-width: 620px;
	}
}

@media (max-width: 600px) {
	.side {
		padding: 6rem 1rem;
	}

	.project-copy {
		padding: 1.5rem 1.25rem 1.75rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.project {
		opacity: 1;
		transform: none;
		transition: border-color 0.3s ease;
	}

	.window img,
	.cta {
		transition: none;
	}
}
</style>
