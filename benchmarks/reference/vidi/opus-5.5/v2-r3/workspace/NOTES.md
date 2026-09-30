# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec was silent or ambiguous:

- **Camera wiring.** The design gives `BoardViewport` only a `children` prop, yet `App.tsx`
  must also feed `ZoomControls` and `NavigationHint` from `useCamera`. `App` owns
  `useCamera` and passes it to `BoardViewport` through `CameraContext`
  (`src/client/canvas/useCamera.ts`), along with a callback for the ResizeObserver size.
- **Extra `useCamera` members.** Besides the contract, the hook exposes `zoomAt(point, factor)`
  (used for Safari `gesturechange` scale ratios) and `setCamera(cam)` (used only by the
  test hook).
- **Initial view** is the same as Reset view: 100%, with the board origin centred. Pressing
  Reset view when already there is a no-op and does not dismiss the hint.
- **Grid level of detail.** At low zoom a 24-unit grid would be 2.4 px apart and read as a grey
  haze. The spacing doubles (48, 96, …) until dots are at least `GRID_MIN_SCREEN_SPACING_PX`
  (8 px) apart. Dots are always a subset of the base grid, so they stay attached to the board.
  At zoom ≥ 1/3 the spacing is exactly `GRID_SPACING_WORLD * zoom`.
- **Additional named settings** in `src/shared/config.ts`: `ZOOM_STEP_SNAP_EPSILON`, `PERCENT`,
  `WHEEL_LINE_HEIGHT_PX`, `GRID_MIN_SCREEN_SPACING_PX`.
- **Keyboard shortcuts** listen on `window`, which in this story means "while the board is
  focused" because the whole page is the board. They are ignored when focus is in an editable
  element (for later stories' text inputs). `+`/`_` and numpad keys are accepted as
  aliases for `=`/`-`.
- **Test hook.** `window.__vidi6` (`setCamera`, `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'`. `npm run build:test` builds that mode for e2e; the
  production `npm run build` does not contain it (checked via grep).
- **Camera readout for tests.** The viewport element carries `data-camera-x/y/zoom` and
  `data-state="idle|panning"` attributes so component and e2e tests can assert state.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit projects but
  only enables the ones installed locally. In this environment only Chromium is installed, so
  e2e ran in Chromium only.
- **Commits.** The whole story went into a single commit (per the session instructions)
  instead of a separate red-phase commit for task 1.
- **Not covered by automated tests:** Safari pinch in a real browser, trackpad hardware
  differences, and touch input. These match the design's "Not covered" list. The manual
  Chrome/Safari check in task 3 was replaced by automated Chromium e2e plus a visual screenshot check.
