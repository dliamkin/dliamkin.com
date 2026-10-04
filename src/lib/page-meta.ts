import type { RouteLocationNormalized } from "vue-router";

// Per-route document head data. The SPA serves the same index.html for every
// path, so without this each subpage kept the homepage's title, description,
// and - worst - a rel=canonical pointing at "/", which search engines read
// as "this page is a duplicate of the homepage" (and Lighthouse scores as a
// failed canonical audit). Google processes JS-applied canonicals and
// descriptions for SPAs, so updating the tags on navigation is enough.
//
// Keyed by route NAME (see src/router/index.ts). Routes without an entry
// fall back to the homepage title/description with a path-correct canonical.

const SITE_ORIGIN = "https://dliamkin.com";

const DEFAULT_TITLE = "Denis Liamkin - Senior Software Engineer";
const DEFAULT_DESCRIPTION =
	"Senior Software Engineer with 12+ years building full-stack enterprise applications across telehealth and real estate. Expert in Vue, Angular, C#/.NET, AWS, and Azure.";

const PAGE_META: Record<string, { title: string; description: string }> = {
	home: {
		title: DEFAULT_TITLE,
		description: DEFAULT_DESCRIPTION,
	},
	about: {
		title: "About - Denis Liamkin",
		description:
			"About Denis Liamkin: a Senior Software Engineer with 12+ years of full-stack experience across telehealth and enterprise real estate, bridging cloud backends and frontends users enjoy.",
	},
	projects: {
		title: "Projects - Denis Liamkin",
		description:
			"Interactive AI demos and experiments built by Denis Liamkin - document structuring, audio analysis, cost simulation, and more, each running on live models with published evals.",
	},
	"note-structurer": {
		title: "Clinical Note Structurer - Denis Liamkin",
		description:
			"Paste a free-text clinical visit note and watch it become a structured, schema-validated record. A telehealth-flavored AI demo with published eval results.",
	},
	"screenshot-to-primevue": {
		title: "Screenshot → PrimeVue - Denis Liamkin",
		description:
			"Drop a UI screenshot and get a PrimeVue component breakdown of what's on screen. An AI vision demo with published eval results.",
	},
	"lease-diff": {
		title: "Lease Diff - Denis Liamkin",
		description:
			"Compare two lease drafts and get a plain-English breakdown of what changed and what it means. An AI document-comparison demo.",
	},
	"paperwork-to-calendar": {
		title: "Paperwork → Calendar - Denis Liamkin",
		description:
			"Turn dense paperwork into calendar-ready obligations with dates, amounts, and an importable .ics file. An AI extraction demo with published evals.",
	},
	"upgrade-planner": {
		title: "Upgrade Planner - Denis Liamkin",
		description:
			"Feed in a dependency list and get a sequenced, risk-annotated upgrade plan. An AI planning demo with published eval results.",
	},
	"tos-watch": {
		title: "ToS Watch - Denis Liamkin",
		description:
			"Track terms-of-service documents over time and surface what changed between snapshots. An AI document-monitoring demo.",
	},
	"dry-run-oracle": {
		title: "Dry-Run Oracle - Denis Liamkin",
		description:
			"Describe a plan and get a cheap-model pre-flight simulation of how it plays out - risks, failure points, and outcomes before you commit.",
	},
	"tail-risk-lab": {
		title: "Tail Risk Lab - Denis Liamkin",
		description:
			"A client-side Monte Carlo simulator for AI feature costs - explore how usage distributions and pricing turn into tail-risk bills, entirely in the browser.",
	},
	"noise-translator": {
		title: "Noise Translator - Denis Liamkin",
		description:
			"Record or upload a mystery mechanical noise and get a plain-English characterization of what it might be. An AI audio-analysis demo.",
	},
	"particle-engine": {
		title: "Particle Engine Playground - Denis Liamkin",
		description:
			"The generative particle field that lives behind dliamkin.com, opened up as a playground - formations, physics, and rendering you can drive yourself.",
	},
	evals: {
		title: "Evals - Denis Liamkin",
		description:
			"Continuous evaluation results for every AI demo on this site - pass rates, case-level outcomes, and history, regenerated automatically in CI.",
	},
};

function setMeta(selector: string, content: string): void {
	document.head.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", content);
}

export function applyPageMeta(to: RouteLocationNormalized): void {
	const entry = (to.name && PAGE_META[String(to.name)]) || null;
	const title = entry?.title ?? DEFAULT_TITLE;
	const description = entry?.description ?? DEFAULT_DESCRIPTION;
	// Canonical never carries a trailing slash except the root.
	const canonical = `${SITE_ORIGIN}${to.path === "/" ? "/" : to.path.replace(/\/$/, "")}`;

	document.title = title;
	document.head
		.querySelector<HTMLLinkElement>('link[rel="canonical"]')
		?.setAttribute("href", canonical);
	setMeta('meta[name="description"]', description);
	setMeta('meta[property="og:title"]', title);
	setMeta('meta[property="og:description"]', description);
	setMeta('meta[property="og:url"]', canonical);
	setMeta('meta[name="twitter:title"]', title);
	setMeta('meta[name="twitter:description"]', description);
	setMeta('meta[name="twitter:url"]', canonical);
}
