import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	UI_ANALYSIS_SYSTEM_PROMPT,
	type ComponentMapping,
	type UiAnalysis,
} from "../../../src/lib/ui-analysis";
import {
	ANALYZE_SCREENSHOT_MODEL,
	analyzeScreenshot,
} from "../../../src/lib/pipelines/analyze-screenshot";
import {
	defineSuite,
	fieldEquals,
	fieldIsNull,
	normalized,
	setContains,
	type EvalCase,
} from "../harness";
import type { CheckResult } from "../../../src/lib/evals";

// Eval suite for the Screenshot → PrimeVue demo. Positive cases are the three
// generated demo sample PNGs (rendered from samples-src/ mock pages - the
// ground truth is which components each mock obviously calls for). Negative
// cases are two generated non-UI fixtures (an SVG landscape and a plain prose
// document) that the pipeline must decline to treat as UI screenshots. All
// PNGs come from `npm run generate:screenshot-samples` - nothing downloaded.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface ScreenshotInput {
	pngPath: string; // repo-relative
}

const demoPng = (id: string): ScreenshotInput => ({
	pngPath: `src/assets/demo-samples/${id}.png`,
});
const fixturePng = (id: string): ScreenshotInput => ({
	pngPath: `scripts/evals/fixtures/${id}.png`,
});

const renderMapping = (m: ComponentMapping) =>
	`${m.detected_element} → ${m.primevue_component}`;

// "mappings set-contains a mapping to this component". Matched against the
// primevue_component string, which the model sometimes qualifies
// ("Button (outlined variant)") - hence regex, not equality.
function mapsTo(analysis: UiAnalysis, component: RegExp, expected: string): CheckResult {
	return setContains(
		analysis.mappings,
		expected,
		(m) => component.test(normalized(m.primevue_component)),
		renderMapping,
	);
}

function scaffoldContains(analysis: UiAnalysis, tag: RegExp, expected: string): CheckResult {
	return {
		passed: analysis.scaffold_code !== null && tag.test(analysis.scaffold_code),
		expected,
		actual:
			analysis.scaffold_code === null
				? "scaffold_code is null"
				: tag.test(analysis.scaffold_code)
					? "tag present in scaffold"
					: `scaffold present but tag missing (${analysis.scaffold_code.length} chars)`,
	};
}

// Shared by both non-UI fixtures: rejection must be total - flag false,
// reason given, nothing forced into mappings or scaffold.
const negativeChecks: EvalCase<ScreenshotInput, UiAnalysis>["checks"] = [
	{
		name: "is_ui_screenshot is false",
		run: (a) => fieldEquals(a.is_ui_screenshot, false),
	},
	{
		name: "a polite reason is given",
		run: (a) => ({
			passed: a.reason !== null && a.reason.trim().length > 0,
			expected: "non-null reason explaining the rejection",
			actual: a.reason === null ? "null" : `"${a.reason}"`,
		}),
	},
	{
		name: "no component mappings are forced",
		run: (a) => ({
			passed: a.mappings.length === 0,
			expected: "empty mappings array",
			actual:
				a.mappings.length === 0
					? "empty mappings array"
					: a.mappings.map(renderMapping).join(" | "),
		}),
	},
	{
		name: "no scaffold code is generated",
		run: (a) => fieldIsNull(a.scaffold_code),
	},
];

const cases: EvalCase<ScreenshotInput, UiAnalysis>[] = [
	{
		id: "shot-login",
		description:
			"Generated login mock: recognized as UI; the form maps to input + button components and the scaffold uses them",
		input: demoPng("login"),
		checks: [
			{
				name: "is_ui_screenshot is true",
				run: (a) => fieldEquals(a.is_ui_screenshot, true),
			},
			{
				name: "maps the credential fields to InputText/Password",
				run: (a) =>
					mapsTo(a, /inputtext|password/, "a mapping to InputText or Password"),
			},
			{
				name: "maps the sign-in action to Button",
				run: (a) => mapsTo(a, /button/, "a mapping to Button"),
			},
			{
				name: "scaffold uses an input component",
				run: (a) =>
					scaffoldContains(a, /<(InputText|Password)\b/, "<InputText> or <Password> in scaffold"),
			},
			{
				name: "scaffold uses Button",
				run: (a) => scaffoldContains(a, /<Button\b/, "<Button> in scaffold"),
			},
		],
	},
	{
		id: "shot-dashboard",
		description:
			"Generated analytics-dashboard mock: recognized as UI; the table and chart map to DataTable and Chart",
		input: demoPng("dashboard"),
		checks: [
			{
				name: "is_ui_screenshot is true",
				run: (a) => fieldEquals(a.is_ui_screenshot, true),
			},
			{
				name: "maps the data table to DataTable",
				run: (a) => mapsTo(a, /datatable/, "a mapping to DataTable"),
			},
			{
				name: "maps the chart to Chart",
				run: (a) => mapsTo(a, /chart/, "a mapping to Chart"),
			},
			{
				name: "scaffold uses DataTable",
				run: (a) => scaffoldContains(a, /<DataTable\b/, "<DataTable> in scaffold"),
			},
		],
	},
	{
		id: "shot-pricing",
		description:
			"Generated pricing-page mock: recognized as UI; plan cards map to Card, CTAs to Button, the top nav to Menubar/Toolbar",
		input: demoPng("pricing"),
		checks: [
			{
				name: "is_ui_screenshot is true",
				run: (a) => fieldEquals(a.is_ui_screenshot, true),
			},
			{
				name: "maps the plan tiers to Card",
				run: (a) => mapsTo(a, /card/, "a mapping to Card"),
			},
			{
				name: "maps the CTAs to Button",
				run: (a) => mapsTo(a, /button/, "a mapping to Button"),
			},
			{
				name: "maps the top navigation to Menubar or Toolbar",
				run: (a) => mapsTo(a, /menubar|toolbar/, "a mapping to Menubar or Toolbar"),
			},
			{
				name: "scaffold uses Card",
				run: (a) => scaffoldContains(a, /<Card\b/, "<Card> in scaffold"),
			},
		],
	},
	{
		id: "shot-landscape-rejected",
		description:
			"Generated SVG landscape (no UI elements at all): must be rejected, with no mappings and no scaffold",
		input: fixturePng("eval-landscape"),
		checks: negativeChecks,
	},
	{
		id: "shot-text-document-rejected",
		description:
			"Generated plain prose document (text but no interface): must be rejected, with no mappings and no scaffold",
		input: fixturePng("eval-text-document"),
		checks: negativeChecks,
	},
];

export const screenshotSuite = defineSuite({
	project_id: "screenshot-to-primevue",
	project_label: "Screenshot → PrimeVue",
	model: ANALYZE_SCREENSHOT_MODEL,
	prompt: UI_ANALYSIS_SYSTEM_PROMPT,
	cases,
	execute: (client, input) =>
		analyzeScreenshot(
			client,
			readFileSync(path.join(root, input.pngPath)).toString("base64"),
			"image/png",
		),
});
