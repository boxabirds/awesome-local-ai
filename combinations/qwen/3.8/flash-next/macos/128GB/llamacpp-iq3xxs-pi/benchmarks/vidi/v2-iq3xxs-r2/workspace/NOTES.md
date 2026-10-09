# Notes: decisions and environment

Story 1 — "Pan and zoom around an infinite board". Everything the design asked for is
implemented; the decisions below cover the places where the design left a choice open, and
the two things that could not be done on this machine.

## Followed from the design exactly

- All six named settings in `src/shared/config.ts` (`ZOOM_MIN`, `ZOOM_MAX`,
  `ZOOM_STEP_FACTOR`, `WHEEL_ZOOM_SENSITIVITY = 0.01`, `GRID_SPACING_WORLD = 24`,
  `UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000`), the `camera.ts` / `useCamera.ts` /
  `BoardViewport.tsx` / `ZoomControls.tsx` / `NavigationHint.tsx` contracts, the file
  layout, and the exact UI strings (`Reset view`, the `Zoom out` / `Zoom in`
  `aria-label`s, the `aria-live="polite"` percentage output, and
  "Drag to move around · Ctrl/Cmd + scroll or pinch to zoom").
- Extra named constants were added only where the design implied a number without naming
  it: `WHEEL_PIXELS_PER_LINE`/`WHEEL_PIXELS_PER_PAGE` (deltaMode conversion),
  `PERCENT_PER_ZOOM`, `ZOOM_STEP_SNAP_EPSILON` (the "within 1e-9" step snap), and
  `INITIAL_CAMERA` / `ZOOM_MIN_PERCENT` / `ZOOM_MAX_PERCENT` for tests and controls.
- No pan clamping anywhere: `x`/`y` are plain doubles, verified out to
  `UNBOUNDED_PAN_TESTED_EXTENT` in a real browser (`e2e`, TC-27 plus the
  "reaches UNBOUNDED_PAN_TESTED_EXTENT" test).

## Decisions

1. **Camera updates are coalesced to one per animation frame** (`useCamera` keeps the
   camera in a ref plus a `requestAnimationFrame` commit, as the design requires). Every
   test that reads DOM geometry therefore waits for a commit first — two frames in e2e
   (`settle()` in `tests/e2e/helpers/board.ts`, folded into the read helpers), and a
   0 ms `setTimeout` `requestAnimationFrame` stub in `tests/component/setup.ts` for jsdom.
   Without this, pointer-invariance assertions race the commit and fail intermittently.
2. **The board opens centred.** `useCamera` seeds the initial camera with
   `resetCamera(viewport)` when the viewport is already measured, with a fallback effect
   for a 0x0 mount (jsdom before `ResizeObserver` fires, or a hidden container). Centring
   never sets `hasNavigated`, so it does not dismiss the hint (TC-22/TC-28).
   Seeding synchronously removes an uncentred first paint, which otherwise made the first
   e2e pixel assertion racy.
3. **`useCamera` returns a small `CameraApi` object** (context-provided, `useCameraApi()`),
   which is the design's return value plus `zoomAround(point, factor)` (screen point for
   wheel/gesture zoom), `setCamera` (used by the test hook) and `panning` (cursor and
   `data-state` on the viewport). `App.tsx` owns `useCamera` + the viewport size so
   `ZoomControls` stays presentational, per the design.
4. **Keyboard shortcuts are bound on `window`** (`keydown`, capture-free bubble phase) for
   Ctrl/Cmd + `=`, `+`, `-`, `_`, `0`, skipped when the event target is editable, matching
   the design's "keydown on window". Ctrl+`=` is what `Shift`+`=` produces on the tested
   layouts, so both `=` and `+` zoom in.
5. **Drag only starts on the viewport or the grid layer** (`data-pan-target`), so later
   object stories can stop propagation, and the pointer is captured for the whole gesture
   with `pointerup`/`pointercancel`/`lostpointercapture` all ending the pan (TC-14).
