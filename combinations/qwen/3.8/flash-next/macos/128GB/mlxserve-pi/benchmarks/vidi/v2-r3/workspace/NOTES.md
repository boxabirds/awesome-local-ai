# Story 1 — Pan and zoom around an infinite board: implementation notes

## Camera model

- `Camera = { x, y, zoom }` where `(x, y)` is the **world coordinate at the
  viewport's top-left corner**. `worldToScreen(p, c) = (p - c) * zoom`,
  `screenToWorld(s, c) = s / zoom + c`. All camera math lives in
  `src/client/canvas/camera.ts` as pure functions (no DOM, unit-tested).
- Zoom is clamped to `[ZOOM_MIN=0.1, ZOOM_MAX=4]`. After every zoom the value
  snaps to the nearest power of `ZOOM_STEP_FACTOR=1.25` when within 2 % — so
  the 100 % → 125 % → 156 % … button ladder lands exactly on powers and the
  button sequence terminates at 400 % / 10 % (this is what makes
  `+`/`−` disable deterministically at the bounds).
- Wheel zoom uses `factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY *
  pixelsPerLine)` with `deltaMode` conversion (lines/pages → px). Trackpad
  pinch on browsers that send `ctrlKey` wheel events falls out of the same
  formula; Safari's `gesturestart/change/end` events are handled separately
  (each `gesturechange` zooms by the scale *ratio* around the pointer) and
  `preventDefault`-ed so the page zoom never changes (TC-24/TC-31).
- Camera mutations are coalesced: a mutable `cameraRef` is updated per event
  and one `requestAnimationFrame` per frame flushes a `setState`. A drag of
  N pointermove events renders once — and because the ref is updated
  immediately, consecutive drags never lose deltas (exactness of TC-23).

## Initial centring and resize

The camera starts at `{0, 0, 1}` and, as soon as the real viewport size is
known (first non-zero `ResizeObserver` report), becomes
`{x: -w/2, y: -h/2, zoom: 1}` — the board's start point sits at the screen
centre. Later resizes deliberately do **not** move content (design decision);
the once-guard also checks `cameraRef.current === INITIAL_CAMERA`, so a
camera set explicitly (e.g. via the e2e test hook) is never clobbered by a
late-flushing centering effect.

## Rendering

- One world layer with `transform: scale(zoom) translate(-x, -y)` and
  `transform-origin: 0 0` — pan and zoom cost nothing and work uniformly at
  1,000,000 units.
- The dot grid is a `radial-gradient` background on the surface:
  `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position = mod(-x*zoom, spacing)` — the modulo keeps every CSS
  number small at any world distance (TC-27).
- The origin crosshair is a world-space marker with
  `transform: scale(1/zoom)` so it keeps constant screen size at any zoom.
  A second marker at world `(1e6, 1e6)` is rendered **only in test builds**
  (`import.meta.env.MODE === 'test'`).

## Test hook

`installTestHooks` (`src/client/canvas/testHooks.ts`) exposes
`window.__vidi6.getCamera/setCamera` for e2e camera teleporting (TC-26/27).
It is imported by `App.tsx` only under `import.meta.env.MODE === 'test'`,
and is verified absent from the production bundle (`grep __vidi6` on
`npm run build` output). `npm run build:test` = `vite build --mode test`;
Playwright's `webServer` runs it behind `wrangler dev` (same asset-serving
path as production Cloudflare Pages).

## Component props superset (deviation from design.md)

Design sketches `BoardViewport` with a `children`-only contract. The
implementation takes `camera` plus interaction callbacks
(`onBeginPan/onPanMove/onEndPan/onWheel/onZoomAtPoint/onZoomStep/onReset/
onViewportSize`) instead of owning the camera itself. This keeps the
component a pure renderer, lets `ZoomControls` and the hint share one camera
state (`useCamera`), and makes both testable. `useCamera` additionally
exposes `zoomAtPoint(point, factor)` for Safari gesture events.

## Test-environment findings (worth knowing)

- **WebKit stale renders:** pointer events are processed synchronously into
  the camera ref, but the DOM render lands a frame later, and WebKit's CDP
  reads can lag input handling. Geometry assertions must first wait for the
  world-layer transform to match `__vidi6.getCamera()` (`settle()` in
  `tests/e2e/helpers/board.ts`) and then poll (`expect.poll`), otherwise a
  ctrl+wheel zoom measured from a stale frame looks 120·zoom px off. With
  that, e2e passes on both Chromium and WebKit.
- **Firefox cannot launch at all in this sandboxed macOS box** (even outside
  Playwright). The `firefox` project exists in `playwright.config.ts` for
  real CI, but `npm run test:e2e` runs `--project=chromium --project=webkit`
  so the suite is green where firefox won't start.
- **Disabled-button click race:** clicking `−` until disabled must not loop
  on `isEnabled()` (the button can become disabled between check and click
  and the click waits forever); the test clicks with a short timeout and
  breaks on the first timeout.

## Grid/keyboard behaviour summary

`Ctrl/Cmd + =/+/−` zoom one step (1.25× / ÷1.25, clamped+snapped),
`Ctrl/Cmd + 0` resets the view; all `preventDefault`-ed so the browser's own
page-zoom shortcuts stay out of the way. Wheel events over the board are
handled with `passive: false` and always `preventDefault`-ed (page never
scrolls/zooms over the board). Non-primary buttons don't start a pan;
`setPointerCapture` failures (WebKit+CDP) degrade gracefully.

## Verification

- `npm run test:unit` — 18 camera tests (TC-01…TC-12 + property check)
- `npm run test:component` — 16 tests (TC-13…TC-22, TC-29, TC-30, …)
- `npm run test:e2e` — 8 tests = TC-23…TC-28, TC-31 × (chromium, webkit)
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass.
