# Notes — Story 1: Pan and zoom around an infinite board

Story 1 is complete: all `npm run build`, `npm run typecheck`, `npm run test:unit`
(16), `npm run test:component` (19) and `npm run test:e2e` (14) pass.

## Decisions & deviations

1. **Vitest 3 (not 2).** The design specifies `vitest.config.ts` `test.projects`.
   `test.projects` only exists in Vitest 3, and Vitest 2 pulls a mismatched Vite
   5 that broke `@vitejs/plugin-react` typing under `typecheck`. Upgrading to
   Vitest 3 fixed both. `@playwright/test` and `vite` are on their current majors.

2. **Firefox project gated behind `E2E_FIREFOX=1`.** The design's browser matrix is
   Chromium, Firefox and WebKit. Firefox launches its own macOS process sandbox
   (`sandbox_init`), which this execution sandbox forbids
   ("sandbox_init() failed with error 'Operation not permitted'"), so Firefox
   cannot start *here* regardless of the app. `npm run test:e2e` runs Chromium +
   WebKit (both pass) and includes Firefox automatically when `E2E_FIREFOX=1` is
   set in an environment that allows it. This follows the task allowance that
   "Chromium is sufficient if other browsers are not installed".

3. **E2E runs against `wrangler dev`.** `playwright.config.ts` `webServer` =
   `npm run build:test && npx wrangler dev`, serving `dist/client` via the
   `assets` config in `wrangler.jsonc` (`not_found_handling: single-page-application`).
   A minimal passthrough `src/worker/index.ts` is present because `wrangler`
   requires a `main`; story 3 replaces it with the real collaboration worker.

4. **Test hook exclusion from production is verified.** `window.__vidi6` lives in
   `src/client/testHooks.ts`, imported only inside `if (import.meta.env.MODE ===
   'test')`. In `vite build` (production) the whole branch is dead-code eliminated:
   the production bundle contains no `__vidi6` string and no testHooks chunk.
   `vite build --mode test` emits a lazily-imported testHooks chunk for e2e.

5. **`useCamera(viewport, initial?)`.** The documented contract is
   `useCamera(viewport)`. An optional second argument seeds the starting camera
   so the hint test can start a camera *at a limit* without a `setCamera` call
   that would itself trip the "has navigated" latch (TC-29 requires that a no-op
   at a limit does NOT dismiss the hint).

6. **`__vidi6.setCamera` / rAF coalescing.** Per the design, camera mutations are
   batched with `requestAnimationFrame` (at most one render per frame) and the
   "has navigated" latch trips only when `camera.math` returns a *new* object.
   `__vidi6.setCamera` (test-only) applies immediately. Component tests fake
   timers and advance past one frame to flush; e2e (real browsers) runs rAF for
   real, so e2e clicks poll for the coalesced update rather than assuming it
   landed synchronously (TC-25 polls with `expect.poll` + a forced click, since
   clicking a disabled button is a no-op).

7. **Origin marker + `data-*` readouts.** A crosshair marker is rendered at world
   (0,0) in every build as a stable pixel target for e2e (per the Fixtures note).
   The viewport also mirrors camera numbers into `data-cam-x/-y/-zoom` and
   `data-transform` attributes, and the origin screen position into a
   `origin-screen` span, because jsdom does not do layout/hit-testing and does not
   serialise `style.transform`. E2e reads real `getBoundingClientRect` /
   `getComputedStyle` in real browsers instead.

8. **TC-23 / TC-27 "a grid dot moves exactly".** The dot grid is a CSS
   `background-image`, so an individual dot has no DOM node. These tests assert the
   exact origin-marker movement (±1px, real layout) plus the exact change in
   `background-position` and an unchanged `background-size` (= `GRID_SPACING_WORLD
   * zoom`), which together prove the grid pans and scales with the board.

9. **Real Safari pinch and trackpad hardware** are manual checks only, per the
   test strategy "Not covered": Playwright WebKit cannot synthesise a native
   `GestureEvent`, so the `gesturestart/change/end` handler is covered by a
   synthetic `Event` in the component test (TC-17). TC-24/TC-31 dispatch a real
   `WheelEvent` with `ctrlKey` in the browser to exercise the non-passive
   listener and confirm page zoom / devicePixelRatio are untouched.

10. **`zoomStep` snap.** Steps use `zoomAt(centre, ZOOM_STEP_FACTOR | 1/…)`. To
    avoid float drift, a resulting zoom within a relative epsilon
    (`ZOOM_STEP_SNAP_EPSILON * value`) of a power of `ZOOM_STEP_FACTOR` snaps to
    that power, so a step in then a step out returns to exactly 1.0 (TC-09).

11. **`panBy` clamps at ZOOM_MAX far away.** `panBy` divides the screen delta by
    zoom (no re-basing). Doubles keep sub-pixel precision well beyond
    ±1,000,000 world units (TC-02/TC-04/TC-27), as the coordinate model states.

12. **Pointer capture breaks if the dragged note is reordered mid-drag.** The
    `z`-ordered snapshot drives DOM order, so calling `bringToFront` on drag
    *start* moves the note's DOM node to the end; in a real browser that drops
    the active pointer capture, `lostpointercapture` fires, and the drag stalls
    with the note unmoved. This bit only when the dragged note was *not*
    already topmost (a single-note drag passed). Fix: select on drag start but
    defer `bringToFront` to pointer-up, after the pointer is released, so the
    final stacking is identical with no mid-drag reorder.

13. **Colour assertions read `rgb(...)`, not the `#RRGGBB` we set.** Both jsdom
    and Chromium normalise `style.background` to `rgb()/RGB()` in
    `getComputedStyle`, so `colorOf` / e2e parse the triplet and rebuild a
    canonical `#RRGGBB` before comparing to `STICKY_COLORS`.

## Not implemented (out of scope by instruction)
Presence, offline copies, sign-in, dashboard, comments, export, Yjs/Durable
Objects, minimap, view persistence, mobile/touch panning, arrow-key panning, and
zoom-to-fit content. Stories 6 and 13–17 hooks are intentionally left out.
