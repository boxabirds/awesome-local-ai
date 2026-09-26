# NOTES — Story 1: Pan and zoom around an infinite board

Decisions and deviations from the design spec, as required by the task brief.

## Deviations

None from the component layout: the zoom controls and the navigation hint are
wired in `App.tsx` to `useCamera`, exactly as the design's diagram shows, and
`BoardViewport` owns only the input surface (dot grid + world layer).

## Decisions worth recording

1. **Why TC-30 works (wheel over the controls never reaches the board).**
   The zoom controls are DOM *siblings* of the viewport (both live in
   `.app-root`), so a wheel event starting over the controls never passes
   through the viewport element, which is the only place the native,
   non-passive wheel listener is attached. The controls additionally declare a
   React `onWheel` that calls `stopPropagation`, guarding the rest of the
   document. No `stopImmediatePropagation` or document-level capture is
   needed.

2. **Safari pinch goes through the hook's `wheel()` API.**
   The design's gesture sequence diagram shows a `zoomAtPointer` call, while
   the `useCamera` contract lists only `wheel()`. The `gesturechange` handler
   derives the wheel delta that yields exactly the pinch scale ratio
   (`-ln(ratio) / WHEEL_ZOOM_SENSITIVITY`) and calls `wheel()`, keeping the
   zoom math in one place with no extra hook surface.

3. **Test hook exposes `setCamera` only** — the design's fixture contract
   (`window.__vidi6.setCamera()`, test mode only). E2e reads camera state from
   the rendered origin marker / zoom label instead of a getter. The hook is
   verified absent from the production bundle.

4. **E2E build mode is passed with `vite build --mode test`.**
   The shell variable `MODE` does not control Vite; `import.meta.env.MODE`
   comes from Vite's own `mode` option. `npm run build:e2e` therefore runs
   `vite build --mode test`, which activates `testHooks()` in the e2e bundle.

5. **Wheel `deltaMode` conversion constants.**
   The spec does not give pixel equivalents for line- and page-mode wheel
   deltas. `WHEEL_DELTA_LINE_PX = 16` and `WHEEL_DELTA_PAGE_PX = 800` in
   `src/shared/config.ts` are standard platform approximations; `deltaMode` 0
   (pixels, the default in Chrome/Firefox/WebKit) needs no conversion.

6. **`zoomStep` snaps to the `ZOOM_STEP_FACTOR^n` lattice.**
   Repeated ×1.25 / ÷1.25 accumulates float drift (e.g.
   `1.25 * 0.8 = 0.9999999999999999`). After computing the next zoom, the
   result is snapped to the nearest lattice value when within `1e-9`
   (absolute, `STEP_SNAP_EPSILON` in `camera.ts`), so `+` then `−` returns
   exactly `100%` and the disable check at `ZOOM_MAX` is reliable. The zoom
   anchor is recomputed with the final (snapped) zoom to preserve pointer
   invariance.

7. **Grid shift assertion in TC-23 uses modulo comparison.**
   A dot lattice is periodic: one dot is indistinguishable from the one
   `GRID_SPACING_WORLD` px away. The e2e test asserts that the computed
   `background-position` shifts by `(200, 100) mod spacing`, while the origin
   marker shifts by exactly `(200, 100)` ± 1 px. That is the strictest
   physically meaningful reading of "grid dots and the origin marker move by
   exactly (200, 100) px".

8. **All three e2e browsers ran.**
   The brief allowed "Chromium only if the others are not installed". Here
   Chromium, Firefox and WebKit are all installed
   (`PLAYWRIGHT_BROWSERS_PATH=~/.cache/vidi-agent-ms-playwright`),
   so `npm run test:e2e` runs the full matrix — 12/12 passing.

## Manual checks

- Verified in headless Chromium via a scripted smoke run: drag, plain wheel
  pan, Ctrl+wheel zoom (pointer invariant), keyboard shortcuts, reset, hint
  hide, page zoom unchanged, origin marker pixel-centred at (640, 400) on a
  1280×800 viewport.
- Safari pinch: covered by component test TC-17 (`gesturechange`), per the
  design's "Not covered" strategy (real Safari pinch = manual check).

## Camera math summary

- Transform: world layer uses `transform: scale(zoom) translate(-x px, -y px)`
  with `transform-origin: 0 0`, mapping world `p` to screen
  `(p − camera.xy) × zoom`.
- `resetCamera(viewport)` = `{x: −w/2, y: −h/2, zoom: 1}` → origin centred.
- Grid: `radial-gradient` dots, tile `GRID_SPACING_WORLD × zoom` px, position
  `(−x·zoom) mod spacing` so dots move 1:1 with the board.
- All tunables live in `src/shared/config.ts`; `camera.ts` contains only
  structural 0/1/2 literals besides the named constants.

## Test counts

- Unit (camera): 15 — TC-01…TC-12 + pointer-invariance property check (1000
  seeded cases) + edge helpers.
- Component: 14 — TC-13…TC-18, TC-29, TC-30 (viewport input);
  TC-19…TC-21, TC-32 (zoom controls); TC-22 (hint).
- E2E: 4 workflows × 3 browsers — TC-23, TC-24, TC-25, TC-26, TC-27, TC-28,
  TC-31.
