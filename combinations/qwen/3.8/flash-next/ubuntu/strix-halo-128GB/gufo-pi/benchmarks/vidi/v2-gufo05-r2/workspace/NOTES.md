# Notes

Decisions and deviations recorded while implementing **story 1 — Pan and zoom
around an infinite board**.

## Followed from the design

- Repository layout, file names and the named settings in
  `src/shared/config.ts` are exactly as specified
  (`ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`, `WHEEL_ZOOM_SENSITIVITY`,
  `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`).
- `camera.ts` implements the pure contract (`screenToWorld`, `worldToScreen`,
  `panBy`, `zoomAt`, `zoomStep`, `resetCamera`, `canZoomIn`, `canZoomOut`,
  `zoomPercent`), immutable cameras, same-object returns for no-ops, and no
  throw for invalid zoom factors.
- Step zoom snaps to `ZOOM_STEP_FACTOR^n` within a named epsilon so
  100% → 125% → 100% is exact (TC-09).
- Non-passive `wheel` listener, Safari `gesturestart`/`gesturechange`
  handlers and the window `keydown` handler for Ctrl/Cmd + `=`, `−`, `0` all
  call `preventDefault`, so page zoom/scroll never changes (TC-24, TC-31).
- Test hook `window.__vidi6.setCamera()` only exists when
  `import.meta.env.MODE === 'test'`; verified: the production bundle contains
  0 occurrences of `__vidi6`, the `--mode test` bundle contains 1.
- e2e runs against `wrangler dev` serving `dist/client` (assets-only config).

## Decisions

1. **Where the camera lives.** The design fixes
   `BoardViewport(props: { children?: ReactNode })` *and* says `App.tsx` wires
   `useCamera` to `ZoomControls`. To satisfy both, `App.tsx` owns
   `useViewportSize()` + `useCamera()` and provides the controller through a
   `CameraContext` exported from `useCamera.ts`; `BoardViewport` reads it with
   `useBoard()`. Children still render inside the world layer, and the
   `ZoomControls` element is a *sibling* of the viewport, so a wheel gesture
   over the controls can never reach the board (TC-30); the controls also stop
   wheel propagation as the design asks.
2. **Extra `useCamera` controller members.** The contract listed
   `camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset`.
   Safari pinch and the test hook need three more: `gestureStart(point)`,
   `gestureZoom(point, scale)` (scale is cumulative, so it is applied to the
   camera snapshotted at `gesturestart`) and `setCamera(camera)`
   (test hook only). Nothing else uses them.
3. **Viewport size source.** The board fills the window, so
   `useViewportSize()` measures `document.documentElement` (falling back to
   `window.innerWidth/innerHeight`) with a `ResizeObserver` when one exists and
   a `resize` listener otherwise. jsdom has no `ResizeObserver`, so component
   tests resize by overriding `window.innerWidth/innerHeight` and dispatching
   `resize`. Camera `x, y` are deliberately untouched on resize (TC-07):
   content keeps its position relative to the top-left.
4. **No-op detection uses values, not identity.** `useCamera` skips an update
   when the new camera has the same `x`, `y` and `zoom` (`sameCamera()` added
   to `camera.ts`), not only when it is the same object. `resetCamera()`
   always builds a new object, so pressing Ctrl/Cmd + 0 while already at the
   standard view must not count as "navigated" and must not dismiss the hint.
5. **Grid dot radius** is a UI choice (1 px, 0.5 px when cells are smaller than
   8 px) so the grid does not turn into a grey wash at 10%. Spacing and offset
   are exactly `GRID_SPACING_WORLD * zoom` and `-x * zoom mod spacing`.
6. **Wheel delta units.** `deltaMode` LINE/PAGE are converted to pixels with
   named constants in `useCamera.ts` (`WHEEL_LINE_PX = 16`,
   `WHEEL_PAGE_PX = 800`).
7. **Absurd wheel deltas.** A delta so large that `exp(-deltaY *
   WHEEL_ZOOM_SENSITIVITY)` overflows to `Infinity` is rejected by the
   camera contract (invalid factor → camera unchanged). Tests use large but
   finite deltas (e.g. `deltaY = -1000` → factor ≈ 22 000, which clamps to
   ZOOM_MAX).
8. **Origin marker.** Rendered in all builds as a crosshair whose 14 px size is
   inverse-scaled, so it is always a stable target for e2e at any zoom. The
   test id is on the visible shape (`width/height > 0`) because Playwright
   treats zero-size elements as invisible.
9. **Drag only from the board surface.** A `pointerdown` starts a pan only when
   `event.target` is the viewport element itself, leaving room for objects in
   stories 2+ to own their pointer events.
10. **`wrangler.jsonc` has no `assets.binding`**: wrangler rejects an assets
    binding in an assets-only Worker ("Cannot use assets with a binding in an
    assets-only Worker"). Story 3 adds `main` and can add the binding back.
11. **Ports.** Everything listens inside the allowed range: `wrangler dev` on
    28736 (inspector 28737), Vite dev/preview default to 28736
    (`VIDI6_PORT` / `VIDI6_E2E_PORT` override).

## Test notes

- Component tests dispatch native events (jsdom has no `PointerEvent`, so
  pointer events are `MouseEvent`s named `pointerdown`/`pointermove`/…, which
  React dispatches by type) inside `act()`, and use fake timers to flush the
  `requestAnimationFrame`-coalesced camera updates.
- Component tests derive the camera from the rendered world-layer transform
  (`scale(zoom) translate(-x px, -y px)`) so they assert what the user sees.
- e2e: 15 tests cover TC-23…TC-28, TC-31 and the three workflows.
- **Blocked on this host: Firefox and WebKit e2e.** The browsers are
  downloaded but the host lacks their system libraries (Firefox:
  `libgtk-3-0t64`; WebKit: `libhyphen.so.0`, `libsecret-1.so.0`,
  `libGLESv2.so.2`, `libx264.so`, …) and the sandbox has no root
  (`sudo` is blocked by "no new privileges"), so they cannot start. The
  Playwright config probes each browser at start-up, skips the ones the host
  cannot run with a printed warning, and runs the rest; `VIDI6_BROWSERS=…`
  forces a specific list. All 15 e2e tests pass in Chromium.
- Not covered, per the design's "Not covered" list: trackpad hardware
  behaviour, Safari `GestureEvent` in e2e (TC-17 covers the handler in jsdom),
  touch input.

## Not implemented (other stories)

Presence/cursors (6), realtime/offline sync (3, 13), sign-in (14), dashboard
(15), comments (16), export (17), and all board objects (2, 7–12). The Worker
entry point is intentionally absent; `wrangler dev` serves static assets only.
