// Sample pipeline for the Screenshot → PrimeVue demo, in two stages:
//   1. Render the mock pages in samples-src/ to PNGs (Playwright, 1280×800 -
//      fully reproducible, no downloaded images). Demo samples land in
//      src/assets/demo-samples/; the eval-* pages land in
//      scripts/evals/fixtures/ (negative test cases for the eval suite -
//      never shown in the demo UI, never analyzed here).
//   2. Run each demo PNG through the same pipeline worker/index.ts uses
//      (src/lib/pipelines/analyze-screenshot.ts) and write
//      src/data/screenshot-sample-results.json, so bundled samples never
//      need a live API call.
//
// Usage:
//   npm run generate:screenshot-samples              (both stages)
//   npm run generate:screenshot-samples -- --render-only   (skip the API stage)
//
// Stage 2 needs ANTHROPIC_API_KEY in the environment.
// Runs via tsx (see package.json): the pipeline modules use extensionless
// TS imports, which Node's native type stripping can't resolve.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import Anthropic from "@anthropic-ai/sdk";
import { analyzeScreenshot } from "../src/lib/pipelines/analyze-screenshot.ts";
import { SCREENSHOT_SAMPLES } from "../src/data/screenshot-samples.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src/assets/demo-samples");
const evalFixtureDir = path.join(root, "scripts/evals/fixtures");
const renderOnly = process.argv.includes("--render-only");

// Non-UI pages rendered only as eval fixtures: the suite asserts these are
// rejected (is_ui_screenshot: false). Keep ids in sync with
// scripts/evals/suites/screenshot-to-primevue.ts.
const EVAL_FIXTURE_PAGES = ["eval-landscape", "eval-text-document"];

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(evalFixtureDir, { recursive: true });

// Stage 1 - render mock pages to PNGs.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const render = async (id, dir) => {
	const src = path.join(root, "samples-src", `${id}.html`);
	const out = path.join(dir, `${id}.png`);
	await page.goto(`file://${src}`);
	await page.screenshot({ path: out });
	console.log(`Rendered ${path.relative(root, out)}`);
};
for (const sample of SCREENSHOT_SAMPLES) {
	await render(sample.id, outDir);
}
for (const id of EVAL_FIXTURE_PAGES) {
	await render(id, evalFixtureDir);
}
await browser.close();

if (renderOnly) {
	console.log("Skipping analysis stage (--render-only).");
	process.exit(0);
}

// Stage 2 - analyze each demo PNG and write the bundled results.
const anthropic = new Anthropic();
const results = {};

for (const sample of SCREENSHOT_SAMPLES) {
	console.log(`Analyzing "${sample.label}"...`);
	const imageData = fs
		.readFileSync(path.join(outDir, `${sample.id}.png`))
		.toString("base64");
	results[sample.id] = await analyzeScreenshot(anthropic, imageData, "image/png");
}

const outPath = path.join(root, "src/data/screenshot-sample-results.json");
fs.writeFileSync(outPath, `${JSON.stringify(results, null, "\t")}\n`);
console.log(`Wrote ${path.relative(root, outPath)}`);
