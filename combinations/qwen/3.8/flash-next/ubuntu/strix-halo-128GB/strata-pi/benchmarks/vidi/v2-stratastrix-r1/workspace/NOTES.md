# Notes

Decisions and findings worth carrying into stories 2–5.

## Design decisions

- **Camera convention.** `camera.x` / `camera.y` is the board coordinate that sits
  at screen `(0, 0)`, so `screen = (world - camera) * zoom` and
  `world = screen / zoom + camera`. The initial camera is
  `(-width / 2, -height / 2, 1)`, which puts the board's starting point
  (`0, 0`) in the centre of the area. The world layer is
  `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`,
  exactly the transform the design names, so every DOM node inside the layer is
  placed by the same maths as the grid.
- **The grid is a viewport-sized background, not an infinite layer.** The dot grid
  is drawn on the viewport element (`radial-gradient` tiles) with
  `background-size: GRID_SPACING_WORLD * zoom` and
  `background-position = positiveModulo(-camera.axis * zoom, cell)` (minus half a
  cell, so each dot sits centred in its tile). Because the
  offset is taken modulo the cell size, the numbers stay small and the dots stay
  evenly spaced a million board units out (verified in Chromium and by
  TC-10/TC-11/TC-27).
- **No rounding anywhere on the visual path.** Pointer deltas, camera numbers and
  the CSS transform keep full double precision, so a 1.5 px drag moves the board
  1.5 px. Only the zoom *label* rounds (`Math.round`, `ZOOM_PERCENT_SCALE`).
- **Camera updates are coalesced with `requestAnimationFrame`.** `useCamera`
  stores the camera in a ref, and every update schedules one flush per frame;
  `getCamera()` (and therefore `window.__vidi6.getCamera()`) reads the *rendered*
  camera, which is why component and e2e tests wait one/two frames
  (`settled()` / `waitForRender()`) after every input.
- **Pure `zoomAt` does not clamp; `canZoomIn/canZoomOut` encode the limit.**
  `zoomAt` rejects non-finite/`<= 0` factors (TC-06) but only clamps the zoom to
  `[ZOOM_MIN, ZOOM_MAX]`, so a wheel gesture that asks for more simply ends at the
  limit and leaves the anchor invariant intact. The buttons read
  `canZoomIn/canZoomOut` to decide `disabled`, so the *only* way to exceed the
  limits is a gesture at the limit — which is a no-op (TC-12, TC-32).
- **`zoomStep` snapping.** `ZOOM_STEP_FACTOR` applied repeatedly produces values
  like `1.25^7 = 4.768…`; after clamping, the button zoom snaps back onto the
  exact limit (`ZOOM_STEP_SNAP_RELATIVE` guards floating-point noise), so the
  percentage label lands exactly on 400 % / 10 % (TC-21, TC-25).
- **Two zoom paths on purpose.** Buttons/disabled state use `zoomStep` (factor
  `ZOOM_STEP_FACTOR`, anchored at the area centre); wheel, pinch and keyboard use
  `zoomAt` (anchored at the pointer, or at the centre for the keyboard).
- **Wheel handling is a native `passive: false` listener on the viewport element.**
  React's `onWheel` is passive, so `preventDefault()` for Ctrl+wheel would be
  ignored and the browser would zoom the page. The viewport registers a non-passive
  `wheel` listener instead; the controls call `stopPropagation()` so a wheel over
  the chrome is left to the browser (TC-15, TC-16, TC-30, TC-31).
- **Safari pinch uses `gesturestart` / `gesturechange` / `gestureend`.** At
  `gesturestart` the viewport stores the camera and the event's scale; each
  `gesturechange` sets the zoom to `event.scale / startScale` relative to the
  *stored* camera (never compounding event by event) with
  `zoomAt`, anchored at the gesture point, and calls `preventDefault()`. All three
  events are registered as non-passive native listeners. Playwright WebKit cannot
  synthesise a `GestureEvent`, so this path is covered by component tests that
  dispatch real `gesture*` events (TC-17, TC-18) and, elsewhere, as Ctrl+wheel.
- **Drag starts only on empty board space.** `pointerdown` on the world layer (or
  any future board object) is ignored — `pointer-events: none` on the layer, with
  board objects re-enabling them later — so story 2's objects can drag themselves
  (TC-13, "only starts a drag on empty board space").
