// mulberry32 - a tiny 32-bit seeded PRNG (public domain, Tommy Ettinger).
// Chosen over Math.random for one reason: reproducibility. Same seed + same
// parameters ⇒ byte-identical simulation summaries, which makes the lab's
// results citable and the engine unit-testable.

export type Rng = () => number;

/** Returns a function producing floats in [0, 1), deterministic per seed. */
export function mulberry32(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
