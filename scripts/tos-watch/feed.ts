import type { ChangelogEntry } from "../../src/lib/tos-watch";

// RSS 2.0 feed of changelog entries - a first-class deliverable, not an
// afterthought: the whole point of a standing monitor is that people can
// subscribe and forget it. Regenerated from the full changelog on every
// change day and served as a static file, like everything else public here.

const SITE_URL = "https://dliamkin.com";
const PAGE_URL = `${SITE_URL}/projects/tos-watch`;
const FEED_ITEM_LIMIT = 50;

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// RFC 822 dates, as RSS 2.0 requires. detected_at is a date (not a moment);
// midnight UTC keeps it honest without inventing a time of day.
function rfc822(isoDate: string): string {
	return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toUTCString();
}

function itemDescription(entry: ChangelogEntry): string {
	if (!entry.report.substantive) {
		return entry.report.cosmetic_note ?? "Cosmetic change detected (formatting or wording only).";
	}
	const counts = entry.report.changes.length;
	return `${entry.report.summary} (${counts} change${counts === 1 ? "" : "s"} detected by automated comparison - see the full entry for excerpts and details.)`;
}

export function buildFeed(entries: ChangelogEntry[], generatedAt: Date = new Date()): string {
	const items = entries
		.slice(0, FEED_ITEM_LIMIT)
		.map((entry) => {
			const title = `${entry.service_name} · ${entry.document_label} - change detected ${entry.detected_at.slice(0, 10)}`;
			return [
				"    <item>",
				`      <title>${escapeXml(title)}</title>`,
				`      <link>${escapeXml(PAGE_URL)}</link>`,
				`      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>`,
				`      <pubDate>${rfc822(entry.detected_at)}</pubDate>`,
				`      <description>${escapeXml(itemDescription(entry))}</description>`,
				"    </item>",
			].join("\n");
		})
		.join("\n");

	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
		"  <channel>",
		"    <title>ToS Watchdog - dliamkin.com</title>",
		`    <link>${escapeXml(PAGE_URL)}</link>`,
		"    <description>Automated nightly monitoring of terms-of-service and policy documents. Entries describe detected changes in neutral, plain English. Not legal advice; not affiliated with any monitored service.</description>",
		"    <language>en-us</language>",
		`    <lastBuildDate>${generatedAt.toUTCString()}</lastBuildDate>`,
		`    <atom:link href="${escapeXml(`${SITE_URL}/tos-watch/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
		items,
		"  </channel>",
		"</rss>",
		"",
	].join("\n");
}
