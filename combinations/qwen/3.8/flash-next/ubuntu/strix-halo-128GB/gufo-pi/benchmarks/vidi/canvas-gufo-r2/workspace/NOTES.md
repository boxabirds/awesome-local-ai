# Notes — story 1 (pan and zoom around an infinite board)

Implementation notes, decisions and deliberate deviations from
`spec/stories/001-pan-and-zoom-around-an-infinite-board/`.

## Camera model (as designed)

`Camera = { x, y, zoom }` where `x, y` is the **world coordinate at the top-left of
the viewport** and `zoom` is **pixels per world unit**:

```
screen = (world - camera.xy) * zoom
world  = screen / zoom + camera.xy
```

All input handlers are expressed as "keep this world point under this screen
point", which is why pan, wheel zoom, pinch zoom and button zoom all reduce to the
same three lines in `src/client/canvas/camera.ts`.

## Deviations from the design's stated contracts

1. **`<BoardViewport>` takes an `overlay` prop in addition to `children`.**
   `children` still go into the world layer (`transform: scale(zoom)
   translate(-x, -y)`, `transform-origin: 0 0`) for stories 2–5. The zoom control
   and hint must *not* scale with the board, so they are rendered in a screen-space
   overlay layer instead of being siblings positioned by `App`.
2. **`useBoardCamera()` context.** The design wires `ZoomControl` callbacks in
   `App`. Because the chrome now lives inside `BoardViewport`, the controller is
   published through a context (`BoardChrome` in `src/client/App.tsx` consumes it)
   so there is no prop drilling. `ZoomControls` itself stayed stateless: it takes
   `zoomPercent / canZoomIn / canZoomOut / onZoomIn / onZoomOut / onReset`.
3. **TC-30 (wheel over the zoom control).** The design says the control "keeps the
   browser default". The acceptance criterion says the *browser page zoom* must not
   change, so the control stops propagation (the board must not zoom) **and** calls
   `preventDefault()` (the browser must not zoom the page). The component test
   asserts `defaultPrevented === true` plus "the camera did not move". The listener
   is a native non-passive one, because React registers `wheel` passively and
   `preventDefault()` would be ignored.
4. **Origin marker.** A 16 px red crosshair is rendered in the screen-space overlay
   at `worldToScreen(camera, {0,0})` in *all* builds (marked
   `data-testid="origin-marker"`, `aria-hidden`). The design asks for a stable pixel
   target for e2e; keeping it in every build means e2e assertions run against the
   shipped bundle. It deliberately does not scale with zoom.
5. **Cross-browser e2e.** Chromium, Firefox and WebKit projects are configured, but
   the default (`npm run test:e2e`) runs **chromium only**, because this environment
   cannot install the browser system libraries (`libgtk-3-0t64` for Firefox,
   GTK4/GStreamer/… for WebKit) — there is no root access. Run
   `npm run test:e2e:all` (or `E2E_ALL_BROWSERS=1`) after
   `npx playwright install --with-deps` to exercise the other two engines. All six
   e2e tests pass on Chromium; they were not run on the other engines here.
6. **Figma.** The design link in the PRD could not be fetched (no network), so the
   chrome placement follows `design.md`: zoom control bottom-right, hint
   bottom-centre, dot grid as the only background decoration.

## Implementation decisions worth knowing

- **One commit per frame.** Pointer/wheel/keyboard input writes into a ref and
  schedules a `requestAnimationFrame`; React state is updated at most once per
  frame, so a 240 Hz mouse cannot thrash the render tree. Component tests install
  fake `requestAnimationFrame` (see `tests/component/harness.tsx` →
  `startFakeFrames`/`flushFrames`).
- **The grid is a CSS background** (`radial-gradient`, `background-repeat: repeat`)
  on the board element: `background-size = GRID_SPACING_WORLD * zoom`,
  `background-position = modulo(-camera.xy * zoom, spacing)`. It is therefore
  infinite by construction and costs nothing per frame; the `modulo` keeps the dots
  locked to world coordinates at 1 000 000 units out just as well as at 0.
