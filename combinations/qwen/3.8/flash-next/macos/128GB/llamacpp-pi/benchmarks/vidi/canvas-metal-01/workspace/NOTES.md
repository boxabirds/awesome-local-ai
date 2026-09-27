# Notes

Decisions and deviations made while implementing **story 1 — Pan and zoom around an
infinite board**. The spec in `spec/` is authoritative; nothing there was modified.

## Where the design was followed exactly

- Repository layout, file names, the `src/shared/config.ts` settings (plus extra named
  settings, never magic numbers in components), the `camera.ts` / `useCamera` /
  `BoardViewport` / `ZoomControls` / `NavigationHint` contracts, all exact UI copy
  ("Drag to move around · Ctrl/Cmd + scroll or pinch to zoom", "Reset view") and the
  `aria-label`s ("Zoom out", "Zoom in"; "Reset view" comes from its own text).
- Test levels: `tests/unit` (node), `tests/component` (jsdom), `tests/e2e` (Playwright).
  There are **no integration tests on purpose** — the design states this story has no
  request-handling boundary, so the `integration` level does not apply.
- TC-01 … TC-32 are all implemented (see the mapping table below).

## Decisions worth knowing

1. **Where the controls are wired.** The design wires `ZoomControls` /
   `NavigationHint` in `App.tsx`, but it also puts the camera and the
   `ResizeObserver`-measured viewport size inside `BoardViewport`. Rather than duplicate
   the camera, `BoardViewport` owns `useCamera` and publishes it through
   `BoardCameraContext`; the new `src/client/canvas/BoardOverlay.tsx` consumes that
   context and passes the designed props. `App.tsx` just mounts the board. All prop
   contracts are unchanged.
2. **Two extra hook members.** `useCamera` returns everything the contract lists plus
   `zoomAtPoint(point, factor)` (the design's own gesture sequence calls for
   "zoomAtPointer scale ratio" on Safari `gesturechange`, which nothing else in the
   contract can express) and `setCamera(camera)` (the entry point of the design's
   `window.__vidi6.setCamera()` e2e fixture).
3. **Camera observable in the DOM.** The viewport and world layer mirror the camera on
   `data-camera-x|y|zoom`, and the drag state machine on `data-pan-state`
   (`idle` | `panning`). Component tests need to read the camera (jsdom does not
   resolve CSS transforms) and TC-13 asserts `Idle → Panning → Idle`.
4. **Frame coalescing.** Continuous input (pointer moves, wheel ticks, gesture ticks)
   is coalesced to one commit per animation frame; discrete actions (pointer up,
   button, keyboard, reset, test hook) commit immediately. Component tests flush with
   `flushFrame()` (real timers; `vi.useFakeTimers` and `waitFor` fight over the same
   clock, so the simpler route was chosen).
5. **Initial view and resize.** The first time the board area is measured, the camera is
   set to the standard view (`resetCamera`), so the app opens at 100% with the board's
   start centred. From then on a resize never touches the camera, so content does not
   move relative to the top-left corner of the board area (PRD "Behaviour", TC-07).
6. **Wheel `deltaMode`.** Converted through the named settings `WHEEL_LINE_PX` (16) and
   `WHEEL_PAGE_PX` (800). `PAGE` uses a fixed constant instead of the viewport height so
   the setting stays a product setting; it only affects the rare keyboard-page scroll.
7. **Grid.** `background-size = GRID_SPACING_WORLD * zoom`, offset `(-x*zoom) mod
   spacing`; dot radius is a constant 1 screen pixel (`GRID_DOT_RADIUS_PX`) so dots stay
   crisp at every zoom. `zoomStep` snaps to the nearest `ZOOM_STEP_FACTOR^n` within
   `ZOOM_STEP_SNAP_EPSILON` so 100% → + → − returns exactly 1.0 (TC-09).
8. **Test build.** `window.__vidi6` is installed only when `import.meta.env.MODE ===
   'test'`; `npm run build` (production) contains no `__vidi6` (verified by grep),
   `npm run build:test` does, and the Playwright `webServer` uses the latter.
9. **Serving.** `wrangler.jsonc` is an assets-only Worker (`assets.directory =
   dist/client`, SPA not-found handling). Wrangler rejects an `assets.binding` without a
   `main`, so the binding is left out until story 3 adds Worker code. `npm run dev` is
   the Vite dev server; `npm run serve` and the e2e `webServer` use `wrangler dev`.
10. **Firefox in CI sandboxes.** Playwright's bundled Firefox cannot create its macOS
    content/GPU sandbox here (`sandbox_init() failed`), so the firefox project sets
    `MOZ_DISABLE_CONTENT_SANDBOX`/`MOZ_DISABLE_GPU_SANDBOX` in its launch env.
11. **Browser projects.** `playwright.config.ts` enables every engine whose binary is
    installed (override with `BROWSERS=chromium,firefox,webkit`), so `npm run test:e2e`
    passes on a machine with only Chromium. All three pass locally.
12. **Hint dismissal** counts any camera change, including Reset view and Ctrl+wheel; a
    click without movement and a zoom at a limit produce no camera object and therefore
    keep the hint (TC-22, TC-29).
13. **Not automated** (per the design's "Not covered"): frame-rate smoothness, trackpad
    inertia, real Safari pinch (Playwright cannot synthesise `GestureEvent`; the handler
    is covered by TC-17), touch input, and TC-33 (shortcuts pressed in the browser
    chrome cannot reach the page). The task-3 manual check was performed with a scripted
    Chromium session (grid paints, `grab`/`grabbing` cursor, hint hides, tab focus
    reaches "Zoom out", resize keeps the origin marker at the same pixel).

## Requirement → test map

| PRD anchor | Tests |
|---|---|
| `pan.drag` | TC-01, TC-02, TC-13, TC-14, TC-23, TC-27 |
| `pan.scroll` | TC-15, "the board owns the wheel" (e2e) |
| `zoom.pointer` | TC-03, TC-04, TC-11, TC-16, TC-17, TC-24 |
| `zoom.step` | TC-05, TC-06, TC-09, TC-10, TC-18, TC-25 |
| `zoom.limits` | TC-05, TC-06, TC-10, TC-19, TC-20, TC-25, "zooming out stops at 10%" |
| `zoom.indicator` | TC-21, TC-19/20, TC-25 |
| `view.reset` | TC-08, TC-18, TC-26 |
| `pan.unbounded` | TC-02, TC-04, TC-26, TC-27 |
| `zoom.no_page_zoom` | TC-16/17/18 (`defaultPrevented`), TC-31 |
| `nav.hint` | TC-22, TC-29, TC-28 |
| grid follows the board | unit `grid.test.ts`, TC-13, TC-27 |
| accessibility | ZoomControls tests (names, `aria-live`, disabled state), e2e tab-focus manual check |

## Commands

| Script | What it runs |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` / `build:test` | production client build / `--mode test` build (keeps `window.__vidi6`) |
| `npm run serve` | build + `wrangler dev` serving `dist/client` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` / `test:component` / `test` | Vitest projects |
| `npm run test:e2e` | Playwright against `wrangler dev` (chromium, firefox, webkit) |
