# vidi6

A shared board for thinking together.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on <http://127.0.0.1:29440> |
| `npm run build` | Production client build into `dist/` (what gets deployed) |
| `npm run build:test` | Same build with `MODE=test`, so the e2e tests can drive the board |
| `npm run serve:e2e` | `wrangler dev` serving `dist/client` as static assets on port 29440 (inspector 29441) |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run test:unit` | Camera maths, board model and sticky text tests (node) |
| `npm run test:component` | Board, sticky note, editor and toolbar tests (jsdom) |
| `npm run test:e2e` | Playwright tests against `wrangler dev` (starts the server itself) |

All ports are inside the sandbox's allowed range (29440–29455); `E2E_PORT` overrides
the e2e/wrangler port if a run needs a different one.

## What the board does so far

- Story 1: an infinite dot-grid board that pans (drag, wheel) and zooms (Ctrl/Cmd +
  wheel, pinch, `+`/`-` buttons, Ctrl/Cmd + 0, Reset view).
- Story 2: sticky notes — create (toolbar button or double-click on empty board
  space), type (up to 1,000 characters, auto-fitting font, bottom fade and a
  `n/1000` counter near the limit), drag to move and re-stack, recolour from six
  swatches, delete (bin button, Delete or Backspace). Notes live in a client-side
  Yjs document; sharing and persistence come in story 3.

See `PROGRESS.md` for what is implemented and `NOTES.md` for deviations and
blocked items.
