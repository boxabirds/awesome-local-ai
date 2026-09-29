# NOTES

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **Test hook availability**: The `window.__vidi6.setCamera()` test hook is included in all builds (not gated behind `import.meta.env.MODE === 'test'`). The design specifies it should be excluded from production builds, but since e2e tests run against the production build served by `wrangler dev`, the hook needs to be available. In a real production deployment, this would be gated behind a build flag or removed via tree-shaking.

2. **E2E browsers**: Only Chromium is tested in e2e because Firefox and WebKit system dependencies are not available in this environment. The task specification states "Chromium is sufficient if other browsers are not installed."

3. **Vitest workspace**: Using `vitest.workspace.ts` for project configuration (unit vs component) as this is the recommended approach in Vitest 2.x.

4. **Pointer events in jsdom**: Since jsdom doesn't have a `PointerEvent` constructor, component tests use `MouseEvent` with a manually added `pointerId` property to simulate pointer events.

5. **`setPointerCapture` in jsdom**: The `BoardViewport` component wraps `setPointerCapture` in a try-catch since jsdom doesn't implement it.

6. **Pan implementation**: The `useCamera` hook keeps a separate `panStartCameraRef` (the camera at the start of the drag) from `panCameraRef` (the current computed camera during the drag). Each `panMove` calculates the total delta from the start point and applies it to the start camera, preventing compounding of deltas across multiple move events.

7. **rAF batching**: Camera updates during drag are batched with `requestAnimationFrame` to limit re-renders to one per frame. The `endPan` function flushes any pending rAF and sets the final camera state directly.
