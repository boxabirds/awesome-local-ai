# NOTES

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions made

1. **Y.Text binding in unit tests**: Yjs `Y.Text` must be bound to a `Y.Doc` (via `doc.getText()`) for `observe` callbacks to fire. Standalone `new Y.Text()` does not trigger observers. Unit tests use `doc.getText('text')` to create properly bound text instances.

2. **Yjs delta format**: The `observe` callback for `Y.Text` reports deltas as `[{retain: N}, {insert: '...'}]` or `[{retain: N}, {delete: N}]` — the retain prefix is always included. Tests assert the full delta structure including retain entries.

3. **`applyTextDiff` with unbound Y.Text**: The `applyTextDiff` function handles both bound (with doc) and unbound Y.Text instances. When bound, it uses `doc.transact()` for atomicity. When unbound (edge case in tests), it applies operations directly.

4. **Font fitting during editing**: A hidden measurement `div` is always rendered inside each `StickyNote` (regardless of editing state) to enable `fitFontSize` to work during text editing. The measurement div has the same width, font-family, and text as the visible content area.

5. **`useSyncExternalStore` referential equality**: The `useBoardDoc` hook caches the snapshot in a ref and only updates it when the Yjs `observeDeep` callback fires. This prevents infinite re-render loops that would occur if `getSnapshot` returned a new array on every call.

6. **E2E note spacing at high zoom**: At 200% zoom, notes are 400×400 screen pixels. E2E tests that create multiple notes must space them at least 400px apart to avoid double-clicking an existing note instead of empty space.

7. **E2E browsers**: Only Chromium is tested in e2e because Firefox and WebKit system dependencies are not available in this environment. The task specification states "Chromium is sufficient if other browsers are not installed."

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **Test hook availability**: The `window.__vidi6.setCamera()` test hook is included in all builds (not gated behind `import.meta.env.MODE === 'test'`). The design specifies it should be excluded from production builds, but since e2e tests run against the production build served by `wrangler dev`, the hook needs to be available. In a real production deployment, this would be gated behind a build flag or removed via tree-shaking.

2. **E2E browsers**: Only Chromium is tested in e2e because Firefox and WebKit system dependencies are not available in this environment. The task specification states "Chromium is sufficient if other browsers are not installed."

3. **Vitest workspace**: Using `vitest.workspace.ts` for project configuration (unit vs component) as this is the recommended approach in Vitest 2.x.

4. **Pointer events in jsdom**: Since jsdom doesn't have a `PointerEvent` constructor, component tests use `MouseEvent` with a manually added `pointerId` property to simulate pointer events.

5. **`setPointerCapture` in jsdom**: The `BoardViewport` component wraps `setPointerCapture` in a try-catch since jsdom doesn't implement it.

6. **Pan implementation**: The `useCamera` hook keeps a separate `panStartCameraRef` (the camera at the start of the drag) from `panCameraRef` (the current computed camera during the drag). Each `panMove` calculates the total delta from the start point and applies it to the start camera, preventing compounding of deltas across multiple move events.

7. **rAF batching**: Camera updates during drag are batched with `requestAnimationFrame` to limit re-renders to one per frame. The `endPan` function flushes any pending rAF and sets the final camera state directly.
