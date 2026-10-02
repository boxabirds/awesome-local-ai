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

1. **One snapshot type for every object**: `ObjectSnapshot` carries `id`, `type`, `x`,
   `y`, `z` plus optional `width`, `height`, `color`, `text`, and
   `type StickySnapshot = ObjectSnapshot`. `snapshot()` returns the generic list, so
   group operations work on any registered type while story 2's code keeps compiling
   under its old name.

2. **`x`, `y` stay the top-left corner** (story 2's convention): `createSticky(doc, at)`
   stores `at - STICKY_SIZE_WORLD / 2`. Every group operation reads the corner through
   `objectBounds()`, which is the only place the fallback lives.

3. **Sizes are stored, with a fallback for old boards**: `createSticky` now writes
   `width`/`height`. A note created before this story has neither, so `objectBounds`
   falls back to `STICKY_SIZE_WORLD` (200) rather than migrating the document.

4. **The model knows which types exist**: `board-model` keeps a `KNOWN_OBJECT_TYPES` set
   (`registerKnownObjectType`, `isKnownObjectType`) and every group operation skips
   unknown types, so a client that understands a new type never moves or deletes objects
   a client that does not would corrupt. `registerObjectType()` registers in both the
   render registry and the model set, and throws on a duplicate registration.

5. **Whole-call rejection for bad numbers**: `moveObjects` refuses the entire call if any
   position is non-finite (`isFiniteRect`/`isFinitePointValue` guards), rather than
   moving half a group. `resizeObjects` clamps to each type's `minSize` and to
   `MAX_OBJECT_SIZE_WORLD`; a group resize is bounded by whichever object hits its limit
   first (`clampScale`), so no member can be inverted.

6. **`bringObjectsToFront` writes nothing when the group is already on top**: it compares
   `min(selected.z)` against `max(unselected.z)` and returns 0 writes in that case, so
   dragging the topmost cluster does not touch `z` on every collaborator.

7. **Outlines belong to the overlay, not to the object**: `StickyNote` no longer draws
   its selection ring. `SelectionOverlay` draws one outline per selected object plus the
   group bounding box and the eight handles, in screen space outside the world layer, so
   the ring stays 1px and the handles stay 8px at every zoom level.

8. **The overlay forwards double-clicks to the board**: a handle sits exactly on a note's
   corner, which is a place story 2 says a double-click creates a note. `onEmptyDblClick`
   turns a double-click anywhere on the overlay into a board double-click at the same
   screen point (this was an e2e failure in TC-27 before the forwarding existed).

9. **The selection bar appears at two or more**: one selected note keeps story 2's
   per-note toolbar; a group gets the bar with its count and a delete button. On a
   read-only board the button is disabled rather than hidden, matching story 4's rule
   that the affordance stays visible but inert.

10. **Marquee is additive and Escape-only**: Shift+drag adds whatever lies fully inside
    the box to the existing selection (`setMany(ids, true)`) and never removes anything.
    Escape is handled by a capture-phase `window` listener that calls
    `stopPropagation()`, so the board's own Escape handler does not also clear the
    selection mid-cancel.

11. **A press inside the group keeps the group**: pressing an already-selected member
    drags the whole selection; pressing an unselected member selects only it and drags
    that. Shift+click toggles and never starts a gesture, which is what makes adding to a
    selection without losing it possible.

12. **Absolute writes are what makes two people converge**: the gesture measures every
    member once at the start and each frame writes where each object *should be* (start
    rect plus delta, or a scaled rect of the start box), never an increment. Pointer
    moves inside one frame collapse into a single `requestAnimationFrame` write, and
    `pointerup` applies the last frame synchronously so the object ends under the pointer.

13. **Listeners live on the window, not on the object**: bringing a group to the front
    re-orders the world layer's children, which would drop a pointer capture taken on one
    of them. Window listeners survive the re-order, and the same three stable refs are
    always removed again in `finish()`.

14. **The overlay is frozen during a gesture**: `useTransformGesture` returns the
    selected rectangles as the gesture found them, and `SelectionOverlay` draws those
    while it runs. The objects move; the outlines and handles are not recomputed per
    frame, which is what the design asks for. A component test asserts the outline still
    sits at its start position mid-drag and only then follows the objects.

15. **Keyboard commands are a pure function**: `handleBoardKeyDown` takes the selection,
    the document and a small context, so select-all, Escape, arrows, Shift+arrows, Delete
    and Backspace are covered by unit tests and by component tests without a browser. It
    does nothing while a text field has focus (story 2 keeps typing) and calls
    `preventDefault()` only for the keys it consumes, so the page never scrolls — the
    e2e test asserts `scrollY` and the camera stay put.

16. **Nudge steps are settings**: `NUDGE_STEP_WORLD` (1) and `NUDGE_LARGE_STEP_WORLD`
    (10) for Shift, `SELECTION_COLOR`, `HANDLE_SIZE_PX`, `STICKY_MIN_SIZE_WORLD`,
    `MAX_OBJECT_SIZE_WORLD` all live in `src/shared/config.ts`.

17. **A test-only object type proves genericity**: `tests/fixtures/testbox.tsx`
    registers `testbox` with its own `minSize`, no locked ratio and no text editor. The
    component and unit tests use it to show that selection, group move, per-axis resize
    and deletion work without touching sticky-note code; it is never registered by the
    app.

18. **jsdom pointer tests**: there is no real pointer capture, so `pointermove` and
    `pointerup` have to be dispatched on the element that started the gesture (the
    helpers do that) and one animation frame has to be advanced between events.
    `moveTo()` must be imported from `tests/component/selection/helpers.ts`: `window`
    already has a `moveTo`, so a missing import turns the step into a silent no-op that
    no typecheck catches.

19. **Cross-browser marquee coverage is opt-in**: `marquee-selection.spec.ts` holds
    TC-32 and `playwright.config.ts` adds `marquee-firefox` / `marquee-webkit` projects
    for it when `PLAYWRIGHT_CROSS_BROWSER=1`. Enabling them unconditionally failed every
    run here because the host cannot start those browsers (story 1 note 12).

20. **Reading the bar through the page**: the marquee e2e asserted the bar with a
    locator and intermittently got an empty string followed by
    `Runtime.callFunctionOn: session closed` when the previous spec's browsers had just
    been torn down. `expect.poll(() => selectionBarText(page))` reads it through
    `page.evaluate` and is stable.
