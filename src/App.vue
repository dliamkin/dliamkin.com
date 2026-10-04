<script setup lang="ts">
import ParticleField from "@/components/ParticleField.vue";
</script>

<template>
	<!-- The one persistent particle canvas - mounted once, never unmounts on
	     navigation. All page content renders above it (see .site-content);
	     page roots that should reveal the field use transparent backgrounds. -->
	<ParticleField />
	<div class="site-content">
		<router-view />
	</div>
</template>

<style>
:root {
	color-scheme: light;
	color: #262626;
	background: #ffffff;

	/* Dark-mode palette tokens - every component's `html.dark` override pulls
	   from these so the whole site darkens consistently. The #27a9e0 brand
	   blue stays the accent in both themes. Dark is the site default: an
	   inline script in index.html adds .dark to <html> before first paint
	   unless the visitor has explicitly chosen light (see useTheme). */
	--dm-bg: #121417;
	--dm-bg-soft: #191d23;
	--dm-bg-mute: #242a33;
	--dm-border: rgba(255, 255, 255, 0.12);
	--dm-text-1: #e8eaee;
	--dm-text-2: #c3c8cf;
	--dm-text-3: #98a0aa;
	--dm-blue: #27a9e0;
	--dm-blue-soft: #66c6ef;
}

body {
	margin: 0;
	font-family: "Raleway", sans-serif;
	background: #fff;
}

html.dark {
	color-scheme: dark;
	color: var(--dm-text-2);
	background: var(--dm-bg);
}

html.dark body {
	background: var(--dm-bg);
}

* {
	box-sizing: border-box;
}

/* Everything the router renders sits above the fixed particle canvas. */
.site-content {
	position: relative;
	z-index: 1;
}

/* Offset anchor jumps so sections aren't hidden under the fixed navbar */
section[id],
footer[id] {
	scroll-margin-top: 5rem;
}

/* PrimeVue's Message mounts inside a <Transition appear> that animates its
   height open (grid-template-rows 0fr -> 1fr, 300ms). For the disclaimer
   banners that are simply part of a page, that entrance visibly pushes the
   whole page down while it plays - the single largest CLS source on the
   demo pages. Messages appear instantly instead; the leave animation is
   untouched. */
.p-message-enter-active {
	animation: none !important;
}
</style>
