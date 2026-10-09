# Notes

Decisions and environment facts for this build.

## Task 1 — scaffold

- Versions installed: React 19, Vite 8, TypeScript 7, Vitest 5 (with `unit` /
  `component` projects), Playwright 1.64, Wrangler 4.
- `npm run test:unit` / `npm run test:component` run the matching Vitest project;
  `npm run test:e2e` runs Playwright against `wrangler dev` serving the test build.
- Ports: only ports 24064-24079 are usable in this environment, so
  `wrangler dev` (e2e/preview) uses 24064 with inspector port 24065 and the Vite
  dev server uses 24066. Override with `VIDI6_E2E_PORT` for e2e.
- E2E builds the client with `vite build --mode test` so
  `window.__vidi6.setCamera()` (far-travel test hook) exists; the production
  `npm run build` omits it (`import.meta.env.MODE` is statically replaced).

## Playwright browsers (environment limitation)

- This sandbox has **no Playwright browser binaries** and no system Chrome/Firefox:
  `google-chrome` is a broken symlink, `firefox` is an uninstalled snap stub, and the
  network blocks every Playwright CDN (`cdn.playwright.dev`,
  `storage.googleapis.com`, `github.com`, `objects.githubusercontent.com`) with 403,
  so `npx playwright install` cannot work. Only `registry.npmjs.org` is reachable.
- Workaround: the npm package **`@sparticuz/chromium`** (devDependency) ships a real
  Chromium 153 binary inside the package tarball; it needs no download. `npm run
  pretest:e2e` (`scripts/prepare-e2e.mjs`) resolves a usable browser and writes
  `.e2e/browser.json` (gitignored), which `playwright.config.ts` reads to set
  `launchOptions.executablePath` (plus `--no-sandbox`, `--disable-dev-shm-usage`).
  If Playwright's own browsers *are* installed they win, and the fallback import is
  never used.
- Consequence: e2e runs in **Chromium only** (5 tests, all passing). Firefox and
  WebKit projects are *blocked* on this machine, not skipped by choice - on a
  machine with browsers installed the same suite runs in all three, because the
  config builds one project per available browser (`VIDI6_E2E_BROWSERS=chromium,
  firefox,webkit` can also be forced).
- Chromium 153 vs Playwright 1.64's expected 156: everything story 1 needs (CDP
  input, `boundingBox`, wheel, keyboard, `visualViewport`) works.

## Camera conventions (camera.math)

- `Camera {x, y, zoom}` with `screen = (world - camera.xy) * zoom`, i.e. `x, y` is
  the world point at the viewport's top-left. Panning by a screen delta is
  `panBy(cam, dx, dy) = x - dx / zoom`.
- Because of that sign convention `resetCamera(w, h)` is `{x: -w/2, y: -h/2}` (that
  is what puts world (0,0) at the viewport centre). The design doc writes the same
  rule as `x + viewportCentre.x / zoom`, which is the identical update expressed for
  the opposite sign; `TC-08` and `TC-26` assert the observable behaviour (origin
  centred at 100%), not the sign.
- `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` within
  `ZOOM_STEP_SNAP_EPSILON` so step in then step out returns *exactly* the starting
  zoom (TC-09, TC-18). Clamped results at `ZOOM_MIN` are deliberately **not**
  snapped (1.25^-10 = 0.107 is further than the epsilon from 0.1), so the zoom
  limit is exactly `ZOOM_MIN` and the label is exactly "10%".
- Functions return the *same object* when nothing changed; `useCamera` uses that
  identity to skip renders and to decide whether navigation happened (TC-05/06,
  TC-29).

## Viewport rendering

- `useViewportSize` measures the board with a `ResizeObserver` (window fallback);
  a resize only replaces the `Size`, the camera is never touched (TC-07 is the
  maths half of this).
- Dot grid: `background-size = GRID_SPACING_WORLD * zoom`, and
  `background-position = mod(-camera.x * zoom - spacingPx/2, spacingPx)`. The extra
  `-spacingPx/2` is needed because CSS paints each tile's radial-gradient dot at
  the **tile centre**; with it a dot lands exactly on every world coordinate that
  is a multiple of `GRID_SPACING_WORLD` (including the origin crosshair), which is
  what the grid-anchoring tests assert (`dotAlignmentError` in both test harnesses).
