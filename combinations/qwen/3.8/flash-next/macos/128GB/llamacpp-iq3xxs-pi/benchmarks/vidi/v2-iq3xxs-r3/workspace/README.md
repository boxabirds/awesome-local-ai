# vidi6

A shared board for thinking together.

## Running it

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://127.0.0.1:28402 (`DEV_PORT` overrides) |
| `npm run build` | production client build into `dist/client` (types are checked by `npm run typecheck`) |
| `npm run build:test` | same build with `MODE=test`, which adds the `window.__vidi6` test hooks |
| `npx wrangler dev --port 28400 --ip 127.0.0.1 --inspector-port 28401` | serve `dist/client` the way production will be served |
| `npm run typecheck` | `tsc --noEmit` over `src` and `tests` |
| `npm run test:unit` | camera maths (node) |
| `npm run test:component` | viewport / controls / hint (Vitest + Testing Library, jsdom) |
| `npm run test:e2e` | Playwright: builds with `MODE=test`, starts `wrangler dev`, drives real browsers |

Every server this project starts listens inside the allocated range
28400-28415. `vite dev` (28402) and `wrangler dev` (28400/28401) can run at the
same time.

## Story 1: pan and zoom around an infinite board

Drag empty board space to move around; scroll or two-finger swipe to pan;
Ctrl/Cmd + scroll (or pinch on Mac) to zoom towards the pointer, between 10% and
400%; `Ctrl/Cmd` + `=`/`-`/`0` to zoom and reset from the keyboard. The zoom
control (−, percentage, +, Reset view) sits bottom right, the −/+ buttons
disable at the limits, and a first-use hint disappears on the first movement.
Nothing is persisted: reloading returns to 100% with the board start centred.

Camera maths lives in `src/client/canvas/camera.ts` (pure, unit-tested); all
tunable settings live in `src/shared/config.ts`. Per-browser limitations and
design deviations are recorded in `NOTES.md`; task status in `PROGRESS.md`.
