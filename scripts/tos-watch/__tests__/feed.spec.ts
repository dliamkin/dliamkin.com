import { describe, expect, it } from "vitest";
import type { ChangelogEntry } from "../../../src/lib/tos-watch";
import { buildFeed } from "../feed";

const entry = (overrides: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
	id: "acmecloud/terms-of-service/2026-07-18",
	service_id: "acmecloud",
	service_name: "Acmecloud",
	document_label: "Terms of Service",
	document_url: "https://example.com/terms",
	detected_at: "2026-07-18",
	report: {
		substantive: true,
		cosmetic_note: null,
		changes: [],
		summary: "The dispute resolution section now requires arbitration.",
	},
	model: "claude-sonnet-5",
	pipeline_version: "1.0.0",
	...overrides,
});

describe("buildFeed", () => {
	it("produces well-formed RSS with the entry as an item", () => {
		const xml = buildFeed([entry()], new Date("2026-07-18T08:00:00Z"));
		expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
		expect(xml).toContain("<rss version=\"2.0\"");
		expect(xml).toContain("Acmecloud · Terms of Service - change detected 2026-07-18");
		expect(xml).toContain(`<guid isPermaLink="false">acmecloud/terms-of-service/2026-07-18</guid>`);
		expect(xml).toContain("<pubDate>Sat, 18 Jul 2026 00:00:00 GMT</pubDate>");
		// Parses as XML (jsdom's DOMParser flags errors via parsererror).
		const doc = new DOMParser().parseFromString(xml, "text/xml");
		expect(doc.querySelector("parsererror")).toBeNull();
		expect(doc.querySelectorAll("item")).toHaveLength(1);
	});

	it("escapes markup-significant characters in model-derived text", () => {
		const xml = buildFeed([
			entry({
				report: {
					substantive: true,
					cosmetic_note: null,
					changes: [],
					summary: `The "terms & conditions" section now covers <scripts>.`,
				},
			}),
		]);
		expect(xml).toContain("&quot;terms &amp; conditions&quot;");
		expect(xml).toContain("&lt;scripts&gt;");
		const doc = new DOMParser().parseFromString(xml, "text/xml");
		expect(doc.querySelector("parsererror")).toBeNull();
	});

	it("describes cosmetic entries via their note and says 'detected', never 'changed on'", () => {
		const xml = buildFeed([
			entry({
				report: {
					substantive: false,
					cosmetic_note: "Sections were renumbered with no change in meaning.",
					changes: [],
					summary: "Cosmetic change.",
				},
			}),
		]);
		expect(xml).toContain("Sections were renumbered");
		expect(xml).toContain("change detected");
		expect(xml).not.toMatch(/changed on/i);
	});

	it("caps the feed at 50 items", () => {
		const entries = Array.from({ length: 60 }, (_, i) =>
			entry({ id: `e${i}`, detected_at: "2026-07-18" }),
		);
		const doc = new DOMParser().parseFromString(buildFeed(entries), "text/xml");
		expect(doc.querySelectorAll("item")).toHaveLength(50);
	});
});
