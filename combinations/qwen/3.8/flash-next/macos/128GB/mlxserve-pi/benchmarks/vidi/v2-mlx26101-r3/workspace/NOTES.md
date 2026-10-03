# vidi6 — working notes

Kept current by whoever works on the repo. Records verified commands, deviations from the
story design, and gotchas for the next story.

## Commands (all verified in this environment)

| Command | What it does |
| --- | --- |
| `npm install` | Install deps (Node 24, npm 11). |
| `npm run dev` | Vite dev server on `http://127.0.0.1:23600`. Story 1 has no server code, so no Worker is needed in dev. |
| `npm run build` | Production client build → `dist/client` with **stable** asset names (`assets/app.js`, `assets/index.css`). |
| `npm run build:test` | Same build with `MODE=test`, which compiles in the `window.__vidi6` e2e hook. Must run before `test:e2e` (the Playwright `webServer` command does it). |
| `npm run preview` | `wrangler dev` serving `dist/client` at `http://127.0.0.1:23612` (inspector port 23613) — the same serving path later stories use. |
| `npm run typecheck` | `tsc --noEmit` over `tsconfig.json` (src) **and** `tsconfig.test.json` (tests + Playwright config). |
| `npm run test:unit` | 23 camera-maths tests, node environment. |
| `npm run test:component` | 27 jsdom tests (viewport input, zoom controls, hint). |
| `npm run test:e2e` | Playwright. Starts `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port 23614 --inspector-port 23615`, viewport 1280×800, **Chromium only by default** (see deviation 1). 23 tests. |
| `BROWSERS=all npm run test:e2e` (or `npm run test:e2e:all-browsers`) | Chromium + Firefox + WebKit. |
| `npm run check:no-test-hook` | Fails if a built asset contains `__vidi6` (run after `npm run build`). |
| `npm run verify` | typecheck → build → no-test-hook → unit → component → e2e(Chromium). One command for the whole gate. |

Ports in use: dev `23600`, preview `23612/23613`, e2e `23614/23615` (override with
`DEV_PORT`, `E2E_PORT`, `E2E_INSPECTOR_PORT`).

## Deviations from `spec/stories/.../design.md`

1. **Non-Chromium Playwright projects are opt-in.** The design wants Chromium, Firefox and
   WebKit projects. All three are configured, but in this sandbox the bundled Firefox and
   WebKit binaries abort on launch (`SIGABRT` / `Abort trap: 6`; `BROWSERS=all` reproduces
   it) — an environment limit, not a product problem, so the default project list is
   Chromium only and the full matrix is one env var away. Everything the Safari/WebKit
   pinch path does is covered in jsdom with synthetic `gesturestart/gesturechange` events
   (`tests/component/BoardViewport.test.tsx`, TC-17/TC-17b).
2. **e2e runs on port 23614 (+ inspector 23615)** instead of a 3000-class port, because this
   agent may only bind 23600–23615.
3. **`wrangler.jsonc` has no Worker `main` and no `ASSETS` binding.** wrangler 4 rejects
   `Cannot use assets with a binding in an assets-only Worker`. Story 3 adds `main`; that is
   when `"binding": "ASSETS"` goes back in. `dev.port` / `dev.inspector_port` are set so
   `npm run preview` also stays inside the allowed port range.
4. **Stable built asset names** (`build.rollupOptions.output.*FileNames`). With content
   hashes, a `wrangler dev` that is already running 404s on the new hashed file (it builds
   its asset list at startup). Wrangler hashes assets itself on deploy.
5. **Extra e2e files** next to the designed `tests/e2e/navigation.spec.ts`:
   `layout.spec.ts` (board fills the window, `touch-action`/`overscroll-behavior`, `grab` and
   `grabbing` cursors, wheel over the controls does nothing, drags starting on the overlay do
   nothing, controls do not scale with zoom, dot-grid alignment to world grid lines, resize
   leaves content where it is, zoom keeps the viewport centre) and `touch.spec.ts` (touch drag pans via CDP
   `Input.dispatchTouchEvent`; skipped for non-Chromium projects).
6. **Interaction tests use `fireEvent` + real DOM events; only the zoom-control clicks use
   `user-event`.** Pointer/wheel/gesture sequences need exact event objects and
   `defaultPrevented` assertions. Fake timers are limited to
   `{ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] }`: faking every timer makes
   React's scheduler spin inside `advanceTimersByTimeAsync` and the test hangs.
7. **The world layer carries a `data-camera="x,y,zoom"` attribute.** It is the readout that
   pixel-free assertions (far-travel exactness) and debugging use.
8. **The e2e test hook is `window.__vidi6.setCamera({ x?, y?, zoom? })`**, applied without
   clamping x/y (jumping 1,000,000 units away is the whole point of the fixture).
9. **`src/server/` was not created** — nothing in story 1 needs server logic.

## Gotchas / findings for the next story

- **Coordinate contract** (everywhere): `screen = (world - camera.xy) * zoom`,
  `world = screen / zoom + camera.xy`. The world layer renders it as
  `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`. Swapping
  `scale`/`translate` shifts the world by a factor of zoom — three e2e tests fail if you do.
