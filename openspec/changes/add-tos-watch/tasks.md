## 1. Config and shared types

- [x] 1.1 Create `watchdog/services.json` with the approved 13 entries / 17 documents (9 UF docs; Google, Reddit, GitHub, Anthropic × ToS + Privacy), each with id, name, enabled, documents[{label, url, selector?}]
- [x] 1.2 Create `src/lib/tos-watch.ts`: `TosChangeCategory`, `TosChange`, `TosChangeReport`, `ChangelogEntry` (impact: `favors_provider`), state-file types, and shared helpers (excerpt word-count, id construction)

## 2. Fetch / extract / normalize / hash layer (checkpoint 2)

- [x] 2.1 `scripts/tos-watch/fetch.ts`: fetch with honest User-Agent (`dliamkin-tos-watch (+https://dliamkin.com/projects/tos-watch)`), timeout, one retry; per-host robots.txt check that skips disallowed paths and surfaces skips
- [x] 2.2 `scripts/tos-watch/normalize.ts`: jsdom extraction (configured selector → article/main fallback), boilerplate strip, whitespace collapse, volatile-fragment strip (copyright years; "last updated" captured as metadata, never hashed), SHA-256 hash
- [x] 2.3 Unit tests (`scripts/tos-watch/__tests__/`): normalization fixtures including the pair differing only in a "last updated" date that must hash identically; robots.txt allow/deny cases; extraction fallback
- [x] 2.4 Read-only shake-out run against all 17 live URLs: verify fetchability and extraction quality, record per-document selectors and any volatile patterns into config/tests → owner reviews results; propose swaps for any URL that resists

## 3. Snapshot storage and baseline (checkpoint 3)

- [ ] 3.1 Write owner setup guide and walk through it: create private repo `dliamkin/tos-snapshots`, mint fine-grained PAT (contents read/write on that repo only), add as Actions secret `TOS_SNAPSHOT_PAT`
- [x] 3.2 `scripts/tos-watch/snapshots.ts`: clone/pull private repo, read latest snapshot, write dated snapshot with rolling-10 retention, commit + push
- [x] 3.3 `scripts/tos-watch/state.ts`: read/write `public/tos-watch/state.json` (last-checked, last-changed, hash, consecutive-failures, status) and `changelog.json` append/cap-500/archive-overflow logic, with unit tests
- [ ] 3.4 Baseline run: snapshot all 17 documents, publish zero changelog entries, verify state.json statuses all `monitored`

## 4. Explain pipeline (checkpoint 4)

- [x] 4.1 `src/lib/tos-watch-diff.ts`: paragraph-level `diffArrays` producing changed blocks with surrounding context (diff-blocks only to the model - never both full documents)
- [x] 4.2 `src/lib/pipelines/explain-tos-change.ts`: approved system prompt verbatim, forced tool use, `claude-sonnet-5` default (house model, matches lease pipeline) with `TOS_WATCH_MODEL` override, max_tokens 4000; cosmetic gate handling
- [x] 4.3 Post-processing in `scripts/tos-watch/editorial.ts`: 25-word hard truncation with ellipsis; forbidden loaded-language scan; violation path = log + deduped ops issue, no auto-publish; unit tests with adversarial fixture output (40-word excerpt containing "sneakily" must trip both guards)
- [x] 4.4 Author synthetic "Acmecloud" fixture document pairs in authentic legalese: added arbitration clause, data-sharing expansion, user-favorable refund-window extension, liability cap change, cosmetic-only pair → owner reviews fixtures

## 5. Eval suite (checkpoint 5)

- [x] 5.1 Add `tos-watch` suite under `scripts/evals/suites/` using the fixtures: planted changes found with correct category + impact direction; cosmetic pair yields `substantive: false`; excerpt ≤ 25 words; verbatim containment (anti-fabrication); zero loaded-language violations; change-count cap (no invented changes)
- [x] 5.2 Wire suite into the harness/dashboard/badge plumbing; confirm it runs in `npm run eval` and lands on `/evals`

## 6. Public page and feed (checkpoint 6)

- [x] 6.1 `scripts/tos-watch/feed.ts`: RSS 2.0 generation from changelog entries with unit tests; validate output against a feed validator
- [x] 6.2 `src/views/TosWatchView.vue` at `/projects/tos-watch`: header (explanation, visible disclaimers, RSS link, monitoring counts + last-check relative time), service grid Cards with status Tags and official-doc links, filterable reverse-chronological changelog with expandable entries, quoted-excerpt styling with source links, cosmetic entries as muted lines, loading state, honest empty state
- [x] 6.3 Standard accordion: raw latest JSON + architecture write-up (economics, editorial engineering, assembly story, limitations) in site voice; eval badge
- [x] 6.4 Router entry + homepage teaser card ("ToS Watchdog · N documents monitored · last change detected {date}")
- [x] 6.5 Verify with fixture data: filters do real work, mobile layout, dark/light, `npm run build` + type-check pass

## 7. Workflow end-to-end (checkpoint 7)

- [x] 7.1 `scripts/tos-watch/run.ts` orchestrator + npm scripts `tos-watch:run` / `--dry` (full pipeline against live URLs, no commits, no issues, per-document outcome printout; summary line checked/changed/cosmetic/failed)
- [x] 7.2 `.github/workflows/tos-watch.yml`: cron offset from site-health/evals, workflow_dispatch, permissions contents+issues write, private-repo clone via `TOS_SNAPSHOT_PAT`, `[skip ci]` commits
- [ ] 7.3 Controlled mutation test: point one config entry at a fixture URL, mutate it, verify entry published + feed regenerated + snapshot rotated + `[skip ci]` respected + no self-trigger; then formatting-only mutation gates cosmetic
- [ ] 7.4 Unreachable test: dead URL flips status, no change entry, deduped ops issue after 3 consecutive failures
- [ ] 7.5 Publication audit: no excerpt > 25 words and no full document text anywhere in `public/tos-watch/` or `dist/`

## 8. Go live (checkpoint 8)

- [ ] 8.1 Restore real config, re-baseline any fixture entry, enable the cron, confirm first scheduled run completes cleanly with zero-change summary
- [ ] 8.2 Final review pass with owner; update memory/docs; first real entry arrives on its own schedule
