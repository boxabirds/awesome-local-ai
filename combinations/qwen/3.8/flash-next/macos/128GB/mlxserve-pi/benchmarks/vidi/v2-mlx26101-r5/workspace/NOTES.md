# Notes

Decisions, deviations and environment findings while implementing story 1.

## Ports

The allowed range is 20784–20799. Defaults: `npm run dev` → 20786 (Vite),
`npm run e2e:serve` / Playwright → 20784 (`wrangler dev`), inspector → 20785.
All three are overridable (`VIDI6_DEV_PORT`, `VIDI6_E2E_PORT`,
`VIDI6_E2E_INSPECTOR_PORT`). `server.host = true` is set in `vite.config.ts` so the
dev server answers on both `127.0.0.1` and `localhost` (with the Vite default it
bound to the IPv6 loopback only and `curl http://127.0.0.1:20786` failed);
`strictPort` is deliberately off so a busy port moves to the next free port in
range instead of exiting.

## Contract deviations (all additive)

- **`BoardViewport` takes a `controller` prop.** The design's contract is
  `BoardViewport(props: { children?: ReactNode })`. One camera has to be shared by
  the viewport, the zoom control and the hint, so `App` calls `useCamera` and passes
  the resulting `CameraController` (camera, `hasNavigated`, `isPanning`, and the
  handlers named in the `useCamera` contract) down as a prop. `children` still works
  and is rendered in world coordinates.
- **`useCamera` returns a superset** of the contract: `isPanning` (drives
  `data-panning` and the grabbing cursor), `zoomBy(factor, point)` (the Safari
  gesture path) and `setCamera(patch)` (the `window.__vidi6` hook). Everything named
  in the contract is there with the documented signature.
- **`hasNavigated` is `useState` backed by a `useRef` latch**, because a ref alone
  cannot re-render the hint away. The latch semantics from the design hold: it only
  flips when `camera.ts` returns a *different* object, so TC-29 (click without
  movement, no-op zoom at a limit) does not dismiss the hint, and it never resets
  during the visit.
- **Extra files:** `src/client/canvas/testHooks.ts` (the `window.__vidi6` fixture,
  listed under "Fixtures" in the design) and `src/client/styles.css`.

## Camera maths

Exactly as specified: immutable `Camera`, `x`/`y` = world point at the viewport's
top-left, `zoomAt` keeps the world point under the pointer and returns the *input
object* for no-ops and invalid factors, `zoomStep` snaps to the nearest
`ZOOM_STEP_FACTOR^n` (epsilon `STEP_SNAP_EPSILON = 1e-9`) so 125 % → 100 % lands on
exactly 1.0. All limits come from `src/shared/config.ts`; `PERCENT = 100` is named.
The unit suite includes the seeded 1,000-case property check for pointer invariance.

## Grid rendering

The dot grid is the viewport's own `background-image` (radial-gradient), with
`background-size = GRID_SPACING_WORLD * zoom` and `background-position` = `-camera.xy *
zoom mod spacing`, so dots stay welded to world intersections. Two details:

- CSS values go through `px()`, which renders `Number(value.toFixed(6))`. Camera
  values around 1e6 would otherwise serialise as `1e+6px`, which CSS rejects.
- The offset is taken modulo the spacing so it stays small at any distance; that is
  what makes 1,000,000 units out look identical to 0.
- The world layer uses `transform: scale(zoom) translate(-x px, -y px)` with
  `transform-origin: 0 0` (one composited transform, no per-dot DOM). The origin
  marker counter-scales by `scale(1/zoom)` about its own centre so the crosshair
  stays a fixed screen size while its centre stays welded to world (0,0).
- The world layer is `pointer-events: none`; object stories re-enable it per object.
  `cursor: grabbing` is applied to the viewport while panning.

## Event handling details worth remembering

