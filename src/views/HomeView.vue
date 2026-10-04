<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import AppNavbar from "@/components/sections/AppNavbar.vue";
import HeroBanner from "@/components/sections/HeroBanner.vue";
import { primevueReady } from "@/lib/deferred-primevue";

// The hero fills the first viewport, so every section below it can arrive as
// a separate chunk AFTER the entry bundle has painted - this keeps the wall
// image (the LCP element) from waiting on below-fold code. The chunk starts
// downloading immediately on mount and pops in below the fold, invisibly.
// Gated on primevueReady because the footer's health widget renders PrimeVue
// components - the home route itself skips that gate (see main.ts).
const HomeBelowFold = defineAsyncComponent(() =>
	Promise.all([primevueReady(), import("@/components/sections/HomeBelowFold.vue")]).then(
		([, m]) => m,
	),
);
</script>

<template>
	<div class="home-page">
		<AppNavbar />
		<HeroBanner />
		<HomeBelowFold />
	</div>
</template>

<style scoped>
.home-page {
	font-family: "Raleway", sans-serif;
	color: #414042;
}

html.dark .home-page {
	color: var(--dm-text-2);
}
</style>
