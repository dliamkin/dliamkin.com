import dns from "node:dns";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// This environment's IPv6 route to the API is a dead end (ENETUNREACH), and
// Node's default dual-stack ordering tries it first, wasting a connect timeout
// per request. Prefer IPv4 so every call goes straight to a reachable address.
dns.setDefaultResultOrder("ipv4first");
import {
	BATCH_SIZE,
	CONCURRENCY,
	DATA_DIR,
	DEFAULT_SEED,
	DEFAULT_TARGET,
	DRY_RUN_TARGET,
	EST_TOKENS,
	GENERATION_MODEL,
	LABELING_MODEL,
	PRICING,
	RAW_DIR,
	SPLIT_FILES,
	SPLIT_RATIOS,
	STAGGER_MS,
	STATS_FILE,
} from "./config";
import { alignExample } from "./align";
import { DupeGuard, overlapsEvalSet, shingles } from "./dedup";
import { generateNote } from "./generate";
import { labelNote } from "./label";
import { loadApiKey } from "./env";
import { mockBuild } from "./mock";
import { mulberry32, sampleSpec } from "./templates";
import type { DatasetExample, DiscardReason } from "./types";

// Orchestrator for `npm run ml:generate-data`. Manufactures the student's
// training set end to end: spec → note (generate) → Medication[] (teacher
// label) → BIO spans (align) → dedupe/eval-overlap guard → 80/10/10 split.
// Spends real money on the API, so a cost estimate prints first and a real run
// requires --confirm. --mock runs the whole flow with a deterministic,
// API-free stand-in at $0 (for proving the pipeline). Resumable: accepted
// examples stream to ml/data/raw/ and --resume continues where a run stopped.

interface Args {
	target: number;
	mock: boolean;
	confirm: boolean;
	resume: boolean;
	seed: number;
	runName: string;
}

function parseArgs(argv: string[]): Args {
	const flag = (name: string) => argv.includes(name);
	const value = (name: string) => {
		const i = argv.indexOf(name);
		return i !== -1 ? argv[i + 1] : undefined;
	};
	const dryRun = flag("--dry-run");
	const mock = flag("--mock");
	const target = value("--count")
		? Math.max(1, Number.parseInt(value("--count") as string, 10))
		: dryRun
			? DRY_RUN_TARGET
			: DEFAULT_TARGET;
	return {
		target,
		mock,
		confirm: flag("--confirm"),
		resume: flag("--resume"),
		seed: value("--seed") ? Number.parseInt(value("--seed") as string, 10) : DEFAULT_SEED,
		runName: mock ? "mock" : dryRun ? "dry" : "dataset",
	};
}

function usd(n: number): string {
	return `$${n.toFixed(4)}`;
}

// Conservative estimate: assume ~1.3 attempts per kept example (discards +
// dupes) and price both the generation and labeling call for each attempt.
function estimateCost(target: number): { attempts: number; total: number; detail: string } {
	const attempts = Math.ceil(target * 1.3);
	const genPrice = PRICING[GENERATION_MODEL] as { input: number; output: number };
	const labPrice = PRICING[LABELING_MODEL] as { input: number; output: number };
	const perM = (tok: number, price: number) => (tok / 1_000_000) * price;
	const genCost =
		attempts * (perM(EST_TOKENS.generation.input, genPrice.input) + perM(EST_TOKENS.generation.output, genPrice.output));
	const labCost =
		attempts * (perM(EST_TOKENS.labeling.input, labPrice.input) + perM(EST_TOKENS.labeling.output, labPrice.output));
	return {
		attempts,
		total: genCost + labCost,
		detail:
			`  generation  ${GENERATION_MODEL}: ~${attempts} calls → ${usd(genCost)}\n` +
			`  labeling    ${LABELING_MODEL}: ~${attempts} calls → ${usd(labCost)}`,
	};
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJsonl(file: string): DatasetExample[] {
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as DatasetExample);
}

interface Produced {
	note: string;
	medications: DatasetExample["medications"];
	spec: ReturnType<typeof sampleSpec>;
	failed: boolean; // transient API failure that survived all retries - skip, don't crash
}

