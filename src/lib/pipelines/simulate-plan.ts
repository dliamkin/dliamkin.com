import type Anthropic from "@anthropic-ai/sdk";
import {
	SIMULATE_MAX_TOKENS,
	SIMULATE_PLAN_SYSTEM_PROMPT,
	SIMULATE_PLAN_TOOL,
	finalizeSimulation,
	planCacheKeyInput,
	serializeSimulateRequest,
	sha256Hex,
	type RawSimulation,
	type SimulateRequest,
	type SimulationResult,
} from "../dry-run-oracle";
import { PipelineOutputError, extractToolInput } from "./shared";

// The full production pipeline for the Dry-Run Oracle: compact plan in, one
// forced tool call on Haiku, schema-validated parse, then deterministic
// finalization (all money math in code, oracle self-cost from the real usage
// block). worker/index.ts wraps this with request validation and rate
// limiting; the eval suite in scripts/evals/ runs it directly.
//
// Haiku is the point, not a compromise: the product claim is that ~$0.01 of
// cheap-model simulation de-risks a $5+ expensive-model run, and the response
// carries its own cost (oracleCostUsd) to prove it. One API call per
// simulation, hard-capped at SIMULATE_MAX_TOKENS output.
export const SIMULATE_PLAN_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function buildUserMessage(request: SimulateRequest): string {
	if (request.freeform !== undefined) {
		const notes = request.contextNotes ? `\nContext notes: ${request.contextNotes}` : "";
		return (
			`Freeform plan to structure and simulate.\nTitle: ${request.title}\n` +
			`Target model: ${request.targetModel}${notes}\nPlan text:\n${request.freeform}`
		);
	}
	// Compact serialization - stripped empty fields, no pretty-printing.
	return serializeSimulateRequest(request);
}

export async function simulatePlan(
	client: Anthropic,
	request: SimulateRequest,
	model: string = SIMULATE_PLAN_DEFAULT_MODEL,
): Promise<SimulationResult> {
	const response = await client.messages.create({
		model,
		max_tokens: SIMULATE_MAX_TOKENS,
		system: SIMULATE_PLAN_SYSTEM_PROMPT,
		tools: [SIMULATE_PLAN_TOOL],
		tool_choice: { type: "tool", name: SIMULATE_PLAN_TOOL.name },
		messages: [{ role: "user", content: buildUserMessage(request) }],
	});

	const raw = extractToolInput<RawSimulation>(response, SIMULATE_PLAN_TOOL.name);
	if (raw.steps.length === 0) {
		throw new PipelineOutputError("Model returned a simulation with zero steps");
	}
	// Structured plans must be assessed step-for-step; a dropped or invented
	// step would silently skew the totals.
	if (request.steps !== undefined) {
		const expected = new Set(request.steps.map((step) => step.id));
		const returned = new Set(raw.steps.map((step) => step.step_id));
		if (expected.size !== returned.size || ![...expected].every((id) => returned.has(id))) {
			throw new PipelineOutputError("Model assessment did not cover the submitted steps 1:1");
		}
	}

	const planHash = await sha256Hex(planCacheKeyInput(request));
	return finalizeSimulation(raw, request, response.usage, planHash, new Date().toISOString());
}
