# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Scaffold project and write camera maths unit tests first (TC-01 to TC-12) | proposed | test:unit | camera.math |
| 2 | Implement camera maths to pass unit tests | proposed | implementation | camera.math |
| 3 | Implement board viewport: drag, wheel, pinch and keyboard navigation with dot grid | proposed | implementation | viewport.input |
| 4 | Implement zoom controls (−, percentage, +, Reset view) | proposed | implementation | zoom.controls |
| 5 | Implement first-use navigation hint | proposed | implementation | nav.hint_display |
| 6 | Component tests for viewport input, zoom controls and hint | proposed | test:ui-component | viewport.input, zoom.controls, nav.hint_display |
| 7 | E2E navigation tests in Chromium, Firefox and WebKit | proposed | test:e2e | viewport.input, zoom.controls, nav.hint_display |

## Details

### 1. Scaffold project and write camera maths unit tests first (TC-01 to TC-12)

## Goal
Create the repo skeleton (design Overview "Planned repository layout") and the test-first unit suite for `camera.math`, so the camera maths is implemented against failing tests.

## Scaffold (prerequisite for any test to run)
- `package.json` scripts: `build`, `typecheck`, `test:unit`, `test:component`, `test:e2e`, `dev`. Deps: react, react-dom. Dev: vite, @vitejs/plugin-react, typescript, vitest, jsdom, @testing-library/react, @testing-library/user-event, @playwright/test, wrangler.
- `vitest.config.ts` projects: `unit` (node, `tests/unit/**`), `component` (jsdom, `tests/component/**`).
- `playwright.config.ts`: `webServer` = `wrangler dev` serving `dist/client`; chromium, firefox, webkit; viewport 1280x800.
- `wrangler.jsonc`: `assets.directory = dist/client` (Worker `main` arrives in story 3).
- `src/shared/config.ts`: ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, WHEEL_ZOOM_SENSITIVITY, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT.
- `.gitignore`: node_modules, dist, .wrangler, playwright-report, test-results.

## camera.math tests (`tests/unit/camera.test.ts`)
Against the contract `screenToWorld, worldToScreen, panBy, zoomAt, zoomStep, resetCamera, canZoomIn, canZoomOut, zoomPercent` (create `camera.ts` with signatures that throw `not implemented` so tests compile and fail):
- TC-01/02 panBy at zoom 1 and at ZOOM_MAX far away (1e6): exact world shift.
- TC-03/04 zoomAt keeps the world point under the pointer invariant (origin and far away, 1e-6).
- TC-05/06 at ZOOM_MIN / ZOOM_MAX zooming further returns the *same object*.
- TC-07 viewport resize leaves camera unchanged.
- TC-08 resetCamera(1200x800) → zoom 1, origin centred.
- TC-09 step in then out returns exactly 1.0 (snap to ZOOM_STEP_FACTOR^n).
- TC-10 20 steps in clamps at ZOOM_MAX, canZoomIn false.
- TC-11 huge factor clamps and still keeps pointer invariance.
- TC-12 factor 0, negative, NaN, ±Infinity → unchanged camera, no NaN.
- Property check: 1,000 seeded random cameras/points/factors, pointer invariance within 1e-6.
All thresholds reference config constants, not literals.

## Done when
`npm run build` and `npm run typecheck` pass; `npm run test:unit` runs and every camera test fails only with "not implemented" (red phase), committed.

### 2. Implement camera maths to pass unit tests

## Goal
Implement `src/client/canvas/camera.ts` per the camera.math contract until task 1.1's tests pass.

## Approach
- Immutable `Camera {x, y, zoom}`; `x,y` = world coordinate at viewport top-left.
- `screenToWorld = p/zoom + xy`; `worldToScreen = (p - xy)*zoom`.
- `panBy`: `x - dx/zoom`, `y - dy/zoom`; zero delta returns the same object.
- `zoomAt`: reject non-finite or ≤0 factor (return input); `newZoom = clamp(zoom*factor, ZOOM_MIN, ZOOM_MAX)`; if equal return input; keep `w = screenToWorld(cam, p)` fixed: `x = w.x - p.x/newZoom`.
- `zoomStep`: zoomAt viewport centre by ZOOM_STEP_FACTOR or its inverse, snapping to nearest ZOOM_STEP_FACTOR^n within a named epsilon constant.
- `resetCamera`: `{x: -w/2, y: -h/2, zoom: 1}`; `canZoomIn/Out` compare to limits; `zoomPercent = Math.round(zoom*100)` (100 as a named PERCENT constant).
- No DOM, no React imports.

## Done when
All TC-01..TC-12 and the property check pass; typecheck passes; no literals besides named constants.

### 3. Implement board viewport: drag, wheel, pinch and keyboard navigation with dot grid

## Goal
Implement viewport.input: `useCamera` hook and `BoardViewport` component per contract.

## Approach
- `useCamera(viewport)` holds camera state, exposes `beginPan/panMove/endPan`, `wheel`, `zoomStep`, `reset`, `hasNavigated` latch (set only when camera.math returns a new object).
- `BoardViewport`:
  - Pointer drag starts only when `event.target` is the viewport/grid; `setPointerCapture`; state Idle→Panning→Idle on pointerup, pointercancel, lostpointercapture.
  - Wheel listener added with `{ passive: false }` in an effect; always `preventDefault` over the board; Ctrl/Meta → `zoomAt(point, exp(-deltaY*WHEEL_ZOOM_SENSITIVITY))`, else `panBy(-deltaX, -deltaY)`; convert `deltaMode` LINE/PAGE to pixels via named constants.
  - Safari `gesturestart/gesturechange`: `preventDefault`, zoom by scale ratio around pointer.
  - Window keydown Ctrl/Cmd + `=`, `-`, `0` → `preventDefault`, zoomStep in/out, reset.
  - Render: dot grid via CSS background (`background-size = GRID_SPACING_WORLD*zoom`, position from camera modulo spacing); world layer `transform: scale(zoom) translate(-x px, -y px)`, `transform-origin: 0 0`; origin crosshair marker at world (0,0).
  - Camera updates coalesced with requestAnimationFrame; viewport size from ResizeObserver; camera x,y unchanged on resize.
