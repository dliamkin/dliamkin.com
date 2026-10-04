import type { HealthReport } from "../../src/lib/site-health";

// Issue filing with dedupe: the report's issue_fingerprint is embedded in a
// hidden HTML comment in the issue body. Before filing, open site-health
// issues are searched for the same fingerprint - a match gets at most one
// "still happening" comment per 7 days instead of a duplicate issue.

const LABEL = "site-health";
const COMMENT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const fingerprintMarker = (fp: string) => `<!-- site-health-fingerprint: ${fp} -->`;

interface GithubIssue {
	number: number;
	html_url: string;
	body: string | null;
	comments: number;
}

interface GithubComment {
	created_at: string;
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

export async function fileOrUpdateIssue(report: HealthReport): Promise<void> {
	if (!report.should_file_issue || !report.issue_fingerprint) return;
	const { base, headers, runUrl } = api();

	const open = await request<GithubIssue[]>(
		`${base}/issues?labels=${LABEL}&state=open&per_page=100`,
		headers,
	);
	const marker = fingerprintMarker(report.issue_fingerprint);
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
			return;
		}
		await request(`${base}/issues/${existing.number}/comments`, headers, {
			method: "POST",
			body: {
				body: `Still present in the ${report.audited_at.slice(0, 10)} nightly audit.\n\n${report.summary}\n\n[Workflow run](${runUrl})`,
			},
		});
		console.log(`Commented on existing issue #${existing.number}.`);
		return;
	}

	const body = [
		marker,
		"",
		report.issue_body ?? report.summary,
		"",
		report.score_deltas.length ? `**Score deltas:**\n${report.score_deltas.map((d) => `- ${d}`).join("\n")}` : "",
		report.top_fix ? `**Top recommended fix:** ${report.top_fix}` : "",
		"",
		`[Workflow run + screenshot artifacts](${runUrl})`,
		"",
		"_Filed automatically by the nightly site-health audit._",
	]
		.filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
		.join("\n");

	const created = await request<GithubIssue>(`${base}/issues`, headers, {
		method: "POST",
		body: {
			title: report.issue_title ?? `Site health regression (${report.audited_at.slice(0, 10)})`,
			body,
			labels: [LABEL],
		},
	});
	console.log(`Filed issue: ${created.html_url}`);
}
