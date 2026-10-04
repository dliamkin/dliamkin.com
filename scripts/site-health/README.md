# Nightly AI Site-Health Audit

Every night, [`site-health.yml`](../../.github/workflows/site-health.yml) audits
the **live** site (https://dliamkin.com):

1. **Screenshots** - Playwright captures each audited page at 1280×800 (desktop)
   and 390×844 (mobile), full page, compressed to JPEG (longest edge ≤ 1400 px).
   Saved as workflow artifacts for 14 days; never committed.
2. **Lighthouse** - one mobile run per page: the four category scores plus
   LCP / CLS / TBT. Single runs jitter by ±3 points; the model prompt accounts
   for that.
3. **One model call** - all screenshots + Lighthouse data + the previous
   night's report go to Claude (`claude-sonnet-4-6`) in a single Messages API
   request with a forced `record_health_report` tool. The previous report's
   `visual_fingerprint` sentences are the pipeline's visual memory - no image
   history is kept in git.
4. **Persist** - the report is written to `public/site-health/latest.json`,
   a trimmed entry (scores + status + date) is appended to `history.json`
   (capped at 90 entries), and both are committed with
   `chore(site-health): nightly audit YYYY-MM-DD [skip ci]`. The workflow has
   no `push` trigger, so this commit can never retrigger the audit, and
   Cloudflare Workers Builds honors `[skip ci]` so it doesn't redeploy.
5. **Issue filing** - only when the model sets `should_file_issue` (real
   regressions, not jitter). Dedupe: the `issue_fingerprint` is embedded as a
   hidden HTML comment in the issue body; if an open `site-health` issue
   already carries the same fingerprint, the pipeline comments ("still
   present") at most once per 7 days instead of filing a duplicate.

The site's footer widget (`src/components/SiteHealthWidget.vue`) fetches the
committed JSON at runtime - no API endpoint, no key, no per-visitor cost.
Shared types + tool schema + system prompt live in `src/lib/site-health.ts`.

## Failure behavior

If screenshots, Lighthouse, or the API call fail, the run still completes:
a report with `status: "audit_error"` and the reason is committed, no issue
is filed, and the workflow stays green. The first-ever run (no previous
report) is baseline mode: fingerprints only, no deltas, no issue.

## Run locally

```sh
export ANTHROPIC_API_KEY=sk-ant-…   # or source it from .dev.vars
npm run audit:local -- --no-issue --no-commit
```

- `--no-commit` skips the git commit/push, `--no-issue` skips GitHub issue
  calls - use both for dry runs. Omit both to seed the first real report.
- Issue filing locally also needs `GITHUB_TOKEN` (a PAT with issues scope);
  in CI the default token is used.

## Adjusting things

| What | Where |
| --- | --- |
| Page list | `AUDIT_PAGES` in `src/lib/site-health.ts` (keep ≤ 5, sync with the router) |
| Cron time | `on.schedule.cron` in `.github/workflows/site-health.yml` (UTC!) |
| Regression thresholds | `AUDIT_SYSTEM_PROMPT` in `src/lib/site-health.ts` (currently: drop > 5 points or below 85) |
| Model / token budget | `AUDIT_MODEL` / `AUDIT_MAX_TOKENS` in `src/lib/site-health.ts` (`claude-haiku-4-5` is the cheap fallback) |
| Screenshot sizes | `DESKTOP_VIEWPORT` / `MOBILE_VIEWPORT` / `MAX_SCREENSHOT_EDGE_PX` in `src/lib/site-health.ts` |
| History length | `HISTORY_MAX_ENTRIES` in `src/lib/site-health.ts` |

## Secrets

`ANTHROPIC_API_KEY` lives **only** in GitHub Actions secrets
(repo → Settings → Secrets and variables → Actions). It is read by the SDK
from the environment and never logged, echoed, or committed.
