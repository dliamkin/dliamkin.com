import { computeFormation, columnCounts, DEFAULT_COLUMNS } from "./formations";
import { flowAngle } from "./noise";
import type {
	AmbientLevel,
	EngineOptions,
	FormationName,
	FormationParams,
	RenderConfig,
} from "./types";

/**
 * Framework-free 2D-canvas particle engine. Vue only hosts and directs it
 * (see ParticleField.vue / useParticleDirector.ts).
 *
 * Public API contract - setFormation / setAmbient / pause / resume /
 * setPointer - is deliberately renderer-agnostic: a future WebGL renderer
 * (Level 2: instanced geometry + vertex-shader positions) implements the same
 * interface behind the same director without touching any caller.
 */

export const DEFAULT_PALETTE: readonly string[] = ["#5DCAA5", "#5DA9E9", "#7F77DD", "#E6E4DC"];
export const DEFAULT_PALETTE_WEIGHTS: readonly number[] = [0.55, 0.25, 0.12, 0.08];
export const DARK_BACKGROUND = "#0D0D12";

const DEFAULT_RENDER: RenderConfig = {
	background: DARK_BACKGROUND,
	trails: true,
	additive: true,
	trailFade: 0.16,
	baseAlpha: 1,
};

const DEFAULT_COUNT = 3000;
const MAX_DPR = 2;

// Spring-to-target constants (formation modes). Transitions between
// formations are purely physical - new targets, same springs - so shapes
// morph instead of teleporting.
const STIFFNESS = 0.014;
const SPRING_DAMPING = 0.88;
const FORMATION_JITTER = 0.012;

// Flow-field constants (storm mode).
const STORM_FORCE = 0.045;
const STORM_DAMPING = 0.975;

const REPULSION_STRENGTH = 0.6;
const RECEDE_ALPHA = 0.08;

// Particle draw sizes per size class, in CSS px. Rects, not arc(): at 3000
// particles per frame arc() is ~4× slower (path construction + fill per call)
// while fillRect is a single blit - and at 1–2px nobody can see the corners.
const SIZES: readonly number[] = [1.1, 1.6, 2.2];
const SIZE_WEIGHTS: readonly number[] = [0.55, 0.33, 0.12];

const FPS_WINDOW = 60;
const BENCHMARK_FRAMES = 60;

function hexToRgba(hex: string, alpha: number): string {
	const v = parseInt(hex.slice(1), 16);
	return `rgba(${(v >> 16) & 0xff}, ${(v >> 8) & 0xff}, ${v & 0xff}, ${alpha})`;
}

function weightedIndex(weights: readonly number[], u: number): number {
	let acc = 0;
	for (let i = 0; i < weights.length; i++) {
		acc += weights[i]!;
		if (u < acc) return i;
	}
	return weights.length - 1;
}

export class ParticleEngine {
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;

	// Structure-of-typed-arrays instead of per-particle objects: a stated
	// performance decision. 3000 objects would scatter x/y/vx/vy across the
	// heap and stall the frame loop on cache misses + GC; six Float32Arrays
	// keep the physics loop linear over contiguous memory with zero
	// per-frame allocation.
	private x!: Float32Array;
	private y!: Float32Array;
	private vx!: Float32Array;
	private vy!: Float32Array;
	private tx!: Float32Array;
	private ty!: Float32Array;
	private paletteIdx!: Uint8Array;
	private basePaletteIdx!: Uint8Array;
	private sizeClass!: Uint8Array;
	// Particle indices grouped by palette color so the draw loop sets
	// fillStyle once per color instead of 3000 times per frame.
	private buckets: Uint32Array[] = [];
	private bucketLens: number[] = [];

	private count = 0;
	private palette: string[];
	private paletteWeights: number[];
	private render: RenderConfig;
	private trailFill = "";

	private formation: FormationName = "storm";
	private formationParams: FormationParams = {};
	private ambient: AmbientLevel = 1;
	private repulsionRadius: number;

	private pointerX = 0;
	private pointerY = 0;
	private pointerActive = false;

	private width = 1;
	private height = 1;
	private time = 0;

	private rafId = 0;
	private running = false;
	private hiddenPaused = false;

	private frameDurations = new Float32Array(FPS_WINDOW);
	private frameCursor = 0;
	private framesSeen = 0;
	private lastFrameAt = 0;