- **The world layer is a transform only** — board content (stories 2+) never
  re-lays-out on navigation.
- **Zoom ladder.** `zoomStep` multiplies/divides by `ZOOM_STEP_FACTOR` (1.25) and
  clamps to `[ZOOM_MIN, ZOOM_MAX]`, and snaps back onto the exact ladder when the
  current zoom is within `ZOOM_STEP_SNAP_EPSILON` of a ladder value (after a
  round-trip zoom in/out through floating point). Repeated clicks therefore land on
  exactly `4` (400 %) and exactly `0.1` (10 %) and the corresponding button
  disables itself, instead of drifting near the limit.
- **Zoom label** is `Math.round(zoom * 100)%` (`zoomPercent`), so it never shows a
  value that the camera does not have, and never changes without the camera changing.
- **Wheel handling** uses a non-passive listener on the board and always calls
  `preventDefault()`, so the page can neither scroll nor zoom. `deltaMode` LINE and
  PAGE are converted to pixels with `WHEEL_LINE_HEIGHT_PX` and
  `WHEEL_PAGE_HEIGHT_FRACTION` from `src/shared/config.ts`.
- **Pinch.** On Safari this arrives as `gesturestart/change/end` (`WebKit` non-standard
  events) and is handled; on Chrome/Firefox a pinch is delivered as `wheel` with
  `ctrlKey`, which is the same zoom path. Component tests cover both (TC-16, TC-17).
  Playwright cannot synthesise a real pinch, so e2e drives the identical zoom code
  path with `Ctrl` + wheel.
- **Pointer capture** is used for the drag (best-effort, wrapped in `try/catch`),
  and `pointercancel` *and* `lostpointercapture` end the pan, so the camera never
  keeps following a pointer that no longer exists.
- **Keyboard**: `Ctrl/Cmd + = + - 0` are `preventDefault`ed while the board is
  mounted — the board claims the browser page-zoom shortcuts (this is what
  `Ctrl+0 = Reset view` requires).
- **Window resize** only updates the stored viewport size; the camera is untouched,
  so content stays put relative to the top-left corner (covered by an e2e test at
  1280×800 → 1920×1080).

## Test-build hook (`window.__vidi6`)

`vite build --mode test` (`npm run build:test`) installs
`window.__vidi6.setCamera/getCamera`. E2E needs it: TC-26/TC-27 require the camera
to be a million world units away and at 400 %, which cannot be reached by dragging
a million pixels. The guard is `import.meta.env.MODE !== 'test'`, and it is verified
that the production bundle does not contain the string `__vidi6`:

```bash
npm run build && grep -c '__vidi6' dist/client/assets/*.js   # 0 matches (grep exits 1)
```

`npm run test:e2e` builds in test mode itself (Playwright `webServer`). Note that
`reuseExistingServer` is on outside CI: if you already have `npm run wrangler:dev`
running against a *production* build, `setCamera` will throw with an explanatory
error instead of silently mis-testing.

## jsdom limitations (component tests)

- jsdom has no `PointerEvent` constructor → `tests/component/setup.ts` shims one
  from `MouseEvent` (with `pointerId`, `isPrimary`, `button`).
- jsdom performs no layout: `getBoundingClientRect()` is all zeros, so
  `measureBoard()` falls back to `window.innerWidth/innerHeight` (jsdom's default
  1024×768 — the tests derive expectations from `window.innerWidth/innerHeight`
  instead of hard-coding a size), and marker/grid assertions read the inline styles
  the component computes rather than rendered boxes. Real pixel geometry is
  asserted in the Playwright suite instead.
- jsdom does not implement pointer capture or auto-fire `lostpointercapture`, so
  tests dispatch it explicitly (as the task hints allow).
- `ResizeObserver` is stubbed; the component guards for its absence anyway.

## Deployment

`wrangler.jsonc` is assets-only for story 1 (`assets.directory = ./dist/client`,
`not_found_handling = single-page-application`) — no Worker script is needed yet,
and no asset `binding` is declared because the local dev server serves the assets
directly. Real-time collaboration bindings arrive with story 4.
