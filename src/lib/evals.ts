// Shared between the eval runner (scripts/evals/) and the dashboard UI
// (src/views/EvalsView.vue, src/components/EvalBadge.vue). The runner makes
// the model calls in CI/locally and commits its results as static JSON; the
// site just fetches that JSON - so nothing in this file may pull in runtime
// code, and no eval machinery ships to the client beyond these types.

export const EVAL_PROJECT_IDS = [
	"note-structurer",
	"lease-diff",
	"screenshot-to-primevue",
	"paperwork-to-calendar",
	"upgrade-planner",
	"tos-watch",
	"dry-run-oracle",
	"noise-translator",
] as const;

export type EvalProjectId = (typeof EVAL_PROJECT_IDS)[number];

export const EVAL_PROJECT_LABELS: Record<EvalProjectId, string> = {
	"note-structurer": "Clinical Note Structurer",
	"lease-diff": "Lease Diff Explainer",
	"screenshot-to-primevue": "Screenshot → PrimeVue",
	"paperwork-to-calendar": "Paperwork → Calendar",
	"upgrade-planner": "Dependency Upgrade Planner",
	"tos-watch": "ToS Watchdog",
	"dry-run-oracle": "Dry-Run Oracle",
	"noise-translator": "Noise Translator",
};

// Where the runner writes and the dashboard reads.
export const EVAL_RESULTS_DIR = "public/eval-results";
export const EVAL_LATEST_PATH = "/eval-results/latest.json";
export const EVAL_HISTORY_PATH = "/eval-results/history.json";

export type EvalTrigger = "schedule" | "manual" | "push";

// One deterministic assertion's outcome. `expected` and `actual` are
// human-readable strings - they are displayed verbatim on the public
// dashboard, including for failures.
export interface CheckResult {
	passed: boolean;
	expected: string;
	actual: string;
}

export interface CaseResult {
	case_id: string;
	description: string;
	passed: boolean; // all checks passed
	checks: (CheckResult & { name: string })[];
	duration_ms: number;
	error: string | null; // pipeline threw / schema parse failed
}

export interface SuiteResult {
	project_id: EvalProjectId;
	project_label: string;
	model: string; // exact model string used
	prompt_hash: string; // sha256 of the system prompt (first 12 chars)
	cases: CaseResult[];
	pass_count: number;
	total: number;
}

export interface EvalReport {
	run_at: string; // ISO timestamp
	trigger: EvalTrigger;
	suites: SuiteResult[];
	overall_pass_rate: number; // 0-1
	regression_from_previous: boolean;
	regression_detail: string | null; // e.g. "lease-diff: 9/9 → 7/9"
}

// Trimmed per-run entry appended to history.json. `cases` (per-case pass/fail
// booleans, for the dashboard's flakiness dots) is kept only on the newest
// EVAL_HISTORY_CASE_RUNS entries; older entries carry counts and hashes only.
export interface EvalHistorySuite {
	project_id: EvalProjectId;
	pass_count: number;
	total: number;
	model: string;
	prompt_hash: string;
	cases?: Record<string, boolean>;
}

export interface EvalHistoryEntry {
	run_at: string;
	trigger: EvalTrigger;
	overall_pass_rate: number;
	suites: EvalHistorySuite[];
}

export const EVAL_HISTORY_MAX_ENTRIES = 90;
export const EVAL_HISTORY_CASE_RUNS = 14;

// Shape check for the fetched JSON: the SPA fallback answers unknown paths
// with index.html (HTTP 200), so "missing" is detected by content shape, not
// status code - same approach as the site-health widget.
export function isEvalReport(value: unknown): value is EvalReport {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as EvalReport).run_at === "string" &&
		Array.isArray((value as EvalReport).suites)
	);
}
