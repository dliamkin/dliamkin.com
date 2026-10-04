import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import lighthouse from "lighthouse";
import { launch, type LaunchedChrome } from "chrome-launcher";
import { chromium } from "@playwright/test";
import { AUDIT_PAGES, SITE_ORIGIN, type PageAudit } from "../../src/lib/site-health";

export interface LighthouseResult {
	path: string;
	lighthouse: PageAudit["lighthouse"];
}

function categoryScore(lhr: Awaited<ReturnType<typeof lighthouse>>, id: string): number {
	const score = lhr?.lhr.categories[id]?.score;
	return score == null ? 0 : Math.round(score * 100);
}

function metricValue(lhr: Awaited<ReturnType<typeof lighthouse>>, id: string): number | null {
	const value = lhr?.lhr.audits[id]?.numericValue;
	return value == null ? null : Math.round(value * 1000) / 1000;
}

// Runs Lighthouse against each audited page of the LIVE site, one run per
// page with the default mobile emulation. This is a nightly trend, not a
// benchmark - single-run scores jitter by ±3 points or so, and the audit
// prompt is written to account for that.
export async function runLighthouse(): Promise<LighthouseResult[]> {
	// Reuse Playwright's Chromium so CI and local runs exercise the same
	// browser and we don't depend on a system Chrome install. The explicit
	// userDataDir keeps chrome-launcher off process.env.TEMP, which under WSL
	// can hold a Windows-style path that ends up as a literal directory name.
	const userDataDir = await mkdtemp(path.join(os.tmpdir(), "site-health-lighthouse-"));
	const chrome: LaunchedChrome = await launch({
		chromePath: chromium.executablePath(),
		chromeFlags: ["--headless=new", "--no-sandbox"],
		userDataDir,
	});

	try {
		const results: LighthouseResult[] = [];
		for (const page of AUDIT_PAGES) {
			const url = `${SITE_ORIGIN}${page.path}`;
			console.log(`Lighthouse: ${url}`);
			const run = await lighthouse(url, {
				port: chrome.port,
				output: "json",
				logLevel: "error",
				onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
			});
			if (!run) {
				throw new Error(`Lighthouse returned no result for ${url}`);
			}
			results.push({
				path: page.path,
				lighthouse: {
					performance: categoryScore(run, "performance"),
					accessibility: categoryScore(run, "accessibility"),
					best_practices: categoryScore(run, "best-practices"),
					seo: categoryScore(run, "seo"),
					lcp_ms: metricValue(run, "largest-contentful-paint"),
					cls: metricValue(run, "cumulative-layout-shift"),
					tbt_ms: metricValue(run, "total-blocking-time"),
				},
			});
		}
		return results;
	} finally {
		await chrome.kill();
		await rm(userDataDir, { recursive: true, force: true });
	}
}
