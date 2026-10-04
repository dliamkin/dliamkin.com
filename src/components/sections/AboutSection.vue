<script setup lang="ts">
import { ref, watch } from "vue";
import { useInView } from "@/composables/useInView";

const { target, inView } = useInView({ threshold: 0.35 });

const terminalOutput = "12+ years bridging cloud backends and frontends users actually enjoy.";
const typed = ref("");
const done = ref(false);

watch(inView, (visible) => {
	if (!visible) return;
	let i = 0;
	const tick = () => {
		typed.value = terminalOutput.slice(0, i);
		i += 1;
		if (i <= terminalOutput.length) {
			setTimeout(tick, 28);
		} else {
			done.value = true;
		}
	};
	setTimeout(tick, 650);
});
</script>

<template>
	<section id="about" ref="target" class="about" :class="{ 'in-view': inView }">
		<div class="about-inner">
			<div class="about-copy">
				<p class="eyebrow">// About Me</p>
				<h2 class="about-heading">
					I build enterprise platforms<br />
					that <span class="accent">feel weightless.</span>
				</h2>
				<p class="about-lede">
					An adaptable Senior Software Engineer with over 12 years of full-stack
					experience designing scalable, intuitive applications across the
					<strong>telehealth</strong> and <strong>enterprise real estate</strong>
					industries. I bridge the gap between complex backend cloud architectures and
					seamless frontend experiences - using C#/.NET, Angular, Vue, and
					serverless AWS/Azure environments to build software that users actually enjoy.
				</p>

				<div class="stat-row">
					<div class="stat">
						<span class="stat-num">12<span class="plus">+</span></span>
						<span class="stat-label">Years Full-Stack</span>
					</div>
					<div class="stat">
						<span class="stat-num">16<span class="plus">+</span></span>
						<span class="stat-label">Apps Maintained</span>
					</div>
					<div class="stat">
						<span class="stat-num">2</span>
						<span class="stat-label">Cloud Stacks</span>
					</div>
					<div class="stat">
						<span class="stat-num">7</span>
						<span class="stat-label">Conferences</span>
					</div>
				</div>
			</div>

			<div class="editor" aria-hidden="true">
				<div class="editor-chrome">
					<span class="dot red"></span>
					<span class="dot amber"></span>
					<span class="dot green"></span>
					<span class="filename">denis.ts</span>
				</div>
				<pre
					class="code"
				><code><span class="ln">const</span> <span class="var">developer</span> <span class="op">=</span> {
  <span class="key">name</span>: <span class="str">"Denis Liamkin"</span>,
  <span class="key">role</span>: <span class="str">"Senior Software Engineer"</span>,
  <span class="key">location</span>: <span class="str">"Melbourne, FL"</span>,
  <span class="key">experience</span>: <span class="num">12</span> <span class="op">+</span> <span class="str">" years"</span>,
  <span class="key">industries</span>: [<span class="str">"Telehealth"</span>, <span class="str">"Real Estate"</span>],
  <span class="key">stack</span>: {
    <span class="key">frontend</span>: [<span class="str">"Vue"</span>, <span class="str">"PrimeVue"</span>, <span class="str">"Angular"</span>, <span class="str">"TypeScript"</span>],
    <span class="key">backend</span>:  [<span class="str">"C#/.NET"</span>, <span class="str">"Node"</span>, <span class="str">"PHP"</span>],
    <span class="key">cloud</span>:    [<span class="str">"AWS Lambda"</span>, <span class="str">"DynamoDB"</span>, <span class="str">"Azure"</span>],
  },
  <span class="key">education</span>: <span class="str">"B.A.S. Computer Information Systems"</span>,
  <span class="key">focus</span>: <span class="str">"weightless, data-heavy UIs"</span>,
  <span class="key">available</span>: <span class="bool">true</span>,
};</code></pre>
				<div class="terminal">
					<span class="prompt">$</span>
					<span class="cmd">node denis.ts</span>
					<div class="term-out">
						<span class="arrow" v-if="typed">&rarr;</span>
						<span class="term-text">{{ typed }}</span
						><span class="term-cursor" :class="{ blink: done }"></span>
					</div>
				</div>
			</div>
		</div>
	</section>
</template>

<style scoped>
.about {
	background-color: #f4f5f7;
	padding: 6rem 2rem;
	overflow: hidden;
}

.about-inner {
	max-width: 1200px;
	margin: 0 auto;
	display: grid;
	grid-template-columns: 1fr 1.05fr;
	gap: 4rem;
	align-items: center;
}

