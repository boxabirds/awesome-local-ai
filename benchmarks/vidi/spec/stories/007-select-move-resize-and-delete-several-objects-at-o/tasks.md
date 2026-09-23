# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 2 | Implement geometry and generic group operations in board-model | proposed | implementation | sel.geometry_ops |
| 5 | E2E: colleague deletes one of my selected notes (TC-35) | proposed | test:e2e | sel.interaction |
| 6 | Write geometry and group-operation unit tests first (TC-01 to TC-10) | proposed | test:unit | sel.geometry_ops |
| 7 | Write registry unit tests first (TC-11, TC-12, duplicate registration) | proposed | test:unit | sel.registry |
| 8 | Implement object type registry and register sticky notes | proposed | implementation | sel.registry |
| 9 | Write selection reducer unit tests first (TC-13 to TC-15) | proposed | test:unit | sel.interaction |
| 10 | Implement multi-selection state, outlines and selection bar | proposed | implementation | sel.interaction |
| 11 | Implement Shift+drag marquee selection | proposed | implementation | sel.marquee_ui |
| 12 | Implement generic transform gesture: group move and bounding-box resize handles | proposed | implementation | sel.transform |
| 13 | Implement selection keyboard commands: select all, clear, nudge, delete | proposed | implementation | sel.keyboard |
| 14 | Component tests: selection bar, marquee, transform gesture and keyboard (TC-16 to TC-31) | proposed | test:ui-component | sel.interaction, sel.marquee_ui, sel.transform, sel.keyboard |
| 15 | E2E: reorganise a cluster and full-capacity reorganisation (TC-32, TC-33, TC-34, TC-36) | proposed | test:e2e | sel.marquee_ui, sel.transform, sel.keyboard |

## Details

### 2. Implement geometry and generic group operations in board-model

## Goal
Implement sel.geometry_ops per contract so the unit tests from the geometry test task pass.

## Approach
- `geometry.ts`: `rectContains`, `unionRects` (null for empty), `normalizeRect`, `resizeRect(start, handle, delta, aspectLocked)` (edge handles change one axis; corner both; aspect lock keeps ratio from the opposite anchor), `clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD)` returning one uniform clamped scale, `scaleWithin(child, from, to)`.
- `board-model.ts`: `objectBounds` (width/height fallback STICKY_SIZE_WORLD), `objectsInRect` (fully inside only, for marquee), `allObjectIds` (registered types only, for select all), `moveObjects` (absolute positions; used by drag and nudge), `resizeObjects` (writes width and height, turning implicit-size stickies explicit), `bringObjectsToFront` (selection above unselected, relative z preserved), `deleteObjects`.
- Every mutating call: reject non-finite values or empty id lists with 0 and no transaction; skip missing ids; otherwise one LOCAL_ORIGIN transaction returning the count changed.
- Story 2 single-object functions become wrappers over the group versions.
- Config: HANDLE_SIZE_PX, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD.

## Done when
TC-01 to TC-10 pass; story 2 board-model tests still pass.

### 5. E2E: colleague deletes one of my selected notes (TC-35)

## Goal
Prove sel.interaction's `prune` behaviour through the real sync path.

## Workflow (TC-35)
Two browser contexts on one board with the 20-note fixture. Lee Shift+drags to select 4 notes; the SelectionBar reads "4 selected". Sam selects one of those notes and presses Delete. On Lee's screen, within LIVE_UPDATE_LATENCY_BUDGET_MS, the note disappears, the bar reads "3 selected" (useSelection pruned the id from the snapshot), the remaining 3 still show outlines, and pressing Delete removes exactly those 3.

## Done when
Passes in chromium against wrangler dev.

### 6. Write geometry and group-operation unit tests first (TC-01 to TC-10)

## Goal
Test-first suite for sel.geometry_ops against a real Y.Doc; stub `geometry.ts` exports and new board-model functions throwing "not implemented".

## Cases
- TC-01 `resizeRect` se handle aspectLocked 200×200 + (100,40) → 300×300.
- TC-02 shrink below STICKY_MIN_SIZE_WORLD (−1 and exact) → clamped 50×50 (boundary).
- TC-03 `clampScale` mixed rects: stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD; relative layout preserved.
- TC-04 two 200-unit notes 100 apart, `scaleWithin` box ×2 width → 400 wide, gap 200.
- TC-05 `moveObjects` 3 ids with 1 deleted → returns 2; exactly 1 update event (error path: missing id skipped).
- TC-06 `bringObjectsToFront` 3 overlapping selected over 2 unselected → all selected z above unselected, relative order kept.
- TC-07 `objectsInRect`: A fully inside, B partly, C outside → [A] (negative for B).
- TC-08 `allObjectIds` skips an unknown type.
- TC-09 NaN/Infinity positions and empty id list → 0, no transaction (error path).
- TC-10 sticky without width/height: `objectBounds` uses STICKY_SIZE_WORLD; first `resizeObjects` writes both fields.

