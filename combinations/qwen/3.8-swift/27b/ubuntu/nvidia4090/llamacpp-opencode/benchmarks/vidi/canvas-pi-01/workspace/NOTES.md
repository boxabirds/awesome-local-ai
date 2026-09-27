# Story 1 — Notes

Pan and zoom around an infinite board. All tests pass:

- `npm run typecheck` — clean
- `npm run test:unit` — 16/16 (camera maths, TC-01..12 + property check)
- `npm run test:component` — 19/19 (TC-13..22, 29, 30, 32 + extras)
- `npm run test:e2e` — 12/12 (4 tests × chromium/firefox/webkit, via `wrangler dev`)
- `npm run build` — production bundle builds; the `window.__vidi6` test hook is
  absent from production output (guarded by `import.meta.env.MODE === 'test'`)

## Design contract extensions

The implementation keeps the design contract and adds members it needs; nothing
in the contract was changed or removed.

### `useCamera` return value (`CameraApi`)

Beyond `camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset`:

- `panning: boolean` — true while a pointer drag is in progress; the viewport
  renders `data-panning` and a `grabbing` cursor from it, and TC-13/TC-14 assert
  the Idle → Panning → Idle cycle through it.
- `gestureStart(): void`, `gestureChange(scale: number, point: Point): void` —
  Safari trackpad pinch (the design lists `gesturestart/gesturechange` as
  inputs; the contract signature list omitted the corresponding hook methods).
- `setCamera(cam: Camera): void` — test-only camera jump; wired to
  `window.__vidi6.setCamera` in `testHooks.ts`, enabled only in test mode.

### `BoardViewport` props

The design shows `BoardViewport({ children? })`; the implementation is
`BoardViewport({ children?, cam: CameraApi })`. `App` owns the single
`useCamera` instance (so the viewport, zoom controls and hint share one camera)
and injects it as a prop — matching the structure diagram, where everything
wires to the one hook.

## Decisions and deviations

- **`wrangler.jsonc`**: no `assets.binding`. Wrangler 4.141 rejects an
  assets-only config that declares a binding without a Worker `main`. The
  `ASSETS` binding returns in story 3 together with the Worker script.
- **E2E build**: `npm run build:e2e` (`vite build --mode test`) so the
  `__vidi6` hook exists in the bundle served to the e2e suite; `npm run build`
  (production mode) excludes it.
- **E2E drag robustness (WebKit)**: WebKit + Playwright can deliver synthetic
  `pointerdown` late (after queued `pointermove`s) or drop it under load.
  `dragBoard` in `tests/e2e/helpers/board.ts` verifies `data-panning` after
  `mouse.down()` and retries if the down was lost; a shortfall pass compensates
  for coalesced `pointermove` events so the asserted net pan is exact.
  The app code itself is unchanged by this — moves before `pointerdown` are
  simply ignored by the hook.
- **Transform assertions are numeric**: JS stringifies `±1000000` as
  `±1e+06` in inline styles, so e2e helpers parse the world-layer transform
  and compare numbers, not strings.
- **Grid rendering**: the dot grid is a CSS `radial-gradient` background on the
  viewport with `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position` wrapped with a positive modulo — even at zoom 0.1 far
  from the origin (TC-27).
- **Origin marker**: a small crosshair at world (0,0) (`data-testid="origin-marker"`)
  so e2e can measure "the board's starting point" directly.

## Test-to-spec map

- `tests/unit/camera.test.ts` — TC-01..12 + a seeded property check
  (round-trip / invariance, clamping, drift over 10 000 zoom steps).
- `tests/component/BoardViewport.test.tsx` — TC-13..18, TC-29, TC-30 +
  deltaX wheel panning + drag-target restriction.
- `tests/component/ZoomControls.test.tsx` — TC-19..21, TC-32.
- `tests/component/NavigationHint.test.tsx` — TC-22 + visibility/positioning.
- `tests/e2e/navigation.spec.ts` — TC-23..28, TC-31 (three design workflows +
  page-zoom isolation), on chromium, firefox and webkit.
