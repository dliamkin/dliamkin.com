---
name: verify
description: Build, serve, and drive dliamkin.com (Vue 3 SPA on Cloudflare Workers) to verify changes at the browser surface.
---

# Verifying dliamkin.com changes

## Build + serve the production bundle

```bash
npm run build            # vue-tsc type-check + vite build → dist/client
npm run preview -- --port 4477   # serves dist (includes worker via @cloudflare/vite-plugin)
```

`npm run dev` (scripts/dev.sh) also works for iterative checks and serves
the /api/* worker endpoints with HMR.

## Drive it

Playwright is a devDependency but scratchpad scripts can't resolve it by
package name - import by absolute path:

```js
import { chromium } from "/home/dliamkin/Repositories/dliamkin/node_modules/@playwright/test/index.mjs";
```

Useful flows:
- Homepage `/`: hero banner (dark by default via `html.dark`), portfolio
  wall images (`/images/*.webp`), sections below fold.
- Footer site-health widget: scroll to bottom, click `.health-summary-btn`
  → dialog (`.p-dialog`) lazy-loads the `datatable-*.js` chunk on first
  click. Widget only renders when `/site-health/latest.json` is valid JSON.
- Demo pages under `/projects/*` are route-lazy chunks.

## Gotchas

- Perf-sensitive: the main `index-*.js` chunk must stay lean. Check with
  `page.on("request")` that `datatable`/heavy PrimeVue chunks are NOT
  fetched on initial load of any page.
- Google Fonts stylesheet is async (`media="print"` onload swap) in
  index.html - don't turn it back into a blocking link.
- e2e suite: `npm run test:e2e` (Playwright, playwright.config.ts).
