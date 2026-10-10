# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Architecture
- Camera state lives in a `useCamera` hook (`src/client/canvas/useCamera.ts`) owned by
  `App.tsx` and shared through `BoardCameraContext`, so `ZoomControls` and the
  navigation hint can drive/observe the same camera as `BoardViewport`.
- All camera mutations funnel through pure functions in `src/client/canvas/camera.ts`
  (zoom-at-point, pan, clamp, reset) which are unit-tested without a DOM.
- Camera commits are coalesced with `requestAnimationFrame`, so one drag gesture
  produces at most one React render per frame.
- Named settings (`ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`, `WHEEL_ZOOM_SENSITIVITY`,
  `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`) live in `src/shared/config.ts`
  and are imported by both app code and tests.
- The dot grid is CSS `radial-gradient` background on the viewport with
  `background-position: mod(-camera.x * zoom, spacing)`; this keeps grid spacing exact
  and jitter-free at world coordinates up to ±1,000,000 (TC-27).
- Pointer Events are used for panning with `setPointerCapture` (guarded, since jsdom
  lacks it). Ctrl/Cmd + wheel zooms around the cursor with `preventDefault` so the
  browser page never zooms (TC-31 asserts `visualViewport.scale` / dpr stay constant).
  Keyboard: +/-/0 zoom at viewport centre; arrows/space pan.
- A `data-testid="origin-marker"` world-space element gives tests a measurable point
  (present in all builds; only the `window.__vidi6` camera-set hook is gated behind
  `import.meta.env.MODE === 'test'` via `src/client/canvas/testHooks.ts`).

## Testing deviations / environment
- jsdom has no `PointerEvent`, so `tests/component/setup.ts` shims it as a `MouseEvent`
  subclass (clientX/clientY/button/pointerId survive like in real browsers). Handlers
  and assertions are otherwise unmodified.
- E2E servers: Playwright's `webServer` runs `wrangler dev` (Cloudflare Pages static
  assets from `dist/client`) on port 22704 (inspector 22705) per the allowed-port
  rules; `npm run test:e2e` builds with `vite build --mode test` first.
- Browser matrix: the config defines chromium, firefox and webkit projects, but probes
  each binary (`executablePath` + `--version`) at config load and skips unusable ones
  with a warning. On this machine only the cached Chromium build works: Firefox/WebKit
  downloads fail host-dependency validation and there is no sudo to run
  `npx playwright install-deps`. All 8 e2e tests pass in Chromium (rules: Chromium
  success suffices); Firefox/WebKit run automatically wherever their binaries exist.
- TC-25 loop tolerates the "+" button disabling between the `isDisabled()` check and
  the `click()` (Playwright actionability would otherwise hang).
