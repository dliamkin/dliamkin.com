import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckResult } from "../../../src/lib/evals";
import {
	countWords,
	EXCERPT_MAX_WORDS,
	EXPLAIN_TOS_SYSTEM_PROMPT,
	findLoadedLanguage,
	type TosChange,
	type TosChangeReport,
} from "../../../src/lib/tos-watch";
import {
	explainTosChange,
	EXPLAIN_TOS_DEFAULT_MODEL,
} from "../../../src/lib/pipelines/explain-tos-change";
import {
	countAtMost,
	defineSuite,
	fieldEquals,
	normalized,
	setContains,
	type EvalCase,
} from "../harness";

// Eval suite for the ToS watchdog's explain pipeline. Fixtures are synthetic
// "Acmecloud" terms written in authentic legalese with planted changes, so
// every check is a ground-truth assertion. Because this pipeline's output is
// published verbatim on a public record about real organizations, the suite
// leans on editorial checks the other suites don't need: the 25-word excerpt
// cap, verbatim excerpt containment (anti-fabrication), and a zero-tolerance
// loaded-language scan.

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

const original = readFileSync(path.join(fixtureDir, "acmecloud-tos-original.txt"), "utf8");
const revised = (id: string) =>
	readFileSync(path.join(fixtureDir, `acmecloud-tos-${id}-revised.txt`), "utf8");

interface TosPairInput {
	previousText: string;
	currentText: string;
}

const pair = (id: string): TosPairInput => ({ previousText: original, currentText: revised(id) });

const renderChange = (c: TosChange) => `"${c.title}" [${c.category}, ${c.impact}, ${c.severity}]`;

function hasChange(
	report: TosChangeReport,
	expected: string,
	spec: {
		categories: TosChange["category"][];
		impacts: TosChange["impact"][];
		keyword: RegExp;
	},
): CheckResult {
	return setContains(
		report.changes,
		expected,
		(c) =>
			spec.categories.includes(c.category) &&
			spec.impacts.includes(c.impact) &&
			spec.keyword.test(normalized(JSON.stringify(c))),
		renderChange,
	);
}

// Every excerpt must be a verbatim quote from the fixture text it claims to
// come from - fabricated or paraphrased "quotes" on a public record would be
// worse than no excerpt at all.
function excerptsContained(report: TosChangeReport, newText: string): CheckResult {
	// The pipeline hard-caps excerpts and marks truncation with a trailing
	// "…" (see truncateExcerpt) - strip that marker before the verbatim test,
	// since the words before it must still quote the source exactly.
	const quoted = (excerpt: string) => normalized(excerpt.replace(/…$/u, ""));
	const missing = report.changes.filter(
		(c) =>
			!normalized(newText).includes(quoted(c.new_excerpt)) ||
			(c.old_excerpt !== null && !normalized(original).includes(quoted(c.old_excerpt))),
	);
	return {
		passed: missing.length === 0,
		expected: "every excerpt appears verbatim in its source fixture text",
		actual:
			missing.length === 0
				? "all excerpts contained"
				: `fabricated/paraphrased: ${missing.map((c) => `"${c.new_excerpt}"`).join(" | ")}`,
	};
}

function excerptsWithinCap(report: TosChangeReport): CheckResult {
	// Report the excerpt that actually broke the cap - this check once
	// flagged an over-long old_excerpt while printing the compliant
	// new_excerpt, which made the dashboard failure unreadable.
	const offenders = report.changes.flatMap((c) =>
		[
			{ field: "new_excerpt", excerpt: c.new_excerpt },
			{ field: "old_excerpt", excerpt: c.old_excerpt },
		].filter(
			(e): e is { field: string; excerpt: string } =>
				e.excerpt !== null && countWords(e.excerpt) > EXCERPT_MAX_WORDS,
		),
	);
	return {
		passed: offenders.length === 0,
		expected: `every excerpt <= ${EXCERPT_MAX_WORDS} words`,
		actual:
			offenders.length === 0
				? "all within cap"
				: offenders
						.map((e) => `${e.field} ${countWords(e.excerpt)} words: "${e.excerpt}"`)
						.join(" | "),
	};
}

function noLoadedLanguage(report: TosChangeReport): CheckResult {
	const violations = findLoadedLanguage(report);
	return {
		passed: violations.length === 0,
		expected: "zero loaded-language violations",
		actual:
			violations.length === 0
				? "clean"
				: violations.map((v) => `${v.field}: "${v.term}"`).join(" | "),
	};
}

// Shared editorial checks appended to every substantive case.
const editorialChecks = (newTextId: string) => [
	{
		name: "all excerpts within the 25-word cap",
		run: (r: TosChangeReport) => excerptsWithinCap(r),
	},
	{
		name: "excerpts verbatim-contained in fixture text (anti-fabrication)",
		run: (r: TosChangeReport) => excerptsContained(r, revised(newTextId)),
	},
	{
		name: "zero loaded-language violations",
		run: (r: TosChangeReport) => noLoadedLanguage(r),
	},
];

