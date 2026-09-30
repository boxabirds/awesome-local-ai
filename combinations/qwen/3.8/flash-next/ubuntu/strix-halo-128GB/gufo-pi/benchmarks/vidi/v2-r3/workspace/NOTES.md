# Implementation Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **Wrangler config**: Used assets-only mode (no `main` Worker script, no binding) since the design specifies Worker code arrives in story 3. The `wrangler dev` command serves static assets from `dist/client`.

2. **Vitest workspace**: Used `vitest.workspace.ts` with `extends` to configure unit (node) and component (jsdom) projects, since Vitest 2.x requires this file-based workspace config (not `test.projects`).

3. **PointerEvent polyfill**: jsdom (v25) does not implement `PointerEvent`, so a polyfill extending `MouseEvent` was added to the component test setup. This is necessary because the BoardViewport uses pointer events for drag-to-pan.

4. **rAF batching**: The `useCamera` hook coalesces camera updates via `requestAnimationFrame` (at most one re-render per frame). Tests use `vi.useFakeTimers()` + `vi.advanceTimersByTime(16)` wrapped in `act()` to flush.

5. **Test hooks**: `window.__vidi6.setCamera()` is registered only when `import.meta.env.MODE === 'test'`, which is the default with `vite build --mode test`. The production build excludes this code path.

6. **Step zoom snapping**: `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` within 1e-9 epsilon to prevent floating-point drift (e.g., 1.0 * 1.25 * 0.8 = 0.9999... instead of exactly 1.0).

7. **Wheel handler**: Attached via `addEventListener('wheel', handler, { passive: false })` in a `useEffect`, not via React's `onWheel` (which React attaches passively). This ensures `preventDefault()` works to suppress browser page scroll/zoom.

8. **E2E test build**: E2E tests build with `--mode test` to enable test hooks. The `npm run test:e2e` script uses `npm run build:test && vite preview` as the web server command.

9. **Grid rendering**: Dot grid is rendered via CSS `radial-gradient` with computed `background-size` and `background-position` derived from camera position and zoom modulo grid spacing. No canvas.

10. **World layer transform**: Uses `transform: scale(zoom) translate(-x, -y)` with `transform-origin: 0 0`. Origin marker is a crosshair at world (0,0) rendered in all builds for e2e assertions.
