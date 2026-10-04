import type Anthropic from "@anthropic-ai/sdk";
import type { DependencyFact, DependencySection } from "./upgrade-facts";

// Phase 2 of the Dependency Upgrade Planner, shared between the Vue app, the
// Cloudflare Worker (worker/index.ts), scripts/generate-upgrade-samples.mjs,
// and the eval suite. Keep the TypeScript interfaces and the tool JSON schema
// below in 1:1 sync - the schema is what actually constrains the model.
//
// The design rule this file enforces: the model receives computed facts and
// is forbidden from altering them. It selects, tiers, and orders; every
// version number in its output is checked against the facts afterwards
// (validateUpgradePlan), and the install commands are rebuilt deterministically
// in code - the model's own command strings are never the final word.

// Matches the facts layer's analysis cap (upgrade-facts.ts). Enforced again
// server-side so a hand-rolled request can't inflate the synthesis input.
export const MAX_PLAN_FACTS = 150;

// The distilled facts payload for 150 packages runs ~250 bytes per entry;
// 64KB bounds the worst case (long deprecation messages, several peer
// conflicts) with headroom while still capping spend.
export const MAX_PLAN_REQUEST_BYTES = 64_000;

// A 40-package plan is ~90 output tokens per package plus waves and summary -
// 6k covers a realistically outdated manifest before extractToolInput's
// max_tokens truncation guard trips. (The spec'd 4k truncated on this site's
// own 45-dependency manifest during design.)
export const UPGRADE_PLAN_MAX_TOKENS = 6000;

export type RiskTier = "safe_now" | "needs_testing" | "breaking_likely";

export const RISK_TIERS: RiskTier[] = ["safe_now", "needs_testing", "breaking_likely"];

export type NoteConfidence = "high" | "medium" | "low";

export interface BreakingNote {
	note: string;
	confidence: NoteConfidence; // model self-assessment - the UI labels every
	// note "from model knowledge - verify against the changelog"
}

export interface PackagePlan {
	name: string; // must match a submitted fact's name
	target_version: string; // must equal that fact's latest - enforced in code
	tier: RiskTier;
	rationale: string; // 1-2 sentences
	breaking_notes: BreakingNote[]; // empty when none known
}

export interface UpgradeWave {
	order: number; // 1-based; renumbered in code after validation
	title: string; // e.g. "Wave 2: Lint and test tooling"
	packages: string[]; // names resolved against PackagePlan entries
	command: string; // rebuilt deterministically from the facts - see buildWaveCommand
	verify_after: string; // what to run/check before the next wave
	rationale: string;
}

export interface UpgradePlan {
	summary: string; // 2-3 sentences: counts and headline risks
	already_current: string[];
	plans: PackagePlan[];
	waves: UpgradeWave[];
	peer_conflict_guidance: string[]; // sequencing advice, one per detected conflict
	deprecated_alerts: string[]; // plain language, one per deprecated package
	general_advice: string[]; // max 3, concrete
}

// What the worker returns: the validated plan plus what post-validation had
// to strip or rewrite. Violations are removed and reported, not fatal - and
// the eval suite requires this list to be empty.
export interface UpgradePlanResult extends UpgradePlan {
	validation_warnings: string[];
}

// ---------------------------------------------------------------------------
// The request payload: a trimmed projection of DependencyFact. URLs and other
// render-only fields stay in the browser; the server (and the model) only
// ever see the analysis itself.

export interface PlanRequestFact {
	name: string;
	section: DependencySection;
	declared_range: string;
	resolved_floor: string | null;
	latest: string;
	majors_behind: number;
	minors_behind: number;
	patches_behind: number;
	is_current: boolean;
	floor_deprecated: boolean;
	latest_deprecated: boolean;
	deprecation_message: string | null;
	peer_conflicts: string[]; // the deterministic conflict messages
}

export function toPlanRequestFacts(facts: DependencyFact[]): PlanRequestFact[] {
	return facts.map((fact) => ({
		name: fact.name,
		section: fact.section,
		declared_range: fact.declared_range,
		resolved_floor: fact.resolved_floor,
		latest: fact.latest,
		majors_behind: fact.majors_behind,
		minors_behind: fact.minors_behind,
		patches_behind: fact.patches_behind,
		is_current: fact.is_current,
		floor_deprecated: fact.floor_deprecated,
		latest_deprecated: fact.latest_deprecated,
		deprecation_message: fact.deprecation_message,
		peer_conflicts: fact.peer_conflicts.map((conflict) => conflict.message),
	}));
}

