<script setup lang="ts">
import Timeline from "primevue/timeline";
import { useInView } from "@/composables/useInView";

interface Role {
	company: string;
	role: string;
	period: string;
	industry: string;
	icon: string;
	accent: string;
	highlights: string[];
	tags: string[];
}

// Newest first - mirrors the résumé. Keep the highlights to the three that
// carry a number or a concrete outcome; the full bullet list lives on the PDF.
const roles: Role[] = [
	{
		company: "Iris Telehealth",
		role: "Senior Software Engineer",
		period: "2024 - 2026",
		industry: "Telehealth / Clinical SaaS",
		icon: "fa-solid fa-notes-medical",
		accent: "#27a9e0",
		highlights: [
			"Designed the company's foundational CI/CD pipelines, cutting release time from ~12-minute manual deploys to ~6-minute automated releases.",
			"Architected and owned the “Iris Insights” TypeScript / AWS Lambda monorepo while driving down monthly AWS spend through continuous cost tracking.",
			"Led the On-Demand Services suite in Vue + PrimeVue - real-time patient trackboards used daily by Emergency Department and in-patient clinical teams.",
			"Slashed API response times with a DynamoDB active-session model and instrumented DataDog monitors that shrank mean time to detection for incidents.",
		],
		tags: ["Vue 3", "PrimeVue", "AWS Lambda", "DynamoDB", "DataDog", "CI/CD", "Monorepo"],
	},
	{
		company: "The Collier Companies",
		role: "Senior Software Engineer",
		period: "2016 - 2024",
		industry: "Real Estate / Property Management",
		icon: "fa-solid fa-building",
		accent: "#5cb85c",
		highlights: [
			"Engineered end-to-end solutions for 10+ production applications - Angular (v2 → 16), C# / .NET, ASP.NET Core, and Swagger-documented APIs.",
			"Pioneered Azure sprint-based Agile delivery for the whole team and rolled out Azure DevOps CI/CD company-wide.",
			"Built C# Azure Function Apps wired into Azure Data Factory pipelines, automating data movement that used to be manual.",
			"Engineered token-authenticated integrations with Google Ads, Facebook, and Instagram that turned raw ad data into automated revenue reports.",
		],
		tags: [
			"Angular",
			"C# / .NET",
			"Azure Functions",
			"Data Factory",
			"Azure DevOps",
			"SSIS / SSAS",
			"WordPress",
		],
	},
	{
		company: "LatentData LLC",
		role: "Owner / Principal Engineer",
		period: "2016 - 2024",
		industry: "Freelance Consultancy",
		icon: "fa-solid fa-laptop-code",
		accent: "#c08552",
		highlights: [
			"Delivered proprietary WordPress themes and custom plugins for a nationwide client base - while holding a full-time senior role.",
			"Deployed custom professional pages for University of Florida faculty, integrating with internal university servers to host live portfolios on official .edu domains.",
			"Built and maintained WHM / cPanel hosting on Apache, including SSL configuration across production servers.",
		],
		tags: ["WordPress", "PHP", "Apache", "WHM / cPanel", "SSL"],
	},
	{
		company: "StartButton LLC / Midgard Scientific",
		role: "Software Developer",
		period: "2014 - 2016",
		industry: "Agency",
		icon: "fa-solid fa-rocket",
		accent: "#9b59b6",
		highlights: [
			"Developed custom WordPress themes and plugins for clients nationwide.",
			"Worked in ASP.NET Core with Razor to integrate an AWS-hosted Amazon product environment; explored Laravel middleware development.",
		],
		tags: ["ASP.NET Core", "Razor", "WordPress", "Laravel", "AWS"],
	},
];

const education = [
	{
		degree: "B.A.S., Computer Information Systems Technology",
		school: "Eastern Florida State College",
		period: "2019 - 2021",
	},
	{
		degree: "A.A., General Studies",
		school: "Eastern Florida State College",
		period: "2013 - 2015",
	},
];

const { target, inView } = useInView({ threshold: 0.08 });
</script>