.about-copy {
	opacity: 0;
	transform: translateX(-28px);
	transition:
		opacity 0.7s ease,
		transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.in-view .about-copy {
	opacity: 1;
	transform: translateX(0);
}

.eyebrow {
	font-family: "JetBrains Mono", monospace;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-size: 0.85rem;
	font-weight: 500;
	color: #c08552;
	margin: 0 0 1rem;
}

.about-heading {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: clamp(2rem, 4vw, 3rem);
	line-height: 1.15;
	color: #414042;
	margin: 0 0 1.5rem;
}

.accent {
	color: #27a9e0;
}

.about-lede {
	font-family: "Raleway", sans-serif;
	font-size: 1.1rem;
	line-height: 1.7;
	color: #55565a;
	margin: 0 0 2.25rem;
}

.about-lede strong {
	color: #414042;
}

.stat-row {
	display: flex;
	flex-wrap: wrap;
	gap: 2rem 2.25rem;
}

.stat {
	display: flex;
	flex-direction: column;
}

.stat-num {
	font-family: "Quicksand", sans-serif;
	font-weight: 500;
	font-size: 2.5rem;
	color: #414042;
	line-height: 1;
}

.plus {
	color: #5cb85c;
}

.stat-label {
	font-family: "JetBrains Mono", monospace;
	font-size: 0.72rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: #8a8b8f;
	margin-top: 0.4rem;
}

/* ---- IDE window ---- */
.editor {
	background: #21252b;
	border-radius: 10px;
	box-shadow: 0 30px 70px rgba(0, 0, 0, 0.28);
	overflow: hidden;
	font-family: "JetBrains Mono", monospace;
	opacity: 0;
	transform: translateY(34px) scale(0.98);
	transition:
		opacity 0.8s ease 0.15s,
		transform 0.8s cubic-bezier(0.22, 0.61, 0.36, 1) 0.15s;
}

.in-view .editor {
	opacity: 1;
	transform: translateY(0) scale(1);
}

.editor-chrome {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	background: #2d323b;
	border-bottom: 1px solid rgba(0, 0, 0, 0.35);
}

.dot {
	width: 12px;
	height: 12px;
	border-radius: 50%;
	display: inline-block;
}

.dot.red {
	background: #ff5f56;
}
.dot.amber {
	background: #ffbd2e;
}
.dot.green {
	background: #27c93f;
}

.filename {
	margin-left: 0.75rem;
	font-size: 0.8rem;
	color: #9da5b4;
}

.code {
	margin: 0;
	padding: 1.25rem 1.4rem;
	font-size: clamp(0.72rem, 1vw, 0.86rem);
	line-height: 1.75;
	color: #abb2bf;
	white-space: pre;
	overflow-x: auto;
}

.ln {
	color: #c678dd;
}
.var {
	color: #61afef;
}
.key {
	color: #e06c75;
}
.str {
	color: #98c379;
}
.num {
	color: #d19a66;
}
.bool {
	color: #d19a66;
}
.op {
	color: #56b6c2;
}

.terminal {
	background: #1a1d23;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
	padding: 0.9rem 1.4rem 1.1rem;
	font-size: 0.82rem;
}

.prompt {
	color: #98c379;
	margin-right: 0.5rem;
}

.cmd {
	color: #d7dae0;
}

.term-out {
	margin-top: 0.5rem;
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
	min-height: 1.2em;
	color: #9da5b4;
}

.arrow {
	color: #27a9e0;
}

.term-text {
	color: #c8ccd4;
}

.term-cursor {
	display: inline-block;
	width: 8px;
	height: 1em;
	background: #27a9e0;
	transform: translateY(2px);
}

.term-cursor.blink {
	animation: blink 1s step-end infinite;
}

@keyframes blink {
	50% {
		opacity: 0;
	}
}

@media (max-width: 900px) {
	.about-inner {
		grid-template-columns: 1fr;
		gap: 2.5rem;
	}

	.about-copy {
		text-align: center;
	}

	.stat-row {
		justify-content: center;
	}
}

@media (max-width: 600px) {
	.about {
		padding: 6rem 1rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.about-copy,
	.editor {
		transition: none;
	}
	.term-cursor.blink {
		animation: none;
	}
}

/* The IDE window is dark by design, so it needs no changes here. */
html.dark .about {
	background-color: var(--dm-bg-soft);
}

html.dark .about-heading {
	color: var(--dm-text-1);
}

html.dark .about-lede {
	color: var(--dm-text-2);
}

html.dark .about-lede strong {
	color: var(--dm-text-1);
}

html.dark .stat-num {
	color: var(--dm-text-1);
}

html.dark .stat-label {
	color: var(--dm-text-3);
}

html.dark .editor {
	box-shadow: 0 30px 70px rgba(0, 0, 0, 0.55);
}
</style>