	private benchmarkDone = false;
	/** Called once, after the first 60 live frames, with the measured avg fps. */
	onBenchmark: ((fps: number) => void) | null = null;

	private readonly onVisibility = (): void => {
		if (document.hidden) {
			if (this.running) {
				this.pause();
				this.hiddenPaused = true;
			}
		} else if (this.hiddenPaused) {
			this.hiddenPaused = false;
			this.resume();
		}
	};

	constructor(canvas: HTMLCanvasElement, opts: EngineOptions = {}) {
		// Acceptance check for the persistent-canvas architecture: this must
		// appear exactly once per session - a second log means the canvas
		// remounted on navigation, which defeats the whole design.
		console.info("[token-field] engine constructed");

		this.canvas = canvas;
		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) throw new Error("ParticleEngine: 2D context unavailable");
		this.ctx = ctx;

		this.palette = [...(opts.palette ?? DEFAULT_PALETTE)];
		this.paletteWeights = [...(opts.paletteWeights ?? DEFAULT_PALETTE_WEIGHTS)];
		this.render = { ...DEFAULT_RENDER, ...opts.render };
		this.repulsionRadius = opts.repulsionRadius ?? 90;
		this.updateTrailFill();

		this.resize();
		this.allocate(opts.count ?? DEFAULT_COUNT);

