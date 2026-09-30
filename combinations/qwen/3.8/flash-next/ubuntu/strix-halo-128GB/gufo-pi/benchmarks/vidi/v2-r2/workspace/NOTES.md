# Notes

## Story 2: Capture ideas on sticky notes and rearrange them

### Decisions

- **BoardViewport integration**: Added `onEmptyDoubleClick` and `onEmptyClick` callbacks to `BoardViewport` to avoid circular dependencies. The viewport detects clicks/drags on its own element (empty space) and invokes these callbacks. The `App.tsx` wires them to create notes and clear selection.

- **NoteLayer component**: Introduced an intermediate `NoteLayer` component rendered inside the `BoardViewport` children to access the camera zoom from `useBoard()` context and pass it down to each `StickyNote`. This satisfies the design's `zoom` prop requirement while working within the component tree.

- **Text editor outside-click detection**: The `StickyTextEditor` calls `onEnd('unselected')` via the App-level click handler on the viewport. The `BoardViewport`'s `onEmptyClick` fires when a pointerup occurs without movement on the viewport element itself (since the note's `pointerdown` calls `stopPropagation`, clicks on notes don't trigger the viewport's empty-click detection).

- **NoteToolbar screen-space positioning**: The `NoteToolbar` is rendered in the overlay (fixed-position) layer, using `worldToScreen` to position it above the selected note. This keeps it unscaled by zoom as the design requires.

- **Font auto-fit**: `fitFontSize` is implemented for use in real browser contexts. In the component (jsdom) tests, a simplified heuristic is used since jsdom doesn't perform real text layout. The e2e test verifies the actual computed font sizes.

- **`yjs` dependency**: Added as a regular dependency (not dev) since it's part of the production application logic.

- **E2E test tolerance**: Used ±2px tolerance for drag tests at different zoom levels to account for floating-point rounding in the world-coordinate calculation during rapid pointer events.

### What was built

- `src/shared/board-model.ts` — Yjs schema, all mutations (createSticky, moveObject, bringToFront, setStickyColor, deleteObject, getStickyText, snapshot)
- `src/client/board/useBoardDoc.ts` — Y.Doc lifecycle hook with `useSyncExternalStore`
- `src/client/board/useSelection.ts` — local selection/editing state
- `src/client/board/Toolbar.tsx` — left toolbar with "Sticky note" button
- `src/client/objects/StickyNote.tsx` — render, select, drag-to-move, double-click-to-edit
- `src/client/objects/NoteLayer.tsx` — renders all notes, passes zoom from context
- `src/client/objects/NoteToolbar.tsx` — 6 colour swatches + delete button
- `src/client/objects/StickyText.ts` — clampToLimit, applyTextDiff, counterVisible, fitFontSize
- `src/client/objects/StickyTextEditor.tsx` — textarea with Y.Text binding, length clamping, Escape handling
- Modified `src/client/canvas/BoardViewport.tsx` — added dblclick and empty-click detection
- Modified `src/client/App.tsx` — wired doc, selection, toolbars, keyboard handlers