6. **Test hook** lives in `src/client/canvas/testHooks.ts`, registered only when
   `import.meta.env.MODE === 'test'`. Verified: `grep -rl "__vidi6" dist/client/assets/*.js`
   finds nothing after `npm run build` (production) and finds the chunk after
   `npm run build:test`. e2e runs against the test build via `npm run e2e:build`.
7. **Origin marker** is a 16px crosshair at world (0,0) inside the world layer, present in
   production builds too (design's fixture note), with `data-testid="origin-marker"`; e2e
   uses it (and the computed dot-grid background) as the pixel target.
8. **Ports** stay in the allowed 27424–27439 range: `dev`/`preview` 27424, e2e server
   27426 with wrangler inspector 27427 (both overridable with `AGENT_PORT_E2E` /
   `AGENT_PORT_E2E_WRANGLER` so CI can move them inside the range).
9. **`wrangler.jsonc`** has `assets.directory = "dist/client"` and no `binding`: an
   assets-only Worker must not declare one. Story 3 adds `main` plus the binding.
10. **Grid rendering** follows the design formulas: `background-size =
    GRID_SPACING_WORLD * zoom`, `background-position = (-x * zoom) mod spacing`, world
    layer `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`.
    Both were checked numerically in e2e (TC-23, TC-27) rather than by snapshot.
11. **TC-33** (shortcuts while the browser chrome has focus) is documented in the design
    as not testable in-page and has no test, as instructed.

## Blocked on this machine

- **Firefox and WebKit cannot be launched here.** Playwright 1.56's Firefox (142.0.1) and
  WebKit abort during process launch (`SIGABRT` / `Abort trap: 6`) before Playwright can
  connect, headless or not, with or without sandbox-relaxing env vars; Chromium starts
  fine, and the same specs pass there. This is an environment limitation of this sandbox,
  not of the tests or the app: the three browser projects are configured, and
  `E2E_BROWSERS=all npm run test:e2e` runs all three on a machine that can start them.
- To keep `npm run test:e2e` honest and green here, `tests/e2e/helpers/browsers.ts` probes
  which browsers can actually be launched (result cached in
  `node_modules/.cache/vidi6-e2e-browsers.json`) and skips the others with a printed
  warning instead of reporting a failure. `E2E_BROWSERS=chromium[,firefox]` (or `all`)
  overrides the probe. Nothing about the app or the specs was weakened to get here: every
  case that ran in Chromium also runs in Firefox and WebKit wherever they can start.
- **Playwright is pinned to 1.56.1**, not a newer line: newer Chromium builds are fetched
  from `storage.googleapis.com`, which this machine's proxy refuses (403). Revision 1194
  (Chromium), 1495 (Firefox) and 2215 (WebKit) are downloadable from
  `cdn.playwright.dev/dbazure`, so `PLAYWRIGHT_BROWSERS_PATH=…/browsers` versions were
  installed there manually. Node 24 also hangs the runner of Playwright ≤ 1.52, which is
  why the version is pinned in `package.json` rather than floated.
- **Browser binaries** come from `PLAYWRIGHT_BROWSERS_PATH` (set to
  `../browsers` here, where revisions 1194/1495/2215 were installed with
  `npx playwright install chromium firefox webkit`). `playwright.config.ts` does not
  hard-code a path, so the usual default (`~/.cache/ms-playwright`) also works.
- **`wrangler dev` metrics** are disabled in the e2e `webServer` command
  (`WRANGLER_SEND_METRICS=false`, `CI=1`) because the analytics upload tries to reach
  Cloudflare endpoints over a proxy that blocks them, which delays server start-up.

## Things worth knowing when story 2 starts

- `tests/component/fixtures/board.tsx` is the place to reuse: it renders the whole board
  with a jsdom `ResizeObserver` fixture (1280x800), reads the camera from
  `[data-testid="viewport"]` (`data-camera-x/y/zoom`, `data-state`), and has pointer,
  wheel and Safari-gesture dispatchers.
- `App.tsx` currently mounts only the board; the collaboration bits from stories 2–5 slot
  in there, and `src/shared/config.ts` is the single place for new named settings.
