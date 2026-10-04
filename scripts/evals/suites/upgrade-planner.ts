import type { CheckResult } from "../../../src/lib/evals";
import {
	PLAN_UPGRADES_DEFAULT_MODEL,
	planUpgrades,
} from "../../../src/lib/pipelines/plan-upgrades";
import {
	PLAN_UPGRADES_SYSTEM_PROMPT,
	type PlanRequestFact,
	type RiskTier,
	type UpgradePlanResult,
} from "../../../src/lib/upgrade-planner";
import { arrayIsEmpty, arrayNonEmpty, defineSuite, normalized, setContains, type EvalCase } from "../harness";

// Eval suite for the Dependency Upgrade Planner. The registry layer is not
// involved at all: every case feeds hand-built PlanRequestFact fixtures (the
// deterministic layer has its own unit tests in src/lib/__tests__), so the
// only thing measured - and the only thing spent - is the synthesis call.
// The headline check is anti-hallucination: planUpgrades post-validates the
// model's output against the facts and strips violations into
// validation_warnings, so "zero warnings" means every version the model named
// was one the deterministic layer provided.

function fact(overrides: Partial<PlanRequestFact> & { name: string; latest: string }): PlanRequestFact {
	return {
		section: "dependencies",
		declared_range: "^1.0.0",
		resolved_floor: "1.0.0",
		majors_behind: 0,
		minors_behind: 0,
		patches_behind: 0,
		is_current: false,
		floor_deprecated: false,
		latest_deprecated: false,
		deprecation_message: null,
		peer_conflicts: [],
		...overrides,
	};
}

const renderPlan = (output: UpgradePlanResult) =>
	output.plans.map((p) => `${p.name}→${p.target_version} [${p.tier}]`).join(" | ");

function tierIs(output: UpgradePlanResult, name: string, expected: RiskTier[]): CheckResult {
	const entry = output.plans.find((p) => p.name === name);
	return {
		passed: entry !== undefined && expected.includes(entry.tier),
		expected: `${name} tiered ${expected.join(" or ")}`,
		actual: entry ? `${name} tiered ${entry.tier}` : `no plan entry for ${name}: ${renderPlan(output)}`,
	};
}

function waveOrderOf(output: UpgradePlanResult, name: string): number | null {
	const wave = output.waves.find((w) => w.packages.includes(name));
	return wave?.order ?? null;
}

// The anti-hallucination headline: post-validation found nothing to strip, so
// every package name and target_version in the plan came from the fixture.
function noInventedVersions(output: UpgradePlanResult): CheckResult {
	return {
		passed: output.validation_warnings.length === 0,
		expected: "validation_warnings empty (no invented packages or versions)",
		actual:
			output.validation_warnings.length === 0
				? "empty"
				: output.validation_warnings.join(" | "),
	};
}

function sharesWave(output: UpgradePlanResult, names: string[]): CheckResult {
	const orders = names.map((name) => waveOrderOf(output, name));
	const detail = names.map((name, i) => `${name}: wave ${orders[i] ?? "none"}`).join(", ");
	return {
		passed: orders.every((order) => order !== null && order === orders[0]),
		expected: `${names.join(", ")} grouped in the same wave`,
		actual: detail,
	};
}

// The dependent must never be sequenced BEFORE the package its peer
// requirement needs (same wave - upgraded together - also resolves the
// conflict, so ≤ is the correct deterministic assertion).
function sequencedAfterOrWith(
	output: UpgradePlanResult,
	requirement: string,
	dependent: string,
): CheckResult {
	const reqOrder = waveOrderOf(output, requirement);
	const depOrder = waveOrderOf(output, dependent);
	return {
		passed: reqOrder !== null && depOrder !== null && reqOrder <= depOrder,
		expected: `${requirement} (wave n) upgraded no later than ${dependent} (wave ≥ n)`,
		actual: `${requirement}: wave ${reqOrder ?? "none"}, ${dependent}: wave ${depOrder ?? "none"}`,
	};
}

// ---------------------------------------------------------------------------
// Fixtures. Real package names and plausible versions so the model's training
// knowledge engages the way it would on a live request.

