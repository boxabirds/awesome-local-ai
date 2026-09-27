# Notes

Implementation notes and decisions for story 1. Nothing here contradicts
`spec/stories/001-pan-and-zoom-around-an-infinite-board/design.md`; where the
design left a choice open, the choice and the reason are recorded here.

## Status

| Task | State |
|---|---|
| 1 Scaffold + failing camera unit tests | done (red phase committed separately) |
| 2 Camera maths | done — 22 unit tests pass (TC-01..TC-12 + 1,000-case property check) |
| 3 Board viewport (drag, wheel, pinch, keyboard, dot grid) | done |
| 4 Zoom controls | done |
| 5 First-use navigation hint | done |
| 6 Component tests | done — 29 tests pass (TC-13..TC-22, TC-29..TC-32) |
| 7 E2E in Chromium, Firefox, WebKit | done — 10 tests pass in Chromium; Firefox/WebKit skip on this host (see "Firefox and WebKit skip on hosts without GTK") |

Verification: `npm run build`, `npm run typecheck`, `npm run test:unit`,
`npm run test:component`, `npm run test:e2e` all pass. Safari pinch, frame rate
and "feels native" are manual checks the design explicitly puts outside the
automated suite.

## Camera ownership: context, not props

The design's `BoardViewport` takes only `children`, yet it needs the camera to
render and to report input, while `App` needs the same camera for
`ZoomControls` and `NavigationHint`. So `App` owns `useCamera` and passes it down
through `CameraContext` (`useCameraContext()` inside `BoardViewport`). Props
would have meant threading the whole handler set through `BoardViewport`, which
the design does not want; a context also lets story 2's content components read
the camera without prop drilling.

## Camera updates are coalesced per animation frame

`useCamera.apply()` writes to a ref immediately and schedules at most one
`setState` per frame. Consequences that the tests account for:

- **The DOM is one frame behind the camera.** e2e assertions on rendered state
  after an imperative change wait for a frame (`waitForRender` in
  `tests/e2e/helpers/board.ts`) rather than reading straight away. This matters
  most for `disabled` on the zoom buttons: a loop that reads `isDisabled()` and
  then clicks races the frame boundary, which is why `clickUntilDisabled` waits
  for a frame before each read.
- Pointer moves, wheel events and pinches arriving several times per frame
  produce one render, which is what keeps dragging smooth.

## No-op updates are compared by value, not identity

`camera.math` promises to return the *same object* when nothing changes, and
`apply` additionally drops an update whose `x`, `y` and `zoom` equal the current
ones. Both matter: a click with no pointer movement, a zero-length drag and a
zoom already at 10% / 400% must not re-render or dismiss the navigation hint
(TC-29), and the hint's latch reads "did the camera actually change".

## Grid as a CSS background, verified through computed style + the origin marker

The dot grid is a `radial-gradient` background with
`background-size = GRID_SPACING_WORLD * zoom` and
`background-position = mod(-camera.xy * zoom, spacing)`; board content goes in a
world layer transformed with `scale(zoom) translate(-x, -y)`, `transform-origin:
0 0`. This costs nothing per dot, has no edges, and is resolution independent.

For the "same dot moved exactly 200px" assertions (TC-23, TC-27) the tests do
not diff screenshots — that is flaky across engines and hard to read when it
fails. Instead: the **origin marker** is a real element at world (0,0), so its
`getBoundingClientRect()` is a genuine pixel measurement of the board transform,
and the **grid's** computed `background-size`/`position` are the values that
place every dot, checked against the camera and against the pan distance
(`position` advanced by 200 modulo spacing). TC-27 additionally shows placement
stays sub-pixel accurate one million units out (the marker is a million pixels
off-screen and still lands exactly where `worldToScreen` says).

## Wheel and keyboard handling

