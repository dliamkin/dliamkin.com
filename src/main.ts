import "./assets/main.css";
// Generated subset of Font Awesome (only the icons the site uses) - see
// scripts/generate-fa-subset.mjs; rerun it when adding icons.
import "./assets/fontawesome-subset.css";

import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import router from "./router";
import { startPrimeVue } from "./lib/deferred-primevue";

const app = createApp(App);

app.use(createPinia());
app.use(router);

// PrimeVue (config + Aura preset + services) installs from an async chunk -
// see src/primevue-setup.ts for why. The home route renders without waiting
// (nothing above the fold uses PrimeVue; its below-fold chunk is gated in
// HomeView.vue); every other route awaits the install before resolving, so
// no PrimeVue component can ever mount unconfigured.
const pvReady = startPrimeVue(app);
router.beforeResolve(async (to) => {
	if (to.name !== "home") await pvReady;
});

app.mount("#app");
