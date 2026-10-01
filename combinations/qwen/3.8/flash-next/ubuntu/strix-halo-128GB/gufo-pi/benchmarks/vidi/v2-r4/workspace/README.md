# vidi6

A shared board for thinking together.

## What is implemented

**Story 1 — pan and zoom around an infinite board.** A full-window, unbounded
board: drag to move, scroll to pan, pinch or Ctrl/Cmd-scroll to zoom around the
pointer, zoom buttons and Ctrl/Cmd + `=` / `-` / `0`, a live zoom percentage,
and a Reset view control. A dot grid moves with the board, and a first-use hint
explains the gestures until you navigate for the first time.

## Stack

Vite + React 19 + TypeScript client, served as static assets by a Cloudflare
Worker (`wrangler dev`). Stories 2+ add Yjs sync and Durable Objects.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production client build into `dist/client` |
| `npm run typecheck` | Type-checks `src` and `tests` |
| `npm run test:unit` | Vitest unit tests (`tests/unit`) |
| `npm run test:component` | Vitest + Testing Library in jsdom (`tests/component`) |
| `npm run test:e2e` | Playwright against `wrangler dev` (Chromium by default) |
| `npm run test:e2e:all` | Playwright in Chromium, Firefox and WebKit |

The e2e server builds in `test` mode (`npm run e2e:server`), which installs the
`window.__vidi6` camera hook used to jump long distances; the production build
does not contain it. `E2E_PROJECTS` selects Playwright projects
(`chromium,firefox,webkit`), so a host missing the Firefox/WebKit system
libraries can still run the suite.

## Layout

```
src/shared/config.ts        product settings (zoom limits, step, grid spacing)
src/client/main.tsx         entry point
src/client/App.tsx          top-level layout
src/client/canvas/camera.ts  pure camera maths (world <-> screen, pan, zoom, clamp)
src/client/canvas/useCamera.ts camera state + navigation actions (React hook)
src/client/canvas/BoardViewport.tsx  input surface, dot grid, world layer
src/client/canvas/ZoomControls.tsx   -, percentage, +, Reset view
src/client/canvas/NavigationHint.tsx first-use hint
tests/unit tests/component tests/e2e
spec/                       read-only product specification
```

See [NOTES.md](NOTES.md) for decisions taken while implementing the stories.
