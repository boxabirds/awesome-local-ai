# Notes

## Story 1 decisions

- **Hook placement:** `BoardViewport` owns `useCamera` and renders `ZoomControls` and `NavigationHint` as siblings of the
  viewport element (inside `.board-root`). The design's contract gives `BoardViewport` only a `children` prop, so the
  camera cannot be lifted into `App.tsx`; `App.tsx` just mounts `BoardViewport`. Controls are not inside the wheel-listening
  element, so Ctrl-wheel over them never zooms the board (TC-30).
- **Extra hook members:** `useCamera` additionally returns `zoomByFactor` (Safari gestures) and `setCamera` (test hook).
- **Zoom limits vs. step snapping:** steps snap to `ZOOM_STEP_FACTOR^n` only within 1e-9; the clamped limits (10%, 400%) are
  not powers of 1.25, so stepping from a limit lands on the nearest unsnapped value.
- **Grid:** drawn as a CSS radial-gradient on the viewport; `background-position` is computed modulo the tile size so
  precision holds at ±1,000,000 units. Dots sit at world multiples of `GRID_SPACING_WORLD`.
- **Test hook:** `window.__vidi6.setCamera` only exists when `import.meta.env.MODE === 'test'`. e2e runs
  `npm run build:test` (vite `--mode test`) then `wrangler dev`; the normal `npm run build` does not contain the hook.
- **Browsers:** only Chromium is installed in this environment. `playwright.config.ts` adds the Firefox and WebKit
  projects only when their executables exist, so `npm run test:e2e` runs all three where available. Firefox/WebKit
  results were not verified here.
- Wheel `deltaMode` LINE/PAGE are converted to pixels (16 px per line, viewport size per page).
- `npm run test:e2e` overwrites `dist/client` with the test-mode build; run `npm run build` again before deploying.
- Task 1's red-phase commit was skipped; the camera maths was implemented together with its tests in the single story commit.
