import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	COMPARE_LEASES_SYSTEM_PROMPT,
	type LeaseChange,
	type LeaseComparison,
} from "../../../src/lib/lease-diff";
import {
	COMPARE_LEASES_DEFAULT_MODEL,
	compareLeases,
} from "../../../src/lib/pipelines/compare-leases";
import {
	countAtMost,
	defineSuite,
	normalized,
	setContains,
	setLacks,
	type EvalCase,
} from "../harness";
import type { CheckResult } from "../../../src/lib/evals";

// Eval suite for the Lease Diff Explainer. Each lease pair was authored with
// a known list of planted changes, so the checks are ground-truth assertions:
// one set-contains check per planted change (category + impact + a keyword
// binding it to the right clause), impact-bias checks on the tenant-favorable
// changes in the month-to-month pair, and a no-invented-changes count guard.
// Pair 3 tests false-positive restraint: a clause reworded with identical
// meaning must NOT be reported, while a real fee increase hidden inside
// similar rewording must be.

const dataDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../src/data/lease-samples",
);
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

const samplePair = (id: string) => ({
	originalText: readFileSync(path.join(dataDir, `${id}-original.txt`), "utf8"),
	revisedText: readFileSync(path.join(dataDir, `${id}-revised.txt`), "utf8"),
});
const fixturePair = (id: string) => ({
	originalText: readFileSync(path.join(fixtureDir, `${id}-original.txt`), "utf8"),
	revisedText: readFileSync(path.join(fixtureDir, `${id}-revised.txt`), "utf8"),
});

interface LeasePairInput {
	originalText: string;
	revisedText: string;
}

const renderChange = (c: LeaseChange) =>
	`"${c.title}" [${c.category}, ${c.impact}, ${c.severity}]`;

interface ChangeSpec {
	categories: LeaseChange["category"][]; // acceptable categorizations
	impacts?: LeaseChange["impact"][]; // acceptable impact judgments
	keyword: RegExp; // binds the match to the planted clause (searched
	// across the whole change object, normalized)
}

function hasChange(
	comparison: LeaseComparison,
	expected: string,
	spec: ChangeSpec,
): CheckResult {
	return setContains(
		comparison.changes,
		expected,
		(c) =>
			spec.categories.includes(c.category) &&
			(spec.impacts === undefined || spec.impacts.includes(c.impact)) &&
			spec.keyword.test(normalized(JSON.stringify(c))),
		renderChange,
	);
}