const cases: EvalCase<TosPairInput, TosChangeReport>[] = [
	{
		id: "tos-arbitration-added",
		description:
			"Dispute-resolution section replaced: courts → binding individual arbitration with class-action waiver. Must be found as substantive, arbitration_and_disputes, favors_provider.",
		input: pair("arbitration"),
		checks: [
			{ name: "gated substantive", run: (r) => fieldEquals(r.substantive, true) },
			{
				name: "finds the arbitration clause (arbitration_and_disputes, favors_provider)",
				run: (r) =>
					hasChange(r, "binding arbitration + class-action waiver added", {
						categories: ["arbitration_and_disputes"],
						impacts: ["favors_provider"],
						keyword: /arbitrat/,
					}),
			},
			{
				name: "no invented changes (1 planted, ≤ 2 reported)",
				run: (r) => countAtMost(r.changes.length, 2, "reported changes"),
			},
			...editorialChecks("arbitration"),
		],
	},
	{
		id: "tos-data-sharing-expanded",
		description:
			"Data sharing expanded from processors-only to affiliates + advertising/analytics partners. Must be privacy_and_data, favors_provider.",
		input: pair("data-sharing"),
		checks: [
			{ name: "gated substantive", run: (r) => fieldEquals(r.substantive, true) },
			{
				name: "finds the data-sharing expansion (privacy_and_data, favors_provider)",
				run: (r) =>
					hasChange(r, "sharing expanded to advertising/analytics partners", {
						categories: ["privacy_and_data"],
						impacts: ["favors_provider"],
						keyword: /advertis|analytic|affiliate/,
					}),
			},
			{
				// The removal of "We do not sell your personal information" may
				// legitimately be reported as its own change.
				name: "no invented changes (1-2 planted concepts, ≤ 3 reported)",
				run: (r) => countAtMost(r.changes.length, 3, "reported changes"),
			},
			...editorialChecks("data-sharing"),
		],
	},
	{
		id: "tos-refund-window-extended",
		description:
			"BIAS CHECK: refund window extended 14 → 30 days - a user-favorable change that must be judged favors_user, not reflexively favors_provider.",
		input: pair("refund-window"),
		checks: [
			{ name: "gated substantive", run: (r) => fieldEquals(r.substantive, true) },
			{
				name: "BIAS CHECK: refund extension judged favors_user (pricing_and_billing)",
				run: (r) =>
					hasChange(r, "refund window 14 → 30 days, judged favors_user", {
						categories: ["pricing_and_billing"],
						impacts: ["favors_user"],
						keyword: /thirty|30/,
					}),
			},
			{
				name: "no invented changes (1 planted, ≤ 2 reported)",
				run: (r) => countAtMost(r.changes.length, 2, "reported changes"),
			},
			...editorialChecks("refund-window"),
		],
	},
	{
		id: "tos-liability-cap-lowered",
		description:
			"Liability cap changed from 12 months of fees to a flat $100. Must be liability, favors_provider.",
		input: pair("liability-cap"),
		checks: [
			{ name: "gated substantive", run: (r) => fieldEquals(r.substantive, true) },
			{
				name: "finds the liability cap change (liability, favors_provider)",
				run: (r) =>
					hasChange(r, "liability cap: 12 months of fees → $100", {
						categories: ["liability"],
						impacts: ["favors_provider"],
						keyword: /100/,
					}),
			},
			{
				name: "no invented changes (1 planted, ≤ 2 reported)",
				run: (r) => countAtMost(r.changes.length, 2, "reported changes"),
			},
			...editorialChecks("liability-cap"),
		],
	},
	{
		id: "tos-cosmetic-only",
		description:
			"False-positive restraint: section renumbering plus three identically-meaning rewordings. Must gate substantive: false with zero changes.",
		input: pair("cosmetic"),
		checks: [
			{
				name: "gated NOT substantive (cosmetic changes only)",
				run: (r) => fieldEquals(r.substantive, false),
			},
			{
				name: "no changes reported for a cosmetic revision",
				run: (r) => countAtMost(r.changes.length, 0, "reported changes"),
			},
			{
				name: "zero loaded-language violations (cosmetic note + summary)",
				run: (r) => noLoadedLanguage(r),
			},
		],
	},
];

// Match the nightly workflow: TOS_WATCH_MODEL overrides the pipeline default,
// so the suite always runs whatever model production runs.
const model = process.env.TOS_WATCH_MODEL ?? EXPLAIN_TOS_DEFAULT_MODEL;

export const tosWatchSuite = defineSuite({
	project_id: "tos-watch",
	project_label: "ToS Watchdog",
	model,
	prompt: EXPLAIN_TOS_SYSTEM_PROMPT,
	cases,
	execute: (client, input) =>
		explainTosChange(
			client,
			{ serviceName: "Acmecloud", documentLabel: "Terms of Service" },
			input.previousText,
			input.currentText,
			model,
		),
});
