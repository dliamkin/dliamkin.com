<script setup lang="ts">
// Hand-rolled canvas distribution chart - deliberately no charting library.
// Histogram (default) or CDF of total run cost, with dashed P50/P90/P99
// markers, a semi-transparent ghost of the pinned baseline, and a draggable
// budget line that live-updates P(over budget). DevicePixelRatio-aware.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SelectButton from "primevue/selectbutton";
import { formatPercent, formatTrials, formatUsd } from "@/lib/tail-risk/format";
import { exceedanceFromCdf } from "@/lib/tail-risk/stats";
import type { SimulationSummary } from "@/lib/tail-risk/types";

const props = defineProps<{
	summary: SimulationSummary | null;
	baseline: SimulationSummary | null;
	budgetUsd: number;
	probOverBudget: number;
}>();

const emit = defineEmits<{
	"update:budgetUsd": [value: number];
}>();

type ChartMode = "histogram" | "cdf";
const mode = ref<ChartMode>("histogram");
const modeOptions: { label: string; value: ChartMode }[] = [
	{ label: "Histogram", value: "histogram" },
	{ label: "CDF", value: "cdf" },
];

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapRef = ref<HTMLDivElement | null>(null);

const HEIGHT = 240;
const PAD = { top: 30, right: 14, bottom: 26, left: 44 };
const GRAB_PX = 8;

let dragging = false;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;

function palette() {
	const dark = document.documentElement.classList.contains("dark");
	return dark
		? {
				teal: "#2cc9b8",
				tealFill: "rgba(44, 201, 184, 0.85)",
				ghost: "rgba(170, 178, 189, 0.65)",
				grid: "rgba(255, 255, 255, 0.09)",
				text: "#98a0aa",
				p50: "#9aa2ac",
				p90: "#f0a441",
				p99: "#ef8b7f",
				budget: "#66c6ef",
			}
		: {
				teal: "#0e9488",
				tealFill: "rgba(14, 148, 136, 0.85)",
				ghost: "rgba(110, 118, 129, 0.55)",
				grid: "rgba(0, 0, 0, 0.08)",
				text: "#6b6a6d",
				p50: "#8a929c",
				p90: "#c97a06",
				p99: "#d64541",
				budget: "#27a9e0",
			};
}

interface Frame {
	width: number;
	plotW: number;
	plotH: number;
	x0: number;
	x1: number;
}

function currentFrame(): Frame | null {
	const canvas = canvasRef.value;
	const s = props.summary;
	if (!canvas || !s) return null;
	const width = canvas.clientWidth;
	const edges = s.histogram.binEdges;
	let x0 = edges[0] ?? 0;
	let x1 = edges[edges.length - 1] ?? 1;
	const b = props.baseline;
	if (b) {
		x0 = Math.min(x0, b.histogram.binEdges[0] ?? x0);
		x1 = Math.max(x1, b.histogram.binEdges[b.histogram.binEdges.length - 1] ?? x1);
	}
	if (!(x1 > x0)) x1 = x0 + 1;
	return {
		width,
		plotW: width - PAD.left - PAD.right,
		plotH: HEIGHT - PAD.top - PAD.bottom,
		x0,
		x1,
	};
}

function xToPx(frame: Frame, value: number): number {
	return PAD.left + ((value - frame.x0) / (frame.x1 - frame.x0)) * frame.plotW;
}

function pxToX(frame: Frame, px: number): number {
	const t = (px - PAD.left) / frame.plotW;
	return frame.x0 + Math.min(1, Math.max(0, t)) * (frame.x1 - frame.x0);
}

/** 1-2-2.5-5 tick spacing for the dollar axis. */
function niceStep(rough: number): number {
	const power = 10 ** Math.floor(Math.log10(rough));
	const scaled = rough / power;
	if (scaled <= 1) return power;
	if (scaled <= 2) return 2 * power;
	if (scaled <= 2.5) return 2.5 * power;
	if (scaled <= 5) return 5 * power;
	return 10 * power;
}

