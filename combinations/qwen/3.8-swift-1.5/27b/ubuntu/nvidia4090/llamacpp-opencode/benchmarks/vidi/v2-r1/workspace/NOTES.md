# Implementation Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **Test hook for e2e**: The `window.__vidi6.setCamera()` hook is enabled when `import.meta.env.MODE === 'test'`. The e2e build uses `vite build --mode test` (configured in `playwright.config.ts` webServer command) so the hook is available during e2e tests but excluded from production builds.

2. **jsdom PointerEvent limitation**: jsdom does not support `PointerEvent`. Component tests dispatch `MouseEvent` instances with `pointerId` property added via `Object.defineProperty` to simulate pointer events. This is sufficient to test the handler logic since React's synthetic event system normalizes the event type.

3. **Keyboard shortcuts in useCamera**: The keyboard listener (Ctrl/Cmd + =, -, 0) is attached in the `useCamera` hook via a `useEffect` on `window`. This ensures shortcuts work regardless of which element has focus within the board area.

4. **Functional state updates**: The `useCamera` hook uses React's functional `setCamera(prev => ...)` pattern to avoid stale closure issues with the camera state. This is more reliable than a ref-based approach in concurrent React.

5. **E2E browser**: Only Chromium is configured for e2e tests (Firefox and WebKit are not installed in this environment). The playwright config is structured to easily add more browser projects.

6. **Wrangler worker stub**: `src/worker/index.js` exports an empty default object. The actual Worker code arrives in story 3. This is sufficient for `wrangler dev` to serve the static assets from `dist/client`.

7. **Vitest workspace**: Uses `vitest.workspace.ts` with two projects (unit: node environment, component: jsdom environment) as required by the design.

### Files created

- `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.workspace.ts`, `playwright.config.ts`, `wrangler.jsonc`, `.gitignore`
- `index.html`
- `src/shared/config.ts` — named settings (ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, WHEEL_ZOOM_SENSITIVITY, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT)
- `src/client/main.tsx`, `src/client/App.tsx`
- `src/client/canvas/camera.ts` — pure camera maths
- `src/client/canvas/useCamera.ts` — React hook
- `src/client/canvas/BoardViewport.tsx` — viewport with dot grid, world layer, input handling
- `src/client/canvas/ZoomControls.tsx` — zoom controls
- `src/client/canvas/NavigationHint.tsx` — first-use hint
- `src/client/canvas/testHooks.ts` — test-only camera setter
- `src/worker/index.js` — worker stub
- `tests/setup.ts` — jsdom mocks (pointer capture, ResizeObserver, jest-dom)
- `tests/jest-dom.d.ts` — type declarations for jest-dom matchers
- `tests/unit/camera.test.ts` — TC-01 to TC-12 + property check (25 tests)
- `tests/component/BoardViewport.test.tsx` — TC-13 to TC-18, TC-29, TC-30 (8 tests)
- `tests/component/ZoomControls.test.tsx` — TC-19, TC-20, TC-21, TC-32 (6 tests)
- `tests/component/NavigationHint.test.tsx` — TC-22 (3 tests)
- `tests/e2e/navigation.spec.ts` — TC-23 to TC-28, TC-31 (7 tests)
- `tests/e2e/helpers/board.ts` — e2e helpers