// Server-side shape validation for the facts payload. Returns the validated
// array or a human-readable rejection. Field-level string caps keep a
// hand-rolled request from smuggling a novel into the prompt.
export function validatePlanRequestFacts(value: unknown): PlanRequestFact[] | string {
	if (!Array.isArray(value) || value.length === 0) {
		return "facts must be a non-empty array.";
	}
	if (value.length > MAX_PLAN_FACTS) {
		return `facts must contain at most ${MAX_PLAN_FACTS} entries.`;
	}
	const shortString = (v: unknown, max: number): v is string =>
		typeof v === "string" && v.length > 0 && v.length <= max;
	const count = (v: unknown): v is number =>
		typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000;

	const facts: PlanRequestFact[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (entry === null || typeof entry !== "object") {
			return "Each fact must be an object.";
		}
		const f = entry as Record<string, unknown>;
		if (!shortString(f.name, 214)) return "Each fact needs a name (at most 214 characters).";
		if (seen.has(f.name)) return `Duplicate fact for "${f.name}".`;
		seen.add(f.name);
		if (f.section !== "dependencies" && f.section !== "devDependencies") {
			return `Fact "${f.name}" has an invalid section.`;
		}
		if (!shortString(f.declared_range, 100)) return `Fact "${f.name}" needs a declared_range.`;
		if (f.resolved_floor !== null && !shortString(f.resolved_floor, 100)) {
			return `Fact "${f.name}" has an invalid resolved_floor.`;
		}
		if (!shortString(f.latest, 100)) return `Fact "${f.name}" needs a latest version.`;
		if (!count(f.majors_behind) || !count(f.minors_behind) || !count(f.patches_behind)) {
			return `Fact "${f.name}" has invalid behind counts.`;
		}
		if (
			typeof f.is_current !== "boolean" ||
			typeof f.floor_deprecated !== "boolean" ||
			typeof f.latest_deprecated !== "boolean"
		) {
			return `Fact "${f.name}" has invalid boolean flags.`;
		}
		if (f.deprecation_message !== null && !shortString(f.deprecation_message, 500)) {
			return `Fact "${f.name}" has an invalid deprecation_message.`;
		}
		if (
			!Array.isArray(f.peer_conflicts) ||
			f.peer_conflicts.length > 20 ||
			!f.peer_conflicts.every((c) => shortString(c, 500))
		) {
			return `Fact "${f.name}" has invalid peer_conflicts.`;
		}
		facts.push({
			name: f.name,
			section: f.section,
			declared_range: f.declared_range,
			resolved_floor: f.resolved_floor,
			latest: f.latest,
			majors_behind: f.majors_behind,
			minors_behind: f.minors_behind,
			patches_behind: f.patches_behind,
			is_current: f.is_current,
			floor_deprecated: f.floor_deprecated,
			latest_deprecated: f.latest_deprecated,
			deprecation_message: f.deprecation_message,
			peer_conflicts: f.peer_conflicts as string[],
		});
	}
	if (JSON.stringify(facts).length > MAX_PLAN_REQUEST_BYTES) {
		return `The facts payload is too large (over ${Math.round(MAX_PLAN_REQUEST_BYTES / 1000)}KB).`;
	}
	return facts;
}

// ---------------------------------------------------------------------------
// Prompt and tool schema

export const PLAN_UPGRADES_SYSTEM_PROMPT = `You are an upgrade-planning engine inside a technical demo for developers. You receive computed dependency facts: current declared ranges, latest versions, versions-behind counts, deprecation flags, and detected peer conflicts. These facts are ground truth - never contradict them, never introduce version numbers not present in them. Your job is judgment: assign each package a risk tier (safe_now: patch/minor with no known breakage; needs_testing: minor with meaningful surface or ecosystem coupling; breaking_likely: major bumps, deprecated packages, or known migration efforts), group packages into ordered upgrade waves where each wave is safe to do together (keep tightly coupled ecosystems - a framework and its own plugins, router, or state store, a lint stack, a test stack - together in one single wave; for peer conflicts between otherwise-unrelated packages, order the waves so the required package lands no later than its dependent - sharing a wave counts as resolved; put tooling-only devDependencies before runtime dependencies when reasonable), and write a short rationale per wave plus concrete npm install commands. Hard rule on coupled stacks: a framework and its companion packages migrate atomically, in ONE wave listing all of them (e.g. vue + vue-router + vuex, or react + react-dom), because the application cannot build in a half-migrated intermediate state. A conflict message saying "upgrade X first" does not mean X goes in an earlier wave - it is satisfied by X sharing the same wave as its dependent, and splitting a coupled stack across waves is always wrong. When you note a known breaking change or migration (e.g. a major version's renamed API), mark your confidence (high/medium/low) - your knowledge may be outdated, and the reader will be told to verify against changelogs. If facts are sparse for a package, tier it conservatively and say why. Do not pad: a package that is current belongs in already_current, not in a wave. A deprecated package always belongs in breaking_likely with a deprecated_alerts entry naming its replacement when you know one, plainly marked as your suggestion to verify. Never emit a wave whose packages list is empty: advice to remove or replace a deprecated package belongs in deprecated_alerts and general_advice, not in a wave of its own - waves exist only to upgrade the listed packages. Write one peer_conflict_guidance entry per detected conflict explaining how the wave order resolves it. general_advice holds at most 3 concrete items - no filler.`;

