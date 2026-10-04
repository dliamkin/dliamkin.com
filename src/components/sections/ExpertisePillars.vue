<script setup lang="ts">
import { useInView } from "@/composables/useInView";

interface Pillar {
	icon: string;
	accent: string;
	title: string;
	body: string;
	tags: string[];
}

const pillars: Pillar[] = [
	{
		icon: "fa-solid fa-diagram-project",
		accent: "#27a9e0",
		title: "Enterprise Frontend Architecture",
		body: "I build complex, data-heavy applications that feel weightless. With Vue and Angular I centralize global state to eliminate race conditions, prevent stale renders, and keep data in sync across deeply nested component trees.",
		tags: ["Vue", "Angular", "State Management", "TypeScript"],
	},
	{
		icon: "fa-solid fa-wand-magic-sparkles",
		accent: "#c08552",
		title: "Precision UI & UX Engineering",
		body: "Great data is useless if it's hard to read. I obsess over the micro-interactions that remove friction - customizing component libraries like PrimeVue, engineering custom CSS layouts, and prototyping original assets in Adobe Creative Cloud.",
		tags: ["PrimeVue", "CSS Flex/Grid", "Adobe CC", "Accessibility"],
	},
	{
		icon: "fa-solid fa-cloud-arrow-up",
		accent: "#5cb85c",
		title: "Cloud Infrastructure & DevOps",
		body: "I don't just build the interface - I make the system behind it bulletproof. I architect end-to-end CI/CD pipelines and disaster-recovery protocols for AWS serverless, and manage Azure Data Factory pipelines and Function Apps.",
		tags: ["AWS Lambda", "DynamoDB", "CI/CD", "Azure"],
	},
	{
		icon: "fa-solid fa-chart-line",
		accent: "#9b59b6",
		title: "Data Integration & Analytics",
		body: "I securely bridge applications and business intelligence - engineering token-based API integrations for platforms like Google Ads and Meta to transform raw data into comprehensive revenue and marketing reports.",
		tags: ["REST APIs", "OAuth", "QuickSight", "DataDog"],
	},
];

const { target, inView } = useInView({ threshold: 0.15 });
</script>

<template>
	<section id="expertise" ref="target" class="expertise" :class="{ 'in-view': inView }">
		<div class="expertise-head">
			<p class="eyebrow">// What I Do</p>
			<h2>Four pillars of full-stack delivery</h2>
			<p class="sub">
				From the pixels a user touches to the serverless functions behind them - I own the
				whole stack.
			</p>
		</div>

		<div class="pillar-grid">
			<article
				v-for="(pillar, idx) in pillars"
				:key="pillar.title"
				class="pillar"
				:style="{ '--accent': pillar.accent, '--delay': `${idx * 0.1}s` }"
			>
				<div class="pillar-icon">
					<i :class="pillar.icon"></i>
				</div>
				<h3>{{ pillar.title }}</h3>
				<p>{{ pillar.body }}</p>
				<ul class="tags">
					<li v-for="tag in pillar.tags" :key="tag">{{ tag }}</li>
				</ul>
			</article>
		</div>
	</section>
</template>

<style scoped>
.expertise {
	background: #fff;
	padding: 6rem 2rem;
}

.expertise-head {
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
	color: #c08552;
	margin: 0 0 1rem;
}

.expertise-head h2 {
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

.pillar-grid {
	max-width: 1100px;
	margin: 0 auto;
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1.75rem;
}

.pillar {
	position: relative;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 14px;
	padding: 2.25rem 2rem 2rem;
	overflow: hidden;
	opacity: 0;
	transform: translateY(30px);
	transition:
		opacity 0.6s ease var(--delay),
		transform 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) var(--delay),
		box-shadow 0.3s ease,
		border-color 0.3s ease;
}

.in-view .pillar {
	opacity: 1;
	transform: translateY(0);
}

/* animated accent bar that grows on hover */
.pillar::before {
	content: "";
	position: absolute;
	top: 0;
	left: 0;
	height: 4px;
	width: 100%;
	background: var(--accent);
	transform: scaleX(0);
	transform-origin: left;
	transition: transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.pillar:hover {
	border-color: var(--accent);
	box-shadow: 0 22px 50px rgba(0, 0, 0, 0.1);
	transform: translateY(-6px);
}

.pillar:hover::before {
	transform: scaleX(1);
}

.pillar-icon {
	width: 3.25rem;
	height: 3.25rem;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.4rem;
	color: var(--accent);
	background: color-mix(in srgb, var(--accent) 12%, transparent);
	margin-bottom: 1.25rem;
	transition: transform 0.3s ease;
}

.pillar:hover .pillar-icon {
	transform: scale(1.1) rotate(-4deg);
}

.pillar h3 {
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 1.25rem;
	color: #414042;
	margin: 0 0 0.85rem;
}

.pillar p {
	font-family: "Raleway", sans-serif;
	font-size: 0.98rem;
	line-height: 1.65;
	color: #6b6b6e;
	margin: 0 0 1.4rem;
}

.tags {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.tags li {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	padding: 0.3rem 0.6rem;
	border-radius: 6px;
	background: #f4f5f7;
	color: #55565a;
	border: 1px solid rgba(0, 0, 0, 0.05);
}

@media (max-width: 767px) {
	.pillar-grid {
		grid-template-columns: 1fr;
	}
}

@media (max-width: 600px) {
	.expertise {
		padding: 6rem 1rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.pillar {
		transition:
			box-shadow 0.3s ease,
			border-color 0.3s ease;
		opacity: 1;
		transform: none;
	}
}

html.dark .expertise {
	background: var(--dm-bg);
}

html.dark .expertise-head h2 {
	color: var(--dm-text-1);
}

html.dark .sub {
	color: var(--dm-text-2);
}

html.dark .pillar {
	background: var(--dm-bg-soft);
	border-color: rgba(255, 255, 255, 0.09);
}

html.dark .pillar:hover {
	border-color: var(--accent);
	box-shadow: 0 22px 50px rgba(0, 0, 0, 0.45);
}

html.dark .pillar h3 {
	color: var(--dm-text-1);
}

html.dark .pillar p {
	color: var(--dm-text-2);
}

html.dark .tags li {
	background: var(--dm-bg-mute);
	color: var(--dm-text-2);
	border-color: rgba(255, 255, 255, 0.07);
}
</style>
