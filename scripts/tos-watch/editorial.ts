import {
	capExcerpts,
	findLoadedLanguage,
	type LoadedLanguageViolation,
	type TosChangeReport,
} from "../../src/lib/tos-watch";

// The editorial gate between model output and the public record. Two jobs:
// enforce the 25-word excerpt cap in code (the prompt asks; this guarantees),
// and scan the model's own prose for the forbidden loaded-language list. A
// loaded-language hit means the entry is NOT auto-published - the caller
// logs it and files an ops issue so editorial control stays with the owner.

export interface EditorialResult {
	report: TosChangeReport; // excerpts hard-truncated
	violations: LoadedLanguageViolation[]; // non-empty => do not publish
}

export function applyEditorialGate(raw: TosChangeReport): EditorialResult {
	// explainTosChange already caps excerpts at the pipeline boundary; this
	// re-application is a cheap idempotent belt-and-braces for callers that
	// construct reports some other way.
	const report = capExcerpts(raw);
	return { report, violations: findLoadedLanguage(report) };
}
