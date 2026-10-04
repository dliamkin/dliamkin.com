<script setup lang="ts">
import { useInView } from "@/composables/useInView";

interface CaseStudy {
	index: string;
	accent: string;
	label: string;
	title: string;
	context: string;
	challenge: string;
	solution: string;
	stack: string[];
	visual: "trackboard" | "dashboard" | "portal";
}

const studies: CaseStudy[] = [
	{
		index: "01",
		accent: "#27a9e0",
		label: "Telehealth · Iris Telehealth",
		title: "High-Stakes Patient Trackboards",
		context:
			"Spearheaded front-end enhancements for On-Demand Services - ODS Schedule, ODS Dashboard, and the Provider Portal.",
		challenge:
			"Manage complex patient encounters and multi-layered data schemas without UI rendering lag, while strictly enforcing medical business logic - e.g. validating pediatric classification only when the patient is under 18.",
		solution:
			"Led front-end development in Vue + PrimeVue with highly dynamic state management, refactoring legacy structures to render UI from grouped facility options. Added a DynamoDB active-session system that cut API load times.",
		stack: ["Vue", "PrimeVue", "TypeScript", "AWS Lambda", "DynamoDB", "DataDog"],
		visual: "trackboard",
	},
	{
		index: "02",
		accent: "#5cb85c",
		label: "Enterprise Real Estate · The Collier Companies",
		title: "Enterprise Real Estate Systems",
		context:
			"Grew from digital-marketing web work into a Senior Engineer maintaining 16+ applications across nearly every department.",
		challenge:
			"Deliver end-to-end solutions for 10+ applications while standing up Agile process and deep server-side maintenance for the whole team.",
		solution:
			"Pioneered Azure sprint-based Agile, drove full-stack Angular + C#/.NET development, and built Azure Function Apps into Data Factory pipelines - empowering product owners to make data-driven decisions.",
		stack: ["Angular", "C#", ".NET", "RxJS", "Azure Functions", "SSAS/SSIS"],
		visual: "dashboard",
	},
	{
		index: "03",
		accent: "#c08552",
		label: "Custom Web · LatentData LLC",
		title: "Custom Higher-Ed Deployments",
		context:
			"Delivered end-to-end custom web solutions for a nationwide freelance client base as owner of LatentData LLC.",
		challenge:
			"Host live faculty portfolios for University of Florida under official .edu domains, integrating directly with internal university servers.",
		solution:
			"Engineered custom WordPress themes and plugins, provisioned WHM/cPanel accounts on Apache, and configured SSL between production servers - shipping polished, secure .edu portals.",
		stack: ["PHP", "WordPress", "Apache", "WHM/cPanel", "SSL"],
		visual: "portal",
	},
];

const { target, inView } = useInView({ threshold: 0.05 });
</script>

