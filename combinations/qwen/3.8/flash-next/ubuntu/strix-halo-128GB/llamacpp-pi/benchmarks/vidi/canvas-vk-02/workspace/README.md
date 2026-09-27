# vidi6

A shared board for thinking together.

## Story 1 — pan and zoom around an infinite board

An infinite dot-grid board you can drag, scroll, pinch and keyboard-zoom without
every zooming the browser page. This story also lays down the repo skeleton the
later stories build on.

## Stack

Vite + React 19 + TypeScript client, served as static assets by a Cloudflare
Worker (`wrangler dev` / `wrangler deploy`). The Worker itself has no code yet —
story 3 adds it — so `assets.directory` in `wrangler.jsonc` points at the built
client.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (hot reload) |
| `npm run build` | Production client build into `dist/client` |
| `npm run build:test` | Same build, `test` mode: adds the `window.__vidi6` camera hook used by e2e |
| `npm run preview` | Vite preview of `dist/client` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit + component tests |
| `npm run test:unit` | Vitest, `node` environment (`tests/unit`) |
| `npm run test:component` | Vitest + Testing Library, `jsdom` (`tests/component`) |
| `npm run test:e2e` | Playwright against `wrangler dev` serving `dist/client` |

`npm run test:e2e` builds the client in test mode and starts `wrangler dev` on
port 8787 (override with `VIDI6_E2E_PORT`). Playwright projects exist for
Chromium, Firefox and WebKit at 1280x800. Firefox and WebKit need GTK system
libraries that not every machine has; when a browser cannot launch, its tests
skip with a reason instead of failing (see `tests/e2e/global-setup.ts`).

```bash
npm install
npx playwright install chromium   # plus firefox, webkit where supported
npm test
npm run test:e2e
```

## Layout

| Path | Purpose |
|---|---|
| `src/shared/config.ts` | Every named setting (zoom limits, step, grid spacing) |
| `src/client/main.tsx`, `src/client/App.tsx` | Entry and top-level layout, owns the camera |
| `src/client/canvas/camera.ts` | Pure camera maths: `screenToWorld`, `worldToScreen`, `panBy`, `zoomAt`, `zoomStep`, `resetCamera`, `canZoomIn`, `canZoomOut`, `zoomPercent` |
| `src/client/canvas/useCamera.ts` | Camera state + input handlers, rAF coalesced |
| `src/client/canvas/BoardViewport.tsx` | Input surface, dot grid, world layer |
| `src/client/canvas/ZoomControls.tsx` | − / % / + / Reset view |
| `src/client/canvas/NavigationHint.tsx` | First-use hint |
| `src/client/canvas/useViewportSize.ts` | Board area size via `ResizeObserver` |
| `src/client/canvas/testHooks.ts` | `window.__vidi6` camera hook, test build only |
| `tests/unit`, `tests/component`, `tests/e2e` | Test suites |

## How navigation works

The camera is `{ x, y, zoom }` where `x, y` is the world coordinate in the
top-left of the board area and `zoom` is screen pixels per world unit. All maths
lives in `camera.ts` with no DOM or React: a screen point is
`(world - camera.xy) * zoom`, a world point is `screen / zoom + camera.xy`.

Rendering is one CSS transform: the world layer is
`scale(zoom) translate(-x, -y)` and the dot grid is a repeating background of
size `GRID_SPACING_WORLD * zoom` positioned from the camera, so the grid is
attached to the board and the board has no edges. Zooming keeps the world point
under the pointer fixed. Zoom is clamped to 10%–400%; at a limit the maths
returns the same camera object, which is what disables the zoom button and keeps
the navigation hint from dismissing.

See `NOTES.md` for decisions taken while implementing, and
`spec/stories/001-pan-and-zoom-around-an-infinite-board/` for the spec.