- `wheel` is bound natively with `{ passive: false }` (React's `onWheel` is passive)
  and always `preventDefault()`s — that plus prevented Safari `gesture*` events and
  the three prevented shortcuts is what keeps page zoom from moving.
- `deltaMode` is converted with named constants: `WHEEL_DELTA_LINE_PX = 16`,
  `WHEEL_DELTA_PAGE_FRACTION = 0.9` of the viewport height.
- The keyboard shortcuts are on `window` (the viewport is a `div` and does not take
  focus first), are skipped when the target is editable, and handle `=`/`+`,
  `-`/`_` and `0` with Ctrl **or** Cmd. `Ctrl/Cmd + 0` is prevented, which also stops
  the browser's own "reset zoom".
- Drag starts only when `event.target` carries `data-board-surface` (the viewport or
  the grid), so object stories can own their own pointerdown.
- `lostpointercapture` is handled with a **native listener on the viewport** rather
  than React's `onLostPointerCapture`: React's root-delegation does not deliver that
  event in jsdom, and a native listener is also closer to the browser's own dispatch.
- The zoom control stops wheel propagation (passive listener) so Ctrl-wheel over the
  buttons never reaches the board (TC-30).

## Test infrastructure

- **Vitest projects**: `unit` (node, `tests/unit/**`), `component` (jsdom,
  `tests/component/**`, setup `tests/component/setup.ts`). Config lives in
  `vitest.config.ts` (Vitest reads the `projects` field there; `vite.config.ts` stays
  build-only).
- **rAF batching vs fake timers:** the design suggested fake timers. The hook batches
  with `requestAnimationFrame`, and jsdom's rAF plus React 19's `act()` interact badly
  with fake timers, so component tests use a real ~40 ms `settle()` inside `act()`
  (exported from `tests/component/harness.tsx`) to let the queued frame land.
- **jsdom gaps** (all guarded in the implementation, so production code is unaffected):
  no `setPointerCapture`/`hasPointerCapture` (tests fire `lostpointercapture`
  directly), no `ResizeObserver` (the viewport size comes from `window.innerWidth` in
  the harness), and `PointerEvent`/`WheelEvent` constructors exist but Testing Library
  `fireEvent` cannot build them with pointer semantics — the harness dispatches
  `window.PointerEvent` instances itself. `@testing-library/user-event` is installed
  per the design's dependency list but is not used for the viewport, because it
  cannot express pointer capture or Safari gesture events.
- `IS_REACT_ACT_ENVIRONMENT` is set in the component setup file (React 19 requires it).
- Component tests assert on the *rendered* camera (`data-camera-x/y/zoom`) and the
  world layer transform rather than on internals, and expected values are computed
  from the same config constants the implementation uses.

## E2E

- The `test:e2e` webServer runs `npm run e2e:serve` (`vite build --mode test` +
  `wrangler dev --local`), so the tests hit the real serving path.
- `window.__vidi6.setCamera/getCamera` is installed only when
  `import.meta.env.MODE === 'test'`; verified by grep: the production bundle contains
  zero occurrences of `__vidi6`, the test build contains it.
- **Firefox and WebKit cannot launch in this sandbox** (`SIGABRT` / `Abort trap: 6`
  during browser start, before any test code runs). Chromium passes 7/7. Instead of
  deleting the two projects from the browser matrix, the project list is env-driven:
  the default is `chromium` (so `npm run test:e2e` is green everywhere) and
  `VIDI6_E2E_PROJECTS=chromium,firefox,webkit npm run test:e2e` runs the full matrix
  on a machine where those browsers start. This is the only story-1 task that could
  not be fully executed here.
- `wrangler.jsonc` declares **no `ASSETS` binding**: wrangler 4 rejects an asset
  binding in an assets-only Worker ("Cannot use assets with a binding in an
  assets-only Worker"). The binding comes back with story 3's `main` entry point.
  `not_found_handling = single-page-application` is kept.
- Playwright waits on state, not sleeps: `expect.poll` on the rendered camera,
  `toHaveText` on the label. `dragAndSettle` asserts the camera delta itself, which
  is how "200 px drag moved the board exactly 200 px" is checked 1e6 units out where
  the marker is off screen; the on-screen variants measure the origin marker's
  `boundingBox()` centre.

## Findings while testing the implementation

- An early version of the grid test asserted `background-position` with `Number()`,
  which returns `NaN` for fractional CSS values like `12.5px`; `Number.parseFloat`
  is the right parse. Not an implementation bug.
- A component test that left a drag open (no `pointerup`) made the following drag's
  delta start from the previous drag's last point, which is correct behaviour for
  `beginPan` being a no-op while already `Panning` — the test now ends its drags. This
  confirmed the state machine really ignores a second `pointerdown`.
- `expect.closeTo(v, 6)` is too tight for e2e because the `data-camera-*` attributes
  are rounded to 6 decimals; precision 5 is used for camera comparisons.
- TC-33 (shortcuts while the address bar has focus) is not testable in-page, as the
  design says; nothing implemented for it.
