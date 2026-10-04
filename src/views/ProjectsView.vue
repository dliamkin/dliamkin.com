<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from "vue";
import Tag from "primevue/tag";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
import ProjectVignette from "@/components/projects/ProjectVignette.vue";
import SupportBanner from "@/components/sections/SupportBanner.vue";
import { useParticleDirector } from "@/composables/useParticleDirector";

interface ProjectEntry {
	to: string;
	icon: string;
	title: string;
	tags: string[];
	description: string;
	featured?: boolean;
}

const projects: ProjectEntry[] = [
	{
		to: "/projects/note-structurer",
		icon: "fa-solid fa-notes-medical",
		title: "Clinical Note Structurer",
		tags: ["Structured output", "Healthcare", "Serverless"],
		description:
			"Turns a messy free-text visit note into typed, structured fields - medications, vitals, follow-ups - with a HIPAA-safe architecture write-up. Synthetic data only.",
	},
	{
		to: "/projects/screenshot-to-primevue",
		icon: "fa-solid fa-wand-magic-sparkles",
		title: "Screenshot → PrimeVue",
		tags: ["Vision", "PrimeVue", "Codegen"],
		description:
			"Upload a screenshot of any UI and a vision model maps it to the PrimeVue components that would rebuild it, plus a scaffold Vue component you can copy.",
	},
	{
		to: "/projects/lease-diff",
		icon: "fa-solid fa-code-compare",
		title: "Lease Diff Explainer",
		tags: ["Hybrid diff + AI", "Real estate", "Structured output"],
		description:
			"Compare two versions of a lease and get a plain-English breakdown of every change - who it favors, how much it matters, and what to ask before signing. Synthetic documents only.",
	},
	{
		to: "/projects/paperwork-to-calendar",
		icon: "fa-solid fa-calendar-check",
		title: "Paperwork → Calendar",
		tags: ["Vision", "Date integrity", ".ics export"],
		description:
			"Paste, upload, or photograph any document with deadlines buried in it and get back a downloadable .ics - every deadline, notice window, and renewal as calendar events with reminders set before the date, not on it.",
	},
	{
		to: "/projects/upgrade-planner",
		icon: "fa-solid fa-arrow-up-right-dots",
		title: "Dependency Upgrade Planner",
		tags: ["npm registry", "Semver math", "Structured output"],
		description:
			"Paste a package.json and get computed facts - versions behind, deprecations, peer conflicts, straight from the npm registry in your browser - then an AI-synthesized upgrade plan: risk tiers, ordered waves, and the commands to run.",
	},
	{
		to: "/projects/dry-run-oracle",
		icon: "fa-solid fa-cloud-bolt",
		title: "Dry-Run Oracle",
		tags: ["Pre-flight simulation", "Cost forecasting", "Cheap-model leverage"],
		description:
			"A weather forecast for AI spend: paste an agent plan and a cheap model simulates it - failure points, retry-storm probability, and the token bill per step - before an expensive model burns a single token. Approve, apply suggested fixes, or abort.",
	},
	{
		to: "/projects/tail-risk-lab",
		icon: "fa-solid fa-chart-area",
		title: "Tail Risk Lab",
		featured: true,
		tags: [
			"TypeScript",
			"Monte Carlo",
			"Statistics",
			"Canvas",
			"Web Workers",
			"AI Cost Engineering",
		],
		description:
			"Monte Carlo cost simulator for AI agent runs. Point estimates lie about agent costs - retry loops make the distribution fat-tailed. This tool simulates a run thousands of times client-side (zero API tokens) and lets you buy down tail risk with policy knobs before spending a cent.",
	},
	{
		to: "/projects/noise-translator",
		icon: "fa-solid fa-ear-listen",
		title: "Noise Translator",
		featured: true,
		tags: ["Client-side audio", "Vision", "Structured output"],
		description:
			"Record the sound your car, dryer, or furnace is making and your browser turns it into a spectrogram plus measured acoustic facts - then a model translates them into the precise description a mechanic needs, with the questions they'll ask next. It describes; it never diagnoses.",
	},
	{
		to: "/projects/particle-engine",
		icon: "fa-solid fa-braille",
		title: "Token Field",
		featured: true,
		tags: ["TypeScript", "Canvas", "Generative Art", "Physics", "Performance"],
		description:
			"The particle system running behind this site. 3,000 simulated 'tokens' with flow-field physics, formation morphing, and mouse interaction - one persistent canvas, zero libraries, 60fps. Open the playground to drive it yourself.",
	},
	{
		to: "/projects/tos-watch",
		icon: "fa-solid fa-tower-observation",
		title: "ToS Watchdog",
		tags: ["Nightly monitor", "Public record", "RSS"],
		description:
			"A standing nightly monitor over terms-of-service and policy documents - UF campus policies and major consumer services. Hash comparison makes unchanged nights free; when a document changes, a diff-and-explain pipeline publishes a dated, neutral changelog entry anyone can subscribe to.",
	},
];

