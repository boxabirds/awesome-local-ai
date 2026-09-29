# Story 7: Select, move, resize and delete several objects at once

## Decisions Made

### Marquee selection semantics
- Uses **full containment** (all four corners inside) rather than intersection, per design.md. This means a note is only selected if the marquee rectangle fully contains it.
- Marquee gesture **replaces** the selection entirely (`setMany(ids, false)`). Previously it was additive, causing stale selection to persist after marquee.

### Coordinate system
- `objectBounds(obj)` returns `{ x, y, width, height }` where x,y is **top-left** (matching how `createSticky` stores position: `at.x - STICKY_SIZE_WORLD/2`). This is consistent across all board-model functions.

### Selection bar visibility
- `SelectionBar` (with "N selected" text + delete button) renders only when `ids.size >= 2`. Single selection shows the `NoteToolbar` instead (per-object color/delete controls). E2E tests for single-selection use `selection-outline` count instead of the bar.

### Resize handle overlap with other notes
- Resize handles (`pointerEvents: auto`) are positioned in screen space above notes (z-index 1001). They can overlap adjacent notes. This is intentional (design tool behavior). The pre-existing brainstorm e2e test was updated to click empty space first to deselect before clicking an adjacent note.

### Stale closure fix in `useMarquee`
- The `rect` state was captured in a stale closure because `end` callback referenced old `rect` from the render closure. Fixed by using a `rectRef` (mutable ref updated synchronously in `begin`/`move`, read in `end`).

### E2E test note ordering
- Notes in the DOM are sorted by UUID (via `renderOrder = [...notes].sort((a,b) => a.id < b.id ? -1 : ...)`). Tests must not assume creation order equals DOM order. TC-33 filters out a known exclusion id before checking positions.

### Group move and bringToFront
- `bringObjectsToFront` is called once at the start of a group drag (when the threshold is crossed), not on every frame. This raises all selected objects above unselected ones while preserving relative z-order among the selected set.

### Keyboard handling
- `useBoardKeys` listens on `window` for keydown. It skips all handling when `editingId !== null` or when focus is inside a `textarea`/`input`. Arrow key nudges call `e.preventDefault()` to prevent page scroll. The `useTransformGesture` `onObjectPointerDown` also calls `e.stopPropagation()` on pointerdown, preventing the viewport's pan handler from activating.

### Full-capacity convergence (TC-36)
- Tests 5 participants simultaneously nudging their own selection. Because moves use absolute positions (`moveObjects` writes `startRect + delta`), Yjs converges deterministically — each local origin writes its own absolute position, and CRDT merge resolves to the final state.
