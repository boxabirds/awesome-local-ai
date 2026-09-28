# NOTES

Implementation notes and decisions for **story 1 — Pan and zoom around an infinite board**.

## Stack / layout
- Vite + React 19 + TypeScript client, built to `dist/client`, served statically by
  `wrangler dev` (assets-only config; the Worker `main` arrives in story 3).
- Vitest **2.1.9** does not support inline `test.projects` in a single config file, so the
  two projects (`unit` = node, `component` = jsdom) are defined in `vitest.workspace.ts`.
  `vite.config.ts` holds only the build config (`outDir: dist/client`). The npm scripts
  (`test:unit`, `test:component`) use `vitest run --project <name>` as the design specifies.
- `wrangler.jsonc` is assets-only (no `binding`, no `main`) because wrangler rejects an
  assets binding in an assets-only worker. `compatibility_date` set to `2025-07-18` (the newest
  date the pinned local Workers runtime supports).

## Camera / coordinate model
- `Camera { x, y, zoom }` with `x, y` = world coordinate at the viewport top-left;
  `screen = (world - camera.xy) * zoom`. Doubles give sub-pixel precision far past
  ±1,000,000 world units at `ZOOM_MAX` (TC-02/TC-04/TC-27 pass exactly).
- Named constants in `src/shared/config.ts` (no magic literals in `camera.ts`):
  added `PERCENT_PER_UNIT = 100`, `ZOOM_STEP_SNAP_EPSILON = 1e-9` (step in/out returns exactly
  1.0), and `WHEEL_LINE_HEIGHT_PX` / `WHEEL_PAGE_HEIGHT_PX` for `deltaMode` LINE/PAGE → px.
- `zoomAt` is algebraically pointer-invariant for any finite zoom (including clamped), so
  TC-11 (huge factor) and the 1000-sample property check hold to 1e-6.
- Invalid factor (≤0, NaN, ±Infinity) returns the input camera unchanged, never throws (TC-12).

## Input handling
- Wheel listener is attached natively with `{ passive: false }` (React `onWheel` is passive and
  cannot stop page zoom). It always `preventDefault()`s over the board. `ctrlKey || metaKey`
  → zoom at pointer via `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`; otherwise pan by
  `(-deltaX, -deltaY)` so content moves opposite the scroll direction (native-scroll feel).
- `Ctrl/Cmd + = | - | 0` handled on `window` keydown with `preventDefault` (stops page zoom).
- Safari `gesturestart/gesturechange/gestureend` handled: `preventDefault`, zoom by scale ratio
  around the pointer. TC-17 covers the handler logic; **real Safari pinch is a manual check**
  (Playwright WebKit cannot synthesise `GestureEvent`), per the test strategy "Not covered".
- Pan only starts when the `pointerdown` target is the viewport itself (the world layer and the
  origin crosshair are `pointer-events: none`, so later board-object stories can `stopPropagation`).
- Camera updates are coalesced with `requestAnimationFrame` to at most one render per frame.
- Viewport size comes from a `ResizeObserver`; resize never recomputes the camera, so content
  stays put relative to the top-left (TC-07).

## Components / wiring decisions
- **BoardViewport props:** the design's illustrative contract `BoardViewport({ children })` is
  expanded to `{ camera, viewportRef, api, children }` so the viewport can render the transform
  and forward input to the `useCamera` handlers while `App.tsx` keeps the camera state that
  `ZoomControls`/`NavigationHint` also read. `children` is still rendered in world coordinates.
- **`useCamera`** returns one extra handler `gesture(scale, point)` (beyond the design's listed
  `beginPan/panMove/endPan/wheel/zoomStep/reset`) to route Safari pinch into `zoomAt`.
- **`hasNavigated`** is a ref-backed latch: a no-op camera update (the same object returned by
  `camera.math` at a zoom limit or for a zero-length drag) neither re-renders nor trips it, so a
  click-without-moving or a no-op zoom at a limit does **not** dismiss the hint (TC-29).
- The navigation hint and camera are not persisted: a page reload shows the hint again (PRD).

## Test-only camera hook
- `window.__vidi6.setCamera()` is installed only when `import.meta.env.MODE === 'test'`
  (`src/client/canvas/testHooks.ts`). It is eliminated from production builds
  (`vite build`) — verified: `__vidi6` does not appear in the production bundle. E2E runs against
  a `vite build --mode test` (the `build:test` script) served by `wrangler dev`, so e2e can jump
  far away (TC-26/TC-27) without dragging a million pixels.

## jsdom notes (component tests)
- jsdom's `PointerEvent` does not carry `clientX`, so pan tests dispatch `MouseEvent` of the
  pointer type (React delegates by event name); coordinates arrive correctly.
- Timers/rAF are faked with `vi.useFakeTimers()` and flushed inside `act()` to flush the camera's
  rAF coalescing deterministically.

## E2E / browsers
- Playwright runs Chromium, Firefox and WebKit (all installed). `npm run test:e2e` sets
  `MOZ_DISABLE_CONTENT_SANDBOX=1 MOZ_DISABLE_GPU_SANDBOX=1` because Firefox's macOS content
  sandbox cannot `sandbox_init()` under this CI environment; without it Firefox fails to launch
  (not an app defect). This matches the harness rule that Chromium alone would suffice if a
  browser is unavailable — here all three pass.
- The e2e server (`webServer`) builds in test mode then serves `dist/client` with `wrangler dev`,
  exercising the same static-serving path production will use.
- `page.mouse.wheel` with Control held is treated by the board as zoom and `preventDefault`ed, so
  `window.visualViewport.scale` stays 1 and page zoom is never triggered (TC-24/TC-31).
- Origin crosshair is a 20×20 box centred on world (0,0) so `boundingBox()` returns a stable
  screen centre for the ±1px pixel checks (TC-23/TC-26/TC-27).

## Manual checks recorded as not-automated (per test strategy)
- Smoothness / frame rate, real Safari pinch, trackpad hardware inertia, and Safari `gesture`
  with a real trackpad are manual checks; they are explicitly "Not covered" in the design.
- Touch-screen / mobile input is out of scope for this story.