<template>
	<section id="work" ref="target" class="cases" :class="{ 'in-view': inView }">
		<div class="cases-head">
			<p class="eyebrow">// Featured Work</p>
			<h2>Case studies, not job listings</h2>
			<p class="sub">Specific problems, and how I engineered my way through them.</p>
		</div>

		<div class="case-list">
			<article
				v-for="(study, idx) in studies"
				:key="study.index"
				class="case"
				:class="{ reverse: idx % 2 === 1 }"
				:style="{ '--accent': study.accent }"
			>
				<div class="case-copy">
					<div class="case-tagline">
						<span class="case-index">{{ study.index }}</span>
						<span class="case-label">{{ study.label }}</span>
					</div>
					<h3>{{ study.title }}</h3>

					<div class="field">
						<span class="field-key">Context</span>
						<p>{{ study.context }}</p>
					</div>
					<div class="field">
						<span class="field-key">Challenge</span>
						<p>{{ study.challenge }}</p>
					</div>
					<div class="field">
						<span class="field-key">Solution</span>
						<p>{{ study.solution }}</p>
					</div>

					<ul class="stack">
						<li v-for="tech in study.stack" :key="tech">{{ tech }}</li>
					</ul>
				</div>

				<div class="case-visual" aria-hidden="true">
					<div class="window">
						<div class="window-bar">
							<span class="wdot"></span><span class="wdot"></span
							><span class="wdot"></span>
							<span class="window-url">
								<i class="fa-solid fa-lock"></i>
								<template v-if="study.visual === 'trackboard'"
									>localhost:5173/ods</template
								>
								<template v-else-if="study.visual === 'dashboard'"
									>localhost:5173/dashboard</template
								>
								<template v-else>localhost:5173/portfolio</template>
							</span>
						</div>

						<div v-if="study.visual === 'trackboard'" class="mock trackboard">
							<div class="tb-head">
								<span>Active Consults</span>
								<span class="tb-live"><span class="pulse"></span> LIVE</span>
							</div>
							<div class="tb-row">
								<span class="tb-status s-green"></span>
								<span class="tb-name">Room 4 · ED</span>
								<span class="tb-badge b-blue">Adult</span>
								<span class="tb-time">04:12</span>
							</div>
							<div class="tb-row">
								<span class="tb-status s-amber"></span>
								<span class="tb-name">Room 7 · IP</span>
								<span class="tb-badge b-amber">Peds &lt;18</span>
								<span class="tb-time">11:38</span>
							</div>
							<div class="tb-row">
								<span class="tb-status s-green"></span>
								<span class="tb-name">Room 2 · ED</span>
								<span class="tb-badge b-blue">Adult</span>
								<span class="tb-time">02:57</span>
							</div>
							<div class="tb-row dim">
								<span class="tb-status s-grey"></span>
								<span class="tb-name">Room 9 · IP</span>
								<span class="tb-badge b-grey">Pending</span>
								<span class="tb-time">-</span>
							</div>
						</div>

						<div v-else-if="study.visual === 'dashboard'" class="mock dashboard">
							<div class="db-cards">
								<div class="db-card">
									<span class="db-num">16+</span><span class="db-cap">Apps</span>
								</div>
								<div class="db-card">
									<span class="db-num">98%</span
									><span class="db-cap">Uptime</span>
								</div>
								<div class="db-card">
									<span class="db-num">10+</span><span class="db-cap">Depts</span>
								</div>
							</div>
							<div class="db-chart">
								<span class="bar" style="--h: 40%"></span>
								<span class="bar" style="--h: 62%"></span>
								<span class="bar" style="--h: 50%"></span>
								<span class="bar" style="--h: 78%"></span>
								<span class="bar" style="--h: 66%"></span>
								<span class="bar" style="--h: 92%"></span>
								<span class="bar" style="--h: 84%"></span>
							</div>
						</div>

						<div v-else class="mock portal">
							<div class="pt-cover"></div>
							<div class="pt-avatar"><i class="fa-solid fa-user-graduate"></i></div>
							<div class="pt-lines">
								<span class="pt-line w70"></span>
								<span class="pt-line w40"></span>
							</div>
							<div class="pt-grid">
								<span></span><span></span><span></span> <span></span><span></span
								><span></span>
							</div>
							<span class="pt-edu">.edu verified</span>
						</div>
					</div>
				</div>
			</article>
		</div>
	</section>
</template>

<style scoped>
.cases {
	background: #f4f5f7;
	padding: 6rem 2rem;
}