// Retry a network op with exponential backoff on top of the SDK's own retries.
// A single connection blip must never take down a multi-thousand-example run.
async function withRetry<T>(op: () => Promise<T>, label: string, attempts = 4): Promise<T> {
	let lastError: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await op();
		} catch (error) {
			lastError = error;
			const wait = Math.min(30000, 1000 * 2 ** i) + Math.floor(Math.random() * 500);
			console.warn(`  ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms`);
			await delay(wait);
		}
	}
	throw lastError;
}

async function produceOne(client: Anthropic | null, seed: number, mock: boolean): Promise<Produced> {
	const spec = sampleSpec(seed);
	if (mock || !client) {
		const built = mockBuild(spec);
		return { note: built.note, medications: built.medications, spec, failed: false };
	}
	try {
		const note = await withRetry(() => generateNote(client, spec), "generate");
		if (!note) return { note: "", medications: [], spec, failed: false };
		const medications = await withRetry(() => labelNote(client, note), "label");
		await delay(STAGGER_MS);
		return { note, medications, spec, failed: false };
	} catch (error) {
		// Survived all retries - skip this example, keep the run alive.
		console.warn(`  example ${seed} skipped after retries: ${(error as Error).message}`);
		return { note: "", medications: [], spec, failed: true };
	}
}