<template>
	<section id="experience" ref="target" class="career" :class="{ 'in-view': inView }">
		<div class="career-head">
			<p class="eyebrow">// Career Path</p>
			<h2>Twelve years, four chapters</h2>
			<p class="sub">
				From agency WordPress builds to clinical-grade serverless platforms - each role
				layered a new part of the stack onto the last.
			</p>
		</div>

		<Timeline :value="roles" align="alternate" class="career-timeline">
			<template #marker="{ item }">
				<span class="marker" :style="{ '--accent': item.accent }">
					<i :class="item.icon"></i>
				</span>
			</template>
			<template #opposite="{ item }">
				<span class="period">{{ item.period }}</span>
			</template>
			<template #content="{ item, index }">
				<article
					class="role-card"
					:style="{ '--accent': item.accent, '--delay': `${index * 0.12}s` }"
				>
					<header>
						<p class="industry">{{ item.industry }}</p>
						<h3>{{ item.company }}</h3>
						<p class="role">{{ item.role }}</p>
						<p class="period period-inline">{{ item.period }}</p>
					</header>
					<ul class="highlights">
						<li v-for="line in item.highlights" :key="line">{{ line }}</li>
					</ul>
					<ul class="tags">
						<li v-for="tag in item.tags" :key="tag">{{ tag }}</li>
					</ul>
				</article>
			</template>
		</Timeline>

		<div class="education">
			<div class="edu-icon"><i class="fa-solid fa-graduation-cap"></i></div>
			<div class="edu-body">
				<p class="edu-eyebrow">Education</p>
				<ul>
					<li v-for="e in education" :key="e.degree">
						<span class="degree">{{ e.degree }}</span>
						<span class="school">{{ e.school }}</span>
						<span class="edu-period">{{ e.period }}</span>
					</li>
				</ul>
			</div>
		</div>
	</section>
</template>

<style scoped>
.career {
	background: #f4f5f7;
	padding: 6rem 2rem;
	overflow: hidden;
}

.career-head {
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

.career-head h2 {
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

.career-timeline {
	max-width: 1100px;
	margin: 0 auto;
}

.marker {
	width: 2.6rem;
	height: 2.6rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #fff;
	color: var(--accent);
	border: 2px solid var(--accent);
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 14%, transparent);
	font-size: 1rem;
	z-index: 1;
}

.period {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.8rem;
	letter-spacing: 0.08em;
	color: #8a8b8f;
	display: inline-block;
	padding-top: 0.75rem;
}

.period-inline {
	display: none;
	padding-top: 0.25rem;
	margin: 0;
}

.role-card {
	position: relative;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 14px;
	padding: 1.75rem 1.75rem 1.6rem;
	margin-bottom: 2.5rem;
	text-align: left;
	overflow: hidden;
	opacity: 0;
	transform: translateY(28px);
	transition:
		opacity 0.6s ease var(--delay),
		transform 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) var(--delay),
		box-shadow 0.3s ease,
		border-color 0.3s ease;
}

.in-view .role-card {
	opacity: 1;
	transform: translateY(0);
}

.role-card::before {
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

.role-card:hover {
	border-color: var(--accent);
	box-shadow: 0 22px 50px rgba(0, 0, 0, 0.1);
}

.role-card:hover::before {
	transform: scaleX(1);
}

.industry {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.7rem;
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: var(--accent);
	margin: 0 0 0.5rem;
}

.role-card h3 {
	font-family: "Raleway", sans-serif;
	font-weight: 700;
	font-size: 1.25rem;
	color: #414042;
	margin: 0 0 0.2rem;
}

.role {
	font-family: "Raleway", sans-serif;
	font-size: 0.95rem;
	color: #6b6b6e;
	margin: 0 0 1rem;
}

.highlights {
	margin: 0 0 1.25rem;
	padding-left: 1.1rem;
	font-family: "Raleway", sans-serif;
	font-size: 0.93rem;
	line-height: 1.6;
	color: #55565a;
}

.highlights li + li {
	margin-top: 0.5rem;
}

.highlights li::marker {
	color: var(--accent);
}

.tags {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 0.45rem;
}

.tags li {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.7rem;
	padding: 0.28rem 0.55rem;
	border-radius: 6px;
	background: #f4f5f7;
	color: #55565a;
	border: 1px solid rgba(0, 0, 0, 0.05);
}

/* ---- education footer card ---- */
.education {
	max-width: 760px;
	margin: 1rem auto 0;
	display: flex;
	gap: 1.25rem;
	align-items: flex-start;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 14px;
	padding: 1.5rem 1.75rem;
	opacity: 0;
	transform: translateY(20px);
	transition:
		opacity 0.6s ease 0.5s,
		transform 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) 0.5s;
}

