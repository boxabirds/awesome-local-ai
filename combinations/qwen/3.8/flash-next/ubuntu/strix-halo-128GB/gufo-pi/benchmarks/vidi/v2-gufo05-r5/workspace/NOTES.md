# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Environment
- Node v22.22.1. Some transitive packages warn they want `^22.22.2` (EBADENGINE warning only, everything works).
- Playwright browsers are at `PLAYWRIGHT_BROWSERS_PATH=/w/browsers`: Chromium 1243, Firefox 1543, WebKit 2359.
- **Firefox and WebKit cannot start on this machine — blocked.** Firefox exits with
  `XPCOMGlueLoad error ... libgtk-3.so.0: cannot open shared object file`; WebKit reports a longer
  missing list (GTK, GStreamer, flite, and `libicu*.so.74`, while this Ubuntu 26.04 image ships ICU 78).
  Fixing it needs `npx playwright install-deps` (root), but `sudo` is blocked (`no new privileges`) and
  the Ubuntu archives are unreachable (`apt-get download libgtk-3-0t64` cannot locate the package).
  The Firefox/WebKit test code is written and browser-agnostic; only launching is impossible here.
  See "Running the e2e suite" below for how the config handles it.
- Servers use the reserved port range 28816-28831: e2e `wrangler dev` on 28816 (inspector 28817),
  `vite dev` 28820, `vite preview` 28821.

## Running the checks
```bash
npm run build          # production client build (dist/client), excludes the test hook
npm run typecheck      # tsc --noEmit over src, tests and the config files
npm run test:unit      # Vitest project unit  (node)            - 17 tests
npm run test:component # Vitest project component (jsdom)       - 29 tests
npm run test:e2e       # Playwright against `wrangler dev`      - 11 tests per launched browser
npm run dev            # vite dev server on 28820
npm run wrangler:dev   # serve dist/client through wrangler dev on 28816
```
`npm run test:e2e` builds the client with `--mode test` and serves it with `wrangler dev`, i.e. the same
serving path production will use. Set `PLAYWRIGHT_BROWSERS_PATH=/w/browsers` if the browsers are not in
the default cache.

## Running the e2e suite on hosts without every browser
`playwright.config.ts` probes each engine once in the main process and only creates projects for browsers
that actually launch, printing e.g.

```
[vidi6] e2e: skipping "firefox" - its browser cannot launch on this host (missing system libraries;
try "npx playwright install-deps firefox"). Its tests stay in the suite and run on a host that has them.
```

The decision is passed to worker processes through `VIDI6_E2E_ENGINES` (the config file is evaluated again
inside each worker). Setting `VIDI6_E2E_BROWSERS=chromium,firefox,webkit` pins the engine list: a pinned
engine that cannot start makes the run fail, so CI with the system dependencies installed can never
silently drop a browser. On a host with all three (CI with `playwright install-deps`) the same 11 tests
run in Chromium, Firefox and WebKit; here they run in Chromium only.

## Design decisions
- **Where the camera state lives.** The design fixes two component contracts: `useCamera(viewport: Size)` and
  `BoardViewport({ children })`, and also says `App.tsx` wires `ZoomControls`/`NavigationHint` to the camera. To keep
  both signatures exactly as designed, a small `CameraProvider` (`src/client/canvas/CameraProvider.tsx`) owns the
  viewport measurement and the `useCamera` controller and shares them through React context. `App.tsx` renders
  `<CameraProvider>` with `<BoardViewport>` plus a `BoardChrome` component (defined in `App.tsx`) that reads the
  controller from context and passes the props designed for `ZoomControls` and `NavigationHint`.
- **Origin marker.** Rendered as a screen-space overlay inside the viewport (not inside the scaled world layer) and
  positioned at `worldToScreen(camera, {0,0})` with `transform: translate(-50%, -50%)`. This keeps its size constant at
  any zoom and makes the centre of its bounding box exactly the projection of world (0,0), which is what the e2e tests
  measure. It has `pointer-events: none` so it never blocks panning.
- **Panning starts unless the gesture begins on a board object.** Story 1 has no objects, so instead of a whitelist of
  "viewport or grid" the viewport checks `event.target.closest('[data-board-object]')`: panning starts for the
  viewport/grid/world layer and is left alone for objects added by later stories (which set that attribute and stop
  propagation). Covered by a component test that injects such an element.