- Wheel handling is a native `addEventListener('wheel', ..., { passive: false })`
  on the board (React's onWheel is passive), and Ctrl/Cmd `+`/`-`/`0` shortcuts are
  window-level with `preventDefault` so the browser's own zoom never changes
  (TC-31 asserts `visualViewport.scale` and `devicePixelRatio` stay 1).
- Anything marked `data-board-chrome="true"` (zoom controls) is excluded from the
  board's wheel/pointer handlers, so scrolling over the controls does not move the
  board (TC-30).

## Test build helpers

- `installTestHooks()` exposes `window.__vidi6.setCamera/getCamera` only when
  `import.meta.env.MODE === "test"` (Vite statically replaces it, so the whole
  block is dead-code-eliminated in `npm run build`; verified by grepping the built
  bundle for `__vidi6`: absent in production, present in `build:test`).
- In test mode the world layer also renders a `far-anchor` marker at world
  (1e6, 1e6) so TC-27 can measure exactness 1,000,000 units away without dragging
  a million pixels. It is inside the world layer, so it moves with the camera.

## Test-design decisions

- Camera is read back from the rendered world-layer `transform` in component tests
  and from `window.__vidi6.getCamera()` in e2e (both are asserted against each other
  through marker bounding boxes).
- `useCamera` coalesces updates with `requestAnimationFrame`, so the DOM lags one
  frame behind an input. E2E therefore waits with `await expect(label).toHaveText(...)`
  before the next click instead of reading `isEnabled()` - otherwise a stale button
  state makes Playwright wait for a click on a control that just became disabled.
- TC-25/TC-26 assert the whole zoom label sequence computed from the config
  constants (`stepLabels`), not hard-coded numbers: 125, 156, 195, 244, 305, 381,
  400 and 80, 64, 51, 41, 33, 26, 21, 17, 13, 11, 10.
- Marker measurements use the **centre** of the crosshair bar (`markerPoint`), so
  the 9px arm offset of the marker never leaks into a tolerance.
- Safari pinch is only covered by the component test TC-17 (synthetic
  `gesturechange`), as Playwright cannot synthesise gesture events - matching the
  test strategy's "Not covered" list.

## Story 2 — sticky notes

Design contracts are implemented as written. Everything below is either an extra
setting the PRD needs but the design did not name, or an environment fact the tests
depend on.

### Additions to `src/shared/config.ts`

- `STICKY_PADDING_WORLD = 16` — the PRD fixes the text 16 px from every note edge;
  the auto-fit search and the editor both need that number, so it is a named product
  setting next to the ones the design listed.
- `STICKY_COLOR_NAMES` / `stickyColorLabel(color)` — the accessible name and tooltip
  of each swatch ("Yellow colour" … "Violet colour"), so colours are distinguishable
  by name and not only by fill (PRD accessibility criterion).

### Board model

- `createSticky` returns `string` exactly as the design declares it. A rejected
  creation returns `''` (falsy), which keeps the return type a string while still
  telling the caller that nothing was created.
- Every successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`; rejections
  (stale id, unknown colour, non-finite coordinates, raise on the topmost note)
  return before a transaction opens, so they emit zero `update` events — that is what
  the unit suite counts.

### Viewport ownership

- `BoardViewport` stays presentation-only: it never calls `createSticky` itself. It
  reports `onEmptyDoubleClick(worldPoint)`, `onEmptyClick(worldPoint)` and
  `onSurfaceChange(surface)` and `App` decides what a click on empty space means.
  `viewportCentre(surface)` returns **screen** coordinates (the centre of the visible
  area); callers convert with `screenToWorld(surface.camera, …)`.
- `data-board-surface="true"` marks elements that empty-board gestures belong to
  (the board and its grid). Notes and both toolbars `stopPropagation`, so a note
  press can never pan the board and a toolbar click can never clear the selection.
- `BoardSurface.width/height` fall back to the measured viewport when
  `getBoundingClientRect()` is empty, because jsdom has no layout engine.

### Test hooks (test build only)

`window.__vidi6` gains `notes()` (a `snapshot()` of the live document) and
`createNote({x, y, color})`. E2E uses them to set up a board without simulating the
creation gesture and to read back world positions, which the DOM cannot express at
50 % / 200 % zoom. They are compiled out of `npm run build` (verified by grepping the
bundle for `__vidi6`).

### jsdom vs. a real browser

- jsdom has no layout: text fit, note clipping, the bottom fade and font-size
  measurement can only be verified in E2E (TC-33). Component tests assert the model
  and the DOM state (data attributes, which element is mounted), never geometry.
- jsdom has no `ResizeObserver`; `useViewportSize` falls back to
  `window.innerWidth/innerHeight` (1024 × 768).
- `StickyNote` coalesces drags with `requestAnimationFrame` (one Y.Doc write per
  frame, not per pointermove), and `useCamera` does the same for pans — so component
  tests must `await flushFrame()` before reading a position or the camera, and
  `data-panning` / `data-dragging` are checked synchronously.
- Only Chromium is available on this machine (see the Playwright section above), so
  story 2's E2E suite runs there; it covers TC-30 to TC-34 plus the golden path.
