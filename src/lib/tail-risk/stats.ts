// Statistical helpers for the Tail Risk Lab engine. Pure functions over
// sorted Float64Arrays - no DOM, no Vue, no allocation beyond the returned
// structures. The engine sorts trial totals exactly once; everything here
// assumes (and documents) that precondition.

/**
 * Nearest-rank percentile on an ascending-sorted array:
 * the smallest value such that at least p% of the sample is ≤ it.
 * Exact sample statistic - no interpolation, so tests can assert equality.
 */
export function percentileSorted(sorted: Float64Array, p: number): number {
	const n = sorted.length;
	if (n === 0) return 0;
	const rank = Math.ceil((p / 100) * n) - 1;
	const index = Math.min(n - 1, Math.max(0, rank));
	return sorted[index] ?? 0;
}

export interface Histogram {
	binEdges: number[];
	counts: number[];
}

/**
 * Fixed-bin histogram over [min, P(clampPercentile)]. Clamping the domain at
 * the 99.5th percentile keeps one freak outlier from flattening the whole
 * chart; everything above the clamp lands in the last bin (≤0.5% of mass).
 */
export function buildHistogram(
	sorted: Float64Array,
	binCount = 48,
	clampPercentile = 99.5,
): Histogram {
	const n = sorted.length;
	const lo = sorted[0] ?? 0;
	let hi = percentileSorted(sorted, clampPercentile);
	if (!(hi > lo)) {
		// Degenerate sample (all values equal): fabricate a small span so the
		// single spike still renders as one visible bar.
		hi = lo + Math.max(Math.abs(lo) * 0.05, 1e-6);
	}
	const width = (hi - lo) / binCount;
	const counts = Array.from({ length: binCount }, () => 0);
	for (let i = 0; i < n; i++) {
		const v = sorted[i] ?? 0;
		let bin = Math.floor((v - lo) / width);
		if (bin >= binCount) bin = binCount - 1;
		if (bin < 0) bin = 0;
		counts[bin] = (counts[bin] ?? 0) + 1;
	}
	const binEdges = Array.from({ length: binCount + 1 }, (_, i) => lo + i * width);
	return { binEdges, counts };
}

export interface Cdf {
	x: number[];
	y: number[];
}

/**
 * Empirical CDF from the sorted totals, downsampled to at most maxPoints by
 * even index striding. The final point (x = max, y = 1) is always included.
 */
export function buildCdf(sorted: Float64Array, maxPoints = 200): Cdf {
	const n = sorted.length;
	const x: number[] = [];
	const y: number[] = [];
	if (n === 0) return { x, y };
	const stride = Math.max(1, Math.ceil(n / maxPoints));
	for (let i = stride - 1; i < n; i += stride) {
		x.push(sorted[i] ?? 0);
		y.push((i + 1) / n);
	}
	if (y[y.length - 1] !== 1) {
		x.push(sorted[n - 1] ?? 0);
		y.push(1);
	}
	return { x, y };
}

/**
 * P(X > value) read off a downsampled CDF by linear interpolation. Used only
 * for the live budget-drag readout between debounced re-simulations; the
 * engine's probOverBudget is exact.
 */
export function exceedanceFromCdf(cdf: Cdf, value: number): number {
	const { x, y } = cdf;
	const n = x.length;
	if (n === 0) return 0;
	const first = x[0] ?? 0;
	if (value < first) return 1;
	const last = x[n - 1] ?? 0;
	if (value >= last) return 0;
	// Binary search for the segment containing value.
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if ((x[mid] ?? 0) <= value) lo = mid;
		else hi = mid;
	}
	const x0 = x[lo] ?? 0;
	const x1 = x[hi] ?? 0;
	const y0 = y[lo] ?? 0;
	const y1 = y[hi] ?? 0;
	const t = x1 > x0 ? (value - x0) / (x1 - x0) : 0;
	return 1 - (y0 + t * (y1 - y0));
}

/**
 * Welford's online variance - single pass, numerically stable. The engine
 * keeps one accumulator per step and pushes each trial's per-step cost.
 */
export class Welford {
	count = 0;
	mean = 0;
	private m2 = 0;

	push(value: number): void {
		this.count++;
		const delta = value - this.mean;
		this.mean += delta / this.count;
		this.m2 += delta * (value - this.mean);
	}

	/** Sample variance (n−1 denominator); 0 until two values are seen. */
	get variance(): number {
		return this.count > 1 ? this.m2 / (this.count - 1) : 0;
	}
}
