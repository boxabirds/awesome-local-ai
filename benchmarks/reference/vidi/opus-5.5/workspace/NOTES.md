# Implementation notes

Decisions made while building without anyone to ask.

## Story 1: Pan and zoom around an infinite board

- **BoardViewport props.** The design lists `BoardViewport(props: { children })`, but also
  says `App.tsx` wires `useCamera` to `ZoomControls` and that `useCamera(viewport)` needs the
  board size measured by BoardViewport's `ResizeObserver`. To share one camera, `App` owns
  `useCamera` and passes it in: `BoardViewport({ controller, onResize, children })`.
- **Extra `zoomBy(point, factor)` on the `useCamera` result**, used by the Safari
  `gesturechange` handler (the listed `wheel()` only accepts deltas). Everything else matches
  the contract.
- **Initial view.** Before the board area is measured the camera is `resetCamera(0x0)`; the
  first measurement (in a layout effect, before paint) centres the starting point. After that,
  resizing never changes the camera, so content stays anchored to the board's top-left corner.
- **Hint dismissal.** `hasNavigated` latches only when a camera update returns a new object.
  Reset view on an untouched start view is treated as a no-op (same camera values), so it does
  not dismiss the hint. The e2e/test `setCamera` hook does not count as navigation.
- **Step zoom snapping.** Per design, step zoom snaps to `ZOOM_STEP_FACTOR^n` only when within
  1e-9. Consequence: after stepping down to the 10% limit, stepping back up gives
  12.5%, 15.6%, … (multiples of 10%) rather than the 100% ladder. PRD examples (100 → 125 → 100)
  hold.
- **Dot grid** is the viewport's own CSS background (radial-gradient), as the design says; there
  is no separate grid element. Dots sit at tile centres, so `background-position` is offset by
  half a tile to put dots exactly on world multiples of `GRID_SPACING_WORLD` (the origin
  crosshair sits on a dot).
- **Keyboard shortcuts** listen on `window` (the whole page is the board in this story); they
  accept `=`/`+`/NumpadAdd, `-`/`_`/NumpadSubtract and `0`/Numpad0 with Ctrl or Cmd, and are
  ignored while typing in an editable element (none exist yet).
- **Only the primary mouse button** starts a pan.
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` is installed only when
  `import.meta.env.MODE === 'test'` (Vitest and `npm run build:test`). Verified that the
  production `npm run build` bundle does not contain `__vidi6`. e2e runs against
  `npm run build:test` served by `wrangler dev`.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit (design). The
  `E2E_BROWSERS` env var (comma-separated) limits them. On the build machine WebKit cannot
  launch (missing system libraries such as libavif13; installing them needs sudo), so e2e was
  verified with `E2E_BROWSERS=chromium,firefox npm run test:e2e`.
- **No integration test script.** The design states there is no request-handling boundary in
  this story, so there is no `test:integration` script yet.
- **Single commit.** Task 1's "red phase committed" step was run (all camera tests failed with
  "not implemented") but not committed separately; the story is one commit as instructed.
- **Not covered automatically** (per design): smoothness, real trackpad hardware, real Safari
  pinch (handler logic covered by TC-17 in jsdom), touch input. Headless browsers do not apply
  browser-level page zoom to synthetic Ctrl+= keys, so TC-31 additionally asserts the page
  called `preventDefault` on each shortcut.