function densities(summary: SimulationSummary): { edges: number[]; values: number[] } {
	const { binEdges, counts } = summary.histogram;
	const values = counts.map((count, i) => {
		const width = (binEdges[i + 1] ?? 0) - (binEdges[i] ?? 0);
		return width > 0 ? count / (summary.trials * width) : 0;
	});
	return { edges: binEdges, values };
}

function drawHistogramBars(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	summary: SimulationSummary,
	maxDensity: number,
	fill: string,
): void {
	const { edges, values } = densities(summary);
	ctx.fillStyle = fill;
	for (let i = 0; i < values.length; i++) {
		const density = values[i] ?? 0;
		if (density <= 0) continue;
		const left = xToPx(frame, edges[i] ?? 0);
		const right = xToPx(frame, edges[i + 1] ?? 0);
		const h = (density / maxDensity) * frame.plotH;
		ctx.fillRect(left + 0.5, PAD.top + frame.plotH - h, Math.max(1, right - left - 1), h);
	}
}

function drawHistogramGhost(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	summary: SimulationSummary,
	maxDensity: number,
	stroke: string,
): void {
	const { edges, values } = densities(summary);
	ctx.strokeStyle = stroke;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	const bottom = PAD.top + frame.plotH;
	ctx.moveTo(xToPx(frame, edges[0] ?? 0), bottom);
	for (let i = 0; i < values.length; i++) {
		const y = bottom - ((values[i] ?? 0) / maxDensity) * frame.plotH;
		ctx.lineTo(xToPx(frame, edges[i] ?? 0), y);
		ctx.lineTo(xToPx(frame, edges[i + 1] ?? 0), y);
	}
	ctx.lineTo(xToPx(frame, edges[edges.length - 1] ?? 0), bottom);
	ctx.stroke();
}

function drawCdfLine(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	summary: SimulationSummary,
	stroke: string,
	width: number,
): void {
	const { x, y } = summary.cdf;
	if (x.length === 0) return;
	const bottom = PAD.top + frame.plotH;
	ctx.strokeStyle = stroke;
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.moveTo(xToPx(frame, Math.min(x[0] ?? 0, frame.x1)), bottom);
	let lastY = bottom;
	for (let i = 0; i < x.length; i++) {
		const vx = x[i] ?? 0;
		if (vx > frame.x1) break;
		lastY = bottom - (y[i] ?? 0) * frame.plotH;
		ctx.lineTo(xToPx(frame, vx), lastY);
	}
	// Beyond the clamped domain the curve is ≥ the last drawn quantile -
	// extend flat so the line doesn't just stop mid-air.
	ctx.lineTo(PAD.left + frame.plotW, lastY);
	ctx.stroke();
}

function drawMarker(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	value: number,
	label: string,
	color: string,
): void {
	const x = xToPx(frame, Math.min(value, frame.x1));
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 3]);
	ctx.beginPath();
	ctx.moveTo(x, PAD.top);
	ctx.lineTo(x, PAD.top + frame.plotH);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.fillStyle = color;
	ctx.font = "10px 'Raleway', sans-serif";
	ctx.textAlign = "center";
	ctx.fillText(label, x, PAD.top - 4);
}