		document.addEventListener("visibilitychange", this.onVisibility);
	}

	destroy(): void {
		this.pause();
		document.removeEventListener("visibilitychange", this.onVisibility);
	}

	// ── sizing ──────────────────────────────────────────────────────────────

	resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
		const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.canvas.width = Math.round(this.width * dpr);
		this.canvas.height = Math.round(this.height * dpr);
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (this.count > 0) this.applyFormation();
		this.paintBackdrop();
	}

	// ── particle allocation ─────────────────────────────────────────────────

	private allocate(count: number): void {
		this.count = count;
		this.x = new Float32Array(count);
		this.y = new Float32Array(count);
		this.vx = new Float32Array(count);
		this.vy = new Float32Array(count);
		this.tx = new Float32Array(count);
		this.ty = new Float32Array(count);
		this.paletteIdx = new Uint8Array(count);
		this.basePaletteIdx = new Uint8Array(count);
		this.sizeClass = new Uint8Array(count);

		for (let i = 0; i < count; i++) {
			this.x[i] = Math.random() * this.width;
			this.y[i] = Math.random() * this.height;
			this.vx[i] = (Math.random() - 0.5) * 0.6;
			this.vy[i] = (Math.random() - 0.5) * 0.6;
			this.basePaletteIdx[i] = weightedIndex(this.paletteWeights, Math.random());
			this.sizeClass[i] = weightedIndex(SIZE_WEIGHTS, Math.random());
		}
		this.paletteIdx.set(this.basePaletteIdx);
		this.rebuildBuckets();
		this.applyFormation();
	}

	/**
	 * Reallocates the particle pool in place. A method rather than a fresh
	 * engine so the constructed-once invariant (and its log) holds for the
	 * whole session even when the playground's count slider rebuilds the pool.
	 */
	setParticleCount(count: number): void {
		const clamped = Math.max(100, Math.min(20000, Math.round(count)));
		if (clamped === this.count) return;
		this.allocate(clamped);
	}

	getParticleCount(): number {
		return this.count;
	}

	private rebuildBuckets(): void {
		const colors = this.palette.length;
		this.buckets = [];
		this.bucketLens = [];
		for (let c = 0; c < colors; c++) {
			this.buckets.push(new Uint32Array(this.count));
			this.bucketLens.push(0);
		}
		for (let i = 0; i < this.count; i++) {
			const c = this.paletteIdx[i]! % colors;
			this.buckets[c]![this.bucketLens[c]!++] = i;
		}
	}

	// ── directing ───────────────────────────────────────────────────────────

	setFormation(name: FormationName, params: FormationParams = {}): void {
		this.formation = name;
		this.formationParams = params;
		this.applyFormation();
	}

	getFormation(): FormationName {
		return this.formation;
	}

	private applyFormation(): void {
		const targets = computeFormation(
			this.formation,
			this.count,
			this.width,
			this.height,
			this.formationParams,
		);
		if (targets) {
			for (let i = 0; i < this.count; i++) {
				this.tx[i] = targets[i * 2]!;
				this.ty[i] = targets[i * 2 + 1]!;
			}
		}
		// Columns recolor their particles per band spec; every other formation
		// restores the weighted base assignment.
		if (this.formation === "columns") {
			const specs = this.formationParams.columns ?? DEFAULT_COLUMNS;
			const counts = columnCounts(this.count, specs);
			let i = 0;
			for (let c = 0; c < specs.length; c++) {
				const color = specs[c]!.paletteIndex % this.palette.length;
				for (let j = 0; j < counts[c]!; j++, i++) this.paletteIdx[i] = color;
			}
			this.rebuildBuckets();
		} else if (this.paletteIdx[0] !== undefined) {
			let dirty = false;
			for (let i = 0; i < this.count; i++) {
				if (this.paletteIdx[i] !== this.basePaletteIdx[i]) {
					dirty = true;
					break;
				}
			}
			if (dirty) {
				this.paletteIdx.set(this.basePaletteIdx);
				this.rebuildBuckets();
			}
		}
	}

	setAmbient(level: AmbientLevel): void {
		this.ambient = level;
	}

	getAmbient(): AmbientLevel {
		return this.ambient;
	}

	setPointer(x: number, y: number): void {
		this.pointerX = x;
		this.pointerY = y;
		this.pointerActive = true;
	}

	clearPointer(): void {
		this.pointerActive = false;
	}

	setRepulsionRadius(radius: number): void {
		this.repulsionRadius = Math.max(0, radius);
	}

	setPalette(colors: readonly string[]): void {
		if (colors.length !== this.palette.length) return;
		this.palette = [...colors];
	}

	setRenderConfig(partial: Partial<RenderConfig>): void {
		this.render = { ...this.render, ...partial };
		this.updateTrailFill();
		this.paintBackdrop();
	}

	/** True when frames accumulate as trails (opaque background + trails on). */
	hasTrails(): boolean {
		return this.render.background !== null && this.render.trails;
	}

	setTrailFade(alpha: number): void {
		this.render.trailFade = Math.min(1, Math.max(0.02, alpha));
		this.updateTrailFill();
	}

	private updateTrailFill(): void {
		this.trailFill = this.render.background
			? hexToRgba(this.render.background, this.render.trailFade)
			: "";
	}

	/**
	 * Fully paints (or clears) the backdrop. Needed whenever the render config
	 * or canvas size changes: trails only fade correctly on top of an already
	 * opaque background.
	 */
	private paintBackdrop(): void {
		const ctx = this.ctx;
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
		if (this.render.background) {
			ctx.fillStyle = this.render.background;
			ctx.fillRect(0, 0, this.width, this.height);
		} else {
			ctx.clearRect(0, 0, this.width, this.height);
		}
	}

	// ── loop ────────────────────────────────────────────────────────────────

	private readonly loop = (now: number): void => {
		if (!this.running) return;
		const dt = this.lastFrameAt === 0 ? 16.7 : now - this.lastFrameAt;
		this.lastFrameAt = now;
		this.recordFrame(dt);
		this.step(dt);
		this.drawFrame();
		this.rafId = requestAnimationFrame(this.loop);
	};

	resume(): void {
		if (this.running) return;
		this.running = true;
		this.lastFrameAt = 0;
		this.rafId = requestAnimationFrame(this.loop);
	}

	/** Full rAF stop - no idle callback keeps ticking, no work is skipped-but-scheduled. */
	pause(): void {
		if (!this.running) return;
		this.running = false;
		cancelAnimationFrame(this.rafId);
	}

	isRunning(): boolean {
		return this.running;
	}

	private recordFrame(dt: number): void {
		this.frameDurations[this.frameCursor] = dt;
		this.frameCursor = (this.frameCursor + 1) % FPS_WINDOW;
		this.framesSeen++;
		if (!this.benchmarkDone && this.framesSeen >= BENCHMARK_FRAMES) {
			this.benchmarkDone = true;
			this.onBenchmark?.(this.getFps());
		}
	}

	/** Average fps over the last 60 frames. */
	getFps(): number {
		const n = Math.min(this.framesSeen, FPS_WINDOW);
		if (n === 0) return 0;
		let sum = 0;
		for (let i = 0; i < n; i++) sum += this.frameDurations[i]!;
		return sum > 0 ? (1000 * n) / sum : 0;
	}

	// ── physics ─────────────────────────────────────────────────────────────

	/**
	 * One simulation step. `dt` in ms; motion is normalized to 60fps units and
	 * clamped so a background-tab hiccup doesn't catapult particles.
	 * Public so snapshot.ts can run the simulation without a rAF loop.
	 */
	step(dt: number): void {
		const k = Math.min(dt, 50) / 16.667;
		this.time += Math.min(dt, 50);

		const { x, y, vx, vy, tx, ty, count, width: w, height: h } = this;
		const t = this.time;
		const storm = this.formation === "storm";
		const receded = this.ambient === 0;
		// Recede: spring stiffness halved, storm force halved - the field
		// settles into slow ambient texture behind the tools.
		const stiffness = receded ? STIFFNESS * 0.5 : STIFFNESS;
		const stormForce = receded ? STORM_FORCE * 0.5 : STORM_FORCE;
		const repulse = this.pointerActive && !receded && this.repulsionRadius > 0;
		const rr = this.repulsionRadius;
		const rr2 = rr * rr;
		const px = this.pointerX;
		const py = this.pointerY;

		for (let i = 0; i < count; i++) {
			let xi = x[i]!;
			let yi = y[i]!;
			let vxi = vx[i]!;
			let vyi = vy[i]!;

			if (storm) {
				const a = flowAngle(xi, yi, t);
				vxi += Math.cos(a) * stormForce * k;
				vyi += Math.sin(a) * stormForce * k;
				vxi *= STORM_DAMPING;
				vyi *= STORM_DAMPING;
			} else {
				vxi += (tx[i]! - xi) * stiffness * k;
				vyi += (ty[i]! - yi) * stiffness * k;
				vxi *= SPRING_DAMPING;
				vyi *= SPRING_DAMPING;
				// Tiny flow-field jitter keeps formed shapes breathing instead
				// of freezing into a stencil.
				const j = flowAngle(xi * 3.1, yi * 2.7, t * 1.7);
				vxi += Math.cos(j) * FORMATION_JITTER * k;
				vyi += Math.sin(j) * FORMATION_JITTER * k;
			}

			if (repulse) {
				const dx = xi - px;
				const dy = yi - py;
				const d2 = dx * dx + dy * dy;
				if (d2 < rr2 && d2 > 0.01) {
					const d = Math.sqrt(d2);
					const f = ((1 - d / rr) * REPULSION_STRENGTH * k) / d;
					vxi += dx * f;
					vyi += dy * f;
				}
			}

			xi += vxi * k;
			yi += vyi * k;

			if (storm) {
				// Screen wrap with a small off-screen margin so particles don't
				// visibly pop at the edges.
				if (xi < -4) xi += w + 8;
				else if (xi > w + 4) xi -= w + 8;
				if (yi < -4) yi += h + 8;
				else if (yi > h + 4) yi -= h + 8;
			}

			x[i] = xi;
			y[i] = yi;
			vx[i] = vxi;
			vy[i] = vyi;
		}
	}

	// ── rendering ───────────────────────────────────────────────────────────

	/** Public so snapshot.ts can compose a single static frame. */
	drawFrame(): void {
		const ctx = this.ctx;
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;

		if (this.render.background) {
			// Trail effect: a translucent background fill each frame lets the
			// previous frames' particles linger as fading streaks.
			ctx.fillStyle = this.render.trails ? this.trailFill : this.render.background;
			ctx.fillRect(0, 0, this.width, this.height);
		} else {
			// Transparent site mode - no trails possible (see RenderConfig).
			ctx.clearRect(0, 0, this.width, this.height);
		}

		ctx.globalAlpha =
			this.ambient === 0 ? RECEDE_ALPHA : this.ambient === 1 ? this.render.baseAlpha : 1;
		if (this.render.additive) ctx.globalCompositeOperation = "lighter";

		const { x, y, sizeClass } = this;
		for (let c = 0; c < this.buckets.length; c++) {
			const len = this.bucketLens[c]!;
			if (len === 0) continue;
			ctx.fillStyle = this.palette[c]!;
			const bucket = this.buckets[c]!;
			for (let j = 0; j < len; j++) {
				const i = bucket[j]!;
				const s = SIZES[sizeClass[i]!]!;
				ctx.fillRect(x[i]!, y[i]!, s, s);
			}
		}

		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = "source-over";
	}
}
