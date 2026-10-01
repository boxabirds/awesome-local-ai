# Story 7 — Select, move, resize and delete several objects at once

## Decisions

### Geometry module (`src/shared/geometry.ts`)
- Pure functions with no Y.Doc dependency; easily testable in isolation.
- `resizeRect` takes a `Handle` (8 directions) and an optional `aspectLocked` flag. Edge handles change one axis; corner handles change both. When aspect-locked, the scale factor is derived from the dominant axis.
- `clampScale` computes a single uniform scale that prevents any object from exceeding `MAX_OBJECT_SIZE_WORLD` or going below its `minSize`. Returns the clamped scale factor.
- `scaleWithin` maps a child rect from a source container to a destination container, preserving relative offsets and dimensions proportionally.

### Object type registry (`src/client/objects/registry.ts`)
- Module-level `Map<string, ObjectTypeSpec>`. Registration is one-time only; duplicate registration throws to catch programming errors early.
- `ObjectTypeSpec` contains only the knobs needed for selection behavior: `resizable`, `aspectLocked`, `minSize`, `editableText`, `hitTest`. The selection/move/resize/delete logic remains generic.
- `defaultHitTest` uses `rectContains` on `objectBounds` — sufficient for axis-aligned rectangles.
- A test-only `testbox` type is registered in the test file (guarded by try/catch) to prove generic behavior without adding production code.

### Selection state (`src/client/board/useSelection.ts`)
- Reducer pattern with `SelectionState { ids: ReadonlySet<string>, editingId: string | null }`.
- Actions: `click` (replaces set with single id), `toggle` (add/remove one), `setMany` (marquee/select-all, with `additive` flag), `clear`, `prune` (remove ids no longer in snapshot), `edit`/`endEdit`.
- The `prune` action runs as a side effect whenever the snapshot changes (via `useEffect`). This handles remote deletions: if a selected id is no longer present, it's removed from the selection and editing ends.
- Backward-compatible `selectedId` getter returns the single id when selection size is 1, for existing code paths.

### Marquee (`src/client/board/Marquee.tsx`)
- Uses a `rectRef` alongside the React state for the marquee rectangle. This avoids a stale-closure bug in the `end` callback: React state updates from `move` may not be flushed before `end` fires within the same event batch. The ref always holds the latest value.
- `objectsInRect` selects only objects whose bounds are fully inside the marquee.
- The marquee rect is stored in world coordinates so zoom/pan during drag does not affect the selection area.

### Transform gesture (`src/client/board/useTransformGesture.ts`)
- Uses `window.addEventListener('pointermove'/'pointerup'/'pointercancel')` for event tracking after a pointerdown starts the gesture. This ensures events are captured even if the pointer leaves the object or viewport.
- Group move: records initial positions of all selected objects, then on each pointer move writes absolute positions (`initial + delta/zoom`). One Y.Doc transaction per rAF frame.
- Resize: uses the bounding-box of all selected objects. `resizeRect` computes the new bounding box, `clampScale` limits it, then `scaleWithin` maps each object's position/size into the new box.
- `bringObjectsToFront` is called at gesture start (after crossing DRAG_THRESHOLD_PX) so the moving group renders above stationary objects.
- `canEdit === false` → gesture is silently refused (no Y.Doc writes).

### Keyboard (`src/client/board/useBoardKeys.ts`)
- Listens on `window` via `useEffect`. Ignores events when `editingId` is set or focus is in an input/textarea (typing context).
- Ctrl/Cmd+A: selects all visible objects. Delete/Backspace: deletes the selection. Arrow keys: nudge by `NUDGE_STEP_WORLD` (or `NUDGE_LARGE_STEP_WORLD` with Shift). Escape: clear selection.
- `preventDefault()` is called on handled keys to prevent browser scroll (arrows) and native select-all (Ctrl+A).

### StickyNote changes
- Removed inline drag logic from story 2; pointer events now delegate to `onObjectPointerDown` from the transform gesture hook.
- Shift-click is handled before delegating: calls `onToggle(id)` and returns without starting a gesture.
- Renders `data-selected` and `data-interaction` attributes for tests.

### E2E tests (`tests/e2e/multi-select.spec.ts`)
- TC-32: marquee selects only fully-inside objects.
- TC-33: group drag moves all selected; resize handle scales proportionally.
- TC-34: keyboard nudge (×3 + large) and delete, camera/scroll unchanged.
- TC-35: two-context test proving remote delete prunes selection via the Y.Doc sync path.
- TC-36: multiple concurrent editors move different groups; absolute writes converge.

## Known limitations
- E2E tests require `wrangler dev` with a running D1 database and Durable Object; they cannot run in this CI environment.
- The `testbox` registry entry is only available in test files (not in production code), which is by design.
- Resize handles are only shown for selected groups containing at least one `resizable` object type.
