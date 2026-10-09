# vidi6

A shared board for thinking together.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on <http://127.0.0.1:22752> |
| `npm run build` | Production client build into `dist/` (what gets deployed) |
| `npm run build:test` | Same build with `MODE=test`, so the e2e tests can drive the board |
| `npm run serve:e2e` | `wrangler dev` serving `dist/` as static assets on port 22753 (inspector 22754) |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run test:unit` | Board model, sticky text and camera maths tests (node) |
| `npm run test:component` | Board viewport, sticky note, text editor and toolbar tests (jsdom) |
| `npm run test:e2e` | Playwright board + sticky note tests against `wrangler dev` on port 22753 (Chromium, Firefox) |

See `PROGRESS.md` for what is implemented and `NOTES.md` for deviations and
blocked items.
