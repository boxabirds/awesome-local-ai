# Story 7: Multi-Select Implementation Notes

## Key Decisions

### Selection Model
- **Set-based selection**: Replaced single `selectedId: string | null` with `ids: ReadonlySet<string>` in a `useReducer`-based hook (`useSelection`).
- **Pure reducer**: `selectionReducer` is a pure function exported for unit testing. Actions: `click`, `toggle`, `setMany`, `clear`, `edit`, `prune`.
- **Pruning**: Selection is pruned whenever the object list changes (remote deletes, local deletes) to prevent dangling IDs.

### Object Type Registry
- **`ObjectTypeSpec`**: Each object type registers a spec with `Component`, `resizable`, `aspectLocked`, `minSize`, `editableText`, and `hitTest`.
- **Deferred component registration**: `registerSticky.ts` uses a mutable ref to avoid circular dependency between `StickyNote.tsx` and `registry.tsx`.
- **Duplicate registration throws**: Prevents accidental double-registration during development.

### Geometry
- **`Rect` type**: `{x, y, width, height}` in world units.
- **`resizeRect`**: Computes new rect from anchor corner + delta. Supports `aspectLocked` for uniform scaling.
- **`clampScale`**: Clamps scale factors to keep all objects within `[minSize, maxSize]` bounds. Stops uniformly when any object would exceed limits.
- **`scaleWithin`**: Proportionally maps a rect from one bounding box to another (used for group resize).
- **`unionRects`**: Computes the bounding box of multiple rects.

### Group Operations (board-model)
- **Single transaction**: All group operations (`moveObjects`, `resizeObjects`, `bringObjectsToFront`, `deleteObjects`) use a single Yjs transaction, producing exactly 1 update event.
- **Missing IDs skipped**: Operations gracefully skip IDs that no longer exist (e.g., deleted remotely).
- **Non-finite values rejected**: NaN/Infinity positions are rejected without opening a transaction.
- **Implicit to explicit size**: Sticks without `width`/`height` use `STICKY_SIZE_WORLD`. First `resizeObjects` call writes both fields.

### Transform Gesture
- **Element-level listeners**: `useTransformGesture` attaches `pointermove`/`pointerup` listeners to the specific element (via `setPointerCapture`), not to `window`. This prevents interference with viewport panning.
- **Shift-click toggles**: Shift+click on an object toggles its selection without starting a drag.
- **`onGestureStart`/`onGestureEnd`**: Callbacks for enter/exit edit mode (used to disable viewport panning during object manipulation).

### Keyboard
- **`useBoardKeys`**: Centralized keyboard handler for the board.
- **Ctrl/Cmd+A**: Selects all objects (prevents default browser select-all).
- **Escape**: Ends editing if in edit mode, otherwise clears selection.
- **Arrow keys**: Nudge selection by `NUDGE_STEP_WORLD` (10) or `NUDGE_LARGE_STEP_WORLD` (50 with Shift).
- **Delete/Backspace**: Deletes all selected objects (ignored while editing text).
- **Input guard**: Keyboard shortcuts are disabled when focus is in an input/textarea/contenteditable.

### Selection UI
- **`SelectionOverlay`**: Renders bounding box + 8 resize handles in screen space for multi-selection (2+ objects).
- **`SelectionBar`**: Shows "N selected" + Delete button for multi-selection, or `NoteToolbar` for single sticky.
- **`Marquee`**: Shift+drag on empty space creates a marquee rect. Fully-inside objects are added to selection.

### Compatibility
- **Backward-compatible snapshots**: `ObjectSnapshot` includes optional `width`/`height` fields. Old sticks without these fields use `STICKY_SIZE_WORLD`.
- **Existing tests pass**: All story 1-5 component tests continue to pass without modification.

## Files Changed
- `src/shared/config.ts` — Added constants
- `src/shared/geometry.ts` — NEW: geometry operations
- `src/shared/board-model.ts` — Added group operations + `ObjectSnapshot`
- `src/client/objects/registry.tsx` — NEW: type registry
- `src/client/objects/registerSticky.ts` — NEW: sticky registration
- `src/client/objects/StickyNote.tsx` — Rewritten to use registry + gesture
- `src/client/board/useSelection.ts` — Rewritten: set-based selection
- `src/client/board/SelectionBar.tsx` — NEW
- `src/client/board/SelectionOverlay.tsx` — NEW
- `src/client/board/Marquee.tsx` — NEW
- `src/client/board/useTransformGesture.ts` — NEW
- `src/client/board/useBoardKeys.ts` — NEW
- `src/client/canvas/BoardViewport.tsx` — Added marquee support
- `src/client/pages/BoardContent.tsx` — Rewired for multi-select

## Test Coverage
- **Unit**: geometry (16), board-model group ops (13), registry (6), selection reducer (10)
- **Component**: selection-multi (16 tests covering TC-16 to TC-31)
- **E2E**: multi-select.spec.ts (TC-32 to TC-36)
