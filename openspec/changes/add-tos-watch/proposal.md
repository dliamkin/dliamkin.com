## Why

Terms-of-service and policy documents change silently - services and institutions revise them without announcement, and nobody keeps a public, dated record. This project assembles components already proven elsewhere on the site (the lease-diff mechanical-diff + model pipeline, the site-health scheduled-CI/report-commit pattern, the eval framework) into a flagship public utility: a nightly watchdog over 17 policy documents (9 University of Florida policies + 8 consumer-service documents) that publishes a neutral, plain-English changelog and RSS feed whenever a document changes. Hash comparison makes unchanged days cost zero AI spend, so the monitor is nearly free to run standing.

## What Changes

- New config `watchdog/services.json`: 11 monitored entries (16 documents; Reddit's privacy policy was dropped during the shake-out - it redirects to a client-rendered page with no text in the HTML, and the posture is drop, not work around) - UF-majority list approved by the owner - each with id, name, enabled flag, and per-document label/URL/optional CSS selector.
- New fetch/extract/normalize/hash layer (`scripts/tos-watch/`): honest User-Agent, robots.txt compliance, volatile-fragment stripping so date bumps never false-positive, content hashing.
- New pipeline `src/lib/pipelines/explain-tos-change.ts`: paragraph-level mechanical diff → Claude (claude-sonnet-5 default, `TOS_WATCH_MODEL` override) explains only the changed blocks; cosmetic gate; forced tool use.
- New shared schema: `TosChange` / `TosChangeReport` / `ChangelogEntry` with `impact: favors_provider | favors_user | neutral | unclear` (note: `favors_provider`, not `favors_company` - providers include university departments).
- Editorial safety layer (post-processing): excerpt hard-cap at 25 words, forbidden loaded-language scan (violations file an ops issue instead of auto-publishing), "detected on {date}" dating only.
- New nightly workflow `.github/workflows/tos-watch.yml` (cron offset from site-health/evals, `workflow_dispatch`, `[skip ci]` commits, deduped ops issues on 3 consecutive fetch failures).
- New private snapshot repo `dliamkin/tos-snapshots` (full normalized text, latest + rolling ~10 dated snapshots per document; never published) accessed in CI via fine-grained PAT secret `TOS_SNAPSHOT_PAT`.
- New public state: `public/tos-watch/state.json`, `changelog.json` (append-only, ~500 cap with archive overflow), `feed.xml` (RSS - first-class deliverable).
- New page `src/views/TosWatchView.vue` at `/projects/tos-watch`: service grid, filterable changelog feed, visible disclaimers, honest empty state, standard accordion (raw JSON + write-up), eval badge; homepage teaser card.
- New offline eval suite `tos-watch` on the `/evals` dashboard with synthetic "Acmecloud" fixtures, plus no-model unit tests for the fetch/normalize/hash layer.

## Non-Goals

- No republishing of document text: the public site carries only generated summaries and quoted excerpts ≤ 25 words. Full text lives only in the private snapshot repo, solely for diffing.
- No editorializing: no motive attribution, no loaded language ("quietly", "buried"), no advice about accepting terms or leaving services.
- No claims about *when* a change was made - only when it was first detected.
- No crawling beyond the exact configured URLs; no workarounds for bot-resistant sites (they get dropped instead).
- No logos or brand assets; text names only.
- No real-time monitoring - nightly granularity is the design point.

## Priority

1. Fetch/extract/normalize/hash layer + unit tests (the false-positive defense; everything depends on it).
2. Snapshot storage + baseline run (starts the clock on real monitoring).
3. Explain pipeline + fixtures + eval suite (the trust layer before anything publishes).
4. Public page + feed.
5. Workflow end-to-end + go-live.

## Testing Strategy

- **Unit-tested (offline, no model)**: normalization/volatile-fragment stripping (a pair differing only in a "last updated" date must hash identically), excerpt truncation, loaded-language scanner, feed generation, changelog append/cap logic.
- **Eval suite (model, fixture-driven, offline documents)**: planted substantive changes found with correct category and impact direction; cosmetic-only pair gates `substantive: false`; excerpts ≤ 25 words and verbatim-contained in fixture text (anti-fabrication); zero loaded-language violations; no invented changes.
- **Integration (controlled, live)**: read-only shake-out fetch against the approved list; end-to-end mutation test against a fixture URL (entry published, feed regenerated, snapshot rotated, `[skip ci]` respected, no self-trigger); dead-URL unreachable handling with issue dedupe.

## Rollback Plan

- Any service can be paused via its `enabled` flag without losing history.
- The whole monitor stops by disabling the workflow (or deleting `tos-watch.yml`); public state files simply stop updating and the page renders its last-known data with honest timestamps.
- A bad published entry is removable by editing `changelog.json` and regenerating the feed (append-only by convention, but the owner retains editorial control - the loaded-language gate routes suspect output to review rather than publishing).
- Full removal: delete the workflow, `scripts/tos-watch/`, the pipeline, the view/route, and `public/tos-watch/`; the private snapshot repo can be archived independently.

## Capabilities

### New Capabilities

- `tos-watch-monitoring`: nightly fetch, extraction, normalization, hashing, and change detection over the configured document set, including failure handling and ops-issue escalation.
- `tos-watch-explain-pipeline`: the mechanical-diff + model pipeline that turns a detected change into a neutral, schema-conformant report, including the cosmetic gate and editorial safety post-processing.
- `tos-watch-publishing`: public state/changelog/feed artifacts, their commit convention, and the retention/cap rules.
- `tos-watch-page`: the `/projects/tos-watch` page, homepage teaser, and its display/filtering/empty-state behavior.
- `tos-watch-evals`: the offline eval suite and its dashboard/badge integration.

### Modified Capabilities

(none - all existing specs are untouched; the project reuses site-health/evals *patterns*, not their specs)

## Impact

- **New code**: `watchdog/services.json`, `scripts/tos-watch/`, `src/lib/pipelines/explain-tos-change.ts`, `src/lib/tos-watch.ts` (shared schema/helpers), `src/views/TosWatchView.vue`, route in `src/router/index.ts`, homepage teaser, eval suite under `scripts/evals`, `.github/workflows/tos-watch.yml`, `public/tos-watch/*`.
- **External**: new private GitHub repo `dliamkin/tos-snapshots`; new Actions secret `TOS_SNAPSHOT_PAT` (fine-grained PAT scoped to that repo); Anthropic API usage only on change days (a few calls/month expected).
- **Dependencies**: reuses the existing diff dependency and Anthropic SDK; likely adds an HTML-to-text/extraction helper (small, e.g. existing DOM parsing already in repo - resolved in design).
- **No breaking changes**; no existing pipelines, workflows, or pages are modified beyond the homepage teaser card and router addition.
