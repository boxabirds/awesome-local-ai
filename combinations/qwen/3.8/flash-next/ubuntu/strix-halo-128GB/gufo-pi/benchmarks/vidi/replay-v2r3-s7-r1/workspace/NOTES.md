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

1. **Drag listeners live on `window`, not on the note**: the design's `setPointerCapture`
   is unusable here because `bringToFront()` at drag start re-orders the world layer's
   children, and React moving the DOM node drops the capture (Chromium fires
   `lostpointercapture` immediately and the drag stalls). Instead the note adds
   `pointermove` / `pointerup` / `pointercancel` listeners on `window` for the duration
   of the press, filtered by `pointerId`. Behaviour matches the state diagram: release
   selects, cancel keeps the last applied position, and no `lostpointercapture` handler
   is needed.

2. **`board-model` rejections are pre-transaction**: `moveObject`, `setStickyColor`,
   `bringToFront` and `deleteObject` validate (stale id, unknown colour, non-finite
   coordinates, already-topmost) and return `false` *before* `doc.transact(...)`, so a
   rejected mutation emits zero `update` events. Equal-value writes (`moveObject` to the
   same point, `setStickyColor` to the current colour) are also no-ops, which keeps the
   rAF drag loop from writing a Yjs update per frame while the pointer is idle.

