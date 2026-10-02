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

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions made

1. **Board model**: Sticky notes live in a `Y.Map` named `objects`; each note is a `Y.Map` with `type:'sticky'`, `x`, `y`, `color`, `text` (a shared `Y.Text`), `z`, `createdAt`. Mutations are exported free functions (`createSticky`, `moveObject`, `bringToFront`, `setStickyColor`, `deleteObject`, `getStickyText`). `snapshot(doc)` returns notes sorted by `(z, id)`.

2. **useBoardDoc**: `useSyncExternalStore` with `observeDeep` on the `objects` map and a cached snapshot recomputed before notifying, so React only re-renders on real changes. Selection state (`selectedId`/`editingId`) is local component state (`useSelection`), never in the doc.

3. **Interaction state machine**: `StickyNote` keeps `idle/pressed/dragging` in refs. A drag begins only after moving `DRAG_THRESHOLD_PX` (3px) so a press+release stays a click. Drag applies `moveObject` rAF-throttled; `finishInteraction` flushes any pending move synchronously on pointerup/cancel. `bringToFront` runs once at drag start.

4. **Text editor**: `StickyTextEditor` uses an uncontrolled `<textarea>`, a code-point-safe minimal diff into `Y.Text`, a hard 1000-char clamp, and a binary-search `fitFontSize` (10–24px). Outside clicks are detected with a document capture-phase `pointerdown` listener; Escape ends editing as 'selected'.

5. **Double-click vs. pointerdown (real-browser fix)**: `e.preventDefault()` on the viewport/note `pointerdown` suppresses the browser's synthesized `dblclick` in Chromium (jsdom does not), so sticky-note double-click creation silently failed in E2E. Fixed by removing those `preventDefault()` calls and blocking text selection via CSS `user-select: none` on the viewport instead.

6. **Stacking via z-index (real-browser fix)**: Rendering notes in snapshot `(z, id)` order meant `bringToFront` reordered DOM nodes mid-drag, which fired `lostpointercapture` and aborted the drag. Notes are now rendered in a stable id order and stacked with CSS `z-index: note.z`, so bring-to-front only changes a number and never moves DOM nodes.

7. **Toolbar clipping (real-browser fix)**: `overflow: hidden` on the note root clipped the floating toolbar (rendered above the note) so its colour swatches were unclickable. The clipping was moved to an inner `sticky-clip` wrapper (which the display/editor already relied on), leaving the root unclipped so the toolbar can overflow.

8. **E2E readiness**: Because the SPA mounts the Y.Doc and attaches handlers asynchronously, E2E helpers wait for the `[data-grid-layer="true"]` element (plus a short settle) before interacting, otherwise early double-clicks are lost.

### Environment notes

- **Ports**: The e2e web server and all servers must bind within the allowed range (26992–27007). `playwright.config.ts` was changed from the story-1 port 5173 to **26992** (baseURL + webServer port).
- **Browsers**: Chromium, Firefox and WebKit binaries are installed, but — matching the story-1 Playwright config — the suite runs **Chromium only** for reliability and speed on this machine. Chromium fully exercises the pointer/drag/dblclick paths under test.
- All suites pass: unit 43, component 32, e2e 13 (7 navigation + 6 sticky).