- `testHooks.ts`: `window.__vidi6.setCamera()` only when `import.meta.env.MODE === 'test'`, excluded from production build.
- `App.tsx` mounts BoardViewport full-window.

## Done when
Manual check in Chrome and Safari: drag, scroll, pinch, Ctrl/Cmd keys work and page zoom never changes; component and e2e test tasks (1.6, 1.7) pass.

### 4. Implement zoom controls (−, percentage, +, Reset view)

## Goal
Implement the stateless `ZoomControls` component per the zoom.controls contract and wire it to `useCamera`.

## Approach
- Props: `zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset`.
- Fixed bottom-right: `button[aria-label="Zoom out"]` disabled when `!canZoomOut`; `output[aria-live="polite"]` showing `${zoomPercent}%`; `button[aria-label="Zoom in"]` disabled when `!canZoomIn`; `button` "Reset view".
- Buttons call callbacks only when enabled (native disabled attribute).
- Stop wheel propagation on the control container so Ctrl-wheel over it never zooms the board (TC-30).
- `App.tsx`: pass `zoomPercent(camera)`, `canZoomIn/Out(camera)`, `zoomStep('in'|'out')`, `reset`.
- Keyboard focusable, visible focus ring.

## Done when
At 10% the − button is disabled; at 400% + is disabled; Reset returns to 100% centred; component tests (task 1.6) pass.

### 5. Implement first-use navigation hint

## Goal
Implement `NavigationHint` per the nav.hint_display contract.

## Approach
- `NavigationHint({ visible })` renders bottom-centre text "Drag to move around · Ctrl/Cmd + scroll or pinch to zoom" or `null`.
- `App.tsx` passes `visible = !hasNavigated` from `useCamera`.
- `hasNavigated` is a ref-backed latch that flips only on a camera change producing a new object, so a click without movement or a no-op zoom at a limit does not dismiss it (TC-29).
- Not persisted: reload shows it again.

## Done when
Hint visible on load, gone after first pan/zoom, stays gone for the visit; covered by tasks 1.6 and 1.7.

### 6. Component tests for viewport input, zoom controls and hint

## Goal
Vitest + Testing Library (jsdom) tests covering the ui-component cases in the story 1 test strategy.

## viewport.input (`BoardViewport.test.tsx`)
- TC-13 pointerdown/move(200,100)/up: world layer transform matches camera; Idle→Panning→Idle.
- TC-14 pointercancel mid-drag: camera frozen at cancel; later moves ignored.
- TC-15 plain wheel deltaY +100: camera y += 100/zoom; `defaultPrevented` true.
- TC-16 Ctrl wheel deltaY −100 at (300,200): zoom increases; `defaultPrevented` true.
- TC-17 synthetic `gesturechange` scale 2: zoom doubles (clamped); `defaultPrevented`.
- TC-18 Ctrl+=, Ctrl+-, Ctrl+0: 1.0→1.25→1.0→reset, each `defaultPrevented`.
- TC-29 click without move: camera unchanged, hint not dismissed (negative).
- TC-30 Ctrl wheel over zoom control: board camera unchanged (negative).

## zoom.controls (`ZoomControls.test.tsx`)
- TC-19 at ZOOM_MIN: Zoom out disabled, label "10%".
- TC-20 at ZOOM_MAX: Zoom in disabled, label "400%".
- TC-21 zoom 1.5625: label "156%".
- TC-32 clicking a disabled button does not call its callback (negative).

## nav.hint_display (`NavigationHint.test.tsx`)
- TC-22 visible → hidden after first camera change → stays hidden after second.

Use config constants for expected values; rAF via fake timers.

## Done when
All listed cases pass in `npm run test:component`.

### 7. E2E navigation tests in Chromium, Firefox and WebKit

## Goal
Playwright tests against `wrangler dev` covering story 1's e2e cases and workflows.

## Cases
- Workflow 1 "First visit navigation": TC-28 hint visible then removed after drag → TC-23 real mouse drag (200,100) moves origin marker and a grid dot by exactly (200,100) ±1px → TC-24 Ctrl+wheel over a dot keeps it under the pointer ±1px and `visualViewport.scale` stays 1.
- Workflow 2 "Limits and recovery": TC-25 click + until disabled, label ends "400%", + has `disabled`; TC-26 jump far via `window.__vidi6.setCamera` (test build), zoom 4, click Reset view → label "100%", origin marker at viewport centre ±1px.
- Workflow 3 "Far travel": TC-27 at UNBOUNDED_PAN_TESTED_EXTENT, drag (200,100): exact movement; computed grid spacing = GRID_SPACING_WORLD*zoom px.
- TC-31 negative: after Ctrl+wheel and Ctrl+=/−/0, `visualViewport.scale` and `devicePixelRatio` unchanged.

## Helpers
`tests/e2e/helpers/board.ts`: locate origin marker, read zoom label, set camera via test hook.

## Done when
All cases pass in all three browser projects; Safari pinch recorded as manual check per strategy "Not covered".

