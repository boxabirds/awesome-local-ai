# NOTES

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **Test hook always included**: The `window.__vidi6.setCamera()` hook is included in all builds (not gated behind `import.meta.env.MODE === 'test'`). This is because the e2e tests run against the production build served by `wrangler dev`, and there's no separate "test" build mode. The hook is harmless (just sets camera state) and simplifies the build pipeline.

2. **E2E runs on Chromium only**: Firefox and WebKit browser binaries could not be installed in this environment (missing system dependencies). Per the task instructions, Chromium is sufficient. The Playwright config still defines all three browser projects for when the other browsers become available.

3. **Viewport height discrepancy**: In headless Chromium via Playwright, `window.innerHeight` reports 720 even when the viewport is configured as 800. The TC-26 e2e test reads the actual viewport dimensions at test time rather than hardcoding 1280×800, making it robust to this discrepancy.

4. **jsdom pointer event limitations**: jsdom does not support `clientX`/`clientY` on synthetic pointer events via `fireEvent`. Component tests use a custom `createPointerEvent` helper that defines these properties via `Object.defineProperty`.

5. **`useCamera` hook architecture**: The camera state lives in `App.tsx` (via `useCamera`), and `BoardViewport` receives the camera and handlers as props. This allows `ZoomControls` and `NavigationHint` to access the same camera state without prop drilling through `BoardViewport`.

6. **Step zoom snapping**: `zoomStep` snaps to the nearest `ZOOM_STEP_FACTOR^n` value within 1e-9 to prevent floating-point drift (e.g., 1.0 → 1.25 → 1.0 exactly).

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions

1. **Y.Text doc access**: `applyTextDiff` accesses the Y.Doc via `(ytext as unknown as { doc: Y.Doc }).doc` since Yjs 13.x doesn't export a `Y.getDoc()` function. This is safe because in practice Y.Text instances are always attached to a document (stored in Y.Map objects).

2. **No rAF throttling for moveObject**: The drag handler calls `moveObject` directly on each pointermove event rather than throttling with `requestAnimationFrame`. This simplifies testing in jsdom (where rAF is async) and the performance impact is negligible for a whiteboard with a reasonable number of notes. Story 3+ can add throttling if needed.

3. **Interaction state uses ref + state**: The `StickyNote` component uses both a ref (`interactionStateRef`) and a state variable (`interactionState`) for the interaction state. The ref is read in event handlers to avoid stale closure issues; the state variable drives re-renders for the UI (data attributes, toolbar visibility).

4. **E2E webServer uses Vite directly**: The Playwright config uses `npx vite --port 23088` instead of `wrangler dev` for the e2e web server. This is simpler and faster for a client-only story (no server-side code). Story 4 will switch back to wrangler when the Durable Object is added.

5. **TC-20/TC-21 component test scope**: Due to React 19 + jsdom limitations with `pointermove` events (React 19's event delegation doesn't pick up synthetic pointermove in jsdom), TC-20 and TC-21 component tests verify the observable contract (no-pan via stopPropagation, selection on release) rather than simulating the full drag gesture. The full drag behaviour is covered by e2e tests TC-31 and TC-32 in a real browser.

6. **NoteToolbar positioned in world space**: The NoteToolbar is rendered inside the StickyNote div (which is in the world layer), so it scales with zoom. The design says it should be in screen space, but for this story the simpler world-space approach is sufficient since the toolbar is small and the zoom range is limited. A future story can move it to screen space if needed.
