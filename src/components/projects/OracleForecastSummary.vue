<script setup lang="ts">
import { computed } from "vue";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { formatUsd, type RiskLevel, type SimulationResult } from "@/lib/dry-run-oracle";

const props = defineProps<{
	result: SimulationResult;
	source: "sample" | "cache" | "live";
}>();

const WEATHER: Record<RiskLevel, { icon: string; label: string }> = {
	clear: { icon: "fa-solid fa-sun", label: "Clear skies" },
	caution: { icon: "fa-solid fa-cloud", label: "Clouds building" },
	storm: { icon: "fa-solid fa-cloud-bolt", label: "Storm warning" },
};

const weather = computed(() => WEATHER[props.result.overallRisk]);

const savings = computed(() => {
	const multiple = props.result.savingsMultiple;
	if (multiple >= 100) return `${Math.round(multiple).toLocaleString("en-US")}×`;
	if (multiple >= 10) return `${multiple.toFixed(0)}×`;
	return `${multiple.toFixed(1)}×`;
});
</script>

<template>
	<section class="forecast" :data-tone="props.result.overallRisk" aria-label="Forecast summary">
		<Message
			v-if="props.result.abortRecommended"
			severity="error"
			:closable="false"
			class="forecast__abort"
		>
			The oracle recommends <strong>aborting this plan as written</strong> - apply the
			suggested fixes or narrow the scope before spending a token.
		</Message>

		<div class="forecast__main">
			<div class="forecast__icon" aria-hidden="true">
				<i :class="weather.icon"></i>
			</div>
			<div class="forecast__body">
				<div class="forecast__meta">
					<span class="forecast__condition">{{ weather.label }}</span>
					<Tag
						v-if="props.source === 'sample'"
						value="bundled sample - 0 tokens spent"
						severity="secondary"
						icon="fa-solid fa-bolt"
					/>
					<Tag
						v-else-if="props.source === 'cache'"
						value="cached forecast - 0 tokens spent"
						severity="secondary"
						icon="fa-solid fa-bolt"
					/>
				</div>
				<h3 class="forecast__headline">{{ props.result.forecastHeadline }}</h3>
				<p class="forecast__cost">
					<span class="forecast__cost-figure">
						{{ formatUsd(props.result.totalCostUsd[0]) }}&ndash;{{
							formatUsd(props.result.totalCostUsd[1])
						}}
					</span>
					<span class="forecast__cost-caption">
						expected spend &middot; worst case
						{{ formatUsd(props.result.worstCaseCostUsd) }}
					</span>
				</p>
				<p class="forecast__flex">
					<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
					This forecast cost {{ formatUsd(props.result.oracleCostUsd) }} - potentially
					saving you <strong>{{ savings }}</strong> that.
				</p>
			</div>
		</div>
	</section>
</template>

<style scoped>
.forecast {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.forecast__abort {
	margin: 0;
}

.forecast__main {
	display: flex;
	gap: 1.25rem;
	align-items: flex-start;
	background: linear-gradient(140deg, #f6fbfe, #eef4f8);
	border: 1px solid rgba(39, 169, 224, 0.25);
	border-radius: 14px;
	padding: 1.4rem 1.5rem;
}

.forecast__icon {
	flex: 0 0 auto;
	width: 4rem;
	height: 4rem;
	border-radius: 50%;
	display: grid;
	place-items: center;
	background: #fff;
	border: 1px solid rgba(0, 0, 0, 0.08);
}

.forecast__icon i {
	font-size: 1.8rem;
}

.forecast[data-tone="clear"] .forecast__icon i {
	color: #f0a020;
}

.forecast[data-tone="caution"] .forecast__icon i {
	color: #8a939e;
}

.forecast[data-tone="storm"] .forecast__icon i {
	color: #e04b3a;
}

.forecast__body {
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
	min-width: 0;
}

.forecast__meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.6rem;
}

.forecast__condition {
	font-size: 0.75rem;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #6b6a6d;
}

.forecast__headline {
	margin: 0;
	font-size: 1.2rem;
	line-height: 1.45;
	font-weight: 600;
	color: #2d2c2e;
	text-transform: none;
	letter-spacing: normal;
}

.forecast__cost {
	margin: 0.2rem 0 0;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.forecast__cost-figure {
	font-size: 1.9rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: #1f8fc0;
}

.forecast__cost-caption {
	font-size: 0.85rem;
	color: #6b6a6d;
}

.forecast__flex {
	margin: 0;
	font-size: 0.9rem;
	color: #6b6a6d;
}

.forecast__flex i {
	color: #27a9e0;
	margin-right: 0.35rem;
}

.forecast__flex strong {
	color: #2d2c2e;
}

@media (max-width: 520px) {
	.forecast__main {
		flex-direction: column;
		gap: 0.9rem;
	}

	.forecast__cost-figure {
		font-size: 1.45rem;
	}
}

html.dark .forecast__main {
	background: linear-gradient(140deg, var(--dm-bg-soft), var(--dm-bg-mute));
	border-color: var(--dm-border);
}

html.dark .forecast__icon {
	background: var(--dm-bg-mute);
	border-color: var(--dm-border);
}

html.dark .forecast[data-tone="clear"] .forecast__icon i {
	color: #ffd66b;
}

html.dark .forecast[data-tone="storm"] .forecast__icon i {
	color: #ff6b6b;
}

html.dark .forecast__condition,
html.dark .forecast__cost-caption,
html.dark .forecast__flex {
	color: var(--dm-text-2);
}

html.dark .forecast__headline,
html.dark .forecast__flex strong {
	color: var(--dm-text-1);
}

html.dark .forecast__cost-figure {
	color: var(--dm-blue-soft);
}
</style>
