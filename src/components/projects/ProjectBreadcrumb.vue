<script setup lang="ts">
// Replaces the old eyebrow on project/eval pages. The back-arrow and the
// breadcrumb parent are the same link - one affordance, no redundant
// "Back to all projects" + "Projects › …" repetition. Parent defaults to the
// projects gallery, but any page can point it elsewhere.
withDefaults(
	defineProps<{ current: string; parentLabel?: string; parentTo?: string }>(),
	{ parentLabel: "My Projects", parentTo: "/projects" },
);
</script>

<template>
	<nav class="project-breadcrumb" aria-label="Breadcrumb">
		<RouterLink :to="parentTo" class="crumb-back">
			<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
			<span>{{ parentLabel }}</span>
		</RouterLink>
		<i class="fa-solid fa-chevron-right crumb-sep" aria-hidden="true"></i>
		<span class="crumb-current" aria-current="page">{{ current }}</span>
	</nav>
</template>

<style scoped>
.project-breadcrumb {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.85rem;
	font-weight: 600;
	margin-bottom: 0.5rem;
}

.crumb-back {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	color: #1f8fc0;
	text-decoration: none;
	border-radius: 4px;
	transition: color 0.15s ease;
}

.crumb-back i {
	transition: transform 0.15s ease;
}

.crumb-back:hover {
	color: #27a9e0;
}

.crumb-back:hover i {
	transform: translateX(-2px);
}

.crumb-back:focus-visible {
	outline: 2px solid #27a9e0;
	outline-offset: 3px;
}

.crumb-sep {
	font-size: 0.65rem;
	color: #c4c3c8;
}

.crumb-current {
	color: #6b6a6d;
}

html.dark .crumb-back {
	color: var(--dm-blue-soft);
}

html.dark .crumb-back:hover {
	color: #8fd4f4;
}

html.dark .crumb-sep {
	color: #4a4f57;
}

html.dark .crumb-current {
	color: var(--dm-text-2);
}
</style>