.cases-head {
	max-width: 720px;
	margin: 0 auto 4rem;
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

.cases-head h2 {
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

.case-list {
	max-width: 1150px;
	margin: 0 auto;
	display: flex;
	flex-direction: column;
	gap: 5rem;
}

.case {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 3.5rem;
	align-items: center;
	opacity: 0;
	transform: translateY(40px);
	transition:
		opacity 0.7s ease,
		transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.in-view .case {
	opacity: 1;
	transform: translateY(0);
}

.case.reverse .case-copy {
	order: 2;
}

.case-tagline {
	display: flex;
	align-items: center;
	gap: 0.9rem;
	margin-bottom: 0.75rem;
}

.case-index {
	font-family: "JetBrains Mono", monospace;
	font-weight: 700;
	font-size: 2rem;
	color: var(--accent);
	line-height: 1;
}

.case-label {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: #8a8b8f;
}

.case-copy h3 {
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: clamp(1.4rem, 2.5vw, 1.85rem);
	color: #414042;
	margin: 0 0 1.5rem;
}

.field {
	margin-bottom: 1rem;
	padding-left: 1rem;
	border-left: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
}

.field-key {
	display: block;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--accent);
	margin-bottom: 0.25rem;
}

.field p {
	font-family: "Raleway", sans-serif;
	font-size: 0.95rem;
	line-height: 1.6;
	color: #55565a;
	margin: 0;
}

.stack {
	list-style: none;
	margin: 1.5rem 0 0;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.stack li {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.73rem;
	padding: 0.32rem 0.65rem;
	border-radius: 6px;
	background: #fff;
	color: #414042;
	border: 1px solid rgba(0, 0, 0, 0.08);
}

/* ---- Mock window shell ---- */
.window {
	background: #fff;
	border-radius: 12px;
	box-shadow: 0 30px 60px rgba(0, 0, 0, 0.15);
	overflow: hidden;
	border: 1px solid rgba(0, 0, 0, 0.06);
}

.window-bar {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.6rem 0.9rem;
	background: #eceef1;
	border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.wdot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: #c9ccd1;
}

.window-url {
	margin-left: 0.75rem;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	color: #8a8b8f;
	background: #fff;
	padding: 0.2rem 0.7rem;
	border-radius: 20px;
	flex: 1;
}

.window-url i {
	color: #5cb85c;
	margin-right: 0.35rem;
	font-size: 0.65rem;
}

.mock {
	padding: 1.25rem;
	min-height: 230px;
}

/* ---- Trackboard ---- */
.tb-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 0.9rem;
	color: #414042;
	margin-bottom: 1rem;
}

.tb-live {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.65rem;
	color: #e0413a;
}

.pulse {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #e0413a;
	animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
	0%,
	100% {
		opacity: 1;
		box-shadow: 0 0 0 0 rgba(224, 65, 58, 0.5);
	}
	50% {
		opacity: 0.5;
		box-shadow: 0 0 0 5px rgba(224, 65, 58, 0);
	}
}

.tb-row {
	display: grid;
	grid-template-columns: auto 1fr auto auto;
	align-items: center;
	gap: 0.75rem;
	padding: 0.6rem 0.5rem;
	border-radius: 8px;
	font-family: "Raleway", sans-serif;
	font-size: 0.85rem;
	background: #f6f7f9;
	margin-bottom: 0.5rem;
}

.tb-row.dim {
	opacity: 0.55;
}

.tb-status {
	width: 10px;
	height: 10px;
	border-radius: 50%;
}

.s-green {
	background: #5cb85c;
}
.s-amber {
	background: #f0ad4e;
}
.s-grey {
	background: #c9ccd1;
}

.tb-name {
	color: #414042;
	font-weight: 700;
}

.tb-badge {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.65rem;
	padding: 0.2rem 0.5rem;
	border-radius: 5px;
}

.b-blue {
	background: rgba(39, 169, 224, 0.14);
	color: #1f88b6;
}
.b-amber {
	background: rgba(240, 173, 78, 0.18);
	color: #c98214;
}
.b-grey {
	background: #eceef1;
	color: #8a8b8f;
}

.tb-time {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	color: #8a8b8f;
}

/* ---- Dashboard ---- */
.db-cards {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 0.75rem;
	margin-bottom: 1.25rem;
}

.db-card {
	background: #f6f7f9;
	border-radius: 8px;
	padding: 0.9rem;
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.db-num {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: 1.5rem;
	color: var(--accent);
}

.db-cap {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.65rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: #8a8b8f;
}

.db-chart {
	display: flex;
	align-items: flex-end;
	gap: 0.6rem;
	height: 110px;
	padding: 0 0.25rem;
}

.bar {
	flex: 1;
	height: var(--h);
	background: linear-gradient(to top, var(--accent), color-mix(in srgb, var(--accent) 45%, #fff));
	border-radius: 5px 5px 0 0;
	transform-origin: bottom;
	animation: grow-bar 0.9s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.in-view .bar {
	animation-play-state: running;
}

@keyframes grow-bar {
	from {
		transform: scaleY(0);
	}
	to {
		transform: scaleY(1);
	}
}

/* ---- Portal ---- */
.portal {
	position: relative;
	padding-top: 0;
}

.pt-cover {
	height: 70px;
	margin: 0 -1.25rem 0;
	background: linear-gradient(120deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #fff));
}

.pt-avatar {
	width: 60px;
	height: 60px;
	border-radius: 50%;
	background: #fff;
	border: 3px solid #fff;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--accent);
	font-size: 1.4rem;
	margin: -30px 0 0.75rem 0.5rem;
}

.pt-lines {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-bottom: 1.25rem;
}

.pt-line {
	height: 10px;
	border-radius: 5px;
	background: #eceef1;
}

.pt-line.w70 {
	width: 70%;
}
.pt-line.w40 {
	width: 40%;
}

.pt-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 0.5rem;
}

.pt-grid span {
	height: 42px;
	border-radius: 6px;
	background: #f6f7f9;
}

.pt-edu {
	position: absolute;
	top: 82px;
	right: 1rem;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.62rem;
	color: #5cb85c;
	background: rgba(92, 184, 92, 0.12);
	padding: 0.2rem 0.5rem;
	border-radius: 5px;
}

@media (max-width: 860px) {
	.case,
	.case.reverse .case-copy {
		grid-template-columns: 1fr;
		order: 0;
	}

	.case-visual {
		order: -1;
	}
}

@media (max-width: 600px) {
	.cases {
		padding: 6rem 1rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.case {
		opacity: 1;
		transform: none;
		transition: none;
	}
	.bar {
		animation: none;
		transform: scaleY(1);
	}
	.pulse {
		animation: none;
	}
}

/* The mock browser windows deliberately stay light in dark mode - they read as
   app screenshots, and a light window on a dark desk looks intentional. */
html.dark .cases {
	background: var(--dm-bg-soft);
}

html.dark .cases-head h2 {
	color: var(--dm-text-1);
}

html.dark .sub {
	color: var(--dm-text-2);
}

html.dark .case-copy h3 {
	color: var(--dm-text-1);
}

html.dark .field p {
	color: var(--dm-text-2);
}

html.dark .stack li {
	background: var(--dm-bg-mute);
	color: var(--dm-text-2);
	border-color: rgba(255, 255, 255, 0.08);
}

html.dark .window {
	box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
}
</style>
