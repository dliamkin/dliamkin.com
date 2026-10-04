import { createRouter, createWebHistory, START_LOCATION } from "vue-router";
import { applyPageMeta } from "../lib/page-meta";
import HomeView from "../views/HomeView.vue";

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes: [
		{
			path: "/",
			name: "home",
			component: HomeView,
		},
		{
			path: "/about",
			name: "about",
			// route level code-splitting
			// this generates a separate chunk (About.[hash].js) for this route
			// which is lazy-loaded when the route is visited.
			component: () => import("../views/AboutView.vue"),
		},
		{
			path: "/projects",
			name: "projects",
			component: () => import("../views/ProjectsView.vue"),
		},
		{
			path: "/projects/note-structurer",
			name: "note-structurer",
			component: () => import("../views/NoteStructurerView.vue"),
		},
		{
			path: "/projects/screenshot-to-primevue",
			name: "screenshot-to-primevue",
			component: () => import("../views/ScreenshotToPrimevueView.vue"),
		},
		{
			path: "/projects/lease-diff",
			name: "lease-diff",
			component: () => import("../views/LeaseDiffView.vue"),
		},
		{
			path: "/projects/paperwork-to-calendar",
			name: "paperwork-to-calendar",
			component: () => import("../views/PaperworkToCalendarView.vue"),
		},
		{
			path: "/projects/upgrade-planner",
			name: "upgrade-planner",
			component: () => import("../views/UpgradePlannerView.vue"),
		},
		{
			path: "/projects/tos-watch",
			name: "tos-watch",
			component: () => import("../views/TosWatchView.vue"),
		},
		{
			path: "/projects/dry-run-oracle",
			name: "dry-run-oracle",
			component: () => import("../views/DryRunOracleView.vue"),
		},
		{
			// Convenience alias - the canonical home is under /projects like
			// every other demo.
			path: "/dry-run-oracle",
			redirect: "/projects/dry-run-oracle",
		},
		{
			path: "/projects/tail-risk-lab",
			name: "tail-risk-lab",
			component: () => import("../views/TailRiskLabView.vue"),
			// The particle field recedes to ambient texture on tool pages so it
			// never competes with the instruments for attention or frames. Any
			// /projects/* tool route recedes by default (see useParticleDirector);
			// meta.recedeField exists to flag routes outside that convention.
			meta: { recedeField: true },
		},
		{
			// Convenience alias - the canonical home is under /projects like
			// every other demo.
			path: "/tail-risk-lab",
			redirect: "/projects/tail-risk-lab",
		},
		{
			path: "/projects/noise-translator",
			name: "noise-translator",
			component: () => import("../views/NoiseTranslatorView.vue"),
		},
		{
			path: "/projects/particle-engine",
			name: "particle-engine",
			component: () => import("../views/ParticleEngineLab.vue"),
		},
		{
			// Convenience alias - the canonical home is under /projects like
			// every other demo.
			path: "/particle-engine",
			redirect: "/projects/particle-engine",
		},
		{
			// Convenience alias - the canonical home is under /projects like
			// every other demo.
			path: "/noise-translator",
			redirect: "/projects/noise-translator",
		},
		{
			path: "/evals",
			name: "evals",
			component: () => import("../views/EvalsView.vue"),
		},
	],
	scrollBehavior(to, from, savedPosition) {
		return savedPosition ?? { top: 0 };
	},
});

// Keep the document head (title, description, canonical, og/twitter tags)
// in sync with the route. Registered before the GA hook below so the
// page_view event reads the already-updated document.title.
router.afterEach((to) => {
	applyPageMeta(to);
});

// Report page views to Google Analytics. Auto page_view is disabled in
// index.html (the SPA never reloads, so gtag would only ever see one), and
// every view - including the initial load - is sent from here instead.
// Hash-only navigations (in-page anchor links such as the "About"/"Contact"
// nav items) keep the same path and are not page views.
router.afterEach((to, from) => {
	if (from !== START_LOCATION && to.path === from.path) return;
	window.gtag?.("event", "page_view", {
		page_path: to.path,
		page_location: window.location.origin + to.fullPath,
		page_title: document.title,
	});
});

export default router;
