import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	EXTRACT_OBLIGATIONS_SYSTEM_PROMPT,
	type ObligationEvent,
	type ObligationExtraction,
} from "../../../src/lib/paperwork";
import {
	EXTRACT_OBLIGATIONS_DEFAULT_MODEL,
	extractObligations,
} from "../../../src/lib/pipelines/extract-obligations";
import { defineSuite, fieldEquals, normalized, setContains, setLacks, type EvalCase } from "../harness";
import type { CheckResult } from "../../../src/lib/evals";

// Eval suite for Paperwork → Calendar. Every document was authored with a
// known list of planted dates, so the checks are ground-truth assertions -
// and the stakes are ordered: a fabricated date is the worst failure this
// demo can have, so the unresolvable-date cases hard-fail if the model fills
// one in. The headline is computed-date arithmetic across month and year
// boundaries - the reason this pipeline runs Sonnet (Haiku computed
// "2027-08-31 minus 60 days" as 2027-06-02 during sample generation).

const dataDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../src/data/paperwork-samples",
);
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

// Must match PAPERWORK_SAMPLE_TODAY in src/data/paperwork-samples.ts - the
// same anchor the pre-generated sample results were produced against.
const SAMPLE_TODAY = "2026-07-01";

const sampleText = (id: string) => readFileSync(path.join(dataDir, `${id}.txt`), "utf8");
const fixtureText = (id: string) => readFileSync(path.join(fixtureDir, `${id}.txt`), "utf8");

interface PaperworkEvalInput {
	documentText: string;
	todayIso: string;
}

const renderEvent = (e: ObligationEvent) =>
	`"${e.title}" [${e.category}, ${e.date ?? "null"}, ${e.date_basis}]`;

interface EventSpec {
	keyword: RegExp; // binds the match to the planted item (searched across
	// the whole event object, normalized)
	date?: string | null; // exact ISO date (or null for unresolved)
	basis?: ObligationEvent["date_basis"][];
	inPast?: boolean;
	recurrenceFrequency?: "weekly" | "monthly" | "yearly";
	recurrenceDayOfMonth?: number;
}

function hasEvent(
	extraction: ObligationExtraction,
	expected: string,
	spec: EventSpec,
): CheckResult {
	return setContains(
		extraction.events,
		expected,
		(e) =>
			spec.keyword.test(normalized(JSON.stringify(e))) &&
			(spec.date === undefined || e.date === spec.date) &&
			(spec.basis === undefined || spec.basis.includes(e.date_basis)) &&
			(spec.inPast === undefined || e.in_past === spec.inPast) &&
			(spec.recurrenceFrequency === undefined ||
				e.recurrence?.frequency === spec.recurrenceFrequency) &&
			(spec.recurrenceDayOfMonth === undefined ||
				e.recurrence?.day_of_month === spec.recurrenceDayOfMonth),
		renderEvent,
	);
}

// The anti-fabrication guard: an unresolved date coming back filled in is the
// worst failure this demo can have.
function noFabricatedDates(extraction: ObligationExtraction): CheckResult {
	return setLacks(
		extraction.events,
		"with date_basis unresolved but a non-null date (a fabricated date)",
		(e) => e.date_basis === "unresolved" && e.date !== null,
		renderEvent,
	);
}

// The anti-hallucination guard: every event's source_excerpt must actually
// appear in the document (whitespace/case-normalized to allow for line
// wrapping, nothing more).
function excerptsAreVerbatim(
	extraction: ObligationExtraction,
	documentText: string,
): CheckResult {
	const haystack = normalized(documentText);
	return setLacks(
		extraction.events,
		"whose source_excerpt does not appear verbatim in the document",
		(e) => !haystack.includes(normalized(e.source_excerpt)),
		(e) => `"${e.title}" excerpt: "${e.source_excerpt}"`,
	);
}

