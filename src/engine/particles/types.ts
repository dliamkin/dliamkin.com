export type FormationName = "storm" | "text" | "distribution" | "columns" | "converge";

export interface ColumnSpec {
	/** Relative height of this band; tallest band fills the available height. */
	fraction: number;
	/** Index into the engine palette this band's particles are recolored to. */
	paletteIndex: number;
}

export interface FormationParams {
	text?: string;
	columns?: ColumnSpec[];
}

/** 0 = recede (ambient texture behind tools), 1 = normal, 2 = full presence. */
export type AmbientLevel = 0 | 1 | 2;

export interface RenderConfig {
	/**
	 * Opaque canvas background, or null for a transparent canvas composited
	 * over whatever the page renders behind it.
	 */
	background: string | null;
	/**
	 * Motion trails via a translucent background fill each frame. Requires an
	 * opaque background - over a transparent canvas the fill would just
	 * accumulate to a solid slab.
	 */
	trails: boolean;
	/** Additive compositing ("lighter") - the glow only reads on dark ground. */
	additive: boolean;
	/** Alpha of the per-frame trail fill; higher = shorter trails. */
	trailFade: number;
	/** Particle alpha at ambient level 1 (site mode wants subtlety, not glow). */
	baseAlpha: number;
}

export interface EngineOptions {
	count?: number;
	palette?: readonly string[];
	/** Per-color weights for the initial particle→color assignment. */
	paletteWeights?: readonly number[];
	render?: Partial<RenderConfig>;
	repulsionRadius?: number;
}