function draw(): void {
	const canvas = canvasRef.value;
	const frame = currentFrame();
	const s = props.summary;
	if (!canvas || !frame || !s) return;
	const dpr = window.devicePixelRatio || 1;
	if (canvas.width !== Math.round(frame.width * dpr)) {
		canvas.width = Math.round(frame.width * dpr);
		canvas.height = Math.round(HEIGHT * dpr);
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, frame.width, HEIGHT);
	const colors = palette();
	const bottom = PAD.top + frame.plotH;

	// X axis ticks.
	const step = niceStep((frame.x1 - frame.x0) / 5);
	ctx.font = "10px 'Raleway', sans-serif";
	ctx.textAlign = "center";
	for (let v = Math.ceil(frame.x0 / step) * step; v <= frame.x1 + 1e-9; v += step) {
		const x = xToPx(frame, v);
		ctx.strokeStyle = colors.grid;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, PAD.top);
		ctx.lineTo(x, bottom);
		ctx.stroke();
		ctx.fillStyle = colors.text;
		ctx.fillText(formatUsd(v), x, bottom + 14);
	}

	if (mode.value === "histogram") {
		let maxDensity = Math.max(...densities(s).values, 1e-12);
		if (props.baseline) {
			maxDensity = Math.max(maxDensity, ...densities(props.baseline).values);
		}
		if (props.baseline) {
			drawHistogramGhost(ctx, frame, props.baseline, maxDensity, colors.ghost);
		}
		drawHistogramBars(ctx, frame, s, maxDensity, colors.tealFill);
	} else {
		// CDF gridlines at the semantic quantiles.
		for (const q of [0.5, 0.9, 0.99]) {
			const y = bottom - q * frame.plotH;
			ctx.strokeStyle = colors.grid;
			ctx.setLineDash([3, 3]);
			ctx.beginPath();
			ctx.moveTo(PAD.left, y);
			ctx.lineTo(PAD.left + frame.plotW, y);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = colors.text;
			ctx.textAlign = "right";
			ctx.fillText(formatPercent(q, 0), PAD.left - 6, y + 3);
		}
		if (props.baseline) drawCdfLine(ctx, frame, props.baseline, colors.ghost, 1.5);
		drawCdfLine(ctx, frame, s, colors.teal, 2);
	}

	drawMarker(ctx, frame, s.p50, "P50", colors.p50);
	drawMarker(ctx, frame, s.p90, "P90", colors.p90);
	drawMarker(ctx, frame, s.p99, "P99", colors.p99);

	// Budget line - the draggable one.
	const budgetX = xToPx(frame, Math.min(Math.max(props.budgetUsd, frame.x0), frame.x1));
	ctx.strokeStyle = colors.budget;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(budgetX, PAD.top - 14);
	ctx.lineTo(budgetX, bottom);
	ctx.stroke();
	// Grab handle.
	ctx.fillStyle = colors.budget;
	ctx.beginPath();
	ctx.moveTo(budgetX - 5, PAD.top - 14);
	ctx.lineTo(budgetX + 5, PAD.top - 14);
	ctx.lineTo(budgetX, PAD.top - 6);
	ctx.closePath();
	ctx.fill();
	ctx.font = "bold 10px 'Raleway', sans-serif";
	const label = `${formatUsd(props.budgetUsd)} budget`;
	ctx.textAlign = budgetX > frame.width / 2 ? "right" : "left";
	ctx.fillText(label, budgetX > frame.width / 2 ? budgetX - 8 : budgetX + 8, PAD.top - 8);

	if (mode.value === "cdf") {
		// Annotate the budget line's intersection with the curve - the
		// exceedance probability, the most information-dense pixel here.
		const exceed = exceedanceFromCdf(s.cdf, props.budgetUsd);
		const yAt = bottom - (1 - exceed) * frame.plotH;
		ctx.fillStyle = colors.budget;
		ctx.beginPath();
		ctx.arc(budgetX, yAt, 3.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.font = "bold 11px 'Raleway', sans-serif";
		ctx.textAlign = budgetX > frame.width / 2 ? "right" : "left";
		// Near the top of the plot the annotation would collide with the
		// budget label - flip it below the intersection dot instead.
		const annotationY = yAt - 8 < PAD.top + 12 ? yAt + 18 : yAt - 8;
		ctx.fillText(
			`P(> ${formatUsd(props.budgetUsd)}) = ${formatPercent(exceed)}`,
			budgetX > frame.width / 2 ? budgetX - 8 : budgetX + 8,
			annotationY,
		);
	}
}