// Recurring payment obligations must come back as a recurrence rule, not
// expanded into per-month instances. Only payment-category events are
// counted (other clauses often quote the same words, e.g. "unpaid rent" in a
// deposit clause); a separate "first payment" event alongside the recurring
// one is defensible modeling, so the cap is 2 - three or more matches means
// the model expanded the pattern.
function notExpanded(
	extraction: ObligationExtraction,
	keyword: RegExp,
	label: string,
): CheckResult {
	const matches = extraction.events.filter(
		(e) => e.category === "payment" && keyword.test(normalized(JSON.stringify(e))),
	);
	return {
		passed:
			matches.length >= 1 &&
			matches.length <= 2 &&
			matches.some((e) => e.recurrence !== null),
		expected: `1-2 ${label} events, at least one carrying a recurrence rule (not expanded instances)`,
		actual:
			matches.length === 0 ? "no matching event" : matches.map(renderEvent).join(" | "),
	};
}

const mapleVineText = sampleText("maple-vine-lease");
const scholarshipText = sampleText("scholarship-award");
const insuranceText = sampleText("auto-insurance-summary");
const gymText = fixtureText("gym-contract");
const recipeText = fixtureText("vegetable-soup-recipe");
const benefitsText = fixtureText("benefits-enrollment-notice");
const invoiceText = fixtureText("consulting-invoice");
const juryText = fixtureText("jury-summons");

