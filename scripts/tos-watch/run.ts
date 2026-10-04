import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
	explainTosChange,
	EXPLAIN_TOS_DEFAULT_MODEL,
	TOS_PIPELINE_VERSION,
} from "../../src/lib/pipelines/explain-tos-change";
import type { ChangelogEntry, DocumentState, TosWatchState } from "../../src/lib/tos-watch";
import { applyEditorialGate } from "./editorial";
import { buildFeed } from "./feed";
import { fetchDocument } from "./fetch";
import { fileOpsIssue } from "./issues";
import { normalizeDocument } from "./normalize";
import {
	commitAndPushSnapshots,
	docSlug,
	readLatestSnapshot,
	snapshotDir,
	writeSnapshot,
} from "./snapshots";
import {
	commitPublicFiles,
	loadChangelog,
	loadState,
	prependChangelogEntries,
	saveFeed,
	saveState,
} from "./state";

// The nightly watchdog run. Per enabled document: fetch → extract/normalize →
// hash-compare against the private snapshot → (only on change) explain via
// the model + editorial gate → persist. The unchanged path - by far the
// common case - costs zero AI spend: it's a fetch, a hash, and a timestamp.
//
// Usage:
//   npm run tos-watch:run            full run: snapshots pushed, public files
//                                    committed [skip ci], ops issues filed
//   npm run tos-watch:run -- --dry   full pipeline against live URLs; prints
//                                    per-document outcomes; no commits, no
//                                    pushes, no issues

const FAILURES_BEFORE_ISSUE = 3;

interface ServiceConfig {
	id: string;
	name: string;
	enabled: boolean;
	documents: { label: string; url: string; selector: string | null }[];
}

type Outcome = "unchanged" | "changed" | "cosmetic" | "baseline" | "failed" | "skipped" | "held";

function findDoc(
	state: TosWatchState | null,
	serviceId: string,
	label: string,
): DocumentState | null {
	return (
		state?.documents.find((d) => d.service_id === serviceId && d.document_label === label) ?? null
	);
}

