# Notes — Story 7

## Design decisions

### `endEdit` accepts optional `mode: 'selected' | 'unselected'` parameter
The existing `StickyTextEditor` calls `endEdit` when the user clicks outside the textarea (TC-47). Without a parameter, endEdit would leave the note selected, and the toolbar would re-appear — breaking that test case. We added an optional `mode` parameter so that the editor can pass `'unselected'` to clear the selection when the user clicks off-note.

### `useTransformGesture` exposes `isDragging` state
The design spec says "The gesture hook owns its own state, no React state needed" for the gesture itself. However, the StickyNote component needs to know whether it is being dragged (to hide the toolbar, TC-26). We use a lightweight `useState<boolean>` in the hook for this — it causes 2 extra re-renders per drag (start + end), which is acceptable since the object count is bounded.

### Selection click vs toggle
- `selection.click(id)` replaces the entire selection with `{id}`. Called when dragging an unselected object.
- `selection.toggle(id)` adds or removes. Called on Shift+click.
- `selection.setMany(ids, additive)` replaces or merges with the given ids. Used by marquee (additive=true merges with existing selection per the PRD).

### Marquee is additive
The PRD says "Shift+drag a rectangle … adds every object fully inside the rectangle to the selection". The existing selection is preserved; marquee adds new ids to it. This matches Figma and other whiteboard tools.

### `useSelection(notes)` takes snapshot for pruning
When objects are deleted remotely, the selection must automatically prune those ids. The hook subscribes to changes in the snapshot and prunes deleted ids via the `prune` action.

### StickyNote hitTest uses exclusive right/bottom bounds
`rectContains` uses `<` for right and bottom edges (not `<=`). This means a point exactly on the right/bottom edge of a note does NOT hit it. This prevents ambiguity between adjacent objects and matches the CSS hit-test behavior (a div with `left: 200px; width: 200px` has its border-box ending at x=400 exclusive).

### `onObjectPointerDown` handles Shift key
When Shift is held and the user clicks an object, `onObjectPointerDown` calls `selection.toggle(id)` and returns early without starting a drag. This enables Shift+click to add/remove objects from the selection without moving them.

### Gesture uses absolute writes from gesture start
Rather than computing relative deltas per frame, the gesture stores each object's position at gesture start and computes the absolute target position from the initial world offset. This eliminates floating-point accumulation errors and ensures TC-24's "gap within one world unit of the exact delta" assertion.

### Resize clamps to min/max size per object type
When the group bbox resize would shrink an object below its type's `minSize`, we use `clampScale` + `scaleWithin` to find the maximum scale that keeps all objects above their minimum, then apply uniformly to preserve aspect ratios.

### Ports changed for agent environment
All test infrastructure ports changed from 5173/5411 to 28224/28225 to fit within the agent's assigned port range ($AGENT_PORT_FIRST–$AGENT_PORT_LAST).

## Flaky tests

- **TC-27 (live-collaboration outage test)**: Sometimes fails due to reconnection timing in the test environment. Passes on retry. Not related to story 7 changes.
