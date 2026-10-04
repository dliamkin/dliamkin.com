<script setup lang="ts">
// Real /about page (this was a placeholder stub for a long time - the
// nightly site-health audit flagged it every run). Deliberately assembled
// from the same sections the home page uses: the content is identical by
// design, this page just gives it a stable, linkable home with the standard
// site chrome around it.
import AppNavbar from "@/components/sections/AppNavbar.vue";
import AboutSection from "@/components/sections/AboutSection.vue";
import EngineeringValues from "@/components/sections/EngineeringValues.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
</script>

<template>
	<div class="about-page">
		<AppNavbar />

		<main class="about-main">
			<header class="about-header">
				<p class="eyebrow">Nice to meet you</p>
				<h1>About Me</h1>
				<p class="intro">
					I'm Denis Liamkin - a Senior Software Engineer in Melbourne, FL with 12+ years
					of full-stack experience across telehealth and enterprise real estate. Below is
					the short version of how I work and what I build with; the
					<RouterLink to="/projects">projects page</RouterLink> shows it in practice.
				</p>
			</header>

			<AboutSection />
			<EngineeringValues />
		</main>

		<SiteFooter />
	</div>
</template>

<style scoped>
.about-page {
	font-family: "Raleway", sans-serif;
	color: #414042;
	/* Transparent so the site-wide particle field shows through; the
	   sections below keep their own opaque backgrounds so text never sits
	   on particles. */
	background: transparent;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

.about-main {
	flex: 1;
	width: 100%;
}

.about-header {
	max-width: 1280px;
	margin: 0 auto;
	padding: 7.5rem 1rem 3rem;
}

.eyebrow {
	font-size: 0.85rem;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #27a9e0;
	margin: 0 0 0.5rem;
}

h1 {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: clamp(2.2rem, 4vw, 3rem);
	margin: 0 0 1rem;
}

.intro {
	max-width: 720px;
	font-size: 1.05rem;
	line-height: 1.7;
	margin: 0;
}

.intro a {
	color: #19749c;
	font-weight: 600;
}

@media (max-width: 640px) {
	.about-header {
		padding-top: 6.5rem;
	}
}

html.dark .about-page {
	color: var(--dm-text-2);
}

html.dark h1 {
	color: var(--dm-text-1);
}

html.dark .intro a {
	color: var(--dm-blue-soft);
}
</style>
