# Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **jsdom PointerEvent polyfill**: jsdom does not implement `PointerEvent`, so we added a polyfill that extends `MouseEvent` in the test setup (`tests/component/setup.ts`).

2. **Native event handlers in tests**: Wheel and gesture events use `addEventListener` with `{ passive: false }` to call `preventDefault()`. In component tests, these are dispatched via `el.dispatchEvent()` wrapped in `act()` to ensure React state updates flush synchronously.

3. **Architecture**: The `useCamera` hook is lifted to the `Board` component in `App.tsx`, and `BoardViewport` receives `camera` and handler callbacks as props (slight deviation from the design's `BoardViewport({ children })` contract to enable testing). The `useCamera` hook manages camera state, `hasNavigated` latch, and all interaction handlers.

4. **Zoom step snapping**: `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` when within `1e-9`, preventing float drift over many zoom in/out cycles.

5. **Playwright browsers**: Only Chromium is configured for e2e tests (design allows "Chromium is sufficient if other browsers are not installed"). Firefox and WebKit are not installed in the environment.

6. **E2e test build**: The `test:e2e` script runs `npm run build:test` (vite --mode test) before playwright, which exposes `window.__vidi6.setCamera` for tests that need to jump to distant positions.

7. **Origin marker**: Rendered as an SVG crosshair at world (0,0) inside the world layer, present in all builds. Gives e2e tests a stable pixel reference.

8. **Wrangler config**: Assets-only configuration (no `binding` field) to support `wrangler dev` for static file serving without a Worker script (Worker code arrives in story 3).