const legacyVueStack: PlanRequestFact[] = [
	fact({
		name: "vue",
		declared_range: "^2.6.10",
		resolved_floor: "2.6.14",
		latest: "3.5.39",
		majors_behind: 1,
	}),
	fact({
		name: "vuex",
		declared_range: "^3.6.2",
		resolved_floor: "3.6.2",
		latest: "4.1.0",
		majors_behind: 1,
		peer_conflicts: [
			"vuex@4.1.0 requires vue ^3.2.0, but your declared range for vue is ^2.6.10 - upgrade vue first (its latest 3.5.39 satisfies the requirement).",
		],
	}),
	fact({
		name: "vue-router",
		declared_range: "^3.6.5",
		resolved_floor: "3.6.5",
		latest: "5.1.0",
		majors_behind: 2,
		peer_conflicts: [
			"vue-router@5.1.0 requires vue ^3.5.34, but your declared range for vue is ^2.6.10 - upgrade vue first (its latest 3.5.39 satisfies the requirement).",
		],
	}),
	fact({
		name: "request",
		declared_range: "~2.79.0",
		resolved_floor: "2.79.0",
		latest: "2.88.2",
		minors_behind: 9,
		latest_deprecated: true,
		floor_deprecated: true,
		deprecation_message: "request has been deprecated, see https://github.com/request/request/issues/3142",
	}),
	fact({
		name: "lodash",
		declared_range: "4.17.19",
		resolved_floor: "4.17.19",
		latest: "4.17.21",
		patches_behind: 2,
	}),
	fact({
		name: "typescript",
		section: "devDependencies",
		declared_range: "~5.6.0",
		resolved_floor: "5.6.0",
		latest: "5.6.3",
		is_current: true,
	}),
];

const coupledEcosystem: PlanRequestFact[] = [
	fact({
		name: "vue",
		declared_range: "^2.7.16",
		resolved_floor: "2.7.16",
		latest: "3.5.39",
		majors_behind: 1,
	}),
	fact({
		name: "vue-router",
		declared_range: "^3.6.5",
		resolved_floor: "3.6.5",
		latest: "5.1.0",
		majors_behind: 2,
		peer_conflicts: [
			"vue-router@5.1.0 requires vue ^3.5.34, but your declared range for vue is ^2.7.16 - upgrade vue first (its latest 3.5.39 satisfies the requirement).",
		],
	}),
	fact({
		name: "vuex",
		declared_range: "^3.6.2",
		resolved_floor: "3.6.2",
		latest: "4.1.0",
		majors_behind: 1,
		peer_conflicts: [
			"vuex@4.1.0 requires vue ^3.2.0, but your declared range for vue is ^2.7.16 - upgrade vue first (its latest 3.5.39 satisfies the requirement).",
		],
	}),
	fact({
		name: "axios",
		declared_range: "^1.7.0",
		resolved_floor: "1.7.0",
		latest: "1.18.1",
		is_current: true,
	}),
];

const quietCurrent: PlanRequestFact[] = [
	fact({ name: "express", declared_range: "^5.2.0", resolved_floor: "5.2.0", latest: "5.2.1", is_current: true }),
	fact({ name: "cors", declared_range: "^2.8.6", resolved_floor: "2.8.6", latest: "2.8.6", is_current: true }),
	fact({ name: "helmet", declared_range: "^8.2.0", resolved_floor: "8.2.0", latest: "8.2.0", is_current: true }),
	fact({
		name: "zod",
		declared_range: "^4.4.0",
		resolved_floor: "4.4.0",
		latest: "4.4.3",
		is_current: true,
	}),
];

const patchUtilities: PlanRequestFact[] = [
	fact({
		name: "lodash",
		declared_range: "4.17.19",
		resolved_floor: "4.17.19",
		latest: "4.17.21",
		patches_behind: 2,
	}),
	fact({
		name: "debug",
		section: "devDependencies",
		declared_range: "~4.3.4",
		resolved_floor: "4.3.4",
		latest: "4.4.0",
		minors_behind: 1,
	}),
];

