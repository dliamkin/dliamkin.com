import semver from "semver";

// Phase 1 of the Dependency Upgrade Planner: everything in this file is
// deterministic and runs in the visitor's browser. The npm registry API is
// CORS-enabled and keyless, so the browser talks to it directly - no request
// ever touches this site's serverless infrastructure, and this phase costs
// nothing. Version math, deprecation flags, and peer-conflict detection are
// all computed here in tested code; the model (phase 2, upgrade-planner.ts)
// only ever receives these facts and is forbidden from altering them.
//
// scripts/generate-upgrade-samples.mjs runs the same functions in Node to
// snapshot the bundled samples' facts, and the unit tests inject a mock fetch
// - hence the injectable fetchImpl.

// Enforced client-side (analyze the first N, tell the visitor) AND
// server-side (reject bigger plan requests). Bounds both registry courtesy
// and the synthesis call's input size.
export const MAX_ANALYZED_DEPENDENCIES = 150;

// A 150-dependency package.json is ~6KB - this cap only exists so the
// textarea can't be fed a novel. Client-side only: the manifest itself never
// leaves the browser.
export const MAX_MANIFEST_CHARS = 50_000;

// Registry courtesy: at most this many in-flight registry requests.
export const REGISTRY_CONCURRENCY = 8;

// Per-request timeout; each lookup gets one retry before its row degrades to
// a "lookup failed" entry (a single bad package never sinks the run).
export const REGISTRY_TIMEOUT_MS = 10_000;

export type DependencySection = "dependencies" | "devDependencies";

// One detected peer-dependency conflict, attached to the package whose latest
// version declares the requirement. Both kinds are computed with semver range
// math - never guessed.
export interface PeerConflict {
	package: string; // the package whose latest declares the peer requirement
	peer: string; // the peer package, also present in this manifest
	required_range: string; // what `package`'s latest requires of `peer`
	kind: "declared_range_excluded" | "peer_latest_excluded";
	message: string; // human-readable, rendered verbatim in the UI and sent to the model
}

// The unit of ground truth. This exact object drives the facts table, and a
// trimmed projection of it (upgrade-planner.ts, toPlanRequestFacts) is the
// only thing the synthesis endpoint ever receives.
export interface DependencyFact {
	name: string;
	section: DependencySection;
	declared_range: string;
	resolved_floor: string | null; // lowest published version satisfying the
	// declared range (best effort without a lockfile - the UI says so)
	latest: string;
	majors_behind: number;
	minors_behind: number; // only counted when majors_behind is 0
	patches_behind: number; // only counted when minors_behind is also 0
	is_current: boolean; // the declared range already satisfies latest
	floor_deprecated: boolean;
	latest_deprecated: boolean;
	deprecation_message: string | null;
	engines_node: string | null; // engines.node of latest, when declared
	peer_conflicts: PeerConflict[];
	npm_url: string;
	repository_url: string | null; // from registry metadata when provided
}

// Non-registry specifiers (file:, git, workspace:, aliases, dist-tags) are
// listed for the visitor rather than silently dropped.
export interface SkippedDependency {
	name: string;
	section: DependencySection;
	declared_range: string;
	reason: string;
}

export interface FailedLookup {
	name: string;
	section: DependencySection;
	declared_range: string;
	reason: string;
}

export interface DependencyFacts {
	facts: DependencyFact[];
	skipped: SkippedDependency[];
	failures: FailedLookup[];
	total_declared: number; // registry-analyzable entries found in the manifest
	truncated: boolean; // more than MAX_ANALYZED_DEPENDENCIES declared
}

// ---------------------------------------------------------------------------
// Manifest parsing

export class ManifestParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManifestParseError";
	}
}

export interface ManifestEntry {
	name: string;
	section: DependencySection;
	range: string;
}

export interface ParsedManifest {
	entries: ManifestEntry[]; // registry-analyzable, dependencies first
	skipped: SkippedDependency[];
	packageName: string | null;
}

// JSON.parse's error position, turned into the offending line with a caret -
// a pasted package.json with a trailing comma should point at the comma, not
// say "invalid JSON".
function describeJsonError(text: string, error: SyntaxError): string {
	const match = /position (\d+)/.exec(error.message);
	if (!match) return error.message;
	const position = Number(match[1]);
	const before = text.slice(0, position);
	const lineNumber = before.split("\n").length;
	const lineStart = before.lastIndexOf("\n") + 1;
	const lineEnd = text.indexOf("\n", position);
	const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trimEnd();
	const column = position - lineStart;
	const shortReason = error.message.split(" in JSON")[0] ?? error.message;
	return `Invalid JSON at line ${lineNumber}: "${line.trim()}" (${shortReason.toLowerCase()}, column ${column + 1})`;
}

