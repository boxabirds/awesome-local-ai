# vidi6 — story 1: pan and zoom around an infinite board

A collaborative whiteboard, built one story at a time. Story 1 is navigation only:
drag to move around, scroll or pinch to zoom, on an unbounded board with a dot grid
and a zoom control.

Nothing is persisted. Reloading the page starts again at the board's starting point,
at 100%, with that point in the middle of the screen.

## Run it

```bash
npm ci
npm run dev          # Vite dev server
npm run build        # client build into dist/client
npm run preview      # serve dist/client with wrangler dev (http://127.0.0.1:8790)
```

## Navigation

| Input | Result |
| --- | --- |
| Drag the empty board | Pans. The board follows the pointer one-for-one and stops exactly where the pointer is released. |
| Scroll / two-finger swipe | Pans. |
| Ctrl/Cmd + scroll, or pinch | Zooms around the pointer. `Cmd` counts as `Ctrl`, and the Safari `gesturestart/change/end` family is handled too. |
| `Ctrl`/`Cmd` + `=`, `-`, `0` | Zoom in, zoom out by one step, reset to the start view. Other `Ctrl`/`Cmd` combinations are left to the browser. |
| `−` / `+` / `Reset view` | The same three operations on the control in the bottom-right corner. `−` is disabled at 10%, `+` at 400%. |

Zoom stays inside `ZOOM_MIN`…`ZOOM_MAX` (10%…400%) and always keeps the point under
the pointer — or under the centre, for the buttons and keys — fixed. Panning has no
limits in any direction; the maths is exact a million world units away from the start.

The board never scrolls or zooms the browser page: every gesture it consumes has its
default prevented.

## Layout

| Path | What lives there |
| --- | --- |
| `src/shared/config.ts` | Every named setting: zoom limits, step factor, wheel zoom sensitivity, grid spacing, the extent the pan tests travel to. |
| `src/client/canvas/camera.ts` | The camera maths, pure functions, no DOM and no React. |
| `src/client/canvas/useCamera.ts` | Camera state and the navigation operations on it. |
| `src/client/canvas/BoardViewport.tsx` | The input surface, the dot grid and the world layer. |
| `src/client/canvas/ZoomControls.tsx` | `−`, the percentage, `+`, `Reset view`. |
| `src/client/canvas/NavigationHint.tsx` | The first-use hint, shown until the first navigation. |
| `src/worker/index.ts` | Entry point that hands out the built client. |
| `tests/unit`, `tests/component`, `tests/e2e` | Camera maths, jsdom component tests, Playwright navigation tests. |

## Tests

```bash
npx playwright install chromium firefox webkit   # once

npm run test:unit        # camera maths, node
npm run test:component   # viewport input, zoom controls, hint (jsdom)
npm run test:e2e         # Chromium, Firefox and WebKit against wrangler dev
npm run typecheck
```

`npm run test:e2e` builds the client in `test` mode, which compiles in a
`window.__vidi6.setCamera()` hook the tests use to jump a million pixels; the
production build does not contain it. `tests/e2e/NOTES.md` records what could not be
automated (a real trackpad pinch, macOS `Cmd` + wheel, browser page-zoom side effects)
and what is asserted in their place.
