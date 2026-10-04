import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";
import sharp from "sharp";
import {
	AUDIT_PAGES,
	DESKTOP_VIEWPORT,
	MAX_SCREENSHOT_EDGE_PX,
	MOBILE_VIEWPORT,
	SITE_ORIGIN,
} from "../../src/lib/site-health";

export interface Screenshot {
	path: string;
	label: string;
	viewport: "desktop" | "mobile";
	file: string;
	base64: string; // JPEG, longest edge ≤ MAX_SCREENSHOT_EDGE_PX
}

// Saved as workflow artifacts (14-day retention) so the exact images the
// model saw can be inspected after the fact. Gitignored - screenshots never
// enter the repo; the report's visual_fingerprint text is the only memory
// carried between runs.
export const ARTIFACT_DIR = path.resolve("site-health-artifacts");

const VIEWPORTS = [
	{ name: "desktop" as const, size: DESKTOP_VIEWPORT },
	{ name: "mobile" as const, size: MOBILE_VIEWPORT },
];

export async function captureScreenshots(): Promise<Screenshot[]> {
	await mkdir(ARTIFACT_DIR, { recursive: true });
	const browser: Browser = await chromium.launch();

	try {
		const shots: Screenshot[] = [];
		for (const { name, size } of VIEWPORTS) {
			const context = await browser.newContext({
				viewport: size,
				...(name === "mobile" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
			});
			const page = await context.newPage();
			for (const audited of AUDIT_PAGES) {
				const url = `${SITE_ORIGIN}${audited.path}`;
				console.log(`Screenshot: ${url} (${name})`);
				await page.goto(url, { waitUntil: "networkidle" });
				// Let fonts, entrance animations, and lazy images settle.
				await page.waitForTimeout(1500);
				const png = await page.screenshot({ fullPage: true });
				const jpeg = await sharp(png)
					.resize(MAX_SCREENSHOT_EDGE_PX, MAX_SCREENSHOT_EDGE_PX, {
						fit: "inside",
						withoutEnlargement: true,
					})
					.jpeg({ quality: 75 })
					.toBuffer();
				const slug = audited.path === "/" ? "home" : audited.path.slice(1).replace(/\//g, "-");
				const file = path.join(ARTIFACT_DIR, `${slug}--${name}.jpg`);
				await writeFile(file, jpeg);
				shots.push({
					path: audited.path,
					label: audited.label,
					viewport: name,
					file,
					base64: jpeg.toString("base64"),
				});
			}
			await context.close();
		}
		return shots;
	} finally {
		await browser.close();
	}
}