- **`deltaMode` conversion constants** (`WHEEL_LINE_MODE_PIXELS`, `WHEEL_PAGE_MODE_PIXELS`) and the zoom-step snapping
  tolerance (`ZOOM_STEP_SNAP_TOLERANCE`), `PERCENT` and `GRID_DOT_SIZE_SCREEN` are extra named settings added to
  `src/shared/config.ts` next to the six the design names.
- **Zoom-step snapping happens inside `zoomAt`** (relative tolerance `ZOOM_STEP_SNAP_TOLERANCE`) rather than only in
  `zoomStep`, because `zoomAt` recomputes `zoom * factor`; snapping there means `zoomStep` can hand over the exact
  target zoom and 1.25 → 1.0 is exact (TC-09). Consequence worth knowing: after the zoom is clamped at `ZOOM_MAX`
  (400%) it is off the `1.25^n` lattice, so one step out gives 320% rather than 305% — the e2e test asserts that.
- **`useCamera` additionally exposes `setCamera`** (used by the test-mode `window.__vidi6` hook to jump far away). It
  goes through the same update path as any other camera change.
- **Camera updates are coalesced with `requestAnimationFrame`**; the ref holding the camera is updated synchronously so
  a burst of pointermove events never loses distance, only renders are coalesced. Because of the coalescing, tests
  assert through `expect.poll`/`toHaveText` (or by running a frame) instead of reading synchronously.
- **Initial view** is `resetCamera(size)` once the viewport has been measured (the first measurement is treated as the
  initial layout; later resizes keep `x`, `y` per the design, verified in a manual check: content stays fixed relative
  to the top-left of the board area).
- **Page zoom suppression** is done with a non-passive `wheel` listener on the viewport element (React's `onWheel` is
  passive), Safari `gesturestart`/`gesturechange` handlers, and a window `keydown` handler that prevents Ctrl/Cmd +
  `=`, `-`, `0`. Shortcuts are ignored when the event target is a text field (defensive; story 1 has none).
- **Scroll direction**: a plain wheel moves the camera by `+delta`, i.e. content moves opposite to the scroll
  direction (scroll down → content up, scroll right → content left), matching the PRD's verification text.

## Test technique
- **Component tests drive frames, not wall clock.** `tests/component/helpers.tsx` exposes `runFrames()`, which
  advances the animation frame that the camera update was scheduled on and flushes React. `BoardViewport.test.tsx`
  and `NavigationHint.test.tsx` use `vi.useFakeTimers()` as the design suggests, so frames are deterministic.
- **`ZoomControls.test.tsx` keeps real timers.** `@testing-library/user-event` v14 hangs when Vitest's fake timers
  are installed (its internal waits never run), so the one file that needs realistic pointer/keyboard interaction
  uses real timers. It does not need frame control: `ZoomControls` is stateless.
- **jsdom stubs**: `tests/component/setup.ts` installs a no-op `ResizeObserver` (jsdom has none). The board's first
  measurement falls back to `window.innerWidth/innerHeight` (1024x768 in jsdom), which keeps component expectations
  computable, e.g. the initial camera is `(-512, -384, 1)`.
- **jsdom does not implement key activation of buttons** (Enter/Space on a focused button fires no click), so the
  keyboard-accessibility test asserts tab order and focus, and activates with a click.
- **jsdom has no `GestureEvent`**, so `dispatchGesture` builds a plain cancelable `Event` and defines
  `scale`/`clientX`/`clientY` on it (TC-17).
- **Wheel and key events are dispatched manually** (`dispatchWheel`, `dispatchKey`) because `fireEvent` returns a
  boolean rather than the event, and TC-15/16/17/18 must assert `event.defaultPrevented`.
- **`window.__vidi6` in component tests**: Vitest runs with `MODE=test`, so the hook is registered and component
  tests can read the live camera; e2e uses the same hook through `page.evaluate`.

## Verified manually in Chromium (in addition to the automated suites)
- `visualViewport.scale` stays 1 and `devicePixelRatio` is unchanged after Ctrl+wheel, pinch-style gesture
  events and Ctrl/Cmd + `=`/`-`/`0` (TC-31 is automated too).
- Resizing the window (1280x800 → 1000x700) leaves the marker and the camera untouched: content does not move
  relative to the top-left of the board area.
- Dragging with the pointer outside the window mid-drag ends the drag through `lostpointercapture`, leaving the
  board where it was.
- Cursor is `grab` at rest and `grabbing` while panning.