function pointerBudgetDistance(offsetX: number): number {
	const frame = currentFrame();
	if (!frame) return Infinity;
	const budgetX = xToPx(frame, Math.min(Math.max(props.budgetUsd, frame.x0), frame.x1));
	return Math.abs(offsetX - budgetX);
}

function onPointerDown(event: PointerEvent): void {
	if (pointerBudgetDistance(event.offsetX) <= GRAB_PX) {
		dragging = true;
		canvasRef.value?.setPointerCapture(event.pointerId);
		event.preventDefault();
	}
}

function onPointerMove(event: PointerEvent): void {
	const canvas = canvasRef.value;
	if (!canvas) return;
	if (dragging) {
		const frame = currentFrame();
		if (!frame) return;
		const value = Math.round(pxToX(frame, event.offsetX) * 100) / 100;
		emit("update:budgetUsd", value);
	} else {
		canvas.style.cursor =
			pointerBudgetDistance(event.offsetX) <= GRAB_PX ? "ew-resize" : "default";
	}
}

function onPointerUp(event: PointerEvent): void {
	if (!dragging) return;
	dragging = false;
	canvasRef.value?.releasePointerCapture(event.pointerId);
}

const meta = computed(() => {
	const s = props.summary;
	if (!s) return "";
	const ms = s.elapsedMs < 10 ? s.elapsedMs.toFixed(1) : Math.round(s.elapsedMs).toString();
	return `${formatTrials(s.trials)} trials in ${ms}ms · 0 tokens`;
});

onMounted(() => {
	resizeObserver = new ResizeObserver(() => draw());
	if (wrapRef.value) resizeObserver.observe(wrapRef.value);
	// The canvas can't inherit CSS theme switches - redraw when html.dark flips.
	themeObserver = new MutationObserver(() => draw());
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	draw();
});

onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	themeObserver?.disconnect();
});

watch([() => props.summary, () => props.baseline, () => props.budgetUsd, mode], () => draw(), {
	flush: "post",
});
</script>

<template>
	<div ref="wrapRef" class="dist-chart">
		<div class="chart-toolbar">
			<h2>Cost distribution</h2>
			<SelectButton
				v-model="mode"
				:options="modeOptions"
				option-label="label"
				option-value="value"
				:allow-empty="false"
				size="small"
				aria-label="Chart mode"
			/>
		</div>

		<div v-if="!summary" class="chart-empty">Running the first simulation…</div>
		<canvas
			v-else
			ref="canvasRef"
			class="chart-canvas"
			:style="{ height: `${HEIGHT}px` }"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
		></canvas>

		<p v-if="summary" class="chart-meta">
			{{ meta }}
			<span v-if="baseline" class="ghost-hint">· gray ghost = pinned baseline</span>
			· drag the blue line to set your budget
		</p>
	</div>
</template>

<style scoped>
.dist-chart {
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 10px;
	background: #fff;
	padding: 0.9rem 1.1rem 0.7rem;
}

.chart-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	margin-bottom: 0.5rem;
	flex-wrap: wrap;
}

h2 {
	font-size: 1.1rem;
	font-weight: 700;
}

.chart-canvas {
	display: block;
	width: 100%;
	touch-action: none;
}

.chart-empty {
	height: 240px;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #6b6a6d;
	font-size: 0.9rem;
}

.chart-meta {
	margin-top: 0.35rem;
	font-size: 0.78rem;
	font-variant-numeric: tabular-nums;
	color: #6b6a6d;
	text-align: center;
}

html.dark .dist-chart {
	background: var(--dm-bg-soft);
	border-color: var(--dm-border);
}

html.dark h2 {
	color: var(--dm-text-1);
}

html.dark .chart-meta,
html.dark .chart-empty {
	color: var(--dm-text-3);
}
</style>