const deprecatedOnly: PlanRequestFact[] = [
	fact({
		name: "moment",
		declared_range: "^2.29.1",
		resolved_floor: "2.29.1",
		latest: "2.30.1",
		minors_behind: 1,
		latest_deprecated: true,
		floor_deprecated: true,
		deprecation_message:
			"Moment.js is a legacy project in maintenance mode, consider Luxon, Day.js, or date-fns.",
	}),
	fact({ name: "express", declared_range: "^5.2.0", resolved_floor: "5.2.0", latest: "5.2.1", is_current: true }),
];

const reactMajors: PlanRequestFact[] = [
	fact({
		name: "react",
		declared_range: "^16.14.0",
		resolved_floor: "16.14.0",
		latest: "19.2.0",
		majors_behind: 3,
	}),
	fact({
		name: "react-dom",
		declared_range: "^16.14.0",
		resolved_floor: "16.14.0",
		latest: "19.2.0",
		majors_behind: 3,
		peer_conflicts: [
			"react-dom@19.2.0 requires react ^19.2.0, but your declared range for react is ^16.14.0 - upgrade react first (its latest 19.2.0 satisfies the requirement).",
		],
	}),
	fact({
		name: "classnames",
		declared_range: "2.5.0",
		resolved_floor: "2.5.0",
		latest: "2.5.1",
		patches_behind: 1,
	}),
];

// ---------------------------------------------------------------------------

