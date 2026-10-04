import type { EvalReport } from "../../src/lib/evals";
import type { SuiteRegression } from "./persist";

// Issue filing with dedupe, mirroring scripts/site-health/issues.ts: the
// fingerprint (demo + newly-failing case ids) is embedded in a hidden HTML
// comment in the issue body. Before filing, open `evals` issues are searched
// for the same fingerprint - a match gets at most one "still failing" comment
// per 7 days instead of a duplicate issue. When every case in an open issue's
// fingerprint passes again, a recovery comment suggests closing - the issue
// is never auto-closed.

const LABEL = "evals";
const COMMENT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const fingerprintMarker = (fp: string) => `<!-- evals-fingerprint: ${fp} -->`;
const FINGERPRINT_RE = /<!-- evals-fingerprint: ([a-z0-9-]+):([a-z0-9,-]+) -->/;

export const regressionFingerprint = (regression: SuiteRegression): string =>
	`${regression.project_id}:${regression.newly_failing_case_ids.join(",")}`;

interface GithubIssue {
	number: number;
	html_url: string;
	body: string | null;
}

interface GithubComment {
	created_at: string;
	body: string;
}

function api(): { base: string; headers: Record<string, string>; runUrl: string } {
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY ?? "dliamkin/dliamkin";
	if (!token) throw new Error("GITHUB_TOKEN is not set - cannot manage issues.");
	const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
	const runId = process.env.GITHUB_RUN_ID;
	return {
		base: `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}`,
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"content-type": "application/json",
		},
		runUrl: runId ? `${server}/${repo}/actions/runs/${runId}` : `${server}/${repo}/actions`,
	};
}

async function request<T>(
	url: string,
	headers: Record<string, string>,
	init?: { method: string; body: unknown },
): Promise<T> {
	const response = await fetch(url, {
		method: init?.method ?? "GET",
		headers,
		body: init ? JSON.stringify(init.body) : undefined,
	});
	if (!response.ok) {
		throw new Error(`GitHub API ${response.status} for ${url}: ${await response.text()}`);
	}
	return (await response.json()) as T;
}

async function openEvalIssues(
	base: string,
	headers: Record<string, string>,
): Promise<GithubIssue[]> {
	return request<GithubIssue[]>(
		`${base}/issues?labels=${LABEL}&state=open&per_page=100`,
		headers,
	);
}

// The public expected/actual detail for one regressed suite's newly-failing
// cases - the same detail the dashboard shows.
function failureDetail(report: EvalReport, regression: SuiteRegression): string {
	const suite = report.suites.find((s) => s.project_id === regression.project_id);
	if (!suite) return "";
	const lines: string[] = [];
	for (const caseId of regression.newly_failing_case_ids) {
		const caseResult = suite.cases.find((c) => c.case_id === caseId);
		if (!caseResult) continue;
		lines.push(`### \`${caseResult.case_id}\``, "", caseResult.description, "");
		if (caseResult.error) {
			lines.push(`Pipeline error: \`${caseResult.error}\``, "");
			continue;
		}
		for (const check of caseResult.checks.filter((c) => !c.passed)) {
			lines.push(
				`- **${check.name}**`,
				`  - expected: ${check.expected}`,
				`  - actual: ${check.actual}`,
			);
		}
		lines.push("");
	}
	return lines.join("\n");
}

export async function fileRegressionIssues(
	report: EvalReport,
	regressions: SuiteRegression[],
): Promise<void> {
	if (regressions.length === 0) return;
	const { base, headers, runUrl } = api();
	const open = await openEvalIssues(base, headers);
	const date = report.run_at.slice(0, 10);

	for (const regression of regressions) {
		const marker = fingerprintMarker(regressionFingerprint(regression));
		const existing = open.find((issue) => issue.body?.includes(marker));

		if (existing) {
			// Same ongoing problem - comment at most once per 7 days.
			const comments = await request<GithubComment[]>(
				`${base}/issues/${existing.number}/comments?per_page=100`,
				headers,
			);
			const last = comments[comments.length - 1];
			if (last && Date.now() - new Date(last.created_at).getTime() < COMMENT_COOLDOWN_MS) {
				console.log(`Issue #${existing.number} already has a recent comment - skipping.`);
				continue;
			}
			await request(`${base}/issues/${existing.number}/comments`, headers, {
				method: "POST",
				body: {
					body: `Still failing in the ${date} eval run: ${regression.project_id} at ${regression.pass_count}/${regression.total}.\n\n[Workflow run](${runUrl})`,
				},
			});
			console.log(`Commented on existing issue #${existing.number}.`);
			continue;
		}

		const body = [
			marker,
			"",
			`The **${regression.project_label}** eval suite regressed: **${regression.previous_pass_count}/${regression.total} → ${regression.pass_count}/${regression.total}**.`,
			"",
			`Newly failing cases: ${regression.newly_failing_case_ids.map((id) => `\`${id}\``).join(", ")}`,
			`Model: \`${report.suites.find((s) => s.project_id === regression.project_id)?.model ?? "unknown"}\` · prompt hash: \`${report.suites.find((s) => s.project_id === regression.project_id)?.prompt_hash ?? "unknown"}\``,
			"",
			failureDetail(report, regression),
			`[Workflow run](${runUrl}) · [Eval dashboard](https://dliamkin.com/evals)`,
			"",
			"_Filed automatically by the eval workflow._",
		]
			.filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
			.join("\n");

		const created = await request<GithubIssue>(`${base}/issues`, headers, {
			method: "POST",
			body: {
				title: `Eval regression: ${regression.project_label} ${regression.previous_pass_count}/${regression.total} → ${regression.pass_count}/${regression.total} (${date})`,
				body,
				labels: [LABEL],
			},
		});
		console.log(`Filed issue: ${created.html_url}`);
	}
}

// When every case named in an open issue's fingerprint passes again, add one
// recovery comment suggesting closure. Never auto-close: a human should
// confirm the recovery wasn't a flake.
export async function commentOnRecoveries(report: EvalReport): Promise<void> {
	const { base, headers, runUrl } = api();
	const open = await openEvalIssues(base, headers);
	const date = report.run_at.slice(0, 10);

	for (const issue of open) {
		const match = issue.body?.match(FINGERPRINT_RE);
		if (!match) continue;
		const [, projectId, caseList] = match;
		const suite = report.suites.find((s) => s.project_id === projectId);
		if (!suite) continue;
		const caseIds = (caseList ?? "").split(",").filter(Boolean);
		const allRecovered =
			caseIds.length > 0 &&
			caseIds.every((id) => suite.cases.find((c) => c.case_id === id)?.passed === true);
		if (!allRecovered) continue;

		const comments = await request<GithubComment[]>(
			`${base}/issues/${issue.number}/comments?per_page=100`,
			headers,
		);
		const last = comments[comments.length - 1];
		if (last?.body.startsWith("Recovered")) continue; // already noted

		await request(`${base}/issues/${issue.number}/comments`, headers, {
			method: "POST",
			body: {
				body: `Recovered in the ${date} eval run: ${suite.project_id} back to ${suite.pass_count}/${suite.total}, all previously-failing cases passing. Consider closing this issue if the recovery holds.\n\n[Workflow run](${runUrl})`,
			},
		});
		console.log(`Recovery comment on issue #${issue.number}.`);
	}
}
