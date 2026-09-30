# Notes — story 1 (pan and zoom around an infinite board)

Decisions, deviations from the design's file list, and things the next story
(stories 2–5 build on this skeleton) needs to know.

## What is here

- `src/shared/config.ts` — every named setting. The six the design names, plus
  two for `deltaMode` conversion (below).
- `src/client/canvas/camera.ts` — pure camera maths, no DOM, no React.
- `src/client/canvas/useCamera.ts` — camera state + input handlers.
- `src/client/canvas/BoardViewport.tsx` — input surface, dot grid, world layer.
- `src/client/canvas/ZoomControls.tsx`, `NavigationHint.tsx` — overlay chrome.
- `src/client/canvas/CameraProvider.tsx` — see deviation 1.
- `src/client/canvas/testHooks.ts` — `window.__vidi6.setCamera()` in `test` mode.
- `tests/unit/camera.test.ts` (16), `tests/component/*.test.tsx` (27),
  `tests/e2e/navigation.spec.ts` (9 tests x 3 browsers = 27).

## Deviations from the design's file list

1. **`CameraProvider.tsx` is an extra file.** The design's layout puts
   `useCamera` in `BoardViewport.tsx`, but its sequence diagrams have
   `ZoomControls` and the keyboard listener driving *the same* camera as the
   viewport, and `App.tsx` has to read `hasNavigated` for the hint. One
   `useCamera` instance therefore has to be shared by three components. Rather
   than move input plumbing into `App.tsx`, `CameraProvider` calls `useCamera`
   once, measures the board area with a `ResizeObserver`, and hands the
   `CameraApi` down through context (`useBoardCamera()`). `BoardViewport` stays
   the input surface; the provider adds no behaviour of its own.
2. **`useCamera` returns more than the contract's minimum.** Additions:
   `pinchAt(point, factor)` (the Safari `gesturechange` path, which the design's
   diagram routes through `zoomAt` at the pointer) and `setCamera(camera)` (used
   by the test hook). Nothing in the design's listed members changed name or
   signature.
3. **Two extra named settings**: `WHEEL_LINE_PX = 32` and `WHEEL_PAGE_PX = 800`.
   The design requires `deltaMode` LINE/PAGE to be converted to pixels but does
   not name the constants; browsers report lines/pages without a pixel size, so
   the conversion needs a value. Both are in `src/shared/config.ts`.
