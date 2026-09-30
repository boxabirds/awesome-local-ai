# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec was open or self-contradictory:

- **Wiring BoardViewport to the camera.** The design gives `BoardViewport(props: { children })` but also has
  `App.tsx` wire `useCamera` to `ZoomControls`, and the viewport measures its own size. To keep that
  exact props contract, `App` calls `useCamera` and provides it (plus `setViewportSize`) through
  `BoardCameraContext` (`src/client/canvas/useCamera.ts`); `BoardViewport` reads it with `useBoardCamera()`.
- **Extra hook method.** `useCamera` also exposes `zoomAtPoint(p, factor)` for Safari `gesturechange`
  (scale ratio), which the listed hook methods had no way to express.
- **Initial view.** The camera starts as `resetCamera(window size)`: 100% with the board's starting
  point (marked by a small crosshair) at the centre, i.e. the same view Reset view returns to.
- **Named constants.** Added `WHEEL_LINE_HEIGHT_PX` (line-mode wheel deltas) to `src/shared/config.ts`;
  `PERCENT` and `ZOOM_STEP_SNAP_EPSILON` live in `camera.ts`. Page-mode wheel deltas use the board height.
- **Keyboard shortcuts** (Ctrl/Cmd + `=`/`+`, `-`, `0`, incl. numpad) are handled on `window` for the whole
  page (the page is the board), except while typing in an editable field.
- **Drag buttons.** Primary and middle mouse buttons both pan.
- **Test hook.** `window.__vidi6` (`setCamera`, `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'` (Vitest, and `npm run build:test` used by Playwright); production
  builds contain no trace of it. `setCamera` does not dismiss the navigation hint.
- **Red phase.** Task 1's failing-test phase was run locally against a throwing stub (22/22 failed with
  "not implemented"), but not committed separately: the session's instructions ask for a single story commit.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit projects, but skips
  Firefox/WebKit when their browser binaries are not installed. Only Chromium is installed on this
  machine, so e2e was verified in Chromium only.
- `npm run test:e2e` builds in test mode and serves `dist/client` with `wrangler dev` on port 8787.