function nonRegistryReason(range: string): string | null {
	if (range.startsWith("file:")) return "local file dependency";
	if (range.startsWith("link:")) return "linked dependency";
	if (range.startsWith("workspace:")) return "workspace dependency";
	if (range.startsWith("npm:")) return "npm alias";
	if (
		range.startsWith("git+") ||
		range.startsWith("git:") ||
		range.startsWith("github:") ||
		/^[\w.-]+\/[\w.-]+(#|$)/.test(range)
	) {
		return "git dependency";
	}
	if (range.startsWith("http:") || range.startsWith("https:")) return "URL tarball";
	if (semver.validRange(range) === null) return `unresolvable range "${range}"`;
	return null;
}

export function parsePackageJson(text: string): ParsedManifest {
	if (text.trim().length === 0) {
		throw new ManifestParseError("Paste or upload a package.json first - the input is empty.");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ManifestParseError(
			error instanceof SyntaxError
				? describeJsonError(text, error)
				: "That doesn't look like valid JSON.",
		);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ManifestParseError("A package.json must be a JSON object.");
	}
	const manifest = parsed as Record<string, unknown>;

	const entries: ManifestEntry[] = [];
	const skipped: SkippedDependency[] = [];
	const seen = new Set<string>();
	for (const section of ["dependencies", "devDependencies"] as const) {
		const value = manifest[section];
		if (value === undefined) continue;
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			throw new ManifestParseError(`"${section}" must be an object of name → range pairs.`);
		}
		for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
			if (typeof range !== "string") {
				skipped.push({
					name,
					section,
					declared_range: String(range),
					reason: "range is not a string",
				});
				continue;
			}
			// dependencies wins over a duplicate devDependencies entry - npm
			// installs it once.
			if (seen.has(name)) continue;
			seen.add(name);
			const reason = nonRegistryReason(range.trim());
			if (reason !== null) {
				skipped.push({ name, section, declared_range: range, reason });
			} else {
				entries.push({ name, section, range: range.trim() });
			}
		}
	}

	if (entries.length === 0 && skipped.length === 0) {
		throw new ManifestParseError(
			"No dependencies found - this package.json has no dependencies or devDependencies to analyze.",
		);
	}
	return {
		entries,
		skipped,
		packageName: typeof manifest.name === "string" ? manifest.name : null,
	};
}

// ---------------------------------------------------------------------------
// Registry metadata

// Abbreviated metadata (Accept: application/vnd.npm.install-v1+json) carries
// everything the version math needs - dist-tags, the version list, per-version
// deprecation, peerDependencies, engines - at a fraction of the full
// document's size. What it does NOT carry is the repository URL, so a second,
// tiny `/{name}/latest` request fills that in; its failure is non-fatal
// (repository_url stays null, the deterministic npm link always works).
interface AbbreviatedVersion {
	version: string;
	deprecated?: string | boolean;
	peerDependencies?: Record<string, string>;
	engines?: { node?: string };
}

