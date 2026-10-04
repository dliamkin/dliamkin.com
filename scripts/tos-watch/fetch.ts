// Respectful fetching for the ToS watchdog: an honest User-Agent naming the
// project and site, per-host robots.txt compliance, one fetch per document
// per night with a modest timeout and a single retry. Never crawls beyond
// the exact configured URLs; sites that resist automated access get dropped
// from the config, not worked around.

export const TOS_WATCH_USER_AGENT =
	"dliamkin-tos-watch/1.0 (+https://dliamkin.com/projects/tos-watch)";

const FETCH_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 5_000;

export type FetchOutcome =
	| { kind: "ok"; html: string }
	| { kind: "robots_skipped"; reason: string }
	| { kind: "failed"; reason: string };

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309, the parts that matter here). We only ever check the
// exact configured paths, but if a host disallows them we skip and surface it
// as a config issue rather than fetching anyway.

interface RobotsRules {
	disallow: string[];
	allow: string[];
}

export function parseRobots(text: string, userAgentToken: string): RobotsRules {
	// Collect rules from the most specific matching group: our token if a
	// group names it, otherwise the * group.
	const groups = new Map<string, RobotsRules>();
	let currentAgents: string[] = [];
	let lastWasAgent = false;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) continue;
		const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
		if (!match) continue;
		const field = match[1]!.toLowerCase();
		const value = match[2]!.trim();

		if (field === "user-agent") {
			if (!lastWasAgent) currentAgents = [];
			currentAgents.push(value.toLowerCase());
			lastWasAgent = true;
			for (const agent of currentAgents) {
				if (!groups.has(agent)) groups.set(agent, { disallow: [], allow: [] });
			}
			continue;
		}
		lastWasAgent = false;
		if (field !== "disallow" && field !== "allow") continue;
		for (const agent of currentAgents) {
			const rules = groups.get(agent)!;
			if (value) rules[field].push(value);
		}
	}

	const token = userAgentToken.toLowerCase();
	for (const [agent, rules] of groups) {
		if (agent !== "*" && token.includes(agent)) return rules;
	}
	return groups.get("*") ?? { disallow: [], allow: [] };
}

function ruleMatches(path: string, rule: string): boolean {
	// RFC 9309 wildcards: * matches any sequence, $ anchors the end.
	const escaped = rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	const pattern = escaped.endsWith("$") ? escaped : `${escaped}.*`;
	return new RegExp(`^${pattern.replace(/\$$/, "$")}`).test(path);
}

export function isPathAllowed(rules: RobotsRules, path: string): boolean {
	// Longest-match wins; Allow beats Disallow on a tie.
	const longest = (candidates: string[]) =>
		candidates.filter((r) => ruleMatches(path, r)).reduce((max, r) => Math.max(max, r.length), -1);
	const allowLen = longest(rules.allow);
	const disallowLen = longest(rules.disallow);
	return allowLen >= disallowLen;
}

// One robots.txt fetch per host per run. "unavailable" = the server answered
// 5xx (RFC 9309: assume disallowed); "unreachable" = no answer at all, which
// is a host problem, not a robots policy - it flows into the document's
// normal fetch-failure path so the 3-strike unreachable escalation applies.
const robotsCache = new Map<string, RobotsRules | "unavailable" | "unreachable">();

async function robotsFor(url: URL): Promise<RobotsRules | "unavailable" | "unreachable"> {
	const cached = robotsCache.get(url.host);
	if (cached) return cached;

	let result: RobotsRules | "unavailable" | "unreachable";
	try {
		const response = await fetchWithTimeout(new URL("/robots.txt", url.origin).href);
		if (response.ok) {
			result = parseRobots(await response.text(), TOS_WATCH_USER_AGENT);
		} else if (response.status >= 500) {
			// RFC 9309: a 5xx robots.txt means assume disallowed.
			result = "unavailable";
		} else {
			// 4xx (usually 404): no robots file, everything is allowed.
			result = { disallow: [], allow: [] };
		}
	} catch {
		result = "unreachable";
	}
	robotsCache.set(url.host, result);
	return result;
}

// Exposed for tests.
export function resetRobotsCache(): void {
	robotsCache.clear();
}

// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string): Promise<Response> {
	return fetch(url, {
		headers: { "user-agent": TOS_WATCH_USER_AGENT, accept: "text/html,application/xhtml+xml" },
		redirect: "follow",
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchDocument(rawUrl: string): Promise<FetchOutcome> {
	const url = new URL(rawUrl);

	const rules = await robotsFor(url);
	if (rules === "unreachable") {
		return { kind: "failed", reason: `host unreachable (robots.txt fetch failed for ${url.host})` };
	}
	if (rules === "unavailable") {
		return {
			kind: "robots_skipped",
			reason: `robots.txt for ${url.host} answered 5xx - treating as disallowed per RFC 9309`,
		};
	}
	if (!isPathAllowed(rules, url.pathname)) {
		return {
			kind: "robots_skipped",
			reason: `robots.txt for ${url.host} disallows ${url.pathname}`,
		};
	}

	let lastError = "";
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt > 0) await delay(RETRY_DELAY_MS);
		try {
			const response = await fetchWithTimeout(rawUrl);
			if (response.ok) return { kind: "ok", html: await response.text() };
			lastError = `HTTP ${response.status}`;
			// Client errors won't heal on retry; server errors and timeouts might.
			if (response.status < 500) break;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}
	return { kind: "failed", reason: lastError };
}
