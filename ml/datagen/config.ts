import path from "node:path";
import { fileURLToPath } from "node:url";

// Central configuration for the teacher data-generation pipeline. The scripts
// here manufacture the student's training set: synthetic clinical notes
// (Part 1a) labeled by the production note-structurer pipeline (Part 1b) and
// aligned into BIO spans (Part 1c). Everything a human might want to change -
// models, pricing, volumes, paths - lives in this one file.

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../..");

// ml/data/ is gitignored: 3,000 synthetic clinical-style notes don't belong in
// the repo, the scripts are the artifact. raw/ holds resumable per-batch
// output; the split files (train/val/test) are the finished dataset.
export const DATA_DIR = path.join(REPO_ROOT, "ml/data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const SPLIT_FILES = {
	train: path.join(DATA_DIR, "train.jsonl"),
	val: path.join(DATA_DIR, "val.jsonl"),
	test: path.join(DATA_DIR, "test.jsonl"),
} as const;
export const STATS_FILE = path.join(DATA_DIR, "dataset-stats.json");

// --- Models ------------------------------------------------------------------
// Generation runs on the cheap, fast model for volume; labeling runs on the
// stronger model regardless of the demo's runtime model, because label quality
// is the ceiling on how good the student can ever get. Both are the repo's
// canonical ids (src/lib/pipelines/structure-note.ts), not dated aliases.
export const GENERATION_MODEL = "claude-haiku-4-5";
export const LABELING_MODEL = "claude-sonnet-5";

// --- Pricing (USD per 1M tokens) --------------------------------------------
// EDIT THESE to match current list pricing before any real run - the cost
// estimate and the 05-costs-and-metrics.md doc read straight from here. Values
// below are placeholders in the right ballpark, not a quote.
export const PRICING: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5": { input: 1.0, output: 5.0 },
	// Sonnet 5 standard list price. Intro pricing ($2 / $10 per MTok) runs
	// through 2026-08-31 - using the standard rate keeps the estimate slightly
	// conservative (a small over-estimate of spend, never under).
	"claude-sonnet-5": { input: 3.0, output: 15.0 },
};

// Rough per-call token expectations, used only to estimate spend up front.
// Generation: a spec prompt in, a note out. Labeling: system prompt + note in,
// a structured tool call out. Tuned to be slightly pessimistic.
export const EST_TOKENS = {
	generation: { input: 700, output: 350 },
	labeling: { input: 900, output: 450 },
} as const;

// --- Volume ------------------------------------------------------------------
export const DEFAULT_TARGET = 3000; // kept examples (post-alignment, post-dedupe)
export const DRY_RUN_TARGET = 50; // Gate 2 review size
export const BATCH_SIZE = 25; // resumable checkpoint granularity
export const SPLIT_RATIOS = { train: 0.8, val: 0.1, test: 0.1 } as const;

// Generation concurrency - polite to the API, still finishes 3k in a sane
// wall-clock. Each note is one generation call + one labeling call.
export const CONCURRENCY = 4;
export const STAGGER_MS = 250;

export const DEFAULT_SEED = 20260705;

// Near-duplicate / eval-overlap threshold: Jaccard similarity over 5-word
// shingles. A generated note at or above this against another generated note
// is a dupe (dropped); at or above this against any public eval sample it is
// an exam leak (dropped, and loudly counted).
export const SHINGLE_SIZE = 5;
export const DUPE_JACCARD = 0.6;
export const EVAL_OVERLAP_JACCARD = 0.4; // stricter: the exam must stay fair
