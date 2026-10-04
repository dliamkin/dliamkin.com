<script setup lang="ts">
// Deliberately PrimeVue-free: this banner sits on the home page's critical
// path, and a plain anchor keeps primevue/button (and its theme CSS) out of
// that bundle. The CTA is fully custom-styled below either way.
import { useId } from "vue";
import { useInView } from "@/composables/useInView";

// Swap this for the Stripe Payment Link and nothing else here needs to change.
// It stays a plain static link on purpose - no Stripe JS, no keys, no backend.
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/cNi00k4AbcI6gmFgm9fEk00";

// "card" is the contained banner used inside a page's content column;
// "band" is the full-bleed section used between home-page sections.
withDefaults(
	defineProps<{
		variant?: "card" | "band";
		eyebrow?: string;
		heading?: string;
		blurb?: string;
		ctaLabel?: string;
	}>(),
	{
		variant: "card",
		eyebrow: "Powered by real AI credits",
		heading: "Keep these projects alive",
		blurb: "Every demo on this page runs on live AI infrastructure - each interaction costs real compute. If something here helped or impressed you, you can chip in. Any amount helps.",
		ctaLabel: "Fuel the projects",
	},
);

const headingId = useId();
const { target, inView } = useInView();
</script>

<template>
	<section
		ref="target"
		class="support-banner"
		:class="[`variant-${variant}`, { 'in-view': inView }]"
		:aria-labelledby="headingId"
	>
		<div class="support-inner">
			<div class="support-row">
				<div class="support-copy">
					<p class="support-badge">{{ eyebrow }}</p>
					<h2 :id="headingId" class="support-heading">{{ heading }}</h2>
					<p class="support-blurb">{{ blurb }}</p>
				</div>

				<a
					class="support-cta"
					:href="STRIPE_PAYMENT_LINK"
					target="_blank"
					rel="noopener noreferrer"
				>
					<i class="fa-solid fa-bolt" aria-hidden="true"></i>
					<span>{{ ctaLabel }}</span>
				</a>
			</div>

			<p class="support-trust">
				<i class="fa-solid fa-lock" aria-hidden="true"></i>
				Secure checkout via Stripe · one-time, any amount · no account needed
			</p>
		</div>
	</section>
</template>

<style scoped>
.support-banner {
	font-family: "Raleway", sans-serif;
}

.variant-card {
	background: linear-gradient(135deg, rgba(39, 169, 224, 0.08), rgba(39, 169, 224, 0) 55%), #fff;
	border: 1px solid rgba(39, 169, 224, 0.22);
	border-radius: 14px;
	padding: 1.4rem 1.75rem 1.15rem;
	margin-bottom: 2.5rem;
}

/* Full-bleed band for the home page: sits between the last white section
   and the dark footer, so a soft accent wash reads as a transition rather
   than another card. Typography follows the home sections (Quicksand
   heading, mono eyebrow), not the projects page. */
/* Opaque base under the tint: the site-wide particle field renders behind
   the page, and the house rule is that text never sits on top of it. */