interface AbbreviatedDoc {
	"dist-tags": Record<string, string>;
	versions: Record<string, AbbreviatedVersion>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RegistryOptions {
	fetchImpl?: FetchLike;
	registryUrl?: string;
	concurrency?: number;
	timeoutMs?: number;
	// Fires as each package's lookup settles - the UI streams table rows in.
	onProgress?: (settled: number, total: number, fact: DependencyFact | null) => void;
}

async function fetchWithTimeoutAndRetry(
	fetchImpl: FetchLike,
	url: string,
	accept: string,
	timeoutMs: number,
): Promise<Response> {
	const attempt = async (): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetchImpl(url, {
				headers: { accept },
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	};
	try {
		const response = await attempt();
		// Retry server-side hiccups once; 4xx are definitive.
		if (response.status >= 500) return attempt();
		return response;
	} catch {
		return attempt();
	}
}

function encodePackageName(name: string): string {
	// Scoped packages keep the @ but encode the slash: @scope%2fname.
	return name.replace("/", "%2f");
}

// Hierarchical distance: a major bump makes minor/patch counts meaningless,
// so only the highest differing component is reported.
export function versionsBehind(
	floor: string,
	latest: string,
): { majors: number; minors: number; patches: number } {
	const from = semver.parse(floor);
	const to = semver.parse(latest);
	if (!from || !to) return { majors: 0, minors: 0, patches: 0 };
	const majors = Math.max(0, to.major - from.major);
	if (majors > 0) return { majors, minors: 0, patches: 0 };
	const minors = Math.max(0, to.minor - from.minor);
	if (minors > 0) return { majors: 0, minors, patches: 0 };
	return { majors: 0, minors: 0, patches: Math.max(0, to.patch - from.patch) };
}

function repositoryToUrl(repository: unknown): string | null {
	const raw =
		typeof repository === "string"
			? repository
			: repository !== null &&
				  typeof repository === "object" &&
				  typeof (repository as { url?: unknown }).url === "string"
				? (repository as { url: string }).url
				: null;
	if (raw === null) return null;
	// Normalize the common registry forms (git+https://…​.git, git://,
	// github:user/repo) to a clickable https URL.
	if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw}`;
	const cleaned = raw
		.replace(/^git\+/, "")
		.replace(/\.git$/, "")
		.replace(/^git:\/\//, "https://")
		.replace(/^ssh:\/\/git@/, "https://")
		.replace(/^github:/, "https://github.com/");
	return cleaned.startsWith("https://") || cleaned.startsWith("http://") ? cleaned : null;
}

async function lookupPackage(
	entry: ManifestEntry,
	fetchImpl: FetchLike,
	registryUrl: string,
	timeoutMs: number,
): Promise<DependencyFact | FailedLookup> {
	const fail = (reason: string): FailedLookup => ({
		name: entry.name,
		section: entry.section,
		declared_range: entry.range,
		reason,
	});

	let doc: AbbreviatedDoc;
	try {
		const response = await fetchWithTimeoutAndRetry(
			fetchImpl,
			`${registryUrl}/${encodePackageName(entry.name)}`,
			"application/vnd.npm.install-v1+json",
			timeoutMs,
		);
		if (response.status === 404) return fail("not found on the npm registry");
		if (!response.ok) return fail(`registry answered ${response.status}`);
		doc = (await response.json()) as AbbreviatedDoc;
	} catch {
		return fail("lookup failed (network or timeout)");
	}

	const latest = doc["dist-tags"]?.latest;
	if (typeof latest !== "string" || !doc.versions?.[latest]) {
		return fail("registry metadata has no latest version");
	}
	const latestMeta = doc.versions[latest];

	// The lowest published version the declared range accepts - the best
	// available floor without a lockfile. semver.minVersion is the fallback
	// when the range matches nothing published (e.g. a range beyond latest).
	const published = Object.keys(doc.versions).filter((v) => semver.valid(v));
	const satisfying = published
		.filter((v) => semver.satisfies(v, entry.range, { includePrerelease: false }))
		.sort(semver.compare);
	const resolvedFloor = satisfying[0] ?? semver.minVersion(entry.range)?.version ?? null;

	const behind = resolvedFloor
		? versionsBehind(resolvedFloor, latest)
		: { majors: 0, minors: 0, patches: 0 };
	const floorMeta = resolvedFloor ? doc.versions[resolvedFloor] : undefined;
	const latestDeprecation = latestMeta.deprecated;
	const floorDeprecation = floorMeta?.deprecated;
	const deprecationMessage =
		typeof latestDeprecation === "string" && latestDeprecation.length > 0
			? latestDeprecation
			: typeof floorDeprecation === "string" && floorDeprecation.length > 0
				? floorDeprecation
				: null;

	const fact: DependencyFact = {
		name: entry.name,
		section: entry.section,
		declared_range: entry.range,
		resolved_floor: resolvedFloor,
		latest,
		majors_behind: behind.majors,
		minors_behind: behind.minors,
		patches_behind: behind.patches,
		is_current: semver.satisfies(latest, entry.range),
		floor_deprecated: Boolean(floorDeprecation),
		latest_deprecated: Boolean(latestDeprecation),
		deprecation_message: deprecationMessage,
		engines_node: latestMeta.engines?.node ?? null,
		peer_conflicts: [], // filled by detectPeerConflicts once all lookups settle
		npm_url: `https://www.npmjs.com/package/${entry.name}`,
		repository_url: null,
	};