// Mirrors UpgradePlan 1:1 (validation_warnings is added by post-validation,
// never by the model). strict: true means the API validates the model's
// output against this schema before it ever reaches us.
export const PLAN_UPGRADES_TOOL: Anthropic.Tool = {
	name: "record_upgrade_plan",
	description:
		"Record the synthesized upgrade plan: a risk tier and rationale per outdated package, ordered upgrade waves with commands and verification steps, peer-conflict sequencing guidance, and deprecation alerts.",
	strict: true,
	input_schema: {
		type: "object",
		properties: {
			summary: {
				type: "string",
				description: "2-3 sentences: how many packages are behind, the headline risks",
			},
			already_current: {
				type: "array",
				items: { type: "string" },
				description: "Names of packages whose declared range already satisfies latest",
			},
			plans: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Must exactly match a name from the submitted facts",
						},
						target_version: {
							type: "string",
							description: "Must exactly equal that fact's latest version",
						},
						tier: { type: "string", enum: RISK_TIERS },
						rationale: { type: "string", description: "1-2 sentences" },
						breaking_notes: {
							type: "array",
							items: {
								type: "object",
								properties: {
									note: { type: "string" },
									confidence: { type: "string", enum: ["high", "medium", "low"] },
								},
								required: ["note", "confidence"],
								additionalProperties: false,
							},
							description:
								"Known breaking changes or migrations from your training knowledge, each with your confidence; empty when none known",
						},
					},
					required: ["name", "target_version", "tier", "rationale", "breaking_notes"],
					additionalProperties: false,
				},
			},
			waves: {
				type: "array",
				items: {
					type: "object",
					properties: {
						order: { type: "number", description: "1-based" },
						title: {
							type: "string",
							description: 'e.g. "Wave 2: Lint and test tooling"',
						},
						packages: {
							type: "array",
							items: { type: "string" },
							description: "Package names, each present in plans",
						},
						command: {
							type: "string",
							description:
								"One npm install command for the wave (the application rebuilds this from the facts)",
						},
						verify_after: {
							type: "string",
							description: "What to run or check before starting the next wave",
						},
						rationale: { type: "string" },
					},
					required: [
						"order",
						"title",
						"packages",
						"command",
						"verify_after",
						"rationale",
					],
					additionalProperties: false,
				},
			},
			peer_conflict_guidance: {
				type: "array",
				items: { type: "string" },
				description: "One sequencing-advice entry per detected peer conflict",
			},
			deprecated_alerts: {
				type: "array",
				items: { type: "string" },
				description: "Plain-language alert per deprecated package",
			},
			general_advice: {
				type: "array",
				items: { type: "string" },
				description: "At most 3 concrete items",
			},
		},
		required: [
			"summary",
			"already_current",
			"plans",
			"waves",
			"peer_conflict_guidance",
			"deprecated_alerts",
			"general_advice",
		],
		additionalProperties: false,
	},
};

// ---------------------------------------------------------------------------
// Post-validation: the anti-hallucination gate. Runs server-side before the
// plan is returned (and inside the eval suite, which requires zero warnings).

// npm treats an in-place upgrade of a devDependency correctly without -D, but
// the generated commands keep the sections explicit so they're copy-safe for
// packages being added fresh.
export function buildWaveCommand(
	packageNames: string[],
	factsByName: Map<string, PlanRequestFact>,
): string {
	const runtime: string[] = [];
	const dev: string[] = [];
	for (const name of packageNames) {
		const fact = factsByName.get(name);
		if (!fact) continue;
		(fact.section === "devDependencies" ? dev : runtime).push(`${name}@${fact.latest}`);
	}
	const parts: string[] = [];
	if (runtime.length > 0) parts.push(`npm install ${runtime.join(" ")}`);
	if (dev.length > 0) parts.push(`npm install -D ${dev.join(" ")}`);
	return parts.join(" && ");
}