const cases: EvalCase<PlanRequestFact[], UpgradePlanResult>[] = [
	{
		id: "planner-legacy-vue-stack",
		description:
			"A Vue 2-era stack - deprecated request, 2-majors-behind vue-router, patch-behind lodash, and peer conflicts pointing at vue: tiers, alerts, and sequencing all at once",
		input: legacyVueStack,
		checks: [
			{
				name: "HEADLINE: no invented versions (post-validation stripped nothing)",
				run: noInventedVersions,
			},
			{
				name: "deprecated request is tiered breaking_likely",
				run: (x) => tierIs(x, "request", ["breaking_likely"]),
			},
			{
				name: "request appears in deprecated_alerts",
				run: (x) =>
					setContains(
						x.deprecated_alerts,
						"an alert naming request",
						(alert) => normalized(alert).includes("request"),
						(alert) => alert,
					),
			},
			{
				name: "2-majors-behind vue-router is tiered breaking_likely",
				run: (x) => tierIs(x, "vue-router", ["breaking_likely"]),
			},
			{
				name: "patch-behind lodash is tiered safe_now",
				run: (x) => tierIs(x, "lodash", ["safe_now"]),
			},
			{
				name: "peer conflicts yield sequencing guidance",
				run: (x) => arrayNonEmpty(x.peer_conflict_guidance),
			},
			{
				name: "vuex is never sequenced before vue (its peer requirement)",
				run: (x) => sequencedAfterOrWith(x, "vue", "vuex"),
			},
			{
				name: "current typescript is in already_current, not a wave",
				run: (x) => ({
					passed:
						x.already_current.includes("typescript") &&
						waveOrderOf(x, "typescript") === null,
					expected: "typescript in already_current and in no wave",
					actual: `already_current: [${x.already_current.join(", ")}], wave: ${waveOrderOf(x, "typescript") ?? "none"}`,
				}),
			},
		],
	},
	{
		id: "planner-coupled-ecosystem",
		description:
			"vue + vue-router + vuex all major-behind - the tightly coupled framework stack must migrate as one wave",
		input: coupledEcosystem,
		checks: [
			{
				name: "HEADLINE: no invented versions",
				run: noInventedVersions,
			},
			{
				name: "vue, vue-router, and vuex share a wave",
				run: (x) => sharesWave(x, ["vue", "vue-router", "vuex"]),
			},
			{
				name: "current axios stays out of the waves",
				run: (x) => ({
					passed: waveOrderOf(x, "axios") === null,
					expected: "axios in no wave",
					actual: `axios wave: ${waveOrderOf(x, "axios") ?? "none"}`,
				}),
			},
		],
	},
	{
		id: "planner-quiet-current",
		description:
			"A fully current manifest - the honest quiet case: zero waves, zero plans, everything in already_current, no padding",
		input: quietCurrent,
		checks: [
			{
				name: "zero waves",
				run: (x) => ({
					passed: x.waves.length === 0,
					expected: "0 waves",
					actual: `${x.waves.length} waves: ${x.waves.map((w) => w.title).join(" | ")}`,
				}),
			},
			{
				name: "zero package plans",
				run: (x) => ({
					passed: x.plans.length === 0,
					expected: "0 plans",
					actual: renderPlan(x) || "0 plans",
				}),
			},
			{
				name: "all four packages listed already_current",
				run: (x) => ({
					passed: ["express", "cors", "helmet", "zod"].every((name) =>
						x.already_current.includes(name),
					),
					expected: "express, cors, helmet, zod all in already_current",
					actual: `[${x.already_current.join(", ")}]`,
				}),
			},
			{
				name: "no phantom deprecation or conflict guidance",
				run: (x) =>
					x.deprecated_alerts.length === 0
						? arrayIsEmpty(x.peer_conflict_guidance)
						: { passed: false, expected: "no deprecated_alerts", actual: x.deprecated_alerts.join(" | ") },
			},
		],
	},
	{
		id: "planner-patch-utilities",
		description: "Two small bumps - both safe_now, groupable in one quick wave",
		input: patchUtilities,
		checks: [
			{ name: "HEADLINE: no invented versions", run: noInventedVersions },
			{
				name: "patch-behind lodash is safe_now",
				run: (x) => tierIs(x, "lodash", ["safe_now"]),
			},
			{
				name: "minor-behind debug is safe_now or needs_testing (never breaking)",
				run: (x) => tierIs(x, "debug", ["safe_now", "needs_testing"]),
			},
			{
				name: "nothing is tiered breaking_likely",
				run: (x) => ({
					passed: x.plans.every((p) => p.tier !== "breaking_likely"),
					expected: "no breaking_likely tiers for patch/minor bumps",
					actual: renderPlan(x),
				}),
			},
		],
	},
	{
		id: "planner-deprecated-package",
		description:
			"A deprecated (but nearly current) moment - deprecation must dominate the tier and produce an alert",
		input: deprecatedOnly,
		checks: [
			{ name: "HEADLINE: no invented versions", run: noInventedVersions },
			{
				name: "deprecated moment is tiered breaking_likely despite being only a minor behind",
				run: (x) => tierIs(x, "moment", ["breaking_likely"]),
			},
			{
				name: "moment appears in deprecated_alerts",
				run: (x) =>
					setContains(
						x.deprecated_alerts,
						"an alert naming moment",
						(alert) => normalized(alert).includes("moment"),
						(alert) => alert,
					),
			},
		],
	},
	{
		id: "planner-react-majors",
		description:
			"react + react-dom three majors behind with a lockstep peer requirement, plus an unrelated patch bump",
		input: reactMajors,
		checks: [
			{ name: "HEADLINE: no invented versions", run: noInventedVersions },
			{
				name: "3-majors-behind react is breaking_likely",
				run: (x) => tierIs(x, "react", ["breaking_likely"]),
			},
			{
				name: "react-dom is never sequenced before react",
				run: (x) => sequencedAfterOrWith(x, "react", "react-dom"),
			},
			{
				name: "patch-behind classnames is safe_now",
				run: (x) => tierIs(x, "classnames", ["safe_now"]),
			},
		],
	},
];

// Match worker/index.ts: UPGRADE_PLANNER_MODEL overrides the pipeline
// default, so the suite always runs whatever model production runs.
const model = process.env.UPGRADE_PLANNER_MODEL ?? PLAN_UPGRADES_DEFAULT_MODEL;

export const upgradePlannerSuite = defineSuite({
	project_id: "upgrade-planner",
	project_label: "Dependency Upgrade Planner",
	model,
	prompt: PLAN_UPGRADES_SYSTEM_PROMPT,
	cases,
	execute: (client, input) => planUpgrades(client, input, model),
});
