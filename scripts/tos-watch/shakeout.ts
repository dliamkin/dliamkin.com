import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchDocument } from "./fetch";
import { normalizeDocument } from "./normalize";

// Read-only shake-out of the configured document list: fetch + extract +
// normalize every enabled document and print what we'd hash. No snapshots,
// no commits, no issues - this exists to validate URLs, selectors, and
// volatile-fragment rules before the baseline run (and any time the list
// changes). Usage: npx tsx scripts/tos-watch/shakeout.ts

interface ServiceConfig {
	id: string;
	name: string;
	enabled: boolean;
	documents: { label: string; url: string; selector: string | null }[];
}

async function main() {
	const config = JSON.parse(
		await readFile(path.resolve("watchdog/services.json"), "utf8"),
	) as { services: ServiceConfig[] };

	let ok = 0;
	let failed = 0;
	for (const service of config.services) {
		if (!service.enabled) continue;
		for (const doc of service.documents) {
			const label = `${service.name} · ${doc.label}`;
			const outcome = await fetchDocument(doc.url);
			if (outcome.kind !== "ok") {
				failed++;
				console.log(`✗ ${label}\n    ${outcome.kind}: ${outcome.reason}`);
				continue;
			}
			const norm = normalizeDocument(outcome.html, doc.selector);
			const words = norm.text.split(/\s+/).length;
			const suspicious = words < 150 ? "  ⚠ SHORT - extraction likely missed content" : "";
			ok++;
			console.log(
				`✓ ${label}\n    ${words} words · hash ${norm.hash.slice(0, 12)} · self-dated: ${norm.selfReportedUpdated ?? "-"}${suspicious}\n    starts: ${norm.text.slice(0, 110).replace(/\n/g, " ")}…`,
			);
		}
	}
	console.log(`\nShake-out: ${ok} ok, ${failed} failed/skipped.`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