- **Keyboard listeners live on `window`** and call `preventDefault()` for
  Ctrl/Cmd + `=`, `-`, `0` (and the numpad/`+` variants). Verified in headless
  Chromium: Ctrl+0 *is* preventable there, so Reset view works from the keyboard.
- **The hint latches on the first camera *change*.** `hasNavigated` is set inside
  the camera flush only when the camera actually changed, so a click without
  movement — or a gesture at a zoom limit — does not dismiss it (TC-22, TC-29).
- **Resize keeps `x`, `y`, `zoom`.** The ResizeObserver only re-renders; the
  camera is untouched, so the board moves by half the size delta (TC-10 unit,
  "keeps the camera when the area is resized" component test).
- **Test build hook.** `installTestHooks()` is called from `BoardProvider` behind
  `import.meta.env.MODE === 'test'` and exposes the *rendered* camera, so a test
  can read back what the user sees. `npm run build` (production) contains no
  `__vidi6` string; `npm run build:test` does. e2e runs against the *test* build
  served by `wrangler dev`, so the serving path matches production.
- **`wrangler dev` serves the client with SPA fallback**
  (`assets.not_found_handling = "single-page-application"`), so `/`, `/app` and
  `/app/` all return `index.html` (200). `/index.html` 307-redirects to `/` — that
  is wrangler's default `html_handling: auto-trailing-slash`, not a 404.
  The `ASSETS` binding is deliberately omitted: wrangler rejects a binding in an
  assets-only Worker, and story 3 adds `main` when there is a Worker to bind it in.

## Deviations from the spec, and why

- `npm run build:test` (an extra script) exists so e2e can build with
  `import.meta.env.MODE === 'test'`; the plain `build` script is unchanged.
- The e2e Ctrl+wheel is `keyboard.down('Control')` + `mouse.wheel()`. Playwright's
  `mouse.wheel()` has no modifier argument; holding Control does set the modifier
  state in Chromium, and the tests confirm the zoom really happened and that the
  page did not zoom.
- `tests/e2e/helpers/window.d.ts` augments `Window` with `__vidi6` for typing only;
  the hook itself is still absent from production builds.

## Environment constraints on this machine

- **Firefox and WebKit e2e cannot run here.** Playwright's browser binaries are
  installed, but the host is missing their system libraries (`libgtk-3` for
  Firefox; `libgtk-4`, `libgraphene`, ICU 74, GStreamer and more for WebKit) and
  the account has no root (`sudo` is blocked by `no_new_privs`), so
  `playwright install-deps` cannot help. Both projects stay configured in
  `playwright.config.ts` and the same specs run there unchanged; on this machine
  `--project=chromium` is the passing subset, as the task allows.
- **Browser page zoom (150 %/200 %) at the end of TC-31 is a manual check.**
  Headless browsers cannot set page zoom; the automated part of TC-31 asserts
  `visualViewport.scale`, `devicePixelRatio` and a measured text height stay
  identical across Ctrl+wheel and Ctrl+`=`/`-`/`0`.
- **A real trackpad pinch is not automated** (design says so); the pinch path is
  covered by component tests that dispatch real `gesture*` events (TC-17, TC-18),
  because Playwright cannot synthesise a Safari `GestureEvent`.

## Gotchas for the next stories

- Anything rendered inside `.board-world` inherits `pointer-events: none`; objects
  must set `pointer-events: auto` (and story 2's drag must stop the viewport from
  starting a pan, e.g. by checking the event target).
- Board code that needs "where is the pointer on the board" must go through
  `screenToWorld(camera, point)` with the *rendered* camera; use the
  `useBoard()`/`useCamera()` hooks rather than reading the test hook.
- Keep new UI inside `BoardChrome` (or another child of `BoardProvider`) and give
  interactive elements real `aria-label`s: the e2e suite finds the controls through
  `getByRole`, which is what makes it independent of styling.
- Component tests must keep stubbing `getBoundingClientRect` for the viewport
  (jsdom reports zero size) and must wait a frame after any camera input.
- e2e tests need `npm run build:test`; if you add a Vite mode, keep the name
  `test` or update `testHooks.ts` and the Playwright `webServer` command together.
