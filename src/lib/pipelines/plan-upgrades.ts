import type Anthropic from "@anthropic-ai/sdk";
import {
	PLAN_UPGRADES_SYSTEM_PROMPT,
	PLAN_UPGRADES_TOOL,
	UPGRADE_PLAN_MAX_TOKENS,
	validateUpgradePlan,
	type PlanRequestFact,
	type UpgradePlan,
	type UpgradePlanResult,
} from "../upgrade-planner";
import { extractToolInput } from "./shared";

// The full production pipeline for the Dependency Upgrade Planner's synthesis
// phase: distilled facts in, forced tool call, schema-validated parse, then
// the deterministic post-validation gate (invented versions stripped, install
// commands rebuilt from the facts). worker/index.ts wraps this with request
// validation and rate limiting; scripts/generate-upgrade-samples.mjs and the
// eval suite in scripts/evals/ run it directly.

// Haiku, the house default for demos: this pipeline's inputs are pre-computed
// facts and its failure mode (restating a version wrong) is caught and
// stripped by validateUpgradePlan, so the cheap model is safe here - unlike
// the paperwork pipeline, nothing depends on the model's arithmetic. The
// worker overrides this per-environment via UPGRADE_PLANNER_MODEL.
export const PLAN_UPGRADES_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export async function planUpgrades(
	client: Anthropic,
	facts: PlanRequestFact[],
	model: string = PLAN_UPGRADES_DEFAULT_MODEL,
): Promise<UpgradePlanResult> {
	const response = await client.messages.create({
		model,
		max_tokens: UPGRADE_PLAN_MAX_TOKENS,
		system: PLAN_UPGRADES_SYSTEM_PROMPT,
		tools: [PLAN_UPGRADES_TOOL],
		tool_choice: { type: "tool", name: PLAN_UPGRADES_TOOL.name },
		messages: [
			{
				role: "user",
				content: `<dependency_facts>\n${JSON.stringify(facts, null, "\t")}\n</dependency_facts>\n\nSynthesize the upgrade plan for these computed facts per your instructions and record it via the tool.`,
			},
		],
	});
	const plan = extractToolInput<UpgradePlan>(response, PLAN_UPGRADES_TOOL.name);
	// The anti-hallucination gate: anything that contradicts the facts is
	// stripped and reported in validation_warnings (the eval suite requires
	// this list to be empty).
	return validateUpgradePlan(plan, facts);
}
