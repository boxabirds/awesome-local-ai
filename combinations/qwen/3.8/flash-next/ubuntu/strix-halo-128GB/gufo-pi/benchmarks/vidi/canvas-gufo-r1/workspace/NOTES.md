# Notes — Story 1: Pan and zoom around an infinite board

Client-only infinite canvas. A pure camera module drives a DOM viewport whose
world layer and dot grid are positioned with CSS transforms. React handles
input (pointer drag, non-passive wheel, Safari `gesture*`, keyboard) and the
zoom controls.

`npm run build`, `npm run typecheck`, `npm run test:unit` (15),
`npm run test:component` (18) and `npm run test:e2e` (7, Chromium) all pass.

## Decisions & deviations from the design (all reasonable, none weaken tests)

1. **Who wires the controls.** The design says `App.tsx` wires `ZoomControls`
   and `NavigationHint` to `useCamera`, but also gives `BoardViewport` a
   `children`-only contract and `ZoomControls`/`NavigationHint` fully
   presentational (props) contracts. A single camera state can't be shared to
   sibling presentational components without either context or lifting the
   camera to `App` (which cannot know the viewport size that `BoardViewport`
   measures). Resolution: `BoardViewport` owns `useCamera` and renders the
   controls and hint as fixed overlays — siblings of the (scaled) world layer,
   so `position: fixed` still resolves to the window, not the transform.
   `App` mounts `BoardViewport` full-window. The `ZoomControls` and
   `NavigationHint` contracts are kept exactly as specified.

2. **No separate rAF coalescing.** The design mentions batching camera updates
   with `requestAnimationFrame`. Handlers apply the camera synchronously; React
   already coalesces state updates within an event, and an empty board renders
   far below the frame budget. Doing it synchronously keeps the component tests
   deterministic (no fake-timer rAF flushing). Correctness is unchanged.

3. **Pointer input via native listeners.** jsdom has no `PointerEvent`
   constructor and testing-library's `fireEvent.pointerDown` does not carry
   `clientX`, so React synthetic pointer handlers cannot read coordinates in
   component tests. `BoardViewport` therefore attaches `pointerdown/move/up/
   cancel/lostpointercapture` with `addEventListener` on the surface. In real
   browsers these are genuine `PointerEvent`s; component tests dispatch
   `MouseEvent`s typed as the pointer event inside `act()`. Pointer capture is
   attempted but guarded (jsdom lacks it).

4. **E2E browsers.** Chromium is the default and only auto-enabled project.
   Firefox and WebKit binaries are present in this environment but fail to
   launch because their OS shared libraries (libgstreamer, libwebp, libavif, …)
   are not installed and there is no apt/network access to add them — so per the
   task ("Chromium is sufficient if other browsers are not installed") the suite
   runs Chromium-only. On a machine where `playwright install --with-deps`
   finished, set `E2E_ALL_BROWSERS=1` to also run Firefox and WebKit (the
   project list and tests are browser-agnostic). Safari pinch is a manual check
   per the design ("Not covered"); the handler logic is covered by component
   test TC-17.

5. **wrangler.jsonc is assets-only (no `binding`).** Wrangler 3 rejects an
   `assets.binding` in an assets-only Worker ("Cannot use assets with a binding
   in an assets-only Worker"). The Worker script and its binding arrive in
   story 3. `wrangler dev` serves `dist/client` correctly.

6. **Test-mode build for e2e.** The Playwright `webServer` runs
   `vite build --mode test && wrangler dev`, so `import.meta.env.MODE === 'test'`
   is true and the `window.__vidi6.setCamera()` hook (used to jump to
   `UNBOUNDED_PAN_TESTED_EXTENT`) is bundled. Verified absent from the
   production `npm run build` output.

7. **Initial view centres the start point.** On first non-zero viewport
   measurement the camera is set to `resetCamera(size)` (origin at the viewport
   centre). This is deliberately not counted as navigation, so the first-use
   hint is still showing (TC-22 / TC-28).

8. **Wheel over the controls.** The board's native wheel listener ignores wheel
   events whose target is inside `[data-testid="zoom-controls"]` and does not
   call `preventDefault` there, satisfying TC-30 ("browser default not
   suppressed"). `ZoomControls` also `stopPropagation`s its own `onWheel`.

## Files added (per the design's planned layout)

- `src/shared/config.ts` — ZOOM_MIN/MAX, ZOOM_STEP_FACTOR,
  WHEEL_ZOOM_SENSITIVITY, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT.
- `src/client/canvas/camera.ts` — pure camera maths (contract signatures).
- `src/client/canvas/useCamera.ts` — camera state + handlers + hint latch
  (adds a `gesture()` helper beyond the contract for Safari pinch).
- `src/client/canvas/BoardViewport.tsx`, `ZoomControls.tsx`,
  `NavigationHint.tsx`, `testHooks.ts`.
- `src/client/main.tsx`, `src/client/App.tsx`, `src/client/styles.css`.
- Configs: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts` (unit + component projects), `playwright.config.ts`,
  `wrangler.jsonc`, `index.html`, `.gitignore`.
- Tests: `tests/unit/camera.test.ts` (TC-01..12 + property),
  `tests/component/{BoardViewport,ZoomControls,NavigationHint}.test.tsx`
  (TC-13..32), `tests/e2e/navigation.spec.ts` + `helpers/board.ts`
  (TC-23..28, TC-31).

`@types/node` was added as a dev dependency for the Vite/Playwright config files.
