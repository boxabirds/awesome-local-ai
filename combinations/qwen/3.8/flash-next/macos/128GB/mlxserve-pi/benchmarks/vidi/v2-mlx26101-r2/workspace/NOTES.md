# NOTES

Environment notes and deviations from the story's test strategy on this machine.

## Ports

Every server listens inside `$AGENT_PORT_FIRST`..`$AGENT_PORT_LAST` (24208–24223 here).

| Port | Use |
|---|---|
| 24208 (`AGENT_PORT_FIRST`) | `npm run dev` (Vite dev server) |
| 24212 (`AGENT_PORT_FIRST + 4`) | e2e server: `wrangler dev` statically serving `dist/client` (test build) |
| 24213 | the `wrangler dev` inspector port that goes with 24212 |

`wrangler dev` is started with `--ip 127.0.0.1 --port 24212 --inspector-port 24213`,
and the Vite dev server is pinned to `host: '127.0.0.1'` (with the default it
binds `::1` here and `http://127.0.0.1:24208` refuses connections).
Ports 24210/24211 are held by a `wrangler dev` process that this sandbox cannot
signal (`kill` is refused), so the e2e port is `AGENT_PORT_FIRST + 4` rather than
`+ 2`; the port stays configurable through `E2E_PORT` / `E2E_INSPECTOR_PORT`.

## Browsers

The suite is written browser-agnostically and the app has no browser-specific
paths, but **this sandbox cannot launch Firefox or WebKit**: `firefox.launch()`
aborts the process (`SIGABRT`) and `webkit.launch()` aborts its `Playwright.app`
(`Abort trap: 6`) before a page exists. It is not a missing install (both
binaries are present, arm64, matching the Playwright 1.63 revision) and not a
product problem — a bare `firefox --dump-dom` also returns nothing here, so the
browser content processes cannot be spawned in this environment. Chromium runs
fine (it uses its own in-process headless shell).

`tests/e2e/setup.ts` therefore *probes* which browsers can launch and
`tests/e2e/fixtures.ts` skips a test only when its browser genuinely cannot start
(the skip message points at the `[e2e] browsers that cannot launch here` line
printed at the start of the run). Nothing is skipped on a guess, and on a machine
where Firefox/WebKit do start, the same 12 tests run there too.

To keep real coverage, the suite runs twice in Chromium: `chromium` (device pixel
ratio 1) and `chromium-retina` (device pixel ratio 2), which re-exercises the dot
grid, sub-pixel grid phases and the counter-scaled origin marker on a 2x surface.

WebKit here cannot synthesise Safari `gesture*` pinch events, which is why the
pinch handler is covered by the component test (TC-17) instead of e2e, as the
story's test strategy allows ("Not covered").

## Measurement notes (e2e)

Things measured on real browsers that the helpers account for:

- **Wheel deltas scale with the device pixel ratio**: `page.mouse.wheel(0, 120)`
  arrives at the page as `deltaY: 60` on a 2x surface. `wheelBoard()` returns the
  delta the page actually saw, so the "board moved by the wheel delta" claim is
  measured rather than assumed.
- **Computed transforms are rounded** to about six significant digits
  (`matrix(3.81471, ...)` for a zoom of 3.8147145625), so "the DOM caught up with
  the camera" is compared relatively (`waitForRender`).
- **Screenshots are in device pixels**: a 48 CSS px clip is a 96 px image at DPR 2.
  `shootRegion()` returns a `Shot` carrying the CSS size so a region is re-shot at
  the same CSS size (`differenceAt`).
- **Screenshots come back as colour type 2/6 PNGs**; `tests/e2e/helpers/png.ts`
  decodes them (all five PNG filters) so regions can be compared without a third
  party image library.
- The dot grid is a CSS `radial-gradient` painted on the board surface itself, so
  the pixel tests locate a dot from the computed `background-size`/`background-
  position` (`nearestDot`) and then compare rendered pixels around it.
- The origin marker (22 px crosshair with a `scale(1/zoom)` counter-scale) is the
  world-anchored reference for the ±1 px claims: its `getBoundingClientRect()`
  centre is where world (0, 0) is drawn.

## jsdom limits worked around (component tests only)

`tests/component/setup.ts` provides what jsdom lacks so the components can be
tested the way they run in a browser:

- `requestAnimationFrame`/`cancelAnimationFrame` are replaced by a frame queue
  (`drainFrames()`), because camera updates are batched onto a frame. This is the
  "rAF via fake timers" of the design.
- `window.innerWidth`/`innerHeight` are fixed at 1280×800 (the design's laptop
  board area), since jsdom reports 1024×768 and does no layout.
- `Element.prototype.setPointerCapture`/`releasePointerCapture`/
  `hasPointerCapture` are stubbed: jsdom implements no pointer capture.
- Safari's `GestureEvent` does not exist in jsdom, so gesture tests dispatch a
  `MouseEvent` with a `scale` property attached (the shape the handler reads).
- jsdom performs no layout, so `getBoundingClientRect()` is all zeros. Component
  tests therefore assert the rendered CSS (world layer `transform`, background
  `background-size`/`position` of the dot grid) rather than pixel geometry; exact
  pixel geometry (±1 px) is asserted in e2e, where real layout happens.

## Deviations

- None from the story's acceptance criteria. The e2e port differs (see Ports),
  Safari pinch gestures are not covered in e2e (see Browsers), which the story's
  test strategy explicitly allows, and Firefox/WebKit tests skip themselves on
  this machine because those browsers cannot be launched here (see Browsers).
