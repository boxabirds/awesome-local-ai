# vidi6

A collaborative infinite whiteboard. This repository currently implements **story 1: pan and
zoom around an infinite board** (see `spec/stories/001-pan-and-zoom-around-an-infinite-board/`
and `NOTES.md`).

The board is an effectively unbounded dot grid that you pan by dragging or scrolling and zoom
toward the pointer with a pinch, `Ctrl`/`Cmd` + scroll or `Ctrl`/`Cmd` + `=` / `-` / `0`. Zoom
stays between 10% and 400%; **Reset view** always brings the starting point back to the centre
at 100%, no matter how far away you are. The board never zooms the web page itself.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/client` (test hook compiled out) |
| `npm run build:test` | Build to `dist/client` with the `window.__vidi6` test hook |
| `npm run typecheck` | `tsc --noEmit` over `src`, `tests` and the config files |
| `npm run test:unit` | Vitest, `tests/unit` (node) — pure camera maths |
| `npm run test:component` | Vitest + Testing Library, `tests/component` (jsdom) |
| `npm run test:e2e` | Playwright in Chromium, Firefox and WebKit against `wrangler dev` |

`npm run test:e2e` builds the test bundle and starts `wrangler dev` on `127.0.0.1:8787`
itself; browsers are downloaded by `npx playwright install`.

## Layout

    src/shared/config.ts             named settings (zoom limits, step, grid spacing)
    src/client/canvas/camera.ts      pure camera maths, no DOM
    src/client/canvas/useCamera.ts   camera state + input handlers
    src/client/canvas/BoardViewport.tsx  dot grid, world layer, drag/wheel/pinch/keys
    src/client/canvas/ZoomControls.tsx   − / percentage / + / Reset view
    src/client/canvas/NavigationHint.tsx first-use hint
    src/client/canvas/testHooks.ts   window.__vidi6, test build only
    tests/unit/                      camera maths (+ a 1,000-case property check)
    tests/component/                 viewport input, zoom controls, hint
    tests/e2e/                       three-browser navigation workflows
