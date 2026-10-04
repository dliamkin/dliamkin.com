import type Anthropic from "@anthropic-ai/sdk";

// Shared plumbing for the demo pipelines in this directory. The pipelines are
// the single production code path for every model call: the Cloudflare Worker
// (worker/index.ts), the sample-generation scripts, and the eval runner
// (scripts/evals/) all import the same functions, so what the evals measure is
// exactly what a live request runs. The Anthropic import is type-only - the
// caller constructs the client - so nothing here can drag the SDK into the
// client bundle.

// The model returned no tool_use block or truncated at max_tokens - the
// structured output is missing or unusable. Distinct from Anthropic API
// errors, which propagate as the SDK's own error types.
export class PipelineOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PipelineOutputError";
	}
}

export function extractToolInput<T>(response: Anthropic.Message, toolName: string): T {
	const toolUse = response.content.find(
		(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
	);
	if (!toolUse || response.stop_reason === "max_tokens") {
		throw new PipelineOutputError(
			`Model did not return a complete ${toolName} tool call` +
				(response.stop_reason === "max_tokens" ? " (hit max_tokens)" : ""),
		);
	}
	// strict: true on the tool definitions means the API has already validated
	// this input against the JSON schema.
	return toolUse.input as T;
}
