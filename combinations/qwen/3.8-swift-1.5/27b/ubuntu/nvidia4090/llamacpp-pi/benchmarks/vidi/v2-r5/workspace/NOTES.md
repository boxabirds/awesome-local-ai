# Notes

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **Architecture**: Camera state lives in `App.tsx` via `useCamera(viewport)` hook and is passed as props to `BoardViewport`, `ZoomControls`, and `NavigationHint`. This allows all components to share the same camera state without context.

2. **Vitest configuration**: Used a single `vitest.config.ts` with the test script passing the directory path (`vitest run tests/unit/`) rather than the `projects` API, which had compatibility issues with vitest 2.1.9. Component tests use `// @vitest-environment jsdom` directive.

3. **E2E test hook**: The `window.__vidi6.setCamera()` hook is enabled when `import.meta.env.MODE === 'test'`. The Playwright webServer command builds with `vite build --mode test` to enable the hook. This is excluded from production builds.

4. **WebKit e2e**: WebKit tests are configured but cannot run in this environment due to a missing system library (`libavif13`). Chromium and Firefox both pass all e2e tests. Per the task instructions, Chromium is sufficient.

5. **rAF batching removed**: The initial design mentioned batching camera updates with `requestAnimationFrame`, but this was simplified to direct state updates via `setCameraState` with functional updaters. This is simpler and avoids stale closure issues while still being performant enough for the use case (React batches state updates within event handlers automatically).

6. **Pointer capture in jsdom**: `setPointerCapture`/`releasePointerCapture` are not available in jsdom and are mocked in component tests.
