# Notes: decisions and deviations

## Tooling / versions
- `@playwright/test` is pinned to `~1.63.0` because the browsers available on this
  machine (chromium-1243, firefox-1543, webkit-2359 under `$PLAYWRIGHT_BROWSERS_PATH`)
  are exactly the revisions Playwright 1.63.0 expects. Newer Playwright releases
  would require downloading new browser builds.
- `typescript` is pinned to `~5.9.3` (the `latest` tag is the 7.x native compiler,
  which is newer than the rest of the toolchain assumes).
- Everything else is current: Vite 8 + `@vitejs/plugin-react` 6, Vitest 5 (projects),
  React 19, Wrangler 4 (assets-only config; Worker `main` arrives in story 3).
- Ports: every server this story starts listens inside
  `$AGENT_PORT_FIRST..$AGENT_PORT_LAST` (28400-28415). `wrangler dev` uses
  28400 with `--inspector-port 28401`; `vite dev` uses 28402 (`DEV_PORT` overrides),
  so `vite dev` and `wrangler dev` can run at the same time.

## Design interpretation
- `useCamera(viewport)` is owned by a `CameraProvider` (context) rather than by
  `BoardViewport`, because the design wires `ZoomControls` and `NavigationHint`
  "in `App.tsx` to `useCamera`" while `BoardViewport`'s contract takes only
  `children`. `CameraProvider` renders the full-window board area, measures it
  with the `ResizeObserver`, calls `useCamera`, and exposes the camera and the
  input handlers through context; `App.tsx` stays the wiring point (it renders
  `BoardViewport`, the `ZoomControls` bridge and the `NavigationHint` bridge
  inside the provider). The extra file is
  `src/client/canvas/CameraProvider.tsx`.
- Initial camera equals the reset view (`resetCamera(viewport)`) applied once the
  viewport has been measured, so "Reset view" is a no-op on a freshly opened
  board. The apply path for that initial sync does **not** trip the
  `hasNavigated` latch, so the first-use hint is still visible (PRD `nav.hint`).
- `hasNavigated` is a ref-backed latch mirrored into state (a ref alone would not
  re-render the hint).
- The dot grid is a separate absolutely positioned element carrying the CSS
  background, so e2e can read `background-size`/`background-position`; both it
  and the viewport are valid pan surfaces (`data-pan-surface`), while the world
  layer is `pointer-events: none` so drags always start on empty board space.
- Pixel-level e2e assertions measure the origin crosshair marker
  (`data-testid="origin-marker"`) via `getBoundingClientRect`, which is exact and
  not affected by clipping. Grid geometry is asserted through computed
  `background-size`/`background-position`. In test builds only, a second
  crosshair (`data-testid="test-marker-far"`) sits at
  `(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT)` so TC-27 can
  measure real pixels 1,000,000 units away.
- `src/client/canvas/testHooks.ts` installs `window.__vidi6` only when
  `import.meta.env.MODE === 'test'` (i.e. `npm run build:test`), so production
  builds drop it. `setCamera` is programmatic and does not trip `hasNavigated`;
  `getCamera` is exposed to make e2e assertions easy.
  Verified: the production bundle contains neither `__vidi6` nor `test-marker-far`.
- `ZoomControls` stops wheel **propagation** but deliberately does **not**
  `preventDefault` (design `viewport.input`, TC-30: "browser default not
  suppressed there"). I briefly added `preventDefault` so a Ctrl-wheel over the
  chrome can never zoom the page, then reverted it: the PRD promise
  (`zoom.no_page_zoom`) is scoped to gestures *over the board*, and TC-30 asks
  for the opposite assertion.

## Component tests (jsdom)
- jsdom 30 ships real `PointerEvent`/`WheelEvent` constructors, so the tests
  dispatch ordinary events (`fireEvent.pointerDown`, `createEvent.wheel`) and can
  read `defaultPrevented`. Only `ResizeObserver` and the pointer-capture methods
  need shims (`tests/component/helpers/shims.ts`); `ResizeObserverStub.resize()`
  is available if a test wants to simulate a window resize.
- Task 6 suggests fake timers for `requestAnimationFrame`. Vitest 5's fake timers
  do not fake `requestAnimationFrame` unless configured to, so the tests await a
  real jsdom frame instead (`flushFrame()` in `tests/component/helpers/board.tsx`,
  inside `act`) — same effect, no timer-configuration coupling.
- The tests read the camera back out of the rendered world-layer transform, and
  compare against values computed with `camera.math` (`panBy`, `zoomAt`,
  `resetCamera`) rather than against hand-written numbers. A mutation check
  (inverting the pan sign, zooming to the viewport centre instead of the pointer)
  makes two of them fail, so they are real checks.

## E2E
- `tests/e2e/helpers/board.ts` wraps the polling the browser needs: the DOM
  trails the camera state by one animation frame, so marker assertions
  (`expectMarkerAt`) poll; `expectCamera` polls the camera through
  `window.__vidi6.getCamera()`.
- Wheel deltas are engine-specific, so the tests install an in-page probe that
  records the `deltaX/deltaY/deltaMode` the page actually received and assert the
  camera moved by exactly that (non-circular, works in every engine).
- Playwright's `mouse.wheel` does deliver `ctrlKey: true` when `Control` is held
  (verified in Chromium). TC-24 skips with a message if an engine does not,
  rather than failing on an input it cannot synthesise.
- TC-25's "click + until it disables" loop races with the button disabling
  itself; `clickUntilDisabled()` tolerates the click that loses the race.
- Extra e2e beyond the listed TCs, because the PRD acceptance list is the real
  contract: wheel scroll pans the board, grid spacing follows the zoom, the zoom
  control is keyboard-reachable and operable with Enter/Space (a11y constraint),
  and resizing the window leaves content anchored to the top-left of the board.
- **Firefox and WebKit cannot start on this machine.** The revisions under
  `$PLAYWRIGHT_BROWSERS_PATH` (firefox-1543, webkit-2359) are exactly what
  Playwright 1.63 expects, and `firefox --version` works, but the builds Playwright
  launches abort immediately (`SIGABRT`; WebKit: `Abort trap: 6` from
  `pw_run.sh`), so every Firefox/WebKit test fails in `browserType.launch` before
  running. Chromium (1243) is unaffected. Instead of deleting the projects,
  `playwright.config.ts` probes browser availability
  (`scripts/probe-browsers.mjs`, cached under `node_modules/.cache`) and skips
  what cannot launch with a loud warning, so the suite stays meaningful and the
  three-engine intent is preserved. Run a fixed set explicitly with
  `E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e` (no probe).