const cases: EvalCase<LeasePairInput, LeaseComparison>[] = [
	{
		id: "lease-residential-renewal",
		description:
			"Bundled renewal pair - 8 planted landlord-favoring changes: rent +$145, auto-renewal added, water shifted to tenant, lawn care shifted to tenant, guest limit halved, notice 30→60 days, new pet fee, new early-termination fee",
		input: samplePair("residential-renewal"),
		checks: [
			{
				name: "finds the rent increase to $1,595 (rent_and_deposits, favors landlord)",
				run: (c) =>
					hasChange(c, "rent increase to $1,595", {
						categories: ["rent_and_deposits"],
						impacts: ["favors_landlord"],
						keyword: /1,?595/,
					}),
			},
			{
				name: "finds the new automatic-renewal clause (term_and_renewal, favors landlord)",
				run: (c) =>
					hasChange(c, "automatic renewal added", {
						categories: ["term_and_renewal"],
						impacts: ["favors_landlord"],
						keyword: /renew/,
					}),
			},
			{
				name: "finds water shifted from landlord to tenant (utilities, favors landlord)",
				run: (c) =>
					hasChange(c, "water responsibility shifted to tenant", {
						categories: ["utilities"],
						impacts: ["favors_landlord"],
						keyword: /water/,
					}),
			},
			{
				name: "finds lawn care shifted to tenant (maintenance, favors landlord)",
				run: (c) =>
					hasChange(c, "lawn care shifted to tenant", {
						categories: ["maintenance_and_repairs"],
						impacts: ["favors_landlord"],
						keyword: /lawn/,
					}),
			},
			{
				name: "finds the guest limit cut from 14 to 7 days (rules_and_use, favors landlord)",
				run: (c) =>
					hasChange(c, "guest stay limit halved", {
						categories: ["rules_and_use"],
						impacts: ["favors_landlord"],
						keyword: /guest/,
					}),
			},
			{
				name: "finds notice to vacate extended 30→60 days (favors landlord)",
				run: (c) =>
					hasChange(c, "notice to vacate 30 → 60 days", {
						categories: ["term_and_renewal", "termination"],
						impacts: ["favors_landlord"],
						keyword: /notice/,
					}),
			},
			{
				name: "finds the new monthly pet fee (fees)",
				run: (c) =>
					hasChange(c, "new $35/month pet fee", {
						categories: ["fees"],
						// Grants a pet right while adding a fee - landlord-favoring
						// is expected, but "unclear" is a defensible judgment.
						impacts: ["favors_landlord", "unclear"],
						keyword: /pet/,
					}),
			},
			{
				name: "finds the new early-termination fee (favors landlord)",
				run: (c) =>
					hasChange(c, "new early-termination fee of two months' rent", {
						categories: ["termination", "fees"],
						impacts: ["favors_landlord"],
						keyword: /early/,
					}),
			},
			{
				name: "no invented changes (8 planted, ≤ 9 reported)",
				run: (c) => countAtMost(c.changes.length, 9, "reported changes"),
			},
		],
	},
	{
		id: "lease-month-to-month",
		description:
			"Bundled month-to-month pair - 7 planted concepts including two tenant-favorable changes that must not be mislabeled: term conversion, +$50 premium, late grace 3→5 days (favors tenant), deposit return 21→14 days (favors tenant), termination rework, entry notice 48→24h, new insurance requirement",
		input: samplePair("month-to-month"),
		checks: [
			{
				name: "finds the fixed-term → month-to-month conversion (term_and_renewal)",
				run: (c) =>
					hasChange(c, "conversion to month-to-month", {
						categories: ["term_and_renewal"],
						// Cuts both ways (flexibility vs. security) - a one-sided
						// judgment either way would be wrong.
						impacts: ["unclear", "neutral"],
						keyword: /month[ -]?to[ -]?month/,
					}),
			},
			{
				name: "finds the $50 month-to-month premium (favors landlord)",
				run: (c) =>
					hasChange(c, "new $50/month premium", {
						categories: ["rent_and_deposits", "fees"],
						impacts: ["favors_landlord"],
						keyword: /premium|1,?325/,
					}),
			},
			{
				name: "BIAS CHECK: late-fee grace 3→5 days is favors_tenant",
				run: (c) =>
					hasChange(c, "late-fee grace period lengthened, judged favors_tenant", {
						categories: ["fees"],
						impacts: ["favors_tenant"],
						keyword: /late/,
					}),
			},
			{
				name: "BIAS CHECK: deposit return 21→14 days is favors_tenant",
				run: (c) =>
					hasChange(c, "deposit return window shortened, judged favors_tenant", {
						categories: ["rent_and_deposits"],
						impacts: ["favors_tenant"],
						keyword: /deposit/,
					}),
			},
			{
				// The penalty removal shares Section 5 with the landlord's new
				// termination right, and the prompt tells the model it may merge
				// fragments of one clause. So accept both shapes: reported
				// separately it must be favors_tenant; merged with the opposing
				// change (detected by the either-party/30-day language in the same
				// entry) "unclear" is the correct judgment, not a bias miss.
				name: "finds the lease-break penalty removal (favors_tenant, or unclear when merged with the landlord's new termination right)",
				run: (c) =>
					setContains(
						c.changes,
						"lease-break penalty removed (favors_tenant alone, or unclear when merged)",
						(change) => {
							const text = normalized(JSON.stringify(change));
							if (change.category !== "termination" || !/penalty|break/.test(text)) {
								return false;
							}
							return (
								change.impact === "favors_tenant" ||
								(change.impact === "unclear" &&
									/either party|thirty|30/.test(text))
							);
						},
						renderChange,
					),
			},
			{
				name: "finds the landlord's new right to terminate at will (favors landlord)",
				run: (c) =>
					hasChange(c, "landlord can now terminate with 30 days' notice", {
						categories: ["termination", "term_and_renewal"],
						impacts: ["favors_landlord", "unclear"],
						keyword: /terminat/,
					}),
			},
			{
				name: "finds entry notice cut 48→24 hours (entry_and_privacy, favors landlord)",
				run: (c) =>
					hasChange(c, "entry notice halved to 24 hours", {
						categories: ["entry_and_privacy"],
						impacts: ["favors_landlord"],
						keyword: /entry|24/,
					}),
			},
			{
				name: "finds the new renter's-insurance requirement (favors landlord)",
				run: (c) =>
					hasChange(c, "renter's insurance now required", {
						categories: ["liability_and_insurance"],
						impacts: ["favors_landlord"],
						keyword: /insurance/,
					}),
			},
			{
				name: "no invented changes (8 planted counting the termination rework as two, ≤ 9 reported)",
				run: (c) => countAtMost(c.changes.length, 9, "reported changes"),
			},
		],
	},
	{
		id: "lease-late-fee-rewording",
		description:
			"False-positive restraint pair - the maintenance clause is reworded with identical meaning (must NOT be reported); the late fee quietly rises $50→$75 inside similar rewording (must be reported)",
		input: fixturePair("late-fee-rewording"),
		checks: [
			{
				name: "finds the late fee increase to $75 buried in the rewording (favors landlord)",
				run: (c) =>
					hasChange(c, "late fee $50 → $75", {
						categories: ["fees"],
						impacts: ["favors_landlord"],
						keyword: /75/,
					}),
			},
			{
				// A neutral, low-severity "clause was reworded" note is acceptable
				// restraint; treating the rewording as a real shift (non-neutral
				// impact, or medium/high severity) is the false positive.
				name: "does not report the identically-meaning maintenance rewording as substantive",
				run: (c) =>
					setLacks(
						c.changes,
						"treating the reworded maintenance/cleanliness clause as a substantive change",
						(change) =>
							/plumbing|sanitary|maintenance/.test(normalized(JSON.stringify(change))) &&
							(change.impact !== "neutral" || change.severity !== "low"),
						renderChange,
					),
			},
			{
				name: "no invented changes (1 planted, ≤ 2 reported)",
				run: (c) => countAtMost(c.changes.length, 2, "reported changes"),
			},
		],
	},
];

// Match worker/index.ts: LEASE_DIFF_MODEL overrides the pipeline default, so
// the suite always runs whatever model production runs.
const model = process.env.LEASE_DIFF_MODEL ?? COMPARE_LEASES_DEFAULT_MODEL;

export const leaseDiffSuite = defineSuite({
	project_id: "lease-diff",
	project_label: "Lease Diff Explainer",
	model,
	prompt: COMPARE_LEASES_SYSTEM_PROMPT,
	cases,
	execute: (client, input) =>
		compareLeases(client, input.originalText, input.revisedText, model),
});
