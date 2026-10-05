# vidi6

A shared board for thinking together.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on <http://127.0.0.1:27840> |
| `npm run build` | Production client build into `dist/` (what gets deployed) |
| `npm run build:test` | Same build with `MODE=test`, so the e2e tests can drive the board |
| `npm run serve:e2e` | `wrangler dev` serving `dist/` as static assets on port 27840 |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run test:unit` | Camera maths tests (node) |
| `npm run test:component` | Component tests (jsdom) |
| `npm run test:e2e` | Playwright navigation tests against `wrangler dev` |

See `PROGRESS.md` for what is implemented and `NOTES.md` for deviations and
blocked items.
