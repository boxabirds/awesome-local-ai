# Notes

Decisions and deviations recorded while implementing the stories.

## Story 1 — Pan and zoom around an infinite board

- **`wrangler.jsonc` has no `assets.binding`.** Wrangler 4 rejects an
  assets-only Worker that declares an asset binding ("Cannot use assets with a
  binding in an assets-only Worker"). Story 3 adds the Worker `main` script and
  will add the binding back together with it. `wrangler dev` serves
  `dist/client` correctly in the meantime (verified, HTTP 200 on `/`).
- **`useCamera` is owned by `BoardViewport`, not `App`.** The design's
  `useCamera(viewport)` takes the viewport size, but the size is only known
  after `BoardViewport` has measured its own element with a `ResizeObserver`.
  To keep the exported contracts exactly as written (`useCamera(viewport: Size)`
  and `BoardViewport({ children })`), `BoardViewport` calls `useCamera` with its
  measured size and wires `ZoomControls` / `NavigationHint` from that state.
  `App.tsx` mounts `BoardViewport` full-window and passes board content as
  `children`. The design's "App.tsx passes derived props" is therefore done one
  level down, inside `BoardViewport`; the props of `ZoomControls` and
  `NavigationHint` are exactly as specified.
- **E2E needs a test-mode build.** `window.__vidi6.setCamera()` is compiled in
  only when `import.meta.env.MODE === 'test'`, so the Playwright `webServer`
  runs `npm run e2e:server` (= `vite build --mode test` then
  `wrangler dev --port 8787`). The production `npm run build` uses the default
  `production` mode and excludes the hook.
- **Component-test shims.** jsdom provides no `ResizeObserver` and no Pointer
  Capture API, so `tests/component/setup.ts` installs minimal stubs. It also
  exposes `ResizeObserverStub.emit(width, height)` so a test can simulate a
  window resize (TC-07 at component level).
- **Zoom-step snapping.** `zoomStep` snaps the result to the nearest power of
  `ZOOM_STEP_FACTOR` within `ZOOM_STEP_SNAP_EPSILON` (1e-9), which makes
  100% -> 125% -> 100% exact (TC-09) instead of drifting through floating point.
- **Manual Safari check.** Task 3 asks for a manual check in Chrome and Safari.
  Chromium was driven interactively (via Playwright against `npm run dev`): drag
  pans 1:1, the cursor becomes a grabbing hand, scroll pans, Ctrl-scroll zooms
  around the pointer, the shortcuts work, the page never scrolls or zooms and the
  console is clean. A real Safari check is impossible in this container (see the
  Firefox/WebKit note below); the Safari-specific code paths are
  `gesturestart`/`gesturechange` handling, covered by the component test TC-17
  as the design's "Not covered" section intends.
- **Firefox/WebKit e2e.** The design asks for all three browsers and all three
  Playwright binaries are present, but this host is missing their system
  libraries (`libgtk-3-0t64` for Firefox, ~30 packages for WebKit) and there is
  no root access to install them, so only Chromium can launch here. The
  `firefox` and `webkit` projects stay in `playwright.config.ts`; the project
  list comes from `E2E_PROJECTS` (default `chromium`), so
  `npm run test:e2e` passes on this host and `npm run test:e2e:all` runs the
  full three-browser matrix on a provisioned one.
- **Grid pixels in e2e.** The dot grid is a CSS background, so it has no DOM
  nodes to measure. The e2e tests assert grid behaviour two ways: the
  *origin marker* (a real element at world 0,0, counter-scaled to keep its
  on-screen size) gives pixel-accurate movement and zoom-anchor checks, and the
  computed `background-size`/`background-position` of the board assert the grid
  tile size equals `GRID_SPACING_WORLD * zoom` and that its painted offset is
  exactly what the camera implies (and moved by exactly the drag distance,
  modulo one tile).
- **Extra members on the `useCamera` return.** The contract's members are all
  present; `canZoomIn`, `canZoomOut`, `zoomPercent` and `pinchAt(point, ratio)`
  were added because the Safari `gesturechange` handler needs a scale-ratio
  entry point (a wheel delta cannot express one) and `BoardViewport` needs the
  derived control state without re-deriving it in two places.
- **Camera renders are coalesced with `requestAnimationFrame`**, so the DOM (and
  the disabled state of a zoom button) is at most one frame behind the input.
  The component tests use fake timers and advance a frame after each event; the
  e2e tests click "until the button refuses" instead of polling `isEnabled()`
  before each click, which would race that frame.
- **`panBy` on plain scroll is called with negated deltas**, exactly as the
  design writes it (`panBy(-deltaX, -deltaY)`), which is what makes scrolling
  down move content up and scrolling right move content left.
- **Wheel delta modes** LINE/PAGE are converted to pixels with the named
  constants `WHEEL_LINE_HEIGHT_PX` / `WHEEL_PAGE_HEIGHT_PX` (Chrome defaults).
  Real trackpad hardware scaling is out of the automated scope per the design's
  "Not covered".
