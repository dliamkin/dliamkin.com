import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type {
	CaseResult,
	CheckResult,
	EvalProjectId,
	SuiteResult,
} from "../../src/lib/evals";

// A deliberately small eval harness - no framework, no dependencies. Cases
// are plain data, checks are plain TypeScript assertions on the pipelines'
// structured output, and every result is honest: one model call per case per
// run, no retries, failures published with expected-vs-actual detail.

export interface EvalCase<TInput, TOutput> {
	id: string; // stable slug, e.g. "note-followup-htn"
	description: string; // what this case is checking
	input: TInput;
	checks: EvalCheck<TOutput>[];
}

export interface EvalCheck<TOutput> {
	name: string; // e.g. "extracts lisinopril 20 mg daily"
	run: (output: TOutput) => CheckResult;
}

export interface SuiteDefinition<TInput, TOutput> {
	project_id: EvalProjectId;
	project_label: string;
	model: string; // exact model string the pipeline will use
	prompt: string; // the pipeline's actual system prompt - hashed per run so
	// the dashboard can attribute score changes to "prompt changed" vs
	// "same prompt, model drifted"
	cases: EvalCase<TInput, TOutput>[];
	execute: (client: Anthropic, input: TInput) => Promise<TOutput>;
}

// Generic-erased handle so heterogeneous suites can sit in one array without
// `any`. defineSuite closes over the concrete input/output types.
export interface RunnableSuite {
	project_id: EvalProjectId;
	project_label: string;
	model: string;
	prompt_hash: string;
	case_ids: string[];
	run: (client: Anthropic) => Promise<SuiteResult>;
}

export function promptHash(prompt: string): string {
	return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

// Small in-suite concurrency plus a stagger between case starts keeps the
// whole run polite to the API without dragging it past a few minutes.
const CASE_CONCURRENCY = 2;
const CASE_STAGGER_MS = 500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function defineSuite<TInput, TOutput>(
	def: SuiteDefinition<TInput, TOutput>,
): RunnableSuite {
	async function runCase(
		client: Anthropic,
		evalCase: EvalCase<TInput, TOutput>,
	): Promise<CaseResult> {
		const startedAt = Date.now();
		try {
			const output = await def.execute(client, evalCase.input);
			const checks = evalCase.checks.map((check) => ({
				name: check.name,
				...check.run(output),
			}));
			return {
				case_id: evalCase.id,
				description: evalCase.description,
				passed: checks.every((check) => check.passed),
				checks,
				duration_ms: Date.now() - startedAt,
				error: null,
			};
		} catch (error) {
			return {
				case_id: evalCase.id,
				description: evalCase.description,
				passed: false,
				checks: [],
				duration_ms: Date.now() - startedAt,
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
			};
		}
	}

	return {
		project_id: def.project_id,
		project_label: def.project_label,
		model: def.model,
		prompt_hash: promptHash(def.prompt),
		case_ids: def.cases.map((c) => c.id),
		async run(client: Anthropic): Promise<SuiteResult> {
			const results: CaseResult[] = Array.from({ length: def.cases.length });
			let nextIndex = 0;
			const worker = async () => {
				while (nextIndex < def.cases.length) {
					const index = nextIndex++;
					const evalCase = def.cases[index];
					if (!evalCase) break;
					results[index] = await runCase(client, evalCase);
					await delay(CASE_STAGGER_MS);
				}
			};
			await Promise.all(
				Array.from({ length: Math.min(CASE_CONCURRENCY, def.cases.length) }, worker),
			);
			return {
				project_id: def.project_id,
				project_label: def.project_label,
				model: def.model,
				prompt_hash: promptHash(def.prompt),
				cases: results,
				pass_count: results.filter((r) => r.passed).length,
				total: results.length,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Grading helpers. All deterministic, all producing human-readable
// expected/actual strings - these are rendered verbatim on the dashboard.

export function normalized(value: string | null | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

// Case-insensitive, whitespace-normalized substring test.
export function containsNormalized(actual: string | null, needle: string): CheckResult {
	return {
		passed: normalized(actual).includes(normalized(needle)),
		expected: `contains "${needle}"`,
		actual: actual === null ? "null" : `"${actual}"`,
	};
}

export function fieldEquals<T extends string | number | boolean | null>(
	actual: T,
	expected: T,
): CheckResult {
	return {
		passed: actual === expected,
		expected: JSON.stringify(expected),
		actual: JSON.stringify(actual),
	};
}

export function fieldIsNull(actual: string | number | null): CheckResult {
	return {
		passed: actual === null,
		expected: "null (absent - not invented)",
		actual: JSON.stringify(actual),
	};
}

export function fieldNonNull(actual: string | number | null): CheckResult {
	return {
		passed: actual !== null,
		expected: "non-null",
		actual: JSON.stringify(actual),
	};
}

export function arrayIsEmpty(items: readonly string[]): CheckResult {
	return {
		passed: items.length === 0,
		expected: "empty array",
		actual: items.length === 0 ? "empty array" : JSON.stringify(items),
	};
}

export function arrayNonEmpty(items: readonly string[]): CheckResult {
	return {
		passed: items.length > 0,
		expected: "at least one entry",
		actual: items.length === 0 ? "empty array" : JSON.stringify(items),
	};
}

// Set-contains: passes when at least one item satisfies the predicate.
// `render` turns each item into a short string so a failure shows what the
// model actually produced instead of the matching entry.
export function setContains<T>(
	items: readonly T[],
	expected: string,
	predicate: (item: T) => boolean,
	render: (item: T) => string,
): CheckResult {
	const match = items.find(predicate);
	return {
		passed: match !== undefined,
		expected,
		actual: match
			? render(match)
			: items.length === 0
				? "no entries at all"
				: `no match among: ${items.map(render).join(" | ")}`,
	};
}

// Inverse guard: passes when NO item satisfies the predicate.
export function setLacks<T>(
	items: readonly T[],
	forbidden: string,
	predicate: (item: T) => boolean,
	render: (item: T) => string,
): CheckResult {
	const match = items.find(predicate);
	return {
		passed: match === undefined,
		expected: `no entry ${forbidden}`,
		actual: match ? `found: ${render(match)}` : "none found",
	};
}

export function countAtMost(actualCount: number, max: number, label: string): CheckResult {
	return {
		passed: actualCount <= max,
		expected: `at most ${max} ${label}`,
		actual: `${actualCount} ${label}`,
	};
}

export function numericWithin(
	actual: number | null,
	expected: number,
	tolerance: number,
): CheckResult {
	return {
		passed: actual !== null && Math.abs(actual - expected) <= tolerance,
		expected: `${expected} ± ${tolerance}`,
		actual: actual === null ? "null" : String(actual),
	};
}
