# vidi6

A shared board for thinking together.

## Status

Story 1 — pan and zoom around an infinite board. The board is a client-only infinite
surface: drag to pan, scroll to pan, pinch or Ctrl/Cmd + scroll to zoom around the pointer,
zoom buttons and shortcuts, a live zoom percentage, and Reset view.

## Requirements

- Node 22 and npm.
- Playwright browsers for the e2e suite: `npx playwright install chromium firefox webkit`
  (the suite only runs the browsers that are installed; Chromium is enough).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server for the client (http://localhost:5173) |
| `npm run build` | Production client build into `dist/client` |
| `npm run build:test` | Client build in `test` mode; includes the `window.__vidi6` camera hook used by the e2e suite |
| `npm run preview` | Preview the production build with Vite |
| `npm run typecheck` | `tsc --noEmit` over `src` and `tests` |
| `npm run test:unit` | Vitest unit tests (pure camera maths, node) |
| `npm run test:component` | Vitest + Testing Library component tests (jsdom) |
| `npm run test:e2e` | Playwright tests against `wrangler dev` serving `dist/client` |

To serve the built client the way production does:

```sh
npm run build && npx wrangler dev   # http://127.0.0.1:8787
```

## Layout

```
src/shared/config.ts        product settings (zoom limits, step, grid spacing, …)
src/client/main.tsx         entry point
src/client/App.tsx          layout: board + zoom controls + first-use hint
src/client/canvas/camera.ts      pure camera maths (world <-> screen, pan, zoom, reset)
src/client/canvas/useCamera.ts   camera state + navigation handlers
src/client/canvas/BoardViewport.tsx  input surface, dot grid, world layer
src/client/canvas/ZoomControls.tsx   − / percentage / + / Reset view
src/client/canvas/NavigationHint.tsx first-use hint
tests/unit, tests/component, tests/e2e
```