.variant-band {
	padding: 5rem 2rem 5.5rem;
	background: linear-gradient(180deg, rgba(39, 169, 224, 0.07), rgba(39, 169, 224, 0.02)), #fff;
	border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.variant-band .support-inner {
	max-width: 720px;
	margin: 0 auto;
	text-align: center;
	opacity: 0;
	transform: translateY(22px);
	transition:
		opacity 0.55s ease,
		transform 0.55s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.variant-band.in-view .support-inner {
	opacity: 1;
	transform: none;
}

.variant-band .support-row {
	flex-direction: column;
	align-items: center;
	gap: 1.75rem;
}

.variant-band .support-copy {
	max-width: none;
}

.variant-band .support-badge {
	font-family: "JetBrains Mono", monospace;
	background: none;
	padding: 0;
	font-size: 0.85rem;
	font-weight: 500;
	letter-spacing: 0.18em;
	margin-bottom: 1rem;
}

.variant-band .support-heading {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: clamp(1.9rem, 3.5vw, 2.5rem);
	margin-bottom: 1rem;
}

.variant-band .support-blurb {
	font-size: 1.05rem;
	line-height: 1.75;
}

.variant-band .support-trust {
	justify-content: center;
	margin-top: 1.5rem;
}

.support-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1.75rem;
}

.support-copy {
	max-width: 62ch;
}

.support-badge {
	display: inline-block;
	background: rgba(39, 169, 224, 0.12);
	color: #19749c;
	font-size: 0.7rem;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	padding: 0.25rem 0.7rem;
	border-radius: 999px;
	margin-bottom: 0.6rem;
}

.support-heading {
	font-size: 1.35rem;
	font-weight: 700;
	color: #414042;
	margin: 0 0 0.4rem;
}

.support-blurb {
	color: #6b6a6d;
	line-height: 1.6;
	font-size: 0.95rem;
	margin: 0;
}

/* CTA - the gradient stays in the 700–800 range of the site accent because
   the white label needs 4.5:1 against its lightest stop. */
.support-banner .support-cta {
	position: relative;
	overflow: hidden;
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	border: 0;
	background: linear-gradient(135deg, #1b7ea9 0%, #145d80 100%);
	color: #fff;
	text-decoration: none;
	font-family: inherit;
	font-weight: 600;
	font-size: 1rem;
	padding: 0.85rem 1.6rem;
	border-radius: 10px;
	box-shadow: 0 6px 18px rgba(39, 169, 224, 0.28);
	transition:
		box-shadow 0.15s ease,
		transform 0.15s ease;
}

/* Hover deepens the glow and lifts rather than brightening the fill -
   a lighter fill would drop the white label below AA. */
.support-banner .support-cta:hover,
.support-banner .support-cta:active {
	background: linear-gradient(135deg, #1b7ea9 0%, #145d80 100%);
	color: #fff;
	text-decoration: none;
	transform: translateY(-2px);
	box-shadow:
		0 10px 26px rgba(39, 169, 224, 0.45),
		inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}

.support-banner .support-cta:focus-visible {
	outline: 2px solid #66c6ef;
	outline-offset: 2px;
}

/* Idle shine: one diagonal pass, then a long rest. */
.support-banner .support-cta::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(
		115deg,
		transparent 42%,
		rgba(255, 255, 255, 0.26) 50%,
		transparent 58%
	);
	transform: translateX(-120%);
	animation: support-shine 6s ease-in-out infinite;
	pointer-events: none;
}

@keyframes support-shine {
	0% {
		transform: translateX(-120%);
	}
	18% {
		transform: translateX(120%);
	}
	100% {
		transform: translateX(120%);
	}
}

.support-trust {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	font-size: 0.78rem;
	color: #737277;
	margin: 0.85rem 0 0;
}

.support-trust i {
	margin-right: 0.4rem;
}

@media (max-width: 768px) {
	.variant-card {
		padding: 1.35rem 1.25rem 1.15rem;
	}

	.variant-band {
		padding: 4rem 1.25rem 4.5rem;
	}

	.support-row {
		flex-direction: column;
		align-items: stretch;
		gap: 1.25rem;
	}

	.support-banner .support-cta {
		width: 100%;
		justify-content: center;
	}

	/* Block, not flex - the lock has to flow with the text once it wraps
	   instead of floating beside the whole two-line block. */
	.support-trust {
		display: block;
		text-align: center;
	}
}

@media (prefers-reduced-motion: reduce) {
	.support-banner .support-cta,
	.support-banner .support-cta:hover {
		transform: none;
		transition: box-shadow 0.15s ease;
	}

	.support-banner .support-cta::after {
		animation: none;
		opacity: 0;
	}

	.variant-band .support-inner {
		opacity: 1;
		transform: none;
		transition: none;
	}
}

html.dark .variant-card {
	background:
		linear-gradient(135deg, rgba(39, 169, 224, 0.09), rgba(39, 169, 224, 0) 55%),
		var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark .variant-band {
	background:
		linear-gradient(180deg, rgba(39, 169, 224, 0.05), rgba(39, 169, 224, 0)), var(--dm-bg);
	border-top-color: rgba(255, 255, 255, 0.07);
}

html.dark .support-badge {
	background: rgba(39, 169, 224, 0.16);
	color: var(--dm-blue-soft);
}

html.dark .variant-band .support-badge {
	background: none;
}

html.dark .support-heading {
	color: var(--dm-text-1);
}

html.dark .support-blurb {
	color: var(--dm-text-2);
}

html.dark .support-trust {
	color: var(--dm-text-3);
}
</style>
