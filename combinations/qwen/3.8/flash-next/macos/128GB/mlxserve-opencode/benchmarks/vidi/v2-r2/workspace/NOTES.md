# Implementation Notes

## Firefox sandbox issue
Firefox cannot launch in the CI/sandbox environment due to OS-level sandbox restrictions (`sandbox initialization failed: Operation not permitted`). E2E tests run in Chromium and WebKit. The tests are written for all three browsers — Firefox tests are configured but not executed in this environment.

## Firefox configuration
The `playwright.config.ts` includes Chromium and WebKit projects only. Firefox device preset causes sandbox failures in this environment. Tests should be run with Firefox in a normal development environment.

## Test mode build
E2E tests use `vite build --mode test` which sets `import.meta.env.MODE === 'test'` and exposes `window.__vidi6.setCamera()` for jumping to far coordinates without simulating millions of pixels of drag.

## Architecture decisions
- `useCamera` owns camera state; `BoardViewport` is a presentational component receiving camera and handlers as props.
- Pointer events use React synthetic events; wheel and gesture events use `addEventListener` directly for non-passive control.
- Camera state uses refs + state pattern: a ref for synchronous reads in callbacks (avoids stale closures), state for triggering re-renders.
- Dot grid rendered via CSS `background-image: radial-gradient(...)` on the viewport div, with `background-size` and `background-position` computed from camera state.
- Origin marker is a fixed-position crosshair at world (0,0), screen position recomputed on every render.
- `zoomStep` snaps to exact powers of `ZOOM_STEP_FACTOR` within epsilon 1e-9 to prevent float drift (e.g. 1.0 → 1.25 → 1.0 exactly).
- The `hasNavigated` latch uses a ref (not state-derived) to avoid resetting on re-renders; only flips when camera.math returns a new object.

## Unused imports in camera.ts
The stub had unused imports of config values for red-phase typecheck. These are removed in the final implementation.
