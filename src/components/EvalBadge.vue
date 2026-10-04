<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { EVAL_LATEST_PATH, isEvalReport, type EvalProjectId, type SuiteResult } from "@/lib/evals";

// Small "Evals: N/M passing" pill shown next to each project's title, linking to
// the /evals dashboard. Reads the same static JSON the dashboard renders - no
// API, no key. Before the first eval run exists (or if the fetch fails), it
// renders nothing.

const props = defineProps<{ projectId: EvalProjectId }>();

const suite = ref<SuiteResult | null>(null);
// While the fetch is in flight an invisible same-size placeholder holds the
// badge's line in the page header - the pill popping in after the JSON
// arrived pushed everything below it down (the largest single CLS source on
// the project pages). Only a definitive miss collapses the space.
const pending = ref(true);

onMounted(async () => {
	try {
		const response = await fetch(EVAL_LATEST_PATH);
		if (!response.ok || !response.headers.get("content-type")?.includes("json")) return;
		const data: unknown = await response.json();
		if (!isEvalReport(data)) return;
		suite.value = data.suites.find((s) => s.project_id === props.projectId) ?? null;
	} catch {
		// No results yet (or unreachable) - render nothing.
	} finally {
		pending.value = false;
	}
});

const allPassing = computed(
	() => suite.value !== null && suite.value.pass_count === suite.value.total,
);
</script>

<template>
	<!-- No aria-label: "N of M" didn't contain the visible "N/M" text (a
	     WCAG 2.5.3 label-in-name failure); the link's own text names it. -->
	<RouterLink
		v-if="suite"
		to="/evals"
		class="eval-badge"
		:class="allPassing ? 'passing' : 'failing'"
	>
		<i
			:class="allPassing ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation'"
			aria-hidden="true"
		></i>
		Evals: {{ suite.pass_count }}/{{ suite.total }} passing
	</RouterLink>
	<!-- "badge-pending", not "placeholder": the host view's scoped attrs fall
	     through to this root, so a generic class name here would also match
	     the view's own scoped `.placeholder` styles (NoteStructurerView's
	     result-panel placeholder padding was inflating this pill to ~118px,
	     which recreated the very layout shift this exists to prevent). -->
	<span v-else-if="pending" class="eval-badge badge-pending" aria-hidden="true">
		<i class="fa-solid fa-circle-check"></i>
		Evals: –/– passing
	</span>
</template>

<style scoped>
.eval-badge {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	font-family: "Raleway", sans-serif;
	font-size: 0.78rem;
	font-weight: 700;
	padding: 0.25rem 0.7rem;
	border-radius: 999px;
	text-decoration: none;
	transition: filter 0.2s ease;
}

.eval-badge:hover {
	filter: brightness(0.92);
}

/* Space-reserving stand-in while the eval JSON loads: invisible but laid
   out, so the real pill swaps in without shifting the page. */
.eval-badge.badge-pending {
	visibility: hidden;
	border: 1px solid transparent;
}

.eval-badge.passing {
	color: #1b6e3d;
	background: #e3f4e9;
	border: 1px solid #b3dfc3;
}

.eval-badge.failing {
	color: #8a5a00;
	background: #fdf0d7;
	border: 1px solid #ecd7a3;
}

html.dark .eval-badge:hover {
	filter: brightness(1.15);
}

html.dark .eval-badge.passing {
	color: #7fd8a3;
	background: rgba(34, 160, 90, 0.14);
	border-color: rgba(34, 160, 90, 0.45);
}

html.dark .eval-badge.failing {
	color: #ffd28a;
	background: rgba(224, 169, 46, 0.12);
	border-color: rgba(224, 169, 46, 0.4);
}
</style>