// Projects are listed oldest-first; featured rows show newest first.
const featuredProjects = projects.filter((p) => p.featured).reverse();
const gridProjects = projects.filter((p) => !p.featured);

const vignetteKind = (to: string): string => to.split("/").pop() ?? "";

// The particle field behind this page morphs into a project's signature shape
// while its card dominates the viewport. Giving another project a formation
// is one line once you have its element:
//   cleanups.push(registerSection(el, "columns", { columns: [...] }));
const { registerSection } = useParticleDirector();
const tailRiskRow = ref<Element | null>(null);

const setTailRiskRef = (el: Element | ComponentPublicInstance | null, to: string): void => {
	if (to !== "/projects/tail-risk-lab") return;
	tailRiskRow.value = el && "$el" in el ? (el.$el as Element) : el;
};

const cleanups: (() => void)[] = [];
onMounted(() => {
	if (tailRiskRow.value) cleanups.push(registerSection(tailRiskRow.value, "distribution"));
});
onBeforeUnmount(() => {
	cleanups.forEach((cleanup) => cleanup());
});
</script>

<template>
	<div class="projects-page">
		<AppNavbar />

		<main class="projects-main">
			<header class="projects-header">
				<p class="eyebrow">Interactive</p>
				<h1>My Projects</h1>
				<p class="intro">
					Working projects built into this site - each one calls a real AI model through a
					serverless proxy, with the same cost, privacy, and reliability engineering I'd
					apply in production.
				</p>
				<p class="evals-link">
					<i class="fa-solid fa-vial-circle-check" aria-hidden="true"></i>
					Every project here is continuously tested -
					<RouterLink to="/evals">see the live eval dashboard</RouterLink>.
				</p>
			</header>

			<SupportBanner />

			<section class="featured-section" aria-label="Latest builds">
				<h2 class="section-label">
					<i class="fa-solid fa-star" aria-hidden="true"></i>
					Latest builds
				</h2>
				<div class="featured-rows">
					<RouterLink
						v-for="(project, index) in featuredProjects"
						:key="project.to"
						:ref="(el) => setTailRiskRef(el, project.to)"
						:to="project.to"
						class="featured-row"
						:class="{ reverse: index % 2 === 1 }"
					>
						<div class="featured-visual">
							<ProjectVignette :kind="vignetteKind(project.to)" />
						</div>
						<div class="featured-body">
							<div class="card-title">
								<i :class="project.icon" aria-hidden="true"></i>
								<span>{{ project.title }}</span>
							</div>
							<p class="card-desc">{{ project.description }}</p>
							<div class="card-tags">
								<Tag
									v-for="tag in project.tags"
									:key="tag"
									:value="tag"
									severity="secondary"
								/>
							</div>
							<span class="try-it">
								Open project
								<i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
							</span>
						</div>
					</RouterLink>
				</div>
			</section>

			<section class="grid-section" aria-label="All projects">
				<h2 class="section-label">
					<i class="fa-solid fa-layer-group" aria-hidden="true"></i>
					All projects
				</h2>
				<div class="project-cards">
					<RouterLink
						v-for="project in gridProjects"
						:key="project.to"
						:to="project.to"
						class="project-link"
					>
						<article class="project-card">
							<div class="card-banner">
								<ProjectVignette :kind="vignetteKind(project.to)" />
							</div>
							<div class="card-body">
								<div class="card-title">
									<i :class="project.icon" aria-hidden="true"></i>
									<span>{{ project.title }}</span>
								</div>
								<p class="card-desc clamped">{{ project.description }}</p>
								<div class="card-tags">
									<Tag
										v-for="tag in project.tags"
										:key="tag"
										:value="tag"
										severity="secondary"
									/>
								</div>
							</div>
						</article>
					</RouterLink>
				</div>
			</section>
		</main>

		<SiteFooter />
	</div>
</template>

