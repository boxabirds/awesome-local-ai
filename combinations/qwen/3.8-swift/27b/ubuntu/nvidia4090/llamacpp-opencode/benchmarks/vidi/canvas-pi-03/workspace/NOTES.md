# Implementation Notes

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **No rAF batching in useCamera**: The design mentions coalescing camera updates with `requestAnimationFrame`. I implemented direct state updates instead, which is simpler and works reliably in all test environments. The rAF optimization can be added in a later story if needed (it's a performance optimization, not a correctness requirement for story 1).

2. **BoardViewport receives camera + handlers as props**: The design contract shows `BoardViewport({ children })` but this makes it impossible for `App` to read `hasNavigated` for the hint. I extended the props to include `camera` and the handler callbacks, with `App` owning the `useCamera` hook. This is a minimal deviation that preserves the visual contract.

3. **Test hook timing in webkit**: The `window.__vidi6` test hook is set in a `useEffect` which can race with test navigation in webkit. Added a `waitForFunction` in the e2e helper to wait for the hook to be available.

4. **Playwright webServer builds in test mode**: The e2e webServer command is `vite build --mode test && vite preview --port 8787` so the test hook (`import.meta.env.MODE === 'test'`) is included in the served build.

5. **vitest workspace file**: Used `vitest.workspace.ts` instead of the `projects` option in `vitest.config.ts` for reliable project separation between unit (node) and component (jsdom) environments.

6. **Safari gesture handling**: The gesture handlers convert the scale ratio to an equivalent `deltaY` value and route through the same `wheel` handler path with `ctrlOrMeta: true`. This is simpler than adding a separate `zoomAt` path and produces identical results.

### Non-behaviours confirmed (per PRD)
- No view persistence across reloads
- No momentum/inertia
- No touch-screen support
- No keyboard arrow-key panning
- Board gestures never zoom the page