4. **Extra files that scaffolding needs**: `index.html` (Vite entry),
   `src/client/vite-env.d.ts` (types `import.meta.env` and `window.__vidi6`),
   `tests/component/setup.ts` (the jsdom project's setup file, empty for now),
   `tests/component/helpers.tsx`, and `tests/e2e/helpers/board.ts` /
   `pixels.ts`. The design lists `main.tsx` and `App.tsx` explicitly; the rest are
   implied by "scaffold".
5. **`wrangler.jsonc` has no `main`/bindings** — assets only, with
   `not_found_handling = "single-page-application"`. Worker code arrives in
   story 3; a `main` field pointing at a non-existent file makes `wrangler dev`
   fail to start.

## Implementation decisions

- **Camera maths is object-identical on no-ops.** `panBy` with a zero delta, and
  any zoom at a limit, returns the *same* `Camera` object. `useCamera` uses that
  identity to decide whether the user has "navigated" (hint latch) and to skip
  React re-renders. Tests assert object identity where the design does.
- **Step snapping.** `zoomStep` snaps the result to the nearest
  `ZOOM_STEP_FACTOR^n` within `STEP_SNAP_EPSILON = 1e-9`, so one step in then one
  step out returns exactly `1` (TC-09), while a wheel zoom (never stepped) does
  not snap. Because division is not the exact inverse of the snap, one zoom-out
  from `ZOOM_MAX` gives `4 / 1.25 = 3.2` → label `320%`, not `305%`; the e2e test
  asserts `320%` (that is the design's rule, not a bug).
- **Updates are batched into one `requestAnimationFrame`.** The newest camera is
  kept in a ref so `panMove` accumulates from the *pending* camera: a fast drag
  whose moves arrive between frames still follows the pointer exactly (this is
  what makes the ±1 px e2e assertions hold).
- **Grid**: one `radial-gradient` `background-image` on the viewport, with
  `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position = mod(-x * zoom, spacing)` per the design. The dot radius
  scales with zoom and is clamped to 0.6–5 CSS px so the dots stay legible at
  10% and do not become blobs at 400%; the radius is not a design constant.
- **Wheel listener is added manually** with `{ passive: false }` (React's
  `onWheel` is passive, and `preventDefault` is the point), attached to the
  viewport element; Safari `gesturestart/change/end` and the window `keydown`
  handler are added the same way. All of them `preventDefault()`.
- **Drag only starts on the surface itself** (`event.target === viewport`): the
  grid is the viewport's own background, and later stories' objects stop
  propagation so they can own their drags.
- **Resize never moves the camera**: `resize` only updates the size used to find
  the centre; `x, y` are untouched (design TC-07), and `Reset view` uses the
  current size, so it centres for whatever the window is now.

## Test decisions

- **Red phase was observed.** With `camera.ts` reduced to `not implemented`
  stubs, 15 of the 16 unit tests failed (the survivor only asserts that a value
  does not change). It was verified in the working tree rather than as its own
  commit, because the story asks for a single commit at the end.
- **Test-case ids** in the test files match the design's acceptance cases.
  Suffixed ids (`TC-15b`, `TC-17b`, `TC-18b`, `TC-22b`, `TC-22c`, `TC-30b`) are
  additional checks around the same case, not new cases.
- **`@testing-library/jest-dom` is not used** (it is not in the design's dev
  dependencies), so assertions use DOM facts: `button.disabled`,
  `getAttribute('disabled')`, `textContent`.
- **Vitest globals are off**, so Testing Library does not auto-clean the DOM.
  `useBoardTestLifecycle()` in `tests/component/helpers.tsx` installs fake
  timers per test *and* calls `cleanup()`; every component test file calls it at
  the top of the module.
- **Vitest 5's `vi.useFakeTimers()` also fakes `requestAnimationFrame`**, which
  is how the component tests flush the rAF-batched camera commit
  (`flushFrames()` advances 32 ms inside `act`).
- **jsdom facts the component tests rely on**: no `ResizeObserver` (so the board
  area is `window.innerWidth × innerHeight` = 1024×768), `getBoundingClientRect()`
  returns zeros (so screen coordinates equal client coordinates), and
  `setPointerCapture` is missing (the component calls it with `?.`).
- **e2e waits for the app's own batching instead of sleeping.** The board commits
  a gesture in the next frame, and headless WebKit applies mount effects up to
  ~50 ms after the load event. `waitForCameraChange(page, before)` waits until the
  camera differs from a pre-gesture read and then until two reads agree;
  `settledCamera()` waits for agreement alone; `setCamera()` waits for
  `window.__vidi6` to exist. Reading geometry immediately after a click is a real
  race — it produced a false failure before the helpers existed.
- **Pixel assertions are done twice, differently.** CSS/layout facts come from
  `getBoundingClientRect` (origin marker, board area) and `getComputedStyle`
  (grid `background-size`/`background-position`). Rendered pixels are checked too:
  `tests/e2e/helpers/pixels.ts` decodes the page screenshot *inside the browser*
  (canvas `getImageData`) and locates grid dots by luminance. Because a screenshot
  is whole device pixels, rendered-pixel deltas carry a ±2 px rounding allowance;
  CSS-derived positions keep the design's ±1 px.
- **Grid dots are sampled on a row that actually crosses dots** (`dotRow(geom)`
  derives it from the computed geometry): a fixed row can fall between two rows of
  dots and silently sample nothing.
- **Chromium dispatches the Ctrl+wheel through CDP** (`Input.dispatchMouseEvent`
  with the Ctrl modifier) so it is a real browser-level gesture; Firefox and
  WebKit get a `WheelEvent` with `ctrlKey` set, which is what a trackpad pinch
  looks like to the board. All three assert `defaultPrevented` from a
  document-level listener — that flag is exactly what the browser uses to decide
  whether to zoom the page — plus `visualViewport.scale` and `devicePixelRatio`
  unchanged.
- **Both fixture sizes are used in e2e**: 1280×800 for every project and one test
  that starts at 1920×1080, shrinks to 1280×800 (camera `x, y` must not move) and
  resets (must centre on the new size).
- **Not covered**, as the design states: TC-33 (shortcuts while the browser's own
  address bar has focus — the page cannot receive those events), trackpad
  hardware inertia, Safari pinch in e2e (Playwright's WebKit cannot synthesise a
  `GestureEvent`; TC-17 covers the handler), and touch input.
- **Manual browser check** (task 3's "Done when") is covered by the automated
  suite in Chromium, Firefox and WebKit; a real Safari pinch was not available.

## Environment notes

- **`playwright.config.ts` carries two macOS-only launch allowances.** Firefox's
  macOS process sandbox cannot initialise inside a sandboxed agent
  (`sandbox_init(): Operation not permitted`) and Playwright's WebKit
  host-requirements check cannot run unprivileged. Both are gated on
  `process.platform === 'darwin'` and only affect whether the browsers start.
- **`npm run test:e2e` builds with `MODE=test`** (through the Playwright
  `webServer` command) so the test hook exists; the production build was checked
  to contain no `__vidi6` reference. `reuseExistingServer` is on outside CI.
- **Reserved browser shortcuts**: `Ctrl + =` is a browser-reserved zoom shortcut
  in real desktop browsers, which can act on it before the page sees the event.
  The board calls `preventDefault()`, and TC-31 asserts the page zoom is untouched
  for dispatched events; that is the strongest statement available from inside a
  page.

## For stories 2–5

- `src/shared/config.ts` is the place for new settings; do not re-declare.
- Board content goes in `BoardViewport`'s `children` — it is rendered inside the
  world layer, so it is already in world coordinates (`transform-origin: 0 0`,
  `scale(zoom) translate(-x, -y)`). Give interactive objects their own
  `onPointerDown` with `stopPropagation()` so the board does not start a pan.
- The world layer is `pointer-events: none` today; objects that need input must
  re-enable it on themselves.
- Camera reads in tests: the viewport carries `data-camera-x`, `data-camera-y`,
  `data-camera-zoom`, `data-grid-spacing`, `data-grid-offset-x/y`,
  `data-origin-x/y` and `data-mode` (`idle` / `panning`).
