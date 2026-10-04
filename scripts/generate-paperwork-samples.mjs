// Regenerates src/data/paperwork-sample-results.json by running each bundled
// paperwork sample through the same pipeline worker/index.ts uses
// (src/lib/pipelines/extract-obligations.ts), so the committed results always
// match what a live request would return.
//
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run generate:paperwork-samples
//
// Runs via tsx (see package.json): the pipeline modules use extensionless
// TS imports, which Node's native type stripping can't resolve. The sample
// texts are read from src/data/paperwork-samples/ by id (paperwork-samples.ts
// bundles the same files via ?raw imports, which Node can't resolve).
//
// Today's date is pinned to PAPERWORK_SAMPLE_TODAY (not the wall clock) so
// in_past flags and any relative arithmetic in the committed results are
// deterministic - the sample dates are planted in 2026-2027 around it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { extractObligations } from "../src/lib/pipelines/extract-obligations.ts";

// Keep ids in sync with PAPERWORK_SAMPLES in src/data/paperwork-samples.ts.
const SAMPLE_IDS = ["maple-vine-lease", "scholarship-award", "auto-insurance-summary"];
const SAMPLE_TODAY = "2026-07-01"; // = PAPERWORK_SAMPLE_TODAY

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data");

const anthropic = new Anthropic();
const results = {};

for (const id of SAMPLE_IDS) {
	console.log(`Extracting "${id}"...`);
	const documentText = fs.readFileSync(
		path.join(dataDir, "paperwork-samples", `${id}.txt`),
		"utf8",
	);
	// Match worker/index.ts: PAPERWORK_MODEL overrides the pipeline default.
	results[id] = await extractObligations(
		anthropic,
		{ documentText },
		SAMPLE_TODAY,
		process.env.PAPERWORK_MODEL,
	);
	console.log(`  ${results[id].events.length} events extracted`);
}

const outPath = path.join(dataDir, "paperwork-sample-results.json");
fs.writeFileSync(outPath, `${JSON.stringify(results, null, "\t")}\n`);
console.log(`Wrote ${outPath}`);
