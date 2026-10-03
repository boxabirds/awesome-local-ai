# vidi6

A shared board for thinking together.

## Story 1 — Pan and zoom around an infinite board

Client-only infinite canvas navigation: pan by drag/scroll, zoom around the
pointer or with buttons and keys, dot grid orientation cues, zoom percentage and
Reset view.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (client) |
| `npm run build` | Production client build into `dist/client` |
| `npm run build:test` | Client build with the e2e test hook (`window.__vidi6`) enabled |
| `npm run e2e:serve` | Build in test mode and serve `dist/client` with `wrangler dev` on port 28736 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | Vitest project `unit` (camera maths) |
| `npm run test:component` | Vitest project `component` (jsdom + Testing Library) |
| `npm run test:e2e` | Playwright against `wrangler dev` (Chromium, Firefox, WebKit) |

Ports default to 28736 (override with `VIDI6_PORT` for Vite, `VIDI6_E2E_PORT`
for the e2e server). Playwright checks which browsers this host can actually
start and skips the others; set `VIDI6_BROWSERS=chromium,firefox,webkit` to
force a list, or `VIDI6_SKIP_BROWSER_PROBE=1` to skip the check. See `NOTES.md`.
