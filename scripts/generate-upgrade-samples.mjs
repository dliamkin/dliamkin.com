// Regenerates the Dependency Upgrade Planner's bundled sample data:
//   1. src/data/upgrade-samples/site-portfolio.json - a trimmed copy of this
//      repo's own package.json (the meta sample: the planner, planning its
//      own host).
//   2. src/data/upgrade-sample-facts.json - each sample's DependencyFacts,
//      computed live against the npm registry and date-stamped (registry
//      state drifts, so the UI shows "registry data as of {date}").
//   3. src/data/upgrade-sample-results.json - each sample's synthesized plan,
//      through the same pipeline worker/index.ts uses
//      (src/lib/pipelines/plan-upgrades.ts). Skipped with a warning when
//      ANTHROPIC_API_KEY is not set, so the free facts snapshot can be
//      refreshed without spending.
//
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run generate:upgrade-samples
//
// Runs via tsx (see package.json): the pipeline modules use extensionless TS
// imports, which Node's native type stripping can't resolve.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { analyzeDependencies, parsePackageJson } from "../src/lib/upgrade-facts.ts";
import { planUpgrades } from "../src/lib/pipelines/plan-upgrades.ts";
import { toPlanRequestFacts } from "../src/lib/upgrade-planner.ts";

// Keep ids in sync with UPGRADE_SAMPLES in src/data/upgrade-samples.ts.
const SAMPLE_IDS = ["site-portfolio", "legacy-vue2", "express-api"];

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = path.join(rootDir, "src/data/upgrade-samples");
const dataDir = path.join(rootDir, "src/data");

// 1. Refresh the meta sample from the repo's real package.json (manifest
// fields only - scripts etc. are irrelevant to the analysis and noisy in the
// textarea).
const own = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const sitePortfolio = {
	name: own.name,
	version: own.version,
	private: true,
	dependencies: own.dependencies,
	devDependencies: own.devDependencies,
};
fs.writeFileSync(
	path.join(samplesDir, "site-portfolio.json"),
	`${JSON.stringify(sitePortfolio, null, "\t")}\n`,
);
console.log("Refreshed site-portfolio.json from the repo's package.json");

// 2. Facts snapshots, live against the registry.
const generatedAt = new Date().toISOString().slice(0, 10);
const factsById = {};
for (const id of SAMPLE_IDS) {
	console.log(`Analyzing "${id}" against the npm registry...`);
	const manifestText = fs.readFileSync(path.join(samplesDir, `${id}.json`), "utf8");
	const facts = await analyzeDependencies(parsePackageJson(manifestText));
	factsById[id] = facts;
	const conflicts = facts.facts.reduce((sum, f) => sum + f.peer_conflicts.length, 0);
	console.log(
		`  ${facts.facts.length} analyzed, ${facts.failures.length} failed, ${facts.skipped.length} skipped, ${conflicts} peer conflicts`,
	);
}
fs.writeFileSync(
	path.join(dataDir, "upgrade-sample-facts.json"),
	`${JSON.stringify({ generated_at: generatedAt, facts: factsById }, null, "\t")}\n`,
);
console.log(`Wrote upgrade-sample-facts.json (registry data as of ${generatedAt})`);

// 3. Plans, only when a key is present.
if (!process.env.ANTHROPIC_API_KEY) {
	console.warn(
		"\nANTHROPIC_API_KEY is not set - facts snapshot refreshed, but the plans in " +
			"upgrade-sample-results.json were NOT regenerated. Re-run with a key to " +
			"regenerate them against the new snapshot.",
	);
	process.exit(0);
}

const anthropic = new Anthropic();
const plans = {};
for (const id of SAMPLE_IDS) {
	console.log(`Planning "${id}"...`);
	// Match worker/index.ts: UPGRADE_PLANNER_MODEL overrides the pipeline default.
	plans[id] = await planUpgrades(
		anthropic,
		toPlanRequestFacts(factsById[id].facts),
		process.env.UPGRADE_PLANNER_MODEL,
	);
	console.log(
		`  ${plans[id].waves.length} waves, ${plans[id].plans.length} package plans, ${plans[id].validation_warnings.length} validation warnings`,
	);
}
const outPath = path.join(dataDir, "upgrade-sample-results.json");
fs.writeFileSync(outPath, `${JSON.stringify(plans, null, "\t")}\n`);
console.log(`Wrote ${outPath}`);
