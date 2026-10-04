// Deduped ops issues for the watchdog, reusing the site-health fingerprint
// pattern: the fingerprint hides in an HTML comment in the issue body, open
// tos-watch issues are searched for it before filing, and a match gets at
// most one "still happening" comment per 7 days instead of a duplicate.

const LABEL = "tos-watch";
const COMMENT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const fingerprintMarker = (fp: string) => `<!-- tos-watch-fingerprint: ${fp} -->`;

export interface OpsIssue {
	fingerprint: string; // stable per problem, e.g. "unreachable:<service>/<doc>"
	title: string;
	body: string;
}

interface GithubIssue {
	number: number;
	html_url: string;
	body: string | null;
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

export async function fileOpsIssue(issue: OpsIssue): Promise<void> {
	const { base, headers, runUrl } = api();

	const open = await request<GithubIssue[]>(
		`${base}/issues?labels=${LABEL}&state=open&per_page=100`,
		headers,
	);
	const marker = fingerprintMarker(issue.fingerprint);
	const existing = open.find((candidate) => candidate.body?.includes(marker));

	if (existing) {
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
			body: { body: `Still present in tonight's run.\n\n[Workflow run](${runUrl})` },
		});
		console.log(`Commented on existing issue #${existing.number}.`);
		return;
	}

	const created = await request<GithubIssue>(`${base}/issues`, headers, {
		method: "POST",
		body: {
			title: issue.title,
			body: `${marker}\n\n${issue.body}\n\n[Workflow run](${runUrl})\n\n_Filed automatically by the nightly ToS watchdog._`,
			labels: [LABEL],
		},
	});
	console.log(`Filed issue: ${created.html_url}`);
}
