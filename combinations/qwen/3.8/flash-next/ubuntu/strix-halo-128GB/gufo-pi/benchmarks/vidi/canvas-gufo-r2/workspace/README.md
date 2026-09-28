# vidi6

A shared board for thinking together.

## Stack

- [Vite 7](https://vite.dev) + [React 19](https://react.dev) + TypeScript (strict)
- [Vitest 3](https://vitest.dev) for unit and component tests (jsdom)
- [Playwright](https://playwright.dev) for end-to-end tests
- [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
  served by [Wrangler](https://developers.cloudflare.com/workers/wrangler/) in dev and preview

## Layout

```
index.html                 client entry document
src/client/                browser app
  canvas/camera.ts         pure camera maths (no DOM): screen<->world, pan, zoom
  canvas/useCamera.ts      React hook: camera state + input processing
  canvas/BoardViewport.tsx full-window board: grid, world layer, input
  canvas/ZoomControls.tsx  screen-space zoom control
  canvas/NavigationHint.tsx first-use hint
  canvas/testHooks.ts      window.__vidi6, injected only in the test build
src/shared/config.ts       named settings shared by app and tests
tests/unit/                camera maths (pure)
tests/component/           viewport, controls, hint (Vitest + Testing Library)
tests/e2e/                 Playwright, against the built app
spec/                      story specs, design and tasks
```

## Commands

```bash
npm install
npm run dev            # vite dev server
npm run build          # production build to dist/client
npm run preview        # preview the production build
npm run typecheck      # tsc --noEmit
npm run test:unit      # camera maths
npm run test:component # components in jsdom
npm run test:e2e       # Playwright (chromium); builds --mode test and serves via wrangler
npm run test:e2e:all   # also firefox + webkit (needs `playwright install-deps`)
npm run wrangler:dev   # serve dist/client the way production does
```

`test:e2e` starts its own web server (`vite build --mode test && wrangler dev`) on
port 8787 and reuses one if it is already running.

## Story 1 — pan and zoom around an infinite board

The board is an infinite 2D world. The camera is `{ x, y, zoom }` where `x, y` is
the world coordinate at the top-left of the viewport and `zoom` is pixels per
world unit:

```
screen = (world - camera) * zoom
world  = screen / zoom + camera
```

Dragging, plain wheel, `Ctrl/Cmd + =` / `-` / `0`, `Ctrl/Cmd` + wheel and trackpad
pinch all move the camera; nothing ever re-lays-out board content, only the camera
changes. See [`spec/stories/001-pan-and-zoom-around-an-infinite-board/`](spec/stories/001-pan-and-zoom-around-an-infinite-board/prd.md)
for the full requirements, and [`NOTES.md`](NOTES.md) for implementation notes and
deliberate deviations.