function writeSplits(kept: DatasetExample[], seed: number): Record<string, number> {
	// Seeded shuffle so the split is reproducible and independent of arrival
	// order. The test split is written to its own file and never touched by
	// training (enforced downstream in ml/train).
	const rng = mulberry32(seed ^ 0x5f3759df);
	const shuffled = [...kept].sort(() => rng() - 0.5);
	const nTrain = Math.floor(shuffled.length * SPLIT_RATIOS.train);
	const nVal = Math.floor(shuffled.length * SPLIT_RATIOS.val);
	const parts = {
		train: shuffled.slice(0, nTrain),
		val: shuffled.slice(nTrain, nTrain + nVal),
		test: shuffled.slice(nTrain + nVal),
	};
	for (const [split, examples] of Object.entries(parts)) {
		for (const ex of examples) ex.split = split as DatasetExample["split"];
		fs.writeFileSync(
			SPLIT_FILES[split as keyof typeof SPLIT_FILES],
			examples.map((e) => JSON.stringify(e)).join("\n") + (examples.length ? "\n" : ""),
		);
	}
	return { train: parts.train.length, val: parts.val.length, test: parts.test.length };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	fs.mkdirSync(RAW_DIR, { recursive: true });

	console.log(`\nData generation - target ${args.target} kept examples${args.mock ? " (MOCK, no API)" : ""}`);

	if (!args.mock) {
		const est = estimateCost(args.target);
		console.log(`\nEstimated spend (editable pricing in config.ts):\n${est.detail}`);
		console.log(`  TOTAL: ~${usd(est.total)} over ~${est.attempts} generation+labeling call pairs\n`);
		if (!args.confirm) {
			console.log("No --confirm flag → not spending. Re-run with --confirm to proceed.");
			console.log("(Or add --mock to exercise the full pipeline at $0.)\n");
			return;
		}
		loadApiKey(); // throws if missing before we start spending
	}

	// maxRetries lifts the SDK's own connection/429/5xx retry budget; produceOne
	// adds another backoff layer on top and skips rather than crashing.
	const client = args.mock ? null : new Anthropic({ maxRetries: 5 });
	const rawFile = `${RAW_DIR}/${args.runName}.jsonl`;

	const kept: DatasetExample[] = args.resume ? readJsonl(rawFile) : [];
	if (!args.resume && fs.existsSync(rawFile)) fs.rmSync(rawFile);
	const dupeGuard = new DupeGuard();
	for (const ex of kept) dupeGuard.remember(shingles(ex.note));

	const discards: Record<DiscardReason, number> = {
		"name-unlocatable": 0,
		"ambiguous-span": 0,
		"near-duplicate": 0,
		"eval-overlap": 0,
		"empty-note": 0,
	};

	let attempts = kept.length; // seed offset; resume continues past prior work
	let skippedAmbiguousFields = 0; // ambiguous optional fields left untagged (kept examples)
	let transientFailures = 0; // examples skipped after exhausting network retries
	const maxAttempts = args.target * 4 + 50; // runaway guard

	while (kept.length < args.target && attempts < maxAttempts) {
		const batchSeeds: number[] = [];
		for (let i = 0; i < CONCURRENCY && attempts < maxAttempts; i++) {
			batchSeeds.push(args.seed + attempts);
			attempts++;
		}
		const produced = await Promise.all(batchSeeds.map((s) => produceOne(client, s, args.mock)));

		// Accept sequentially so the incremental dupe guard stays deterministic.
		for (const p of produced) {
			if (kept.length >= args.target) break;
			if (p.failed) {
				transientFailures++;
				continue; // network skip - not a data-quality discard
			}
			const sh = shingles(p.note);
			if (!p.note.trim()) {
				discards["empty-note"]++;
				continue;
			}
			if (overlapsEvalSet(sh)) {
				discards["eval-overlap"]++;
				continue;
			}
			if (dupeGuard.isDupe(sh)) {
				discards["near-duplicate"]++;
				continue;
			}
			const id = `med-${String(kept.length + 1).padStart(5, "0")}`;
			const aligned = alignExample(id, p.note, p.medications, p.spec, args.mock);
			if (aligned.discarded) {
				discards[aligned.discarded]++;
				continue;
			}
			skippedAmbiguousFields += aligned.skippedAmbiguousFields;
			kept.push(aligned.example as DatasetExample);
			dupeGuard.remember(sh);
			fs.appendFileSync(rawFile, JSON.stringify(aligned.example) + "\n");
		}

		if (kept.length % BATCH_SIZE === 0 || attempts >= maxAttempts) {
			console.log(`  ${kept.length}/${args.target} kept (${attempts} attempts)`);
		}
	}

	// --- finalize ------------------------------------------------------------
	const splitCounts = writeSplits(kept, args.seed);
	const totalDiscards = Object.values(discards).reduce((a, b) => a + b, 0);
	const discardRate = attempts === 0 ? 0 : totalDiscards / attempts;
	const totalEntities = kept.reduce((s, e) => s + e.entities.length, 0);
	const negatives = kept.filter((e) => e.medications.length === 0).length;

	const stats = {
		generated_at: new Date().toISOString(),
		mock: args.mock,
		seed: args.seed,
		target: args.target,
		kept: kept.length,
		attempts,
		discards,
		discard_rate: Math.round(discardRate * 10000) / 10000,
		splits: splitCounts,
		zero_med_negatives: negatives,
		total_entity_spans: totalEntities,
		skipped_ambiguous_fields: skippedAmbiguousFields,
		transient_api_failures: transientFailures,
		generation_model: GENERATION_MODEL,
		labeling_model: LABELING_MODEL,
	};
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, "\t") + "\n");

	// --- gate-2 review print -------------------------------------------------
	console.log(`\n=== Summary ===`);
	console.log(`kept ${kept.length} / target ${args.target}  (${attempts} attempts)`);
	console.log(`discard rate: ${(discardRate * 100).toFixed(1)}%  →`, discards);
	console.log(`ambiguous fields left untagged (kept): ${skippedAmbiguousFields}`);
	console.log(`transient API failures skipped: ${transientFailures}`);
	console.log(`zero-med hard negatives: ${negatives}`);
	console.log(`splits:`, splitCounts);
	console.log(`total entity spans: ${totalEntities}`);
	console.log(`\n=== First 3 examples (note-quality + alignment review) ===`);
	for (const ex of kept.slice(0, 3)) {
		console.log(`\n[${ex.id}] specialty=${ex.meta.spec.specialty} style=${ex.meta.spec.style} tricky=[${ex.meta.spec.tricky.join(", ")}]`);
		console.log(ex.note);
		console.log(
			`  entities: ` +
				(ex.entities.map((e) => `${e.type}="${e.text}"`).join("  ") || "(none - hard negative)"),
		);
		console.log(`  teacher meds: ${JSON.stringify(ex.medications)}`);
	}
	console.log(`\nWrote splits to ml/data/ and stats to ${STATS_FILE}\n`);
}

await main();
