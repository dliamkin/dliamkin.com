import { describe, expect, it } from "vitest";
import {
	buildWaveCommand,
	upgradePlanToMarkdown,
	validatePlanRequestFacts,
	validateUpgradePlan,
	type PlanRequestFact,
	type UpgradePlan,
} from "../upgrade-planner";

// The anti-hallucination gate for the Upgrade Planner: post-validation strips
// anything the model invented, and the commands are rebuilt from facts. No
// model, no network.

const fact = (overrides: Partial<PlanRequestFact> & { name: string }): PlanRequestFact => ({
	section: "dependencies",
	declared_range: "^1.0.0",
	resolved_floor: "1.0.0",
	latest: "2.0.0",
	majors_behind: 1,
	minors_behind: 0,
	patches_behind: 0,
	is_current: false,
	floor_deprecated: false,
	latest_deprecated: false,
	deprecation_message: null,
	peer_conflicts: [],
	...overrides,
});

const FACTS: PlanRequestFact[] = [
	fact({ name: "vue", latest: "3.5.13" }),
	fact({ name: "vitest", latest: "2.1.0", section: "devDependencies" }),
	fact({ name: "lodash", latest: "4.17.21", is_current: true, majors_behind: 0 }),
];

const plan = (overrides: Partial<UpgradePlan>): UpgradePlan => ({
	summary: "Two packages behind.",
	already_current: ["lodash"],
	plans: [
		{
			name: "vue",
			target_version: "3.5.13",
			tier: "breaking_likely",
			rationale: "Major bump.",
			breaking_notes: [],
		},
		{
			name: "vitest",
			target_version: "2.1.0",
			tier: "needs_testing",
			rationale: "Test runner.",
			breaking_notes: [],
		},
	],
	waves: [
		{
			order: 1,
			title: "Wave 1: Tooling",
			packages: ["vitest"],
			command: "model-written command (ignored)",
			verify_after: "npm test",
			rationale: "Tooling first.",
		},
		{
			order: 2,
			title: "Wave 2: Framework",
			packages: ["vue"],
			command: "model-written command (ignored)",
			verify_after: "npm run build",
			rationale: "Framework after.",
		},
	],
	peer_conflict_guidance: [],
	deprecated_alerts: [],
	general_advice: [],
	...overrides,
});

describe("validateUpgradePlan", () => {
	it("passes a clean plan through with zero warnings and rebuilt commands", () => {
		const result = validateUpgradePlan(plan({}), FACTS);
		expect(result.validation_warnings).toEqual([]);
		expect(result.waves[0]?.command).toBe("npm install -D vitest@2.1.0");
		expect(result.waves[1]?.command).toBe("npm install vue@3.5.13");
	});

	it("strips a plan whose target_version is not the computed latest", () => {
		const tampered = plan({});
		tampered.plans[0]!.target_version = "3.9.9"; // invented version
		const result = validateUpgradePlan(tampered, FACTS);
		expect(result.plans.map((p) => p.name)).toEqual(["vitest"]);
		// plan dropped + name dropped from its wave + emptied wave dropped
		expect(result.validation_warnings).toHaveLength(3);
		expect(result.waves).toHaveLength(1); // the emptied framework wave is gone
		expect(result.waves[0]?.order).toBe(1);
	});

	it("strips a plan for a package not in the facts", () => {
		const tampered = plan({});
		tampered.plans.push({
			name: "invented-pkg",
			target_version: "1.0.0",
			tier: "safe_now",
			rationale: "Made up.",
			breaking_notes: [],
		});
		const result = validateUpgradePlan(tampered, FACTS);
		expect(result.plans.map((p) => p.name)).toEqual(["vue", "vitest"]);
		expect(result.validation_warnings[0]).toContain("invented-pkg");
	});

	it("drops already_current entries that are not facts or that also have plans", () => {
		const tampered = plan({ already_current: ["lodash", "ghost-pkg", "vue"] });
		const result = validateUpgradePlan(tampered, FACTS);
		expect(result.already_current).toEqual(["lodash"]);
		expect(result.validation_warnings).toHaveLength(2);
	});

	it("renumbers waves 1..n after sorting by the model's order", () => {
		const shuffled = plan({});
		shuffled.waves[0]!.order = 7;
		shuffled.waves[1]!.order = 3;
		const result = validateUpgradePlan(shuffled, FACTS);
		expect(result.waves.map((w) => [w.order, w.packages[0]])).toEqual([
			[1, "vue"],
			[2, "vitest"],
		]);
	});

	it("caps general_advice at 3 entries", () => {
		const chatty = plan({ general_advice: ["a", "b", "c", "d", "e"] });
		expect(validateUpgradePlan(chatty, FACTS).general_advice).toEqual(["a", "b", "c"]);
	});
});

describe("buildWaveCommand", () => {
	it("splits runtime and dev dependencies into separate installs", () => {
		const byName = new Map(FACTS.map((f) => [f.name, f]));
		expect(buildWaveCommand(["vue", "vitest"], byName)).toBe(
			"npm install vue@3.5.13 && npm install -D vitest@2.1.0",
		);
	});
});

describe("validatePlanRequestFacts", () => {
	it("accepts a round-tripped facts payload", () => {
		const result = validatePlanRequestFacts(JSON.parse(JSON.stringify(FACTS)));
		expect(Array.isArray(result)).toBe(true);
	});

	it("rejects empty, oversized, and malformed payloads with messages", () => {
		expect(validatePlanRequestFacts([])).toContain("non-empty");
		expect(validatePlanRequestFacts([{ name: "x" }])).toContain("invalid section");
		expect(
			validatePlanRequestFacts(
				Array.from({ length: 151 }, (_, i) => fact({ name: `p${i}` })),
			),
		).toContain("at most 150");
		expect(validatePlanRequestFacts([fact({ name: "a" }), fact({ name: "a" })])).toContain(
			"Duplicate",
		);
	});

	it("rejects strings past their field caps", () => {
		const oversized = fact({ name: "a", deprecation_message: "x".repeat(501) });
		expect(validatePlanRequestFacts([oversized])).toContain("deprecation_message");
	});
});

describe("upgradePlanToMarkdown", () => {
	it("renders versions from the facts and labels model-knowledge notes", () => {
		const withNotes = plan({});
		withNotes.plans[0]!.breaking_notes = [
			{ note: "Options API default changed.", confidence: "medium" },
		];
		const result = validateUpgradePlan(withNotes, FACTS);
		const markdown = upgradePlanToMarkdown(result, FACTS, "registry data as of 2026-07-09");
		expect(markdown).toContain("**vue** ^1.0.0 → 3.5.13");
		expect(markdown).toContain("npm install vue@3.5.13");
		expect(markdown).toContain("medium confidence - verify against the changelog");
		expect(markdown).toContain("registry data as of 2026-07-09");
	});
});