- **Never round `camera.x` / `camera.y`.** All pan/zoom maths stays in double precision so
  sub-pixel precision survives at 1,000,000 units out (PRD "No edges"). Only the *label*
  rounds (`zoomPercent`).
- **React attaches `wheel` as a passive listener at the root**, so `onWheel` +
  `preventDefault()` throws "Unable to preventDefault inside passive event listener". The
  board's wheel handling is a native `addEventListener('wheel', fn, { passive: false })` in
  `BoardViewport`. Keep it that way.
- **Drag vs. objects:** only elements carrying `data-board-surface` start a pan; anything
  inside `[data-board-ui]` (the overlay) is ignored by both the pan and wheel handlers.
  Story 2's sticky notes should call `stopPropagation()` on `pointerdown` to own their drag.
  `touch-action: none` (in CSS, not inline) is what stops the browser panning/zooming.
- **Pointer capture:** `setPointerCapture` on the viewport retargets later pointer events, so
  dragging continues even when the pointer is over the overlay. `onLostPointerCapture` ends
  the pan; `panningRef` (a ref, not state) is the synchronous source of truth.
- **`deltaMode` matters:** Firefox reports `DOM_LINE_NUMBER` (1) and some setups report pages
  (2). `wheelPixelScale` converts lines → `WHEEL_LINE_HEIGHT_PX` and pages → viewport height,
  otherwise panning feels 3× slower in Firefox.
- **Safari `gesture*` events** carry `scale` measured *since the gesture started*, so zoom is
  applied incrementally (`scale / lastScale`). A test that uses scales 1 → 2 → 4 cannot catch
  the difference because the clamp at 4 hides it — the component test uses 1.2 → 1.5 for that
  reason.
- **Camera updates are coalesced with rAF** (at most one render per frame), so any assertion
  on the DOM must wait a frame: `settle()` (e2e, two `requestAnimationFrame`s) or
  `flushFrames()` (component). `useCamera` also keeps `cameraRef` synchronously up to date,
  which is what makes rapid-fire events exact.
- **A window resize never moves the camera.** `useCamera` seeds the standard view from
  `resetCamera({ width: window.innerWidth, height: window.innerHeight })` at first render and
  the `ResizeObserver` size is only used for page-mode wheel deltas and the zoom-step centre.
  (PRD "Resizing the browser window does not move content relative to the top-left corner" +
  design "camera x, y is unchanged by design"; asserted by TC-07 component and the e2e resize
  test.) Because of that, jsdom component tests must emulate the window size —
  `tests/component/setup.ts` redefines `window.innerWidth/innerHeight` to 1280×800 to match the
  e2e viewport; jsdom's own 1024×768 would give a different standard view.
- **jsdom gaps:** no `ResizeObserver` (stub in `tests/component/resizeObserver.ts`, drive it
  with `setObservedSize()`), and essentially no CSS cascade/layout — element rects are 0×0,
  so pixel assertions there are impossible (the origin marker still gives a usable centre
  because it has a fixed CSS size and is centred by a counter-scale). CSS-level regressions
  belong in e2e: the e2e run caught a real one (`overscroll-behavior` was only on
  `html, body`, not `.board-viewport`) that jsdom happily reported as correct.
- **The dot grid** is a CSS `radial-gradient` background on a full-viewport layer:
  `background-size = GRID_SPACING_WORLD * zoom`, `background-position =
  mod(-camera.xy * zoom, spacing) - spacing/2` (the half-tile correction is what puts a dot
  exactly on a world grid line — `layout.spec.ts` asserts that).
- **Zoom step snapping:** `zoomStep` snaps a target zoom to the nearest `ZOOM_STEP_FACTOR^n`
  within `ZOOM_STEP_SNAP_EPSILON * max(1, snapped)` so step-in → step-out returns to the exact
  zoom it started from; labels then read 100 → 125 → 156 → 195 → 244 → 305 → 381 → 400 (the
  last one is a clamp, not a power of 1.25). The e2e test derives that sequence from the pure
  maths instead of hardcoding it.
- **Sandbox limits worth remembering:** `/tmp` is not writable (scratch files go in `.logs/`,
  which is gitignored), `ps` / `pkill` / `lsof` return nothing, so a manually started
  `wrangler dev` cannot be killed — let Playwright own the e2e port. A stale `wrangler dev`
  on the e2e port is served by `reuseExistingServer: !CI`, so if you ever change asset names,
  change the port too.
- **Production must stay hook-free:** `npm run check:no-test-hook` greps the built assets for
  `__vidi6`. It is part of `npm run verify`.

## Where story 2 plugs in

- `BoardViewport` takes `children` rendered inside the world layer, already in world
  coordinates (world layer scale does the rest). Objects that should not pan the board call
  `stopPropagation()` on `pointerdown` and carry no `data-board-surface`.
- `useCamera` is the only place that owns camera state; `CameraInputHandlers` is the seam for
  new input gestures.