3. **`applyTextDiff` counts code points, writes UTF-16 offsets**: the common prefix and
   suffix are compared over `Array.from(text)` so an emoji is never split, then converted
   back to UTF-16 offsets for `ytext.delete`/`insert` — one delete and/or one insert
   inside a single transaction (required for story 3's concurrency).

4. **Font fit measures the display div only**: `fitFontSize(el, box)` binary-searches
   integer px in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]` using `scrollHeight <=
   clientHeight`, run in a `useLayoutEffect` on mount and on text change (zoom scales
   uniformly, so no re-fit is needed). In jsdom `clientHeight` is 0, which is treated as
   an unbounded box and leaves the size at the maximum — the only layout-free assertion
   the component tests can make; the real shrink-to-10px path is covered by e2e TC-33.

5. **Note toolbar stays screen-sized inside the scaled world layer**: rather than
   portalling out of the world layer, the anchor div uses `transform: scale(1/zoom)`
   with `transform-origin: bottom left`, so the toolbar keeps its 1:1 pixel size at any
   zoom without measuring the note's screen box.

6. **Text editor is uncontrolled**: the textarea's value is set once on mount from the
   `Y.Text` (focus + caret at end) and every `input` writes through with
   `clampToLimit` + `applyTextDiff`; IME input is deferred to `compositionend` so
   composition never duplicates characters. Ending editing therefore writes nothing
   further — Escape ends as *Selected*, a pointerdown outside the note ends as
   *Unselected* (document-level capture listener, idempotent via a ref), blur flushes
   defensively.

7. **Empty-space click detection in `BoardViewport`**: `onEmptyClick` fires on
   `pointerup` when the press started on the viewport/grid layer and never exceeded
   `DRAG_THRESHOLD_PX`, and `onEmptyDblClick` fires on `dblclick` with the same target
   test. Both props are optional, so story 1's `BoardViewport` tests are untouched. The
   world layer is `0x0`, so clicks on empty space fall through to the grid layer.

8. **Selection cleanup is an `App` effect**: a note can vanish while selected (bin
   button, remote deletion in story 3), so `App` clears `selectedId` whenever it is
   missing from the snapshot. `StickyNote` additionally checks the live `Y.Map` in its
   rAF drag step and stops quietly if the note is gone (TC-37).

9. **`useBoardDoc` snapshot cache**: `objects.observeDeep` bumps a revision counter and
   `getSnapshot` memoises `snapshot(doc)` per revision for `useSyncExternalStore`; the
   `Y.Doc` is created once per mount with `initDoc`.

10. **E2E helpers must wait for the camera to settle**: `setCamera()` posts to
    `window.__vidi6` and React re-renders asynchronously, so a following
    `boundingBox()` could measure the previous frame and make the test grab empty board
    (an intermittent failure at 50% zoom). `setCamera` now waits until the world layer's
    computed matrix carries the requested zoom/pan.

11. **`window.__vidi6.getBoard()`**: added next to `setCamera` (same test-mode gate,
    now via `registerTestHooks`) so e2e tests can assert the model — positions, z order,
    colour and the 1,000 character clamp — instead of inferring it from pixels.

12. **Browsers**: the Playwright config stays chromium-only. Firefox and WebKit binaries
    are present but the host is missing their system libraries (`libgtk-3-0t64`, ...),
    and installing them needs root and network access that this environment does not
    have; story 1's tests fail there for the same reason.

## Story 7: Select, move, resize and delete several objects at once

### Decisions made

1. **`useTransformGesture` handles both move and resize**: a single hook owns the window-level
   pointer listeners and a state machine (`idle → pressed → moving/resizing`). The hook
   exposes `onObjectPointerDown` and `onHandlePointerDown` consumed by StickyNote and
   SelectionOverlay respectively. rAF batching coalesces per-frame writes for smooth
   group moves without flooding Yjs.

2. **Shift+click toggles selection in the transform gesture**: `onObjectPointerDown`
   checks `e.shiftKey` before deciding to replace vs toggle selection. When toggling
   off (object was already selected), the handler returns early so no drag starts.

3. **SelectionOverlay rendered inside BoardViewport**: resize handles are placed in
   `overlayChildren` (a new prop) so that dblclick events on the handle element bubble
   to the viewport's `handleDoubleClick`. Without this, handles outside the viewport
   intercepted the second mousedown of a dblclick sequence and prevented new-note
   creation at handle-covered coordinates.

4. **`handleDoubleClick` uses `closest('[data-note-id]')` instead of `isBoardSurface`**:
   the check is inverted — any dblclick that does NOT hit a sticky note is treated as
   an empty-space dblclick. This lets overlay elements (selection handles, bounding
   box) pass dblclicks through to the board-creation handler.

5. **Group move uses absolute writes from `startRects`**: the gesture captures the
   initial bounds of every selected object at threshold crossing, then each rAF frame
   computes the new position from `startRect + (currentPointer - startPointer) / zoom`.
   This avoids drift from cumulative delta writes.

6. **`bringObjectsToFront` called once at threshold crossing**: z-order change happens
   exactly once when the drag starts, not on every frame. This keeps the ymap update
   count low and matches the UX of "objects come forward when you start moving them".

7. **Bounding-box resize scales objects proportionally**: `resizeRect` computes the new
   bounding box; `scaleWithin` then clamps each object to `[minSize, MAX_OBJECT_SIZE_WORLD]`.
   `clampScale` ensures the uniform scale factor doesn't push any object below its own
   minimum. Aspect-locked objects (sticky notes) maintain width/height ratio unless
   Shift unlocks.

8. **`data-dragging` attribute removed from StickyNote**: the old single-note drag
   exposed `data-dragging` on the note element. With the new architecture, drag state
   lives in `useTransformGesture` (a separate hook), not in the note component. Tests
   were updated to remove assertions on this attribute while keeping all functional
   position/camera assertions.

9. **NoteToolbar stays visible during drag**: the old code hid the toolbar while
   dragging. In story 7, single-note drag uses the transform gesture and the toolbar
   visibility is purely `selected && !editing`, matching design-tool conventions where
   the toolbar doesn't flicker during manipulation.

10. **Marquee uses `Shift+pointerdown` on the viewport**: BoardViewport checks
    `e.shiftKey` in its own `handlePointerDown` (which only fires when the target is
    the viewport or grid layer). The `useMarquee` hook tracks the drag rect and on
    pointerup calls `objectsInRect` to find fully-contained objects, then
    `selection.setMany(ids, additive=true)` to merge with existing selection.

