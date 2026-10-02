# NOTES

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **Test hook always included**: The `window.__vidi6.setCamera()` hook is included in all builds (not gated behind `import.meta.env.MODE === 'test'`). This is because the e2e tests run against the production build served by `wrangler dev`, and there's no separate "test" build mode. The hook is harmless (just sets camera state) and simplifies the build pipeline.

2. **E2E runs on Chromium only**: Firefox and WebKit browser binaries could not be installed in this environment (missing system dependencies). Per the task instructions, Chromium is sufficient. The Playwright config still defines all three browser projects for when the other browsers become available.

3. **Viewport height discrepancy**: In headless Chromium via Playwright, `window.innerHeight` reports 720 even when the viewport is configured as 800. The TC-26 e2e test reads the actual viewport dimensions at test time rather than hardcoding 1280×800, making it robust to this discrepancy.

4. **jsdom pointer event limitations**: jsdom does not support `clientX`/`clientY` on synthetic pointer events via `fireEvent`. Component tests use a custom `createPointerEvent` helper that defines these properties via `Object.defineProperty`.

5. **`useCamera` hook architecture**: The camera state lives in `App.tsx` (via `useCamera`), and `BoardViewport` receives the camera and handlers as props. This allows `ZoomControls` and `NavigationHint` to access the same camera state without prop drilling through `BoardViewport`.

6. **Step zoom snapping**: `zoomStep` snaps to the nearest `ZOOM_STEP_FACTOR^n` value within 1e-9 to prevent floating-point drift (e.g., 1.0 → 1.25 → 1.0 exactly).