## Done when
Suites compile and fail only with "not implemented"; committed.

### 7. Write registry unit tests first (TC-11, TC-12, duplicate registration)

## Goal
Test-first coverage of the sel.registry contract (`registerObjectType`, `getObjectType`, `ObjectTypeSpec`).

## Cases
- TC-11 `getObjectType('sticky')` → { resizable: true, aspectLocked: true, minSize: STICKY_MIN_SIZE_WORLD, editableText: true }, and its `hitTest` is true inside bounds and false 1 unit outside (boundary).
- TC-12 `getObjectType('unknown')` → undefined.
- Duplicate `registerObjectType('sticky', …)` throws (programming error path).
- Test-only `testbox` type registration (resizable, not aspect-locked, minSize 10) is retrievable — used by component tests to prove generic behaviour.

## Done when
Fails against stub; committed.

### 8. Implement object type registry and register sticky notes

## Goal
Implement sel.registry per contract.

## Approach
- Module-level `Map<string, ObjectTypeSpec>`; `registerObjectType` throws on duplicates; `getObjectType` returns undefined for unknown types.
- `ObjectTypeSpec` = { Component, resizable, aspectLocked, minSize, editableText, hitTest } — the only per-type knobs; selection, move, resize and delete stay generic (sel.all_types). Aspect lock and minSize feed `clampScale`/`resizeRect` in the transform gesture.
- Register `sticky` = { StickyNote, resizable: true, aspectLocked: true, minSize: STICKY_MIN_SIZE_WORLD, editableText: true, hitTest: point within `objectBounds` }.
- The board renderer maps snapshot objects through `getObjectType`, skipping unknown types.
- `tests/fixtures/testbox.tsx` registers a test-only resizable, non-locked type (imported only by tests).

## Done when
Registry unit tests pass.

### 9. Write selection reducer unit tests first (TC-13 to TC-15)

## Goal
Test-first coverage of sel.interaction's pure `selectionReducer` (actions click, toggle, setMany, clear, prune, edit).

## Cases
- TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b} (click replaces set).
- TC-14 {a} → toggle a → {} (removing last member, boundary).
- TC-15 {a,b,c} → prune present {a,c,d} → {a,c}; if editingId was b, editingId becomes null (remote delete ends editing).
- setMany additive vs non-additive; actions for ids absent from snapshot are ignored (error path).

## Done when
Fails against stub; committed.

### 10. Implement multi-selection state, outlines and selection bar

## Goal
Implement sel.interaction per contract.

## Approach
- `selectionReducer` + `useSelection(snapshot)`: click replaces the set, toggle adds/removes (Shift-click), setMany (marquee/select all), clear, startEdit/endEdit; a snapshot effect dispatches `prune` so ids deleted by other people leave the selection and editing of a pruned id ends.
- Empty-space pointerup without drag in `BoardViewport` dispatches `clear`.
- Dragging an unselected object: the object's pointerdown dispatches `click` before the transform gesture starts.
- Objects render `data-selected` outline.
- `SelectionBar`: size ≥ 2 → "N selected" + `button[aria-label="Delete selection"]` calling `deleteObjects` then `clear`; exactly one sticky → story 2 `NoteToolbar`; `aria-live="polite"` count announcement.
- Selection never written to the Y.Doc.

## Done when
Reducer unit tests and selection component tests pass.

### 11. Implement Shift+drag marquee selection

## Goal
Implement sel.marquee_ui per contract (`useMarquee`, `MarqueeRect`).

## Approach
- `BoardViewport` empty-space pointerdown: `shiftKey` → `useMarquee.begin(screen)`, otherwise story 1 pan (unchanged).
- `move` converts to world with `screenToWorld` and stores `normalizeRect(start, current)` so zoom during drag is harmless; `MarqueeRect` draws the translucent rectangle in the world layer.
- `end` → `objectsInRect(snapshot, rect)` → `selection.setMany(ids, additive = true)`; empty result leaves selection unchanged.
- pointercancel, lostpointercapture or Escape → `cancel()`, no selection change.
- Pointer capture during the marquee.

## Done when
Marquee component tests and e2e TC-32 pass.

### 12. Implement generic transform gesture: group move and bounding-box resize handles

## Goal
Implement sel.transform per contract (`useTransformGesture`, `SelectionOverlay`).