- The wheel listener is attached with `{ passive: false }` in an effect, because
  React's `onWheel` is passive and cannot cancel browser page zoom. Over the
  board it *always* `preventDefault()`s: the page must neither scroll nor zoom
  (TC-31 checks `visualViewport.scale` and `devicePixelRatio` afterwards).
- `Ctrl`/`Cmd` + wheel zooms with `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`; the
  exponent is clamped to `WHEEL_ZOOM_MAX_EXPONENT` so an absurd `deltaY` cannot
  overflow `exp` to `Infinity` — `zoomAt` would reject it anyway, but clamping
  keeps the clamped-limit behaviour ("zoom in hard, land on `ZOOM_MAX`") instead
  of a silent no-op.
- `deltaMode` lines/pages are converted with named constants
  (`WHEEL_DELTA_MODE_LINE_PX`, viewport size for pages).
- Keys are handled on `window` and cover `event.key` *and* `event.code` so
  layouts where `=` lives elsewhere still work; `altKey` combos are ignored so
  OS/browser shortcuts are not swallowed.
- Safari's `gesturestart/change/end` are attached manually (no React support,
  not in the standard types) with the same "never let the page zoom" rule.
  Playwright cannot synthesise a `GestureEvent`, so pinch is covered at
  component level (TC-17) and real Safari pinch is a manual check.
- Drag starts only when the pointer target is the board surface itself
  (`isBoardSurface`), and objects added in later stories can take over by
  stopping propagation or marking themselves with `data-board-surface`.

## Resizing never moves the camera

`x, y` is the world coordinate at the top-left of the board area, so a window
resize keeps existing content anchored to that corner and only reveals more
board. `useCamera` keeps the size in a ref — a resize never re-creates the
camera (TC-07 unit, "board geometry" e2e test).

## Test hook, and why e2e uses a test-mode build

`tests/e2e` needs to place the camera a million units away without simulating
thousands of pixels. `window.__vidi6.setCamera()` exists only when
`import.meta.env.MODE === 'test'`, so `npm run test:e2e` serves
`npm run build:test` (asserted: no `__vidi6` string in the production bundle).
The hook goes through the normal `apply` path, so it cannot produce a camera the
UI could not reach by itself — it clamps at the zoom limits and latches the hint
like any other update.

## wrangler: assets without a binding

`wrangler dev` rejects `assets.binding` while the Worker has no `main` ("Cannot
use assets with a binding in an assets-only Worker"), so `wrangler.jsonc`
declares only `assets.directory` + `not_found_handling`. Story 3 adds the Worker
script and the bindings it needs.

## Firefox and WebKit skip on hosts without GTK

Both engines are configured as Playwright projects at 1280x800, but they need
`libgtk-3` and friends, which are absent on this machine and need root to
install. `tests/e2e/global-setup.ts` tries to launch each one and records the
failures in `VIDI6_UNAVAILABLE_BROWSERS`; the spec skips just those engines with
an explicit reason, so a Chromium-only host is green and a full CI image runs
all three projects with no config change.

Verified here: `npm run test:e2e` → 10 passed (chromium), 20 skipped
(firefox, webkit — "cannot launch on this host (missing system libraries)").
**On any machine with the GTK dependencies, re-run the full matrix before
shipping**; the engine-specific risks are wheel/pinch handling and
`visualViewport.scale`.

## Test environment shims

jsdom has no `ResizeObserver` and no reliable `setPointerCapture`: `useViewportSize`
falls back to a `window` resize listener when `ResizeObserver` is undefined, and
`BoardViewport` swallows a failing `setPointerCapture` so drags still work there.

The design suggested fake timers for the camera hook's rAF. Instead
`tests/component/setup.ts` stubs `requestAnimationFrame` onto `setTimeout(..., 0)`
and the tests flush it with `await flushFrame()` (inside `act`). The stub must not
fire synchronously — the hook stores the frame handle and, called synchronously,
would clear it before scheduling the next frame — and a macrotask stub keeps the
tests readable without a fake clock that also owns `queueMicrotask` and
`cleanup`.
