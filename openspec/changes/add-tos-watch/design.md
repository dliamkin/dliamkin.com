## Context

The site (Vue 3 + TypeScript + PrimeVue, Vite, deployed on Cloudflare Workers with GitHub auto-deploy) already contains every component this project needs, in house conventions:

- **Hybrid diff pipeline**: `src/lib/lease-mechanical-diff.ts` (paragraph-level `diffArrays` from the `diff` package, server/script-side only) feeding `src/lib/pipelines/compare-leases.ts` with a favors-whom schema - this project generalizes both.
- **Scheduled CI + report-commit**: `.github/workflows/site-health.yml` and `evals.yml` - nightly cron, `[skip ci]` commits of JSON reports into `public/`, fingerprint-deduped ops issues (`scripts/site-health/issues.ts`).
- **Eval framework**: `scripts/evals/` (harness, suites, fixtures, persist) publishing to the `/evals` dashboard with per-project badges.
- **Page anatomy**: view under `src/views/`, route at `/projects/<slug>`, homepage teaser card, collapsed accordion with raw JSON + architecture write-up.

The owner approved a UF-majority document list (9 University of Florida policy documents + Google/Reddit/GitHub/Anthropic, 17 documents total), confirmed the main repo is public, and chose to have the private snapshot repo set up with guidance at checkpoint 3.

This publishes claims about real organizations' legal documents under the owner's name, so editorial correctness is a design driver, not a nicety.

## Goals / Non-Goals

**Goals:**
- A standing nightly monitor whose unchanged-day cost is zero AI spend.
- A public, dated, neutral changelog + RSS feed that is trustworthy enough to cite.
- Full reuse of house patterns - this is an assembly project, not an invention project.
- Editorial safety enforced *in code* (excerpt caps, loaded-language gate, honest dating), not just in prompts.

**Non-Goals:**
- Republishing document text (public artifacts carry summaries + ≤25-word excerpts only).
- Editorializing, motive attribution, or advice.
- Sub-nightly granularity, or claims about when a change actually occurred.
- Crawling beyond configured URLs or working around bot-resistant sites.
- Logos/brand assets.

## Decisions

1. **HTML extraction via `jsdom` (already a devDependency)** - script-side only, per-document optional CSS selector with `article`/`main`/largest-text-block fallback. Alternative considered: adding `@mozilla/readability`; rejected for now to avoid a new dependency - policy pages are mostly simple server-rendered templates (WordPress for most UF sites), and the selector override covers stragglers. Revisit if the shake-out shows extraction misses.

2. **Normalization as one pure, heavily-tested module** (`scripts/tos-watch/normalize.ts`): selector extraction → boilerplate strip → whitespace collapse → volatile-fragment strip (copyright years; "last updated" lines captured as metadata, never hashed). This module is the false-positive defense; everything downstream trusts it. Hash = SHA-256 of normalized text.

3. **Mechanical diff reuses the `diff` package pattern from the lease engine** but as a new module (`src/lib/tos-watch-diff.ts`, script-side only like `lease-mechanical-diff.ts`) rather than importing the lease-specific one - the lease module carries lease-specific block semantics. Only changed blocks + N surrounding context blocks go to the model; never both full documents (ToS run tens of thousands of words - token-cost control).

