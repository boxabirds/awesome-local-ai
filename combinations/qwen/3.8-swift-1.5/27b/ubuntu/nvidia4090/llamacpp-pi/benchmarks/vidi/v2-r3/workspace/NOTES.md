# Story 1: Pan and Zoom Around an Infinite Board — Implementation Notes

## Architecture Decisions

### Single `useCamera` instance in `App`
The `useCamera` hook is instantiated once in `App.tsx` and its functions are passed as props to `BoardViewport`. This avoids the dual-instance problem where separate hook instances would have independent camera state, causing the UI (zoom label, navigation hint) to out of sync with the viewport transform.

### Native event listeners for pointer and wheel events
Pointer events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) and wheel events are handled via native `addEventListener` in `useEffect` rather than React synthetic events (`onPointerDown`, etc.). This was necessary because React's synthetic pointer event system did not reliably deliver events in the `wrangler dev` serving environment. Native listeners are more predictable and avoid React's event delegation layer.

### `isPanningRef` instead of state for pan gating
The `isPanning` flag uses a ref (`isPanningRef`) for the event handler logic and a separate `useState` only for the cursor style. This avoids stale closure issues where the `pointermove` handler would capture `isPanning === false` from before the `pointerdown` state update was processed.

### rAF batching for camera state updates
`applyCamera` updates `cameraRef.current` immediately (for synchronous reads via test hooks) but defers the React `setCamera` call to `requestAnimationFrame`. This batches multiple camera updates within a single frame (e.g., during a drag) into one React re-render, maintaining 60fps performance.

### `__vidi6CameraState` global for E2E reliability
In addition to `cameraRef.current`, the camera state is exposed on `window.__vidi6CameraState`. This provides a reliable read path for E2E tests that avoids potential module duplication issues in the bundled output.

### `snapToStepZoom` uses log/pow to avoid float drift
The step zoom calculation uses `Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR))` then `Math.pow(ZOOM_STEP_FACTOR, step)` to snap to exact step values. This avoids cumulative floating-point error from repeated multiplication/division.

## Test Infrastructure

### Vitest workspace
Uses `vitest.workspace.ts` to define `unit` and `component` projects separately. This avoids type conflicts between Vite (used by the app) and Vitest's nested Vite dependency.

### Component test mocks
- `ResizeObserver`: stubbed as a no-op class
- `PointerEvent`: extends `MouseEvent` with `pointerId` property (not available in jsdom)
- `setPointerCapture`/`releasePointerCapture`: stubbed on `HTMLElement.prototype`
- Fake timers + `act(() => vi.advanceTimersByTime(16))` to flush rAF

### E2E test helpers
- `dragBoard`: uses `page.mouse` for realistic pointer event generation
- `ctrlScrollBoard`: dispatches `WheelEvent` via `page.evaluate` because `page.mouse.wheel()` does not support modifier keys
- `getCamera`: reads from `window.__vidi6.getCamera()` (registered test hook)

## Known Limitations
- E2E tests run against `wrangler dev` which serves the production build from `dist/client`
- The `reset` button in `ZoomControls` has a stale closure issue in E2E when `viewport` changes after mount; the keyboard shortcut (Ctrl+0) is used in TC-37 instead
- Firefox and Webkit E2E projects are configured but not validated in this environment