export function validateUpgradePlan(
	plan: UpgradePlan,
	facts: PlanRequestFact[],
): UpgradePlanResult {
	const warnings: string[] = [];
	const factsByName = new Map(facts.map((fact) => [fact.name, fact]));

	// Every plan must name a real fact, and its target must be that fact's
	// latest - the model selects and orders, it never restates numbers.
	const plans = plan.plans.filter((entry) => {
		const fact = factsByName.get(entry.name);
		if (!fact) {
			warnings.push(`Dropped plan for "${entry.name}" - not in the submitted facts.`);
			return false;
		}
		if (entry.target_version !== fact.latest) {
			warnings.push(
				`Dropped plan for "${entry.name}" - target ${entry.target_version} is not the computed latest (${fact.latest}).`,
			);
			return false;
		}
		return true;
	});
	const plannedNames = new Set(plans.map((entry) => entry.name));

	const alreadyCurrent = plan.already_current.filter((name) => {
		if (!factsByName.has(name)) {
			warnings.push(`Dropped "${name}" from already_current - not in the submitted facts.`);
			return false;
		}
		if (plannedNames.has(name)) {
			warnings.push(`Dropped "${name}" from already_current - it also has an upgrade plan.`);
			return false;
		}
		return true;
	});

	const waves = plan.waves
		.map((wave) => {
			const arrivedEmpty = wave.packages.length === 0;
			const packages = wave.packages.filter((name) => {
				if (plannedNames.has(name)) return true;
				warnings.push(
					`Dropped "${name}" from wave "${wave.title}" - no surviving plan entry for it.`,
				);
				return false;
			});
			return { ...wave, packages, arrivedEmpty, command: buildWaveCommand(packages, factsByName) };
		})
		.filter((wave) => {
			if (wave.packages.length > 0) return true;
			// A wave the model sent with no packages at all (e.g. a "remove the
			// deprecated package" advice wave) contains nothing invented - drop
			// it silently. Only warn when stripping invented entries emptied it.
			if (!wave.arrivedEmpty) warnings.push(`Dropped empty wave "${wave.title}".`);
			return false;
		})
		.map(({ arrivedEmpty: _arrivedEmpty, ...wave }) => wave)
		// Preserve the model's intended sequence, then renumber 1..n so the
		// timeline never shows gaps.
		.sort((a, b) => a.order - b.order)
		.map((wave, index) => ({ ...wave, order: index + 1 }));

	return {
		...plan,
		plans,
		already_current: alreadyCurrent,
		waves,
		general_advice: plan.general_advice.slice(0, 3),
		validation_warnings: warnings,
	};
}

// ---------------------------------------------------------------------------
// The take-away artifact: the whole plan as markdown for a team channel or
// ticket. Version data comes from the facts, per the design rule.

export function upgradePlanToMarkdown(
	plan: UpgradePlanResult,
	facts: PlanRequestFact[],
	generatedNote: string,
): string {
	const factsByName = new Map(facts.map((fact) => [fact.name, fact]));
	const tierLabel: Record<RiskTier, string> = {
		safe_now: "safe now",
		needs_testing: "needs testing",
		breaking_likely: "breaking changes likely",
	};
	const lines: string[] = [
		"# Dependency upgrade plan",
		"",
		plan.summary,
		"",
		`_${generatedNote}_`,
		"",
	];

	if (plan.deprecated_alerts.length > 0) {
		lines.push("## Deprecations", "");
		for (const alert of plan.deprecated_alerts) lines.push(`- ⚠️ ${alert}`);
		lines.push("");
	}
	if (plan.peer_conflict_guidance.length > 0) {
		lines.push("## Peer-conflict sequencing", "");
		for (const guidance of plan.peer_conflict_guidance) lines.push(`- ${guidance}`);
		lines.push("");
	}

	lines.push("## Upgrade waves", "");
	for (const wave of plan.waves) {
		lines.push(`### Wave ${wave.order}: ${wave.title.replace(/^Wave \d+:\s*/i, "")}`, "");
		lines.push(wave.rationale, "");
		for (const name of wave.packages) {
			const entry = plan.plans.find((p) => p.name === name);
			const fact = factsByName.get(name);
			if (!entry || !fact) continue;
			lines.push(
				`- **${name}** ${fact.declared_range} → ${fact.latest} (${tierLabel[entry.tier]}) - ${entry.rationale}`,
			);
			for (const note of entry.breaking_notes) {
				lines.push(
					`  - ${note.note} _(model knowledge, ${note.confidence} confidence - verify against the changelog)_`,
				);
			}
		}
		lines.push(
			"",
			"```sh",
			wave.command,
			"```",
			"",
			`**Verify before the next wave:** ${wave.verify_after}`,
			"",
		);
	}

	if (plan.general_advice.length > 0) {
		lines.push("## General advice", "");
		for (const advice of plan.general_advice) lines.push(`- ${advice}`);
		lines.push("");
	}
	if (plan.already_current.length > 0) {
		lines.push("## Already current", "", plan.already_current.join(", "), "");
	}
	lines.push(
		"---",
		"",
		"Facts (versions, deprecations, peer conflicts) were computed from npm registry data; tiers, waves, and notes were synthesized by a model. Breaking-change notes come from model knowledge and can be stale - always verify against each package's changelog.",
	);
	return lines.join("\n");
}
