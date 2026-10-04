# NOTES

Decisions and deviations made while implementing Story 1 (pan & zoom around an
infinite board).

## E2E browsers: Chromium only

The design lists Chromium, Firefox and WebKit for the e2e suite. **Only Chromium
is installed on this machine** (`~/.cache/ms-playwright` contains just
`chromium-1243`, matching the Playwright 1.63.0 expectation; no Firefox/WebKit
builds). The `playwright.config.ts` still declares all three projects (matching
the design intent), but the `test:e2e` script runs `--project=chromium` so the
suite is green on this machine. Adding the other browsers later is just a matter
of `npx playwright install firefox webkit` and dropping the `--project` flag.

## Viewport owns the camera; App is a thin shell

The design describes `App` wiring `useCamera` and passing the camera to
`BoardViewport`. In practice `BoardViewport` calls `useCamera` itself and renders
`ZoomControls` and `NavigationHint` internally. This keeps the board a single
self-contained component (it needs the viewport size for camera math anyway) and
leaves `App` as a one-line shell. The observable behaviour and the test seams
(`role=application`, `role=group "Zoom controls"`, the hint text, the zoom label)
are exactly as specified, so no test depends on the internal wiring.

## Camera state and input coalescing

- `Camera = { x, y, zoom }`; `screen = (world - camera) * zoom`.
- **Drag panning is coalesced with `requestAnimationFrame`**: pointermove only
  records the latest pending camera; a single rAF commits it. This makes drags
  smooth and independent of pointer-event frequency. The drag is *accumulative*
  (each move builds on the previous pending value) so a fast drag applies the
  full delta, not just the last event.
- **Wheel zoom, gesture, keyboard and the control buttons commit immediately**
  (no rAF), which keeps those paths deterministic.
- All zoom paths snap to the `1.25^n` step grid to avoid float drift.
- Zoom limits: `ZOOM_MIN = 0.1`, `ZOOM_MAX = 4` (100%→400%). Wheel zoom is
  clamped; the step buttons disable at the limits.

## Test-only camera hook

`window.__vidi6.setCamera(...)` is registered **only in the `test` build mode**
(`import.meta.env.MODE === 'test'`). The e2e web server builds the client with
`vite build --mode test` (the `build:e2e` script) so the far-travel cases
(TC-26/TC-27) can jump the camera. The normal `build` (production) does **not**
include the hook — verified by grepping the built bundle.

## Stable e2e pixel target

A small crosshair **origin marker** at world (0,0) (test id `origin`,
`pointer-events: none`) is the stable reference the e2e tests measure against for
"exact" pan/zoom/reset assertions. It is part of the world layer so it moves and
scales with the board.

## Serving the board for e2e

The board is served by `wrangler dev` (the same static-asset path used in
production), on port **20608** (within the allowed 20608–20623 range).
`wrangler.jsonc` is **assets-only** (no `main`, no asset binding) because Story 1
has no Worker code — an asset binding would require a Worker script and error out.

## Component-test environment notes

- **jsdom has no `PointerEvent`**, so a minimal `PointerEvent` polyfill
  (extending `MouseEvent`) is installed in `tests/component/setup.ts`; without it
  `fireEvent.pointerDown/Move` events carry no `clientX/clientY`.
- A `ResizeObserver` mock reports a 1280×800 size so the board centring runs in
  jsdom (the real browser reports its actual size via the same code path).
- Raw `window.dispatchEvent` / `element.dispatchEvent` calls in the tests are
  wrapped in `act()` so the resulting React state updates flush before assertions.
- **Vitest 3** is used (not 2.x) so it shares the top-level Vite 6 instead of
  bundling a nested Vite 5 — the two Vite type systems conflict under `tsc -b`
  otherwise.

## What is deliberately out of scope for Story 1

Per the PRD, the board is empty in this story: no shapes, no presence, no
persistence, no sign-in. Only navigation (pan/zoom), the dot grid, the zoom
controls, the first-use hint, and the "no page zoom" guarantee are implemented.
