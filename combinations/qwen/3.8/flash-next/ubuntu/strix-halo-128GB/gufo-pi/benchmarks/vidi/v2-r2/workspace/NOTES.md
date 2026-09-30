# vidi6 — Story 1: Pan and zoom around an infinite board

Client-only infinite canvas. A pure camera module drives a DOM viewport (world
layer + CSS dot-grid) positioned with CSS transforms; input handling (pointer
drag, wheel, Safari gesture, keyboard) and zoom controls are React components.

## Status

`npm run build`, `npm run typecheck`, `npm run test:unit`, `npm run test:component`
and `npm run test:e2e` all pass. E2E is verified in **Chromium** (the only
browser engine installed in this environment — see decisions below).

Test coverage mapped to the design's coverage table:
- Unit (`tests/unit/camera.test.ts`): TC-01..TC-12 (+ resize TC-07, reset, step
  sequence/limits, factor edge cases) and the seeded 1,000-case pointer-invariance
  property check.
- Component (`tests/component/`): TC-13..TC-18, TC-29, TC-30 (BoardViewport);
  TC-19, TC-20, TC-21, TC-32 (ZoomControls); TC-22 (NavigationHint latch).
- E2E (`tests/e2e/navigation.spec.ts`): TC-23..TC-27 and TC-31, organised as the
  three story workflows plus the page-zoom negative case.

There is deliberately **no integration layer** in this story (no server / data).

## Repository layout

Follows the design's planned layout. Added on top of the listed files:
`vitest.config.ts`, `playwright.config.ts`, `src/client/styles.css`,
`src/client/global.d.ts`, `src/client/canvas/BoardContext.tsx`,
`tests/component/setup.ts`, `tests/e2e/helpers/board.ts`.

## Key decisions & deviations (noted per task rules)

1. **BoardContext to share one camera.** `BoardViewport` owns the single camera
   via `useCamera` (so it stays self-contained for isolated component tests). A
   small React context (`BoardContext`/`useBoard`) exposes it to the fixed UI.
   `App.tsx` wires `ZoomControls`/`NavigationHint` (stateless, prop-driven per the
   contracts) through an `overlay` slot rendered by `BoardViewport`, so the controls
   render above the world layer without inheriting its transform, while `App`
   remains the wiring point the design describes.

2. **Pointer input via native listeners, not React synthetic events.** React's
   delegated pointer events did not fire under jsdom, and native listeners behave
   identically in jsdom and real browsers and let us use pointer capture.
   `pointerdown` is on the viewport element (drag starts only when the target is
   the board itself, so later object stories can `stopPropagation`); `pointermove`
   / `pointerup` / `pointercancel` are on `window` (events bubble there), and
   `lostpointercapture` on the element. `setPointerCapture` is guarded.

3. **jsdom has no `PointerEvent`.** `tests/component/setup.ts` polyfills a minimal
   `PointerEvent` (extends `MouseEvent`) so handlers see realistic `button`,
   `pointerId`, `clientX/Y` values like a real browser. Also sets
   `IS_REACT_ACT_ENVIRONMENT` for manual dispatch + `act` flushing.

4. **TC-30 (wheel over controls).** The board's non-passive `wheel` listener is a
   native listener on the viewport element (a DOM ancestor of the overlay), so it
   fires during bubbling *before* React's root-delegated `onWheel` on the controls.
   `stopPropagation` alone cannot stop the ancestor. The viewport wheel handler
   therefore also ignores any wheel whose target is inside a `[data-board-ui]`
   overlay (the controls container and the hint carry that attribute) — and does
   not `preventDefault` there, leaving the browser default intact. The controls'
   own `stopPropagation` is kept as belt-and-braces. Verified by both the component
   test and the e2e guard test.

5. **rAF coalescing omitted.** The design mentions batching camera updates with
   `requestAnimationFrame`. React 18/19 already batches all state updates inside a
   single event handler into one render, and discrete events map to discrete
   gestures, so a per-handler functional `setState` is deterministic and simpler to
   test (no fake-timer coupling). Camera updates remain immutable, and camera.math
   returns the *same object* for no-ops so React skips a re-render and the
   `hasNavigated` latch never trips on them (TC-29).

6. **Zoom-step snapping.** `zoomStep` snaps the target zoom to the nearest
   `ZOOM_STEP_FACTOR^n` within `1e-9`, so a step in immediately followed by a step
   out lands on exactly `1.0` ("100%") with no float drift (TC-09). The applied
   zoom is set to the exact snapped value (via an internal `withZoom`), and the
   pointer/centre world point is kept invariant.

7. **E2E serving path.** E2E runs against `wrangler dev` (the path used from day
   one) over a **test-mode** build (`vite build --mode test`) so
   `window.__vidi6.setCamera()` exists (jumping a million units by dragging is
   impractical). Verified: the production build tree-shakes the hook out entirely
   (0 occurrences of `__vidi6` in the bundle); the test build includes it.

8. **Browser projects.** Only Chromium is installed here, so `playwright.config.ts`
   auto-detects installed engines and runs Chromium; Firefox/WebKit projects
   activate automatically when those engines are present. Per the task guidance,
   Chromium is sufficient. Safari pinch (`GestureEvent`) cannot be synthesised by
   Playwright and is covered by the component handler test TC-17 (per strategy).

9. **wrangler.jsonc is assets-only.** A Worker `main` arrives in story 3. Wrangler
   rejects an asset `binding` in an assets-only Worker, so the binding is omitted;
   `assets.directory = ./dist/client` with SPA not-found handling.

10. **Keyboard.** A window `keydown` handler prevents Ctrl/Cmd + `=`/`+`/`-`/`_`/`0`
    (stopping browser page zoom) and maps them to step-in / step-out / reset.
    Alt/Shift combinations are ignored.

11. **Origin marker.** A 0×0 anchor at world (0,0) inside the world layer,
    counter-scaled by `1/zoom` so the crosshair keeps a constant on-screen size.
    Its rendered `getBoundingClientRect` matches the camera model exactly (verified
    at origin and at ±1,000,000 world units), giving e2e a precise pixel target.

12. **Stack versions.** Vite 6 + React 19 + TypeScript 5.7 + Vitest 3 +
    Playwright 1.63 (matching the installed Chromium build) + Wrangler 4.
