# Story 7: Select, move, resize and delete several objects at once

## Status: COMPLETE

## Implementation Summary

### New files
- `src/shared/geometry.ts` — Point, Rect, Handle types; rectContains, unionRects, normalizeRect, resizeRect, clampScale, scaleWithin
- `src/client/objects/registry.tsx` — ObjectTypeSpec interface, registerObjectType, getObjectType, rectHitTest; registers 'sticky'
- `src/client/board/SelectionBar.tsx` — "N selected" + Delete button (2+ selection)
- `src/client/board/SelectionOverlay.tsx` — Bounding box outline + 8 resize handles in screen space
- `src/client/board/Marquee.tsx` — useMarquee hook + MarqueeRect (shift+drag marquee)
- `src/client/board/useTransformGesture.ts` — Group move (absolute writes, threshold, bringToFront) and handle resize (aspect lock, clampScale, scaleWithin)
- `src/client/board/useBoardKeys.ts` — Ctrl/Cmd+A, Escape, arrow nudge, Delete/Backspace, Enter-to-edit

### Modified files
- `src/shared/config.ts` — Added HANDLE_SIZE_PX, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD
- `src/shared/board-model.ts` — ObjectSnapshot type, width/height on StickySnapshot, objectBounds, objectsInRect, allObjectIds, moveObjects, resizeObjects, bringObjectsToFront, deleteObjects
- `src/client/board/useSelection.ts` — Rewritten as set-based multi-select with reducer
- `src/client/canvas/BoardViewport.tsx` — Added marquee props (Shift+drag = marquee, plain drag = pan)
- `src/client/objects/StickyNote.tsx` — Removed own drag code, delegates to onObjectPointerDown, accepts dragging prop
- `src/client/Board.tsx` — Wires useSelection, useTransformGesture, useBoardKeys, useMarquee, SelectionOverlay, SelectionBar
- `src/client/canvas/testHooks.ts` — Added createNote hook for e2e tests
- `src/client/styles.css` — Selection overlay, marquee rect, selection bar styles

### Tests
- `tests/unit/geometry.test.ts` — TC-01 to TC-04 (rectContains, unionRects, resizeRect, clampScale, scaleWithin)
- `tests/unit/board-model-group.test.ts` — TC-05 to TC-10 (objectBounds, objectsInRect, moveObjects, resizeObjects, deleteObjects, bringObjectsToFront)
- `tests/unit/registry.test.ts` — TC-11, TC-12 (registerObjectType, getObjectType, hitTest)
- `tests/unit/selection.test.ts` — TC-13 to TC-15 (selectionReducer: click, toggle, setMany)
- `tests/component/multiSelect.test.tsx` — TC-16 to TC-31 (shift-click, marquee, Ctrl+A, group move, group delete, arrow nudge, resize, selection bar, edit blocking)
- `tests/e2e/multi-select.spec.ts` — TC-32 to TC-35 (marquee containment, group move, resize proportional, keyboard nudge+delete, collaborative pruning)

### Key decisions
1. **Absolute writes**: Each frame writes absolute position = startRect + accumulated world delta, not incremental. Converges correctly under concurrent edits.
2. **Unselected click + drag**: When pointerdown on an unselected object, sel.click(id) is dispatched but ids are set to [id] immediately (React state is async). Avoids stale selection during the first frame.
3. **Drag state via callback**: onDragStateChange notifies Board.tsx which note is dragging (for data-dragging attribute and toolbar hiding).
4. **Marquee via refs**: The marquee rect is stored in both state (for rendering) and a ref (for end() to read without stale closure).
5. **clampScale handles negative scales**: When dragging a handle past the opposite edge, scale goes to 0; clampScale clamps it up to minSize/dimension.

## Test counts
- Unit: 140 tests (12 files)
- Component: 103 tests (14 files)
- Integration: 65 tests (5 files)
- E2E (chromium): 50 tests (11 files)
- **Total: 358 tests passing**
