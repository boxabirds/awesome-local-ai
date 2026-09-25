# vidi6 — infinite collaborative whiteboard

Client scaffold for the vidi6 whiteboard: Vite + React + TypeScript, served
locally by Cloudflare Workers Assets (`wrangler dev`), the same server used in
production.

## Status

Story 1 — *Pan and zoom around an infinite board* — is implemented: pointer-drag
panning, Ctrl/Cmd + wheel and pinch zoom with 10%/400% clamps, a camera-relative
dot grid, zoom controls, a first-use navigation hint, and `Reset view`. There is
no board content, storage or collaboration yet (stories 2+).

See `spec/stories/001-pan-and-zoom-around-an-infinite-board/` for the
specification and `NOTES.md` for implementation notes, camera maths and
deviations.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-safe client build into `dist/client` |
| `npm run build:test` | Same, in `test` mode (installs `window.__vidi6`) |
| `npm run preview` | Serve `dist/client` with `wrangler dev` on :8787 |
| `npm run typecheck` | `tsc --noEmit` over src, tests, worker and config |
| `npm run test:unit` | Vitest, node: camera maths and the camera store |
| `npm run test:component` | Vitest, jsdom: BoardViewport, ZoomControls, NavigationHint |
| `npm run test:e2e` | Playwright: builds in test mode, serves with wrangler |
| `npm run test` | unit + component + e2e |
| `npm run deploy` | `npm run build && wrangler deploy` |

## Layout

```
index.html
playwright.config.ts        device matrix, wrangler webServer
src/shared/config.ts        camera, input and grid constants (single source)
src/client/main.tsx         mount root
src/client/App.tsx          CameraProvider + BoardViewport + BoardOverlays
src/client/canvas/camera.ts     pure camera maths (pan/zoom/clamp/convert)
src/client/canvas/useCamera.ts  CameraStore + React hooks + useViewportSize
src/client/canvas/BoardViewport.tsx  input surface, grid, world layer
src/client/canvas/ZoomControls.tsx   -, percentage, +, Reset view
src/client/canvas/NavigationHint.tsx first-use hint
src/client/canvas/testHooks.ts       window.__vidi6 (test mode only)
tests/unit/                 node environment
tests/component/            jsdom environment
tests/e2e/                  Playwright against wrangler
```