4. **Model: `claude-sonnet-5` default (matching the lease pipeline's current house model), `TOS_WATCH_MODEL` env override** (Haiku budget fallback), forced tool use, `max_tokens` 4000. Legal text + published output + very low volume (a few calls/month) justify the better model. System prompt as approved by the owner verbatim (cosmetic gate first; neutral; ≤25-word excerpts; `unclear` over guessing; no advice).

5. **Schema uses `favors_provider`, not `favors_company`** - the monitored set includes university departments. Shared types live in `src/lib/tos-watch.ts` (imported by both the page and scripts, like the lease types).

6. **Two-repo storage.** Private `dliamkin/tos-snapshots` (full normalized text, latest + rolling 10 dated snapshots per document) cloned in CI via fine-grained PAT secret `TOS_SNAPSHOT_PAT`; public repo gets only `public/tos-watch/state.json`, `changelog.json` (cap 500, overflow archive), `feed.xml`. Ordering on a change day: push snapshot to private repo *first*, then commit public files - if the private push fails, the public entry is withheld and the change simply re-detects next night (at-least-once, never phantom entries).

7. **Failure semantics: fetch failure ≠ change.** Failed fetch → `unreachable` status + consecutive-failure increment, entry withheld; 3 consecutive failures → deduped ops issue (label `tos-watch`, reusing the site-health fingerprint approach in a shared or copied `issues.ts`). Model failure on a change day → document marked failed, snapshot NOT rotated (re-detect next run).

8. **Editorial gate in post-processing, not trust-the-model**: hard excerpt truncation at 25 words with ellipsis; forbidden loaded-language list scan; a violation logs the output and files an ops issue instead of publishing - editorial control stays with the owner.

9. **Workflow**: `.github/workflows/tos-watch.yml`, cron offset from site-health and evals, `workflow_dispatch` for manual runs, permissions `contents: write, issues: write`, commits with `[skip ci]`. Runner: `tsx scripts/tos-watch/run.ts`, npm script `tos-watch:run`, with `--dry` executing everything against live URLs with no commits/issues.

10. **Respectful fetching**: honest User-Agent (`dliamkin-tos-watch (+https://dliamkin.com/projects/tos-watch)`), per-host robots.txt check with disallowed paths skipped and surfaced, one fetch per document per night, modest timeout, one retry. Bot-resistant services get dropped, not worked around.

## Risks / Trade-offs

- [Main-content extraction misses changes inside scripts/PDFs or misfires on redesigns] → selector override per document; a redesign shows up as one large detected change, which the model can gate/describe; limitations are stated in the write-up.
- [UF pages share templates - a sitewide template change could fire many "changes" at once] → normalization strips boilerplate/nav before hashing; cosmetic gate catches template-only diffs; per-document isolation means worst case is several cosmetic entries, not false alarms.
- [Volatile-fragment stripping is heuristic; a novel timestamp format could false-positive] → the cosmetic gate is the second line of defense; unit tests encode every observed volatile pattern from the shake-out run.
- [Model mislabels impact/severity on genuinely ambiguous legal text] → schema and prompt make `unclear` a first-class answer; labels are presented on-page as automated assessments; eval bias check (user-favorable planted change) guards direction errors.
- [PAT expiry breaks snapshot pushes] → private-push-first ordering means failures withhold entries rather than corrupt state; the failure files a deduped ops issue.
- [A monitored site adds bot protection later] → unreachable path handles it gracefully; after the ops issue, the owner disables the entry (history retained via `enabled: false`).

## Migration Plan

Deploy is additive (new files only; router + homepage teaser are the only touched files). Sequence: fetch layer + tests → shake-out (read-only) → owner creates private repo + PAT (guided) → baseline run (snapshots all, publishes zero entries, page shows honest empty state) → pipeline/evals/page → controlled-mutation end-to-end test → enable cron. Rollback per proposal: `enabled: false` per service; disable workflow to stop entirely; page degrades gracefully to last-known data.

## Open Questions

- ~~Exact CSS selectors per document~~ - resolved in the shake-out: fallback extraction works for 15 of 16 documents; Reddit's User Agreement uses `#text-content1` (US variant), and Reddit's privacy policy was dropped (client-rendered).
- Whether X/TikTok-style swaps are needed does not apply anymore (list is UF-majority + four bot-friendly consumer services), but the shake-out may still reject a URL; owner approves any swap.
- ~~RSS vs Atom flavor~~ - resolved: RSS 2.0 (widest reader support, simplest to hand-generate).
