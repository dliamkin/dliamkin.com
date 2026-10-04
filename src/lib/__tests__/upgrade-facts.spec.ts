import { describe, expect, it } from "vitest";
import {
	analyzeDependencies,
	detectPeerConflicts,
	ManifestParseError,
	MAX_ANALYZED_DEPENDENCIES,
	parsePackageJson,
	versionsBehind,
	type DependencyFact,
	type FetchLike,
} from "../upgrade-facts";

// The deterministic half of the Upgrade Planner - no model, no network. The
// registry is mocked with a tiny in-memory doc set so the version math and
// peer-conflict detection are asserted against known ground truth.

describe("parsePackageJson", () => {
	it("extracts dependencies and devDependencies with their sections", () => {
		const parsed = parsePackageJson(
			JSON.stringify({
				name: "app",
				dependencies: { vue: "^3.4.0" },
				devDependencies: { vitest: "^2.0.0" },
			}),
		);
		expect(parsed.packageName).toBe("app");
		expect(parsed.entries).toEqual([
			{ name: "vue", section: "dependencies", range: "^3.4.0" },
			{ name: "vitest", section: "devDependencies", range: "^2.0.0" },
		]);
	});

	it("points at the offending line for invalid JSON", () => {
		const broken = '{\n\t"dependencies": {\n\t\t"vue": "^3.4.0",\n\t}\n}';
		expect(() => parsePackageJson(broken)).toThrowError(ManifestParseError);
		expect(() => parsePackageJson(broken)).toThrowError(/line \d+/);
	});

	it("rejects empty input and dependency-less manifests with pointed messages", () => {
		expect(() => parsePackageJson("   ")).toThrowError(/empty/);
		expect(() => parsePackageJson('{"name":"x"}')).toThrowError(/[Nn]o dependencies/);
	});

	it("skips non-registry specifiers with reasons instead of failing", () => {
		const parsed = parsePackageJson(
			JSON.stringify({
				dependencies: {
					local: "file:../local",
					repo: "git+https://github.com/a/b.git",
					shorthand: "user/repo",
					ws: "workspace:*",
					alias: "npm:other@^1.0.0",
					tag: "latest",
					ok: "^1.0.0",
				},
			}),
		);
		expect(parsed.entries.map((e) => e.name)).toEqual(["ok"]);
		expect(parsed.skipped.map((s) => s.name).sort()).toEqual([
			"alias",
			"local",
			"repo",
			"shorthand",
			"tag",
			"ws",
		]);
	});

	it("dedupes a package declared in both sections (dependencies wins)", () => {
		const parsed = parsePackageJson(
			JSON.stringify({
				dependencies: { vue: "^3.4.0" },
				devDependencies: { vue: "^3.5.0" },
			}),
		);
		expect(parsed.entries).toHaveLength(1);
		expect(parsed.entries[0]?.section).toBe("dependencies");
	});
});

describe("versionsBehind", () => {
	it("reports only the highest differing component", () => {
		expect(versionsBehind("2.6.14", "3.5.13")).toEqual({ majors: 1, minors: 0, patches: 0 });
		expect(versionsBehind("3.0.0", "5.2.0")).toEqual({ majors: 2, minors: 0, patches: 0 });
		expect(versionsBehind("3.2.0", "3.5.1")).toEqual({ majors: 0, minors: 3, patches: 0 });
		expect(versionsBehind("1.2.2", "1.2.5")).toEqual({ majors: 0, minors: 0, patches: 3 });
		expect(versionsBehind("1.2.3", "1.2.3")).toEqual({ majors: 0, minors: 0, patches: 0 });
	});
});

// ---------------------------------------------------------------------------
// Mock registry

interface MockPackage {
	latest: string;
	versions: Record<
		string,
		{
			deprecated?: string;
			peerDependencies?: Record<string, string>;
			engines?: { node?: string };
		}
	>;
	repository?: string;
}

function mockRegistry(packages: Record<string, MockPackage>): FetchLike {
	return async (url) => {
		const path = new URL(url).pathname.slice(1);
		const [name, tag] = path.endsWith("/latest")
			? [decodeURIComponent(path.slice(0, -"/latest".length)), "latest"]
			: [decodeURIComponent(path), null];
		const pkg = packages[name];
		if (!pkg) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
		if (tag === "latest") {
			return new Response(
				JSON.stringify({ version: pkg.latest, repository: pkg.repository }),
				{ status: 200 },
			);
		}
		const versions = Object.fromEntries(
			Object.entries(pkg.versions).map(([version, meta]) => [version, { version, ...meta }]),
		);
		return new Response(JSON.stringify({ "dist-tags": { latest: pkg.latest }, versions }), {
			status: 200,
		});
	};
}

const REGISTRY = mockRegistry({
	vue: {
		latest: "3.5.13",
		versions: { "2.6.14": {}, "3.4.0": {}, "3.5.13": {} },
		repository: "git+https://github.com/vuejs/core.git",
	},
	"vue-router": {
		latest: "4.5.0",
		versions: {
			"3.6.5": {},
			"4.5.0": { peerDependencies: { vue: "^3.2.0" } },
		},
	},
	"@vue/test-utils": {
		latest: "2.4.6",
		versions: { "2.4.6": { peerDependencies: { vue: "^3.0.1" } } },
	},
	request: {
		latest: "2.88.2",
		versions: {
			"2.88.2": { deprecated: "request has been deprecated" },
		},
	},
	"left-pad": {
		latest: "1.3.0",
		versions: { "1.2.0": {}, "1.3.0": { engines: { node: ">=0.10" } } },
	},
});