<style scoped>
.projects-page {
	font-family: "Raleway", sans-serif;
	color: #414042;
	/* Transparent so the site-wide particle field shows through; the body
	   already paints the same #fff / var(--dm-bg) this used to. Cards and
	   surfaces below keep opaque backgrounds so text never sits on particles. */
	background: transparent;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

.projects-main {
	flex: 1;
	width: 100%;
	max-width: 1280px;
	margin: 0 auto;
	padding: 7.5rem 1rem 4rem;
}

.projects-header {
	max-width: 720px;
	margin-bottom: 2.5rem;
}

.eyebrow {
	font-size: 0.85rem;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #27a9e0;
	margin-bottom: 0.5rem;
}

h1 {
	font-size: 2.25rem;
	font-weight: 700;
	margin-bottom: 0.75rem;
}

.intro {
	line-height: 1.7;
	color: #6b6a6d;
}

.evals-link {
	margin-top: 0.75rem;
	font-size: 0.9rem;
	color: #6b6a6d;
}

.evals-link i {
	color: #27a9e0;
	margin-right: 0.35rem;
}

.evals-link a {
	color: #1f8fc0;
	font-weight: 600;
}

.section-label {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.85rem;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #6b6a6d;
	margin-bottom: 1.25rem;
}

.section-label i {
	color: #27a9e0;
}

/* Featured rows */
.featured-section {
	margin-bottom: 3rem;
}

.featured-rows {
	display: flex;
	flex-direction: column;
	gap: 1.5rem;
}

.featured-row {
	display: grid;
	grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
	text-decoration: none;
	color: inherit;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 14px;
	overflow: hidden;
	transition:
		box-shadow 0.2s ease,
		transform 0.2s ease;
}

.featured-row:hover {
	box-shadow: 0 10px 30px rgba(39, 169, 224, 0.2);
	transform: translateY(-3px);
}

.featured-row.reverse .featured-visual {
	order: 2;
}

.featured-visual {
	min-height: 240px;
}

.featured-body {
	padding: 1.75rem 2rem;
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
	align-items: flex-start;
	justify-content: center;
}

.try-it {
	display: inline-flex;
	align-items: center;
	gap: 0.45rem;
	font-weight: 700;
	font-size: 0.9rem;
	color: #1f8fc0;
}

.try-it i {
	transition: transform 0.2s ease;
}

.featured-row:hover .try-it i {
	transform: translateX(4px);
}

/* Grid */
.project-cards {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
	gap: 1.5rem;
}

.project-link {
	text-decoration: none;
	color: inherit;
	display: block;
	height: 100%;
}

.project-card {
	height: 100%;
	display: flex;
	flex-direction: column;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 14px;
	overflow: hidden;
	transition:
		box-shadow 0.2s ease,
		transform 0.2s ease;
}

.project-link:hover .project-card {
	box-shadow: 0 8px 24px rgba(39, 169, 224, 0.18);
	transform: translateY(-2px);
}

.card-banner {
	aspect-ratio: 2 / 1;
	border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.card-body {
	padding: 1.25rem 1.4rem 1.4rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	flex: 1;
}

.card-title {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	font-size: 1.15rem;
	font-weight: 700;
}

.card-title i {
	color: #27a9e0;
}

.card-desc {
	color: #6b6a6d;
	line-height: 1.6;
}

.card-desc.clamped {
	display: -webkit-box;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.card-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
	margin-top: auto;
}

.featured-body .card-tags {
	margin-top: 0;
}

@media (max-width: 860px) {
	.featured-row,
	.featured-row.reverse {
		grid-template-columns: minmax(0, 1fr);
	}

	.featured-row.reverse .featured-visual {
		order: 0;
	}

	.featured-visual {
		min-height: 0;
		aspect-ratio: 16 / 9;
	}

	.featured-body {
		padding: 1.4rem 1.5rem 1.6rem;
	}
}

@media (max-width: 900px) {
	.projects-main {
		padding-top: 6.5rem;
	}

	h1 {
		font-size: 1.75rem;
	}
}

html.dark .projects-page {
	color: var(--dm-text-2);
	background: transparent;
}

html.dark h1 {
	color: var(--dm-text-1);
}

html.dark .intro,
html.dark .evals-link {
	color: var(--dm-text-2);
}

html.dark .evals-link a {
	color: var(--dm-blue-soft);
}

html.dark .section-label {
	color: var(--dm-text-3);
}

html.dark .section-label i {
	color: var(--dm-blue-soft);
}

html.dark .featured-row,
html.dark .project-card {
	background: var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark .card-banner {
	border-bottom-color: var(--dm-border);
}

html.dark .card-title {
	color: var(--dm-text-1);
}

html.dark .card-desc {
	color: var(--dm-text-2);
}

html.dark .try-it {
	color: var(--dm-blue-soft);
}

html.dark .featured-row:hover,
html.dark .project-link:hover .project-card {
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
</style>
