# Notes

## Story 1: Pan and zoom around an infinite board

### Decisions made

1. **WebKit E2E not available**: Playwright WebKit could not be installed due to missing system dependencies. Per the task instructions ("Chromium is sufficient if other browsers are not installed"), E2E tests run in Chromium only. The playwright config was updated to include only the chromium project.

2. **Vitest workspace config**: Used `vitest.workspace.ts` for project configuration (unit/node, component/jsdom) as the `projects` field in `vitest.config.ts` was not resolving test files correctly in Vitest 2.1.

3. **Test hook for E2E**: The `window.__vidi6.setCamera()` hook is installed via `installTestHooks()` in `App.tsx`, gated on `import.meta.env.MODE === 'test'`. In production builds, Vite replaces `import.meta.env.MODE` with `'production'`, so the hook is tree-shaken.

4. **PointerEvent in jsdom**: jsdom does not provide `PointerEvent` constructor. Component tests use `MouseEvent` with `pointerId` and `isPrimary` properties added via `Object.defineProperty`, and mock `setPointerCapture`/`releasePointerCapture` on `HTMLElement.prototype`.

5. **rAF in component tests**: `requestAnimationFrame` is handled via `vi.useFakeTimers()` and `vi.runOnlyPendingTimers()` in component tests.

6. **PERCENT constant**: Added `PERCENT = 100` to `src/shared/config.ts` to avoid a magic number in `zoomPercent()`.