async function main(): Promise<void> {
	const dry = process.argv.includes("--dry");
	const now = new Date();
	const nowIso = now.toISOString();
	const today = nowIso.slice(0, 10);

	const config = JSON.parse(
		await readFile(path.resolve("watchdog/services.json"), "utf8"),
	) as { services: ServiceConfig[] };

	// Dry runs without a snapshot dir still exercise the whole fetch/normalize
	// path - every document just reads as its first observation.
	const snapDir =
		dry && !process.env.TOS_SNAPSHOT_DIR
			? await mkdtemp(path.join(tmpdir(), "tos-watch-dry-"))
			: snapshotDir();

	const previousState = await loadState();
	const model = process.env.TOS_WATCH_MODEL ?? EXPLAIN_TOS_DEFAULT_MODEL;
	// Constructed lazily: the all-unchanged night needs no API key at all.
	let client: Anthropic | null = null;

	const documents: DocumentState[] = [];
	const newEntries: ChangelogEntry[] = [];
	const issues: Parameters<typeof fileOpsIssue>[0][] = [];
	const counts: Record<Outcome, number> = {
		unchanged: 0,
		changed: 0,
		cosmetic: 0,
		baseline: 0,
		failed: 0,
		skipped: 0,
		held: 0,
	};

	for (const service of config.services) {
		if (!service.enabled) continue;
		for (const doc of service.documents) {
			const label = `${service.name} · ${doc.label}`;
			const prev = findDoc(previousState, service.id, doc.label);
			const record = (outcome: Outcome, next: DocumentState, note = "") => {
				counts[outcome]++;
				documents.push(next);
				console.log(`${outcome.padEnd(9)} ${label}${note ? ` - ${note}` : ""}`);
			};

			const outcome = await fetchDocument(doc.url);

			if (outcome.kind === "robots_skipped") {
				// A disallowed configured URL is a config problem to surface, not
				// something to fetch anyway.
				issues.push({
					fingerprint: `robots:${service.id}/${docSlug(doc.label)}`,
					title: `tos-watch: robots.txt blocks ${label}`,
					body: `${outcome.reason}\n\nThe document at ${doc.url} is configured for monitoring but disallowed for automated access. Either the URL moved, or this service should be disabled in watchdog/services.json.`,
				});
				record("skipped", {
					service_id: service.id,
					service_name: service.name,
					document_label: doc.label,
					document_url: doc.url,
					last_checked_at: nowIso,
					last_changed_at: prev?.last_changed_at ?? null,
					content_hash: prev?.content_hash ?? null,
					consecutive_failures: prev?.consecutive_failures ?? 0,
					status: "robots_skipped",
					self_reported_updated: prev?.self_reported_updated ?? null,
				}, outcome.reason);
				continue;
			}

			if (outcome.kind === "failed") {
				// A failed fetch is never a change - the document may be fine and
				// the network not. Count it; escalate only on a streak.
				const failures = (prev?.consecutive_failures ?? 0) + 1;
				if (failures === FAILURES_BEFORE_ISSUE) {
					issues.push({
						fingerprint: `unreachable:${service.id}/${docSlug(doc.label)}`,
						title: `tos-watch: ${label} unreachable ${failures} nights running`,
						body: `Fetching ${doc.url} has failed ${failures} consecutive nightly runs (latest: ${outcome.reason}). The URL may have moved or the page may now resist automated access - check the config in watchdog/services.json.`,
					});
				}
				record("failed", {
					service_id: service.id,
					service_name: service.name,
					document_label: doc.label,
					document_url: doc.url,
					last_checked_at: nowIso,
					last_changed_at: prev?.last_changed_at ?? null,
					content_hash: prev?.content_hash ?? null,
					consecutive_failures: failures,
					status: "unreachable",
					self_reported_updated: prev?.self_reported_updated ?? null,
				}, outcome.reason);
				continue;
			}

			const norm = normalizeDocument(outcome.html, doc.selector);
			const baseState: DocumentState = {
				service_id: service.id,
				service_name: service.name,
				document_label: doc.label,
				document_url: doc.url,
				last_checked_at: nowIso,
				last_changed_at: prev?.last_changed_at ?? null,
				content_hash: norm.hash,
				consecutive_failures: 0,
				status: "monitored",
				self_reported_updated: norm.selfReportedUpdated,
			};

			const previousText = await readLatestSnapshot(snapDir, service.id, doc.label);

			if (previousText === null) {
				// First observation: snapshot it, publish nothing. An honest
				// monitor starts with an empty changelog, not backfilled drama.
				if (!dry) await writeSnapshot(snapDir, service.id, doc.label, norm.text, nowIso);
				record("baseline", baseState);
				continue;
			}

			if (previousText === norm.text) {
				// The common case, and deliberately the zero-AI-cost one: a
				// fetch, a hash comparison, a timestamp. Nothing else runs.
				record("unchanged", baseState);
				continue;
			}

			// Change detected - the one path that costs model tokens.
			try {
				client ??= new Anthropic();
				const raw = await explainTosChange(
					client,
					{ serviceName: service.name, documentLabel: doc.label },
					previousText,
					norm.text,
					model,
				);
				const { report, violations } = applyEditorialGate(raw);

				if (violations.length > 0) {
					// Editorial control stays with the owner: loaded language means
					// this entry is held for review, not auto-published. The
					// snapshot is NOT rotated, so the change re-detects nightly
					// until the issue is resolved.
					issues.push({
						fingerprint: `editorial:${service.id}/${docSlug(doc.label)}`,
						title: `tos-watch: entry for ${label} held for editorial review`,
						body: `The model's output for a detected change contained forbidden loaded language and was NOT published:\n\n${violations.map((v) => `- ${v.field}: "${v.term}" in: ${v.text}`).join("\n")}\n\nFull report JSON:\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``,
					});
					record("held", { ...baseState, content_hash: prev?.content_hash ?? null }, "loaded-language violation - held for review");
					continue;
				}

				newEntries.push({
					id: `${service.id}/${docSlug(doc.label)}/${today}`,
					service_id: service.id,
					service_name: service.name,
					document_label: doc.label,
					document_url: doc.url,
					detected_at: today,
					report,
					model,
					pipeline_version: TOS_PIPELINE_VERSION,
				});
				if (!dry) await writeSnapshot(snapDir, service.id, doc.label, norm.text, nowIso);
				record(report.substantive ? "changed" : "cosmetic", {
					...baseState,
					last_changed_at: nowIso,
				}, report.summary);
			} catch (error) {
				// Model/API failure: no entry, snapshot not rotated - the change
				// re-detects tomorrow. Never publish a guess.
				record("failed", { ...baseState, content_hash: prev?.content_hash ?? null }, `pipeline error: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	const state: TosWatchState = {
		generated_at: nowIso,
		monitoring_since: previousState?.monitoring_since ?? today,
		documents,
	};

	console.log(
		`\nSummary: ${counts.unchanged} unchanged · ${counts.changed} changed · ${counts.cosmetic} cosmetic · ${counts.baseline} baseline · ${counts.failed} failed · ${counts.skipped} robots-skipped · ${counts.held} held`,
	);

	if (dry) {
		console.log("Dry run - nothing committed, no issues filed.");
		return;
	}

	// Snapshots push FIRST: if the private repo can't take tonight's text, the
	// public entries are withheld too (they'd otherwise describe a change we
	// have no snapshot for, and it would never re-detect). The record can lag
	// a day; it must never lie.
	await commitAndPushSnapshots(snapDir, nowIso);

	await saveState(state);
	if (newEntries.length > 0) {
		const changelog = await prependChangelogEntries(newEntries);
		await saveFeed(buildFeed(changelog, now));
	} else if ((await loadChangelog()).length === 0) {
		// Keep the feed valid (and subscribable) even before the first entry.
		await saveFeed(buildFeed([], now));
	}
	await commitPublicFiles(nowIso);

	// Issue filing is best-effort and last: a GitHub API hiccup shouldn't
	// block the record itself.
	for (const issue of issues) {
		try {
			await fileOpsIssue(issue);
		} catch (error) {
			console.error(`Failed to file issue "${issue.title}":`, error);
		}
	}
}

await main();