async function analyze(manifestJson: object) {
	return analyzeDependencies(parsePackageJson(JSON.stringify(manifestJson)), {
		fetchImpl: REGISTRY,
		registryUrl: "https://mock.registry",
	});
}

describe("analyzeDependencies", () => {
	it("computes floor, behind counts, currency, and repository link", async () => {
		const result = await analyze({ dependencies: { vue: "^3.4.0" } });
		expect(result.failures).toEqual([]);
		const vue = result.facts[0]!;
		expect(vue.resolved_floor).toBe("3.4.0");
		expect(vue.latest).toBe("3.5.13");
		expect(vue.is_current).toBe(true); // ^3.4.0 satisfies 3.5.13
		expect(vue.minors_behind).toBe(1);
		expect(vue.repository_url).toBe("https://github.com/vuejs/core");
		expect(vue.npm_url).toBe("https://www.npmjs.com/package/vue");
	});

	it("flags a major-behind declared range as not current", async () => {
		const result = await analyze({ dependencies: { vue: "^2.6.10" } });
		const vue = result.facts[0]!;
		expect(vue.resolved_floor).toBe("2.6.14");
		expect(vue.majors_behind).toBe(1);
		expect(vue.is_current).toBe(false);
	});

	it("carries deprecation flags and message", async () => {
		const result = await analyze({ dependencies: { request: "^2.88.0" } });
		const req = result.facts[0]!;
		expect(req.latest_deprecated).toBe(true);
		expect(req.deprecation_message).toContain("deprecated");
	});

	it("degrades a missing package to a failure without sinking the run", async () => {
		const result = await analyze({
			dependencies: { vue: "^3.4.0", "no-such-pkg-xyz": "^1.0.0" },
		});
		expect(result.facts).toHaveLength(1);
		expect(result.failures).toEqual([
			{
				name: "no-such-pkg-xyz",
				section: "dependencies",
				declared_range: "^1.0.0",
				reason: "not found on the npm registry",
			},
		]);
	});

	it("streams progress per settled lookup", async () => {
		const seen: (string | null)[] = [];
		await analyzeDependencies(
			parsePackageJson(
				JSON.stringify({ dependencies: { vue: "^3.4.0", "left-pad": "^1.2.0" } }),
			),
			{
				fetchImpl: REGISTRY,
				registryUrl: "https://mock.registry",
				onProgress: (_settled, _total, fact) => seen.push(fact?.name ?? null),
			},
		);
		expect(seen.sort()).toEqual(["left-pad", "vue"]);
	});

	it("truncates past the analysis cap and says so", async () => {
		const dependencies = Object.fromEntries(
			Array.from({ length: MAX_ANALYZED_DEPENDENCIES + 5 }, (_, i) => [`pkg-${i}`, "^1.0.0"]),
		);
		const result = await analyzeDependencies(
			parsePackageJson(JSON.stringify({ dependencies })),
			{ fetchImpl: mockRegistry({}), registryUrl: "https://mock.registry" },
		);
		expect(result.truncated).toBe(true);
		expect(result.total_declared).toBe(MAX_ANALYZED_DEPENDENCIES + 5);
		expect(result.failures).toHaveLength(MAX_ANALYZED_DEPENDENCIES);
	});

	it("detects a declared-range peer conflict end to end", async () => {
		// vue-router 4.5.0's latest requires vue ^3.2.0, but the manifest caps
		// vue at ^2.6.10 - the planted hard conflict.
		const result = await analyze({
			dependencies: { vue: "^2.6.10", "vue-router": "^3.6.0" },
		});
		const router = result.facts.find((f) => f.name === "vue-router")!;
		expect(router.peer_conflicts).toHaveLength(1);
		expect(router.peer_conflicts[0]).toMatchObject({
			package: "vue-router",
			peer: "vue",
			kind: "declared_range_excluded",
		});
	});
});

describe("detectPeerConflicts", () => {
	const fact = (name: string, declared: string, latest: string): DependencyFact => ({
		name,
		section: "dependencies",
		declared_range: declared,
		resolved_floor: null,
		latest,
		majors_behind: 0,
		minors_behind: 0,
		patches_behind: 0,
		is_current: false,
		floor_deprecated: false,
		latest_deprecated: false,
		deprecation_message: null,
		engines_node: null,
		peer_conflicts: [],
		npm_url: `https://www.npmjs.com/package/${name}`,
		repository_url: null,
	});

	it("flags peer_latest_excluded when even the peer's latest can't satisfy", () => {
		const a = fact("plugin", "^1.0.0", "1.0.0");
		const b = fact("framework", "^4.0.0", "4.9.0");
		detectPeerConflicts([a, b], (f): Record<string, string> =>
			f.name === "plugin" ? { framework: ">=5.0.0" } : {},
		);
		expect(a.peer_conflicts).toHaveLength(1);
		expect(a.peer_conflicts[0]?.kind).toBe("peer_latest_excluded");
	});

	it("stays silent when ranges are compatible", () => {
		const a = fact("plugin", "^1.0.0", "1.0.0");
		const b = fact("framework", "^4.0.0", "4.9.0");
		detectPeerConflicts([a, b], (f): Record<string, string> =>
			f.name === "plugin" ? { framework: "^4.0.0" } : {},
		);
		expect(a.peer_conflicts).toEqual([]);
	});

	it("ignores peers not present in the manifest", () => {
		const a = fact("plugin", "^1.0.0", "1.0.0");
		detectPeerConflicts([a], () => ({ "not-in-manifest": ">=2.0.0" }));
		expect(a.peer_conflicts).toEqual([]);
	});
});