	// Second, non-fatal request: `/{name}/latest` is the only lightweight way
	// to get the repository URL (the abbreviated document omits it).
	try {
		const response = await fetchWithTimeoutAndRetry(
			fetchImpl,
			`${registryUrl}/${encodePackageName(entry.name)}/latest`,
			"application/json",
			timeoutMs,
		);
		if (response.ok) {
			const meta = (await response.json()) as {
				repository?: unknown;
				peerDependencies?: unknown;
			};
			fact.repository_url = repositoryToUrl(meta.repository);
		}
	} catch {
		// repository link stays null - the npm link is always available.
	}

	// Stash latest's peerDependencies for the conflict pass without widening
	// the public interface.
	peerDepsByFact.set(fact, latestMeta.peerDependencies ?? {});
	return fact;
}

// latest-version peerDependencies per fact, kept out of DependencyFact so the
// payload sent to the server stays lean. WeakMap: entries die with the facts.
const peerDepsByFact = new WeakMap<DependencyFact, Record<string, string>>();

// The gold feature: for every package's latest version, check its declared
// peerDependencies against the OTHER packages in this same manifest. Two
// deterministic conflict kinds:
//   declared_range_excluded - the manifest's declared range for the peer has
//     no overlap with what latest requires ("upgrading X to latest means
//     bumping Y beyond your declared range") → a sequencing constraint.
//   peer_latest_excluded - even the peer's latest version doesn't satisfy the
//     requirement ("X's latest doesn't support Y's latest yet") → a holdback.
export function detectPeerConflicts(
	facts: DependencyFact[],
	peerDepsFor: (fact: DependencyFact) => Record<string, string> = (fact) =>
		peerDepsByFact.get(fact) ?? {},
): void {
	const byName = new Map(facts.map((fact) => [fact.name, fact]));
	for (const fact of facts) {
		for (const [peerName, requiredRange] of Object.entries(peerDepsFor(fact))) {
			const peer = byName.get(peerName);
			if (!peer || semver.validRange(requiredRange) === null) continue;
			const conflicts: PeerConflict[] = [];
			if (!semver.satisfies(peer.latest, requiredRange)) {
				conflicts.push({
					package: fact.name,
					peer: peerName,
					required_range: requiredRange,
					kind: "peer_latest_excluded",
					message: `${fact.name}@${fact.latest} requires ${peerName} ${requiredRange}, but ${peerName}'s latest is ${peer.latest} - even a full upgrade of ${peerName} won't satisfy it.`,
				});
			}
			let intersects = true;
			try {
				intersects = semver.intersects(peer.declared_range, requiredRange);
			} catch {
				// Unparseable combination - no verdict, no conflict.
			}
			if (intersects === false && semver.satisfies(peer.latest, requiredRange)) {
				conflicts.push({
					package: fact.name,
					peer: peerName,
					required_range: requiredRange,
					kind: "declared_range_excluded",
					message: `${fact.name}@${fact.latest} requires ${peerName} ${requiredRange}, but your declared range for ${peerName} is ${peer.declared_range} - upgrade ${peerName} first (its latest ${peer.latest} satisfies the requirement).`,
				});
			}
			fact.peer_conflicts.push(...conflicts);
		}
	}
}

// ---------------------------------------------------------------------------
// The orchestrator: bounded-concurrency lookups, streaming progress, then the
// cross-package peer-conflict pass.

export async function analyzeDependencies(
	manifest: ParsedManifest,
	options: RegistryOptions = {},
): Promise<DependencyFacts> {
	const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
	const registryUrl = options.registryUrl ?? "https://registry.npmjs.org";
	const concurrency = options.concurrency ?? REGISTRY_CONCURRENCY;
	const timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;

	const truncated = manifest.entries.length > MAX_ANALYZED_DEPENDENCIES;
	const entries = manifest.entries.slice(0, MAX_ANALYZED_DEPENDENCIES);

	const facts: (DependencyFact | undefined)[] = Array.from({ length: entries.length });
	const failures: FailedLookup[] = [];
	let settled = 0;
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < entries.length) {
			const index = nextIndex++;
			const entry = entries[index];
			if (!entry) break;
			const result = await lookupPackage(entry, fetchImpl, registryUrl, timeoutMs);
			settled += 1;
			if ("latest" in result) {
				facts[index] = result;
				options.onProgress?.(settled, entries.length, result);
			} else {
				failures.push(result);
				options.onProgress?.(settled, entries.length, null);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));

	const resolved = facts.filter((fact): fact is DependencyFact => fact !== undefined);
	detectPeerConflicts(resolved);

	return {
		facts: resolved,
		skipped: manifest.skipped,
		failures,
		total_declared: manifest.entries.length,
		truncated,
	};
}
