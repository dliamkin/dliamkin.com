<script setup lang="ts">
import { useInView } from "@/composables/useInView";

interface Value {
	icon: string;
	title: string;
	body: string;
}

const values: Value[] = [
	{
		icon: "fa-solid fa-people-group",
		title: "Mentorship & Leadership",
		body: "Technical leadership and mentoring the team matter as much as the code itself.",
	},
	{
		icon: "fa-solid fa-comments",
		title: "Cross-Dept Communication",
		body: "Translating product wants into engineering reality across every department.",
	},
	{
		icon: "fa-solid fa-book-open",
		title: "Documentation Integrity",
		body: "Rigorous Jira hygiene and Confluence docs treated as first-class engineering goals.",
	},
	{
		icon: "fa-solid fa-bullseye",
		title: "Strategic OKRs",
		body: "Setting and executing measurable objectives so the whole team moves forward together.",
	},
];

const { target, inView } = useInView({ threshold: 0.2 });
</script>

<template>
	<section id="culture" ref="target" class="culture" :class="{ 'in-view': inView }">
		<div class="culture-inner">
			<p class="eyebrow">// Engineering Culture</p>

			<blockquote class="pull-quote">
				<span class="q-mark">&ldquo;</span>
				Great software is built by great teams. I cultivate a
				<span class="hl">transparent, team-driven culture</span> where technical leadership
				and mentorship are just as important as the code - pairing clear
				cross-departmental communication with the discipline of rigorous documentation and
				strategic OKRs, so the entire team moves forward together.
			</blockquote>

			<div class="value-grid">
				<div
					v-for="(value, idx) in values"
					:key="value.title"
					class="value"
					:style="{ '--delay': `${idx * 0.09}s` }"
				>
					<i :class="value.icon"></i>
					<h3>{{ value.title }}</h3>
					<p>{{ value.body }}</p>
				</div>
			</div>
		</div>
	</section>
</template>

<style scoped>
.culture {
	position: relative;
	background: #2b2f36;
	background-image:
		radial-gradient(circle at 20% 20%, rgba(39, 169, 224, 0.16), transparent 45%),
		radial-gradient(circle at 85% 75%, rgba(92, 184, 92, 0.14), transparent 45%);
	padding: 6rem 2rem;
	overflow: hidden;
}

.culture-inner {
	max-width: 1000px;
	margin: 0 auto;
	text-align: center;
}

.eyebrow {
	font-family: "JetBrains Mono", monospace;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-size: 0.85rem;
	font-weight: 500;
	color: #66c6ef;
	margin: 0 0 2rem;
}

.pull-quote {
	position: relative;
	font-family: "Cormorant Garamond", serif;
	font-weight: 500;
	font-size: clamp(1.4rem, 3vw, 2.15rem);
	line-height: 1.5;
	color: #eef1f4;
	margin: 0 0 4rem;
	opacity: 0;
	transform: translateY(24px);
	transition:
		opacity 0.8s ease,
		transform 0.8s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.in-view .pull-quote {
	opacity: 1;
	transform: translateY(0);
}

.q-mark {
	position: absolute;
	top: -2.5rem;
	left: 50%;
	transform: translateX(-50%);
	font-size: 6rem;
	color: rgba(39, 169, 224, 0.35);
	line-height: 1;
	pointer-events: none;
}

.hl {
	color: #66c6ef;
}

.value-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 1.5rem;
	text-align: left;
}

.value {
	padding: 1.5rem 1.25rem;
	border-radius: 12px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.08);
	opacity: 0;
	transform: translateY(24px);
	transition:
		opacity 0.6s ease var(--delay),
		transform 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) var(--delay),
		background 0.3s ease,
		border-color 0.3s ease;
}

.in-view .value {
	opacity: 1;
	transform: translateY(0);
}

.value:hover {
	background: rgba(255, 255, 255, 0.07);
	border-color: rgba(39, 169, 224, 0.5);
}

.value i {
	font-size: 1.35rem;
	color: #66c6ef;
	margin-bottom: 0.9rem;
	display: block;
}

.value h3 {
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 1rem;
	color: #fff;
	margin: 0 0 0.5rem;
}

.value p {
	font-family: "Raleway", sans-serif;
	font-size: 0.85rem;
	line-height: 1.55;
	color: #aab1ba;
	margin: 0;
}

@media (max-width: 860px) {
	.value-grid {
		grid-template-columns: repeat(2, 1fr);
	}
}

@media (max-width: 480px) {
	.value-grid {
		grid-template-columns: 1fr;
	}
}

@media (max-width: 600px) {
	.culture {
		padding: 6rem 1rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.pull-quote,
	.value {
		opacity: 1;
		transform: none;
		transition:
			background 0.3s ease,
			border-color 0.3s ease;
	}
}
</style>
