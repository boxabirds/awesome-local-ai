# vidi6

A shared board for thinking together.

## Running it

```bash
npm install
npm run dev        # Vite dev server, http://127.0.0.1:20370
```

| Script | What it does | Port |
|---|---|---|
| `npm run dev` | Vite dev server with HMR | 20370 |
| `npm run build` | Production client build to `dist/client` (no test hooks) | — |
| `npm run build:test` | Client build with the `window.__vidi6` test hook (`--mode test`) | — |
| `npm run preview` | Preview the built client | 20371 |
| `npx wrangler dev` | Serve the built client the way production does | 20368 (inspector 20369) |
| `npm run typecheck` | `tsc --noEmit` (strict) | — |
| `npm run test:unit` | Camera maths tests (node) | — |
| `npm run test:component` | Viewport / controls / hint tests (jsdom) | — |
| `npm run test:e2e` | Playwright navigation tests against `wrangler dev` | 20368 |
| `npm run test` | Unit + component + e2e | — |

`npx wrangler dev` expects a prior `npm run build` (or `npm run build:test` for the e2e build).
Playwright starts the served build itself, and only runs browser projects the machine can actually
launch — see `playwright.config.ts` and `NOTES.md`.

## Layout

```
src/shared/config.ts        numbers and strings the spec pins down
src/client/canvas/camera.ts pure camera maths (screen <-> world, pan, zoom, limits)
src/client/canvas/useCamera.ts  camera state, input coalescing, board controller context
src/client/canvas/BoardViewport.tsx  input surface, dot grid, world layer, origin marker
src/client/canvas/ZoomControls.tsx   −, percentage, +, Reset view
src/client/canvas/NavigationHint.tsx first-use hint
tests/unit tests/component tests/e2e
```

See `PROGRESS.md` for story status and `NOTES.md` for deviations, blocked items and known gaps.
