import type { App } from "vue";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";
import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

// PrimeVue plugin setup, loaded as an ASYNC chunk from main.ts. The Aura
// preset plus @primevue/core are ~200KB of source that no above-the-fold
// component touches - keeping them out of the entry bundle keeps the
// homepage hero (the LCP element) from waiting on them. Nothing that uses
// PrimeVue renders before this has installed: non-home routes await it in a
// beforeResolve guard, and the home page's below-fold chunk is gated on it
// (see main.ts / HomeView.vue).

// Aura preset re-tinted to the site's #27a9e0 accent.
const sitePreset = definePreset(Aura, {
	semantic: {
		primary: {
			50: "#eef9fd",
			100: "#d5f0fa",
			200: "#aee1f5",
			300: "#7fcfee",
			400: "#4fbce7",
			500: "#27a9e0",
			600: "#1f8fc0",
			700: "#19749c",
			800: "#135978",
			900: "#0d3e54",
			950: "#082a39",
		},
	},
});

export function install(app: App): void {
	app.use(PrimeVue, {
		theme: {
			preset: sitePreset,
			// The site themes off an html.dark class (dark by default, light as
			// an explicit visitor choice) - keep PrimeVue on the same switch.
			options: { darkModeSelector: ".dark" },
		},
	});
	app.use(ToastService);
	app.directive("tooltip", Tooltip);
}