.in-view .education {
	opacity: 1;
	transform: translateY(0);
}

.edu-icon {
	flex: none;
	width: 3rem;
	height: 3rem;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.25rem;
	color: #27a9e0;
	background: rgba(39, 169, 224, 0.12);
}

.edu-eyebrow {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.7rem;
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: #8a8b8f;
	margin: 0 0 0.6rem;
}

.edu-body ul {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.7rem;
}

.edu-body li {
	display: grid;
	grid-template-columns: 1fr auto;
	column-gap: 1rem;
	font-family: "Raleway", sans-serif;
}

.degree {
	font-weight: 700;
	color: #414042;
	font-size: 0.98rem;
}

.school {
	grid-column: 1;
	color: #6b6b6e;
	font-size: 0.88rem;
}

.edu-period {
	grid-row: 1 / span 2;
	grid-column: 2;
	font-family: "JetBrains Mono", monospace;
	font-size: 0.78rem;
	color: #8a8b8f;
	align-self: start;
	padding-top: 0.15rem;
}

/* PrimeVue Timeline internals (unscoped element classes) */
.career-timeline :deep(.p-timeline-event-connector) {
	background: rgba(0, 0, 0, 0.1);
	width: 2px;
}

.career-timeline :deep(.p-timeline-event-opposite) {
	font-family: "JetBrains Mono", monospace;
}

@media (max-width: 767px) {
	/* Collapse to a single left rail: hide the opposite column, show the
	   period inside the card instead. */
	.career-timeline :deep(.p-timeline-event-opposite) {
		display: none;
	}

	.career-timeline :deep(.p-timeline-event:nth-child(even)) {
		flex-direction: row;
	}

	.career-timeline :deep(.p-timeline-event-content) {
		text-align: left !important;
	}

	.period-inline {
		display: block;
	}

	.role-card {
		padding: 1.4rem 1.25rem 1.3rem;
		margin-bottom: 1.75rem;
	}

	.education {
		flex-direction: column;
	}

	.edu-body li {
		grid-template-columns: 1fr;
	}

	.edu-period {
		grid-row: auto;
		grid-column: 1;
	}
}

@media (max-width: 600px) {
	.career {
		padding: 6rem 1rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.role-card,
	.education {
		opacity: 1;
		transform: none;
		transition:
			box-shadow 0.3s ease,
			border-color 0.3s ease;
	}
}

html.dark .career {
	background: var(--dm-bg-soft);
}

html.dark .career-head h2,
html.dark .role-card h3,
html.dark .degree {
	color: var(--dm-text-1);
}

html.dark .sub,
html.dark .role,
html.dark .highlights,
html.dark .school {
	color: var(--dm-text-2);
}

html.dark .period,
html.dark .edu-period,
html.dark .edu-eyebrow {
	color: var(--dm-text-3);
}

html.dark .marker {
	background: var(--dm-bg);
}

html.dark .role-card,
html.dark .education {
	background: var(--dm-bg);
	border-color: rgba(255, 255, 255, 0.09);
}

html.dark .role-card:hover {
	border-color: var(--accent);
	box-shadow: 0 22px 50px rgba(0, 0, 0, 0.45);
}

html.dark .tags li {
	background: var(--dm-bg-mute);
	color: var(--dm-text-2);
	border-color: rgba(255, 255, 255, 0.07);
}

html.dark .career-timeline :deep(.p-timeline-event-connector) {
	background: rgba(255, 255, 255, 0.12);
}
</style>
