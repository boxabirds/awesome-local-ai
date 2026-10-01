# Notes

Decisions and deviations made while implementing **story 1 — Pan and zoom around an
infinite board**. Nothing here weakens a test; every test case named in
`spec/stories/001-pan-and-zoom-around-an-infinite-board/design.md` is implemented.

## Design contract extensions (not contradictions)

1. **`BoardViewport` props.** The design documents `props: { children?: ReactNode }`, but the
   camera must be shared between the board, the zoom controls and the hint, and the design
   also puts the zoom controls in `App`. Decision: `App` owns `useCamera` (via
   `useViewportSize`) and passes `camera` + `handlers` down to `BoardViewport`, alongside the
   documented `children`. `BoardViewport` stays presentational.
2. **`useCamera` gesture methods.** The documented handler list has no entry point for Safari's
   `gesturestart` / `gesturechange` / `gestureend`, which the viewport contract requires for
   `zoom.pointer` on Safari. Added `beginGesture()`, `gesture({ scale, point })` and
   `endGesture()`; `gesture` applies the *ratio* since the previous event, so a lone
   `gesturechange` with `scale: 2` doubles the zoom (TC-17).
3. **Viewport size.** `useViewportSize()` (in `useCamera.ts`) measures the window with a
   `ResizeObserver` on `document.documentElement`, falling back to the `resize` event where
   `ResizeObserver` is unavailable (jsdom). The board fills the window, and the camera is
   anchored to the viewport's top-left, so a resize never moves content — covered by an e2e
   test at 1280x800 -> 1920x1080.
4. **Extra named settings.** All in `src/shared/config.ts` as required: the six from the
   design plus `ZOOM_STEP_SNAP_EPSILON`, `PERCENT`, `WHEEL_PIXELS_PER_LINE`,
   `WHEEL_PIXELS_PER_PAGE`, `GRID_DOT_RADIUS`, `ORIGIN_MARKER_SIZE`. Tests assert against
   these constants rather than literals.

## Implementation notes

- **rAF coalescing.** `useCamera` applies camera changes through `requestAnimationFrame`
  (at most one render per frame). Component tests therefore use fake timers and flush a frame
  (`advanceFrame()` in `tests/component/boardHarness.tsx`) after each interaction.
- **"Same object means no change."** `camera.ts` returns the input camera when nothing would
  change (limit reached, zero delta, invalid factor). `useCamera` treats an identical camera as
  a no-op: no re-render and **no** hint dismissal. Consequently a click without movement
  (TC-29) and a zoom already at `ZOOM_MIN`/`ZOOM_MAX` leave the first-use hint visible.
- **Step snapping.** `zoomStep` snaps to the nearest `ZOOM_STEP_FACTOR^n` within
  `ZOOM_STEP_SNAP_EPSILON`, so `100% -> 125% -> 100%` is exact (1.25 * 0.8 is not exactly 1 in
  binary floating point). Clamped values are never snapped (400% is not a power of 1.25).
- **Dot grid precision far away.** The grid is a CSS `radial-gradient` whose `background-size`
  is `GRID_SPACING_WORLD * zoom` and whose `background-position` is `-camera.x * zoom` reduced
  **modulo the spacing**, so the CSS value stays small even a million world units out.
  `getComputedStyle` therefore never loses sub-pixel precision (TC-27 asserts movement at
  `UNBOUNDED_PAN_TESTED_EXTENT`). Dot radius is a constant 1 screen px, and dot opacity fades
  below a spacing threshold so 10% zoom does not turn into a grey wash.
- **Pan only from empty space.** A drag starts only when the pointerdown target is the
  viewport, the world layer, or an element marked `data-board-surface`, so story 2's objects
  can own their own dragging. Pointer capture is best-effort (wrapped in `try/catch`: jsdom
  has no `setPointerCapture`). `pointerup`, `pointercancel` and `lostpointercapture` all end the
  drag, leaving the camera where it was.
- **Touch is ignored.** `pointerdown` with `pointerType === 'touch'` does not start a pan, per
  the PRD's explicit non-behaviour ("does not support touch-screen pinch or one-finger drag").
- **Page zoom suppression.** The wheel listener is registered natively with
  `{ passive: false }` (React's `onWheel` is passive) and always calls `preventDefault()` over
  the board; gesture events and `Ctrl/Cmd + = - 0` are prevented too. TC-31 asserts
  `visualViewport.scale`, `devicePixelRatio`, `innerWidth` and the control's computed font size
  are unchanged, and a separate test asserts the page itself never scrolls.
- **Keyboard scope.** The `Ctrl/Cmd + = - 0` handler is attached to `window` because the board
  is the whole page in this story. When story 2+ adds text inputs, this handler must skip
  events originating from form fields — noted here so it is not forgotten.

## Tooling decisions

- **Test-only camera hook.** `window.__vidi6.getCamera()/setCamera()` is installed only when
  `import.meta.env.MODE === 'test'`, so `npm run build:test` (used by the e2e web server) has
  it and the production bundle does not — verified by grepping the built assets. It is also
  available in the Vitest component project (Vitest runs in `test` mode) and is used there to
  read the live camera and to jump far away.
- **`wrangler.jsonc` is assets-only.** `wrangler dev` rejects an assets *binding* in a
  Worker-less config ("Cannot use assets with a binding in an assets-only Worker"), so the
  binding is omitted for now; story 3 adds `main` (and can add the binding back then).
  `npm run test:e2e` builds in test mode and serves `dist/client` through `wrangler dev`.
- **Playwright projects.** The config only creates projects for browsers actually present in
  the Playwright browsers directory (some sandboxes have Chromium only). In this environment
  Chromium, Firefox and WebKit all run: `npx playwright install firefox webkit` reports a
  host-requirements warning but the downloaded browsers launch and the suite passes in all
  three (36 e2e runs = 12 cases x 3 browsers).
- **Stack versions.** Vite 7 + Vitest 3 + TypeScript 5.9 + React 19 (Vitest 3/Vite 7 is a
  known-good pairing; TypeScript 7 and Vitest 5 were available but newer).

- **Manual verification.** Task 3 asks for a manual check in Chrome and Safari. There is no
  interactive browser in this environment, so the equivalent checks are automated instead: the
  e2e suite drives real mouse drag, wheel scroll, Ctrl + wheel (Chromium's pinch delivery), the
  `Ctrl/Cmd + = - 0` shortcuts and Reset view in Chromium, Firefox and WebKit, and asserts
  `visualViewport.scale`, `devicePixelRatio`, `innerWidth` and the control's font size do not
  change (TC-31). Safari's native `GestureEvent` stays covered at component level (TC-17).

## Tests added beyond the design's list

Kept because they are cheap and guard real requirements: wheel `deltaMode = LINE` conversion,
Cmd (macOS) equivalents of the shortcuts, the button reaching `ZOOM_MIN` with `−` disabled in
e2e, wheel-scroll suppression of page scrolling, window-resize anchoring, and a no-console-error
smoke test. Per the design's "Not covered" section, Safari pinch gestures are not exercised in
e2e (TC-17 covers the handler) and TC-33 (shortcuts pressed in the browser's address bar) is
not testable in-page.