## Approach
- `onObjectPointerDown(e, id)`: if id not selected → `selection.click(id)`; Pressed until DRAG_THRESHOLD_PX; then record start rects of all selected, call `onGestureStart`, `bringObjectsToFront`; each rAF frame `moveObjects` with absolute `start + delta/zoom`.
- `onHandlePointerDown(e, handle)`: skipped if no selected spec is resizable; aspect lock when any spec `aspectLocked` or Shift held; `resizeRect` on bounding box → `clampScale` with per-type `minSize` and MAX_OBJECT_SIZE_WORLD → `scaleWithin` per object → `resizeObjects`.
- `canEdit === false` → gestures ignored. Pruned ids skipped mid-gesture. pointerup/pointercancel → `onGestureEnd` once, last applied state kept.
- `SelectionOverlay`: bounding box from `unionRects`, 8 handles sized HANDLE_SIZE_PX in screen space with `aria-label="Resize <position>"`.
- `StickyNote`: remove story 2 drag code; delegate pointerdown; render width/height. Future types use the same props (sel.all_types).

## Done when
Transform component tests and e2e TC-33/TC-36 pass.

### 13. Implement selection keyboard commands: select all, clear, nudge, delete

## Goal
Implement sel.keyboard per contract (`useBoardKeys`).

## Approach
- Window keydown; ignore when `editingId` set or focus is in input/textarea.
- Ctrl/Cmd+A → `preventDefault`, `setMany(allObjectIds(snapshot), false)` (empty board → empty set).
- Escape → `clear`.
- Arrow keys with a selection and `canEdit` → `preventDefault` (no page scroll, no pan) and `moveObjects` by NUDGE_STEP_WORLD, or NUDGE_LARGE_STEP_WORLD with Shift.
- Delete/Backspace with a selection and `canEdit` → `deleteObjects(selection)` then `clear`.
- Keep story 2's Enter-to-edit for a single selected sticky; remove the old Delete handler from `App.tsx`.

## Done when
Keyboard component tests and e2e TC-34 pass.

### 14. Component tests: selection bar, marquee, transform gesture and keyboard (TC-16 to TC-31)

## Goal
jsdom tests with a real Y.Doc and the test-only `testbox` type, covering the story 7 component cases, boundaries, negative scenarios and error paths.

## sel.interaction (SelectionBar, useSelection)
- TC-16 all selected ids deleted remotely → selection empty, bar hidden.
- TC-17 two selected → "2 selected" + Delete selection button; aria-live announces count.
- TC-18 one sticky selected → NoteToolbar instead of bar.
- TC-19 empty-space click without drag → selection cleared.

## sel.marquee_ui (useMarquee)
- TC-20 Shift+drag around objects with {x} selected → fully-inside ids added (additive).
- TC-21 plain drag on empty space pans; no marquee (negative).
- TC-22 pointercancel mid-marquee → selection unchanged (error path: gesture cancelled).

## sel.transform (useTransformGesture, SelectionOverlay)
- TC-23 drag unselected b while {a} selected → selection {b}, only b moves. Boundary: movement of DRAG_THRESHOLD_PX − 1 is a click (no write); exactly DRAG_THRESHOLD_PX starts the gesture.
- TC-24 testbox edge handle changes width only; Shift keeps ratio; handles have "Resize <position>" labels.
- TC-25 canEdit false → no writes (negative).
- TC-26 onGestureStart/onGestureEnd each called exactly once per drag; pointercancel mid-drag keeps the last applied positions (error path: gesture cancelled).

## sel.keyboard (useBoardKeys)
- TC-27 Ctrl/Cmd+A selects all with preventDefault.
- TC-28 Ctrl/Cmd+A on empty board → empty, no error (boundary).
- TC-29 ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault (boundary: both nudge steps).
- TC-30 Backspace while editing → text edited, objects kept (negative).
- TC-31 Delete with selection → all removed, selection empty.

## Done when
All pass in `npm run test:component`.

### 15. E2E: reorganise a cluster and full-capacity reorganisation (TC-32, TC-33, TC-34, TC-36)

## Goal
Real-browser proof of marquee, transform gesture and keyboard commands against wrangler dev.

## Workflow "Reorganise a cluster"
- TC-32 (sel.marquee_ui): notes A fully inside, B half inside, C outside a Shift+drag rectangle → only A selected.
- TC-33 (sel.transform): select 6 notes, drag one 300 world units → all 6 move 300 and render above a 4th note; drag se handle → each note scales proportionally, gaps scale, notes stay square; shrinking stops at STICKY_MIN_SIZE_WORLD.
- TC-34 (sel.keyboard): ArrowRight ×3 and Shift+ArrowRight move the selection by NUDGE_STEP_WORLD×3 + NUDGE_LARGE_STEP_WORLD with `window.scrollY` and camera unchanged; Delete removes all 6.

## Workflow "Full-capacity reorganisation"
- TC-36 (sel.transform): MAX_CONCURRENT_EDITORS contexts each move a different selection at the same time → every context shows identical final positions (absolute writes converge).

## Done when
All pass in chromium; TC-32 also in firefox and webkit.

