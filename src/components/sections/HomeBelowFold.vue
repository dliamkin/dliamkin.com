<script setup lang="ts">
// Everything on the home page below the 100vh hero, bundled as ONE async
// chunk (see HomeView.vue). The hero is the LCP element, so none of this
// code - sections, the donate band, the footer with its health widget -
// belongs in the entry bundle's download/execute window.
import ResponsiveShowcase from "@/components/sections/ResponsiveShowcase.vue";
import AboutSection from "@/components/sections/AboutSection.vue";
import ExpertisePillars from "@/components/sections/ExpertisePillars.vue";
import CareerTimeline from "@/components/sections/CareerTimeline.vue";
import CaseStudies from "@/components/sections/CaseStudies.vue";
import SideProjects from "@/components/sections/SideProjects.vue";
import SkillsGrid from "@/components/sections/SkillsGrid.vue";
import ConferencesSection from "@/components/sections/ConferencesSection.vue";
import SupportBanner from "@/components/sections/SupportBanner.vue";
import SiteFooter from "@/components/sections/SiteFooter.vue";
</script>

<template>
	<SideProjects />
	<ResponsiveShowcase />
	<AboutSection />
	<ExpertisePillars />
	<CareerTimeline />
	<CaseStudies />
	<SkillsGrid />
	<ConferencesSection />
	<SupportBanner
		variant="band"
		eyebrow="// Support"
		heading="Enjoying the site?"
		blurb="I build all of this in my own time - the site, the experiments running behind it, and the write-ups that go with them. If something here gave you an idea, taught you something, or was just fun to click through, you're welcome to chip in toward the next one. Everything stays free either way."
		cta-label="Buy me some tokens"
	/>
	<SiteFooter />
</template>