const cases: EvalCase<PaperworkEvalInput, ObligationExtraction>[] = [
	{
		id: "paperwork-lease",
		description:
			"Bundled lease sample - stated end date, computed 60-day non-renewal deadline (month-boundary arithmetic), recurring rent, stated inspection date, and a deliberately unresolvable renewal-offer date (anniversary never defined)",
		input: { documentText: mapleVineText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "HEADLINE: non-renewal notice deadline computed to the day (2027-08-31 minus 60 days = 2027-07-02)",
				run: (x) =>
					hasEvent(x, "non-renewal notice deadline on 2027-07-02, basis computed", {
						keyword: /non-?renewal|sixty|60/,
						date: "2027-07-02",
						basis: ["computed"],
					}),
			},
			{
				name: "move-out inspection extracted as stated 2027-09-01",
				run: (x) =>
					hasEvent(x, "move-out inspection on 2027-09-01, basis stated", {
						keyword: /inspection/,
						date: "2027-09-01",
						basis: ["stated"],
					}),
			},
			{
				name: "rent is one recurring monthly event on the 1st, not expanded",
				run: (x) => notExpanded(x, /rent/, "rent"),
			},
			{
				name: "FABRICATION GUARD: the anniversary-based renewal offer is unresolved with date null",
				run: (x) =>
					hasEvent(x, "renewal-offer event with date null and basis unresolved", {
						keyword: /renewal offer|anniversary/,
						date: null,
						basis: ["unresolved"],
					}),
			},
			{
				name: "FABRICATION GUARD: no unresolved event carries a date",
				run: noFabricatedDates,
			},
			{
				name: "every source excerpt appears verbatim in the lease",
				run: (x) => excerptsAreVerbatim(x, mapleVineText),
			},
		],
	},
	{
		id: "paperwork-scholarship",
		description:
			"Bundled scholarship sample - stated acceptance deadline, enrollment verification computed from the stated semester start, yearly GPA report recurrence, and one already-passed date",
		input: { documentText: scholarshipText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "acceptance deadline extracted as stated 2026-08-15",
				run: (x) =>
					hasEvent(x, "acceptance deadline on 2026-08-15, basis stated", {
						keyword: /accept/,
						date: "2026-08-15",
						basis: ["stated"],
					}),
			},
			{
				name: "enrollment verification computed (2026-09-08 plus 14 days = 2026-09-22)",
				run: (x) =>
					hasEvent(x, "enrollment verification on 2026-09-22, basis computed", {
						keyword: /enrollment verification|proof of/,
						date: "2026-09-22",
						basis: ["computed"],
					}),
			},
			{
				name: "annual GPA report is a yearly recurrence",
				run: (x) =>
					hasEvent(x, "GPA report with yearly recurrence", {
						keyword: /gpa|transcript/,
						recurrenceFrequency: "yearly",
					}),
			},
			{
				name: "the closed housing-grant date (2026-06-01) is flagged in_past",
				run: (x) =>
					hasEvent(x, "housing grant deadline flagged as already passed", {
						keyword: /housing/,
						date: "2026-06-01",
						inPast: true,
					}),
			},
			{
				name: "every source excerpt appears verbatim in the letter",
				run: (x) => excerptsAreVerbatim(x, scholarshipText),
			},
		],
	},
	{
		id: "paperwork-insurance",
		description:
			"Bundled insurance sample - stated policy expiration, cancellation notice computed across a YEAR boundary (2027-01-14 minus 30 days), monthly premium recurrence on the 15th",
		input: { documentText: insuranceText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "policy expiration extracted as stated 2027-01-14",
				run: (x) =>
					hasEvent(x, "policy expiration on 2027-01-14, basis stated", {
						keyword: /expir|policy period|renew/,
						date: "2027-01-14",
					}),
			},
			{
				name: "HEADLINE: cancellation notice computed across the year boundary (2027-01-14 minus 30 days = 2026-12-15)",
				run: (x) =>
					hasEvent(x, "cancellation notice deadline on 2026-12-15, basis computed", {
						keyword: /cancel/,
						date: "2026-12-15",
						basis: ["computed"],
					}),
			},
			{
				name: "premium is one recurring monthly event on the 15th, not expanded",
				run: (x) => notExpanded(x, /premium|installment/, "premium"),
			},
			{
				name: "renewal offer mail date extracted as stated 2026-12-01",
				run: (x) =>
					hasEvent(x, "renewal offer mailed on 2026-12-01, basis stated", {
						keyword: /renewal offer|mailed/,
						date: "2026-12-01",
						basis: ["stated"],
					}),
			},
			{
				name: "every source excerpt appears verbatim in the summary",
				run: (x) => excerptsAreVerbatim(x, insuranceText),
			},
		],
	},
	{
		id: "paperwork-gym-contract",
		description:
			"Gym contract - cancellation deadline computed 45 days before term end across February (2027-03-01 minus 45 days = 2027-01-15), monthly dues on the 5th, yearly maintenance fee",
		input: { documentText: gymText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "HEADLINE: cancellation notice computed across short-February (2027-03-01 minus 45 days = 2027-01-15)",
				run: (x) =>
					hasEvent(x, "cancellation notice deadline on 2027-01-15, basis computed", {
						keyword: /cancel/,
						date: "2027-01-15",
						basis: ["computed"],
					}),
			},
			{
				name: "monthly dues recur on the 5th",
				run: (x) =>
					hasEvent(x, "dues with monthly recurrence on day 5", {
						keyword: /dues/,
						recurrenceFrequency: "monthly",
						recurrenceDayOfMonth: 5,
					}),
			},
			{
				name: "annual maintenance fee is a yearly recurrence",
				run: (x) =>
					hasEvent(x, "maintenance fee with yearly recurrence", {
						keyword: /maintenance fee/,
						recurrenceFrequency: "yearly",
					}),
			},
			{
				name: "every source excerpt appears verbatim in the contract",
				run: (x) => excerptsAreVerbatim(x, gymText),
			},
		],
	},
	{
		id: "paperwork-invoice-net30",
		description:
			"Invoice with net-30 terms from January 31, 2028 - leap-year arithmetic (2028-01-31 plus 30 days = 2028-03-01) plus an early-payment discount window",
		input: { documentText: invoiceText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "HEADLINE: payment due computed across leap-February (2028-01-31 plus 30 days = 2028-03-01)",
				run: (x) =>
					hasEvent(x, "payment due on 2028-03-01, basis computed", {
						keyword: /payment|due/,
						date: "2028-03-01",
						basis: ["computed"],
					}),
			},
			{
				name: "early-payment discount window computed (2028-01-31 plus 10 days = 2028-02-10)",
				run: (x) =>
					hasEvent(x, "discount deadline on 2028-02-10, basis computed", {
						keyword: /discount/,
						date: "2028-02-10",
						basis: ["computed"],
					}),
			},
			{
				name: "every source excerpt appears verbatim in the invoice",
				run: (x) => excerptsAreVerbatim(x, invoiceText),
			},
		],
	},
	{
		id: "paperwork-benefits-unresolvable",
		description:
			"Benefits notice whose deadlines all hinge on a hire date the document never states - everything datable must come back unresolved, never guessed",
		input: { documentText: benefitsText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "health enrollment (60 days after hire) is unresolved with date null",
				run: (x) =>
					hasEvent(x, "health enrollment deadline unresolved, date null", {
						keyword: /health|enroll/,
						date: null,
						basis: ["unresolved"],
					}),
			},
			{
				name: "the unresolved event carries a structured resolution (anchor + offset) for the client-side resolve flow",
				run: (x) =>
					setContains(
						x.events,
						"an unresolved event with resolution naming the hire date and a 60- or 90-day offset",
						(e) =>
							e.date_basis === "unresolved" &&
							e.resolution !== null &&
							/hire/.test(normalized(e.resolution.anchor_label)) &&
							(e.resolution.offset_days === 60 || e.resolution.offset_days === 90),
						renderEvent,
					),
			},
			{
				name: "FABRICATION GUARD: no unresolved event carries a date",
				run: noFabricatedDates,
			},
			{
				name: "every source excerpt appears verbatim in the notice",
				run: (x) => excerptsAreVerbatim(x, benefitsText),
			},
		],
	},
	{
		id: "paperwork-jury-summons",
		description:
			"Jury summons with only stated dates - extraction restraint: both dates exact, nothing invented",
		input: { documentText: juryText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "report date extracted as stated 2026-09-14",
				run: (x) =>
					hasEvent(x, "jury report date on 2026-09-14, basis stated", {
						keyword: /report|appear|assembly/,
						date: "2026-09-14",
						basis: ["stated"],
					}),
			},
			{
				name: "confirmation deadline extracted as stated 2026-09-07",
				run: (x) =>
					hasEvent(x, "confirmation deadline on 2026-09-07, basis stated", {
						keyword: /confirm/,
						date: "2026-09-07",
						basis: ["stated"],
					}),
			},
			{
				name: "no invented dated events (2 planted dates, ≤ 3 events)",
				run: (x) => ({
					passed: x.events.length <= 3,
					expected: "at most 3 events",
					actual: `${x.events.length} events: ${x.events.map(renderEvent).join(" | ")}`,
				}),
			},
			{
				name: "every source excerpt appears verbatim in the summons",
				run: (x) => excerptsAreVerbatim(x, juryText),
			},
		],
	},
	{
		id: "paperwork-not-a-document",
		description:
			"A soup recipe - must be rejected as not an obligation document, with no events",
		input: { documentText: recipeText, todayIso: SAMPLE_TODAY },
		checks: [
			{
				name: "is_obligation_document is false",
				run: (x) => fieldEquals(x.is_obligation_document, false),
			},
			{
				name: "no events extracted",
				run: (x) => ({
					passed: x.events.length === 0,
					expected: "0 events",
					actual: `${x.events.length} events`,
				}),
			},
		],
	},
];

// Match worker/index.ts: PAPERWORK_MODEL overrides the pipeline default, so
// the suite always runs whatever model production runs.
const model = process.env.PAPERWORK_MODEL ?? EXTRACT_OBLIGATIONS_DEFAULT_MODEL;

export const paperworkSuite = defineSuite({
	project_id: "paperwork-to-calendar",
	project_label: "Paperwork → Calendar",
	model,
	prompt: EXTRACT_OBLIGATIONS_SYSTEM_PROMPT,
	cases,
	execute: (client, input) =>
		extractObligations(client, { documentText: input.documentText }, input.todayIso, model),
});
