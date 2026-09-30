# Story 11 Notes

## Decisions made

1. **Stroke storage uses flat `number[]` array**: Points are stored as `[x0, y0, x1, y1, ...]` in the Y.Map for efficient CRDT sync. Relative coordinates (offset from the stroke's bounding box origin) ensure that moving a stroke doesn't require rewriting all points.

2. **`simplify()` uses iterative Ramer-Douglas-Peucker**: Avoids stack overflow on very long strokes. Tolerance is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` so simplification is resolution-aware.

3. **Tool overlays rendered outside `BoardViewport`**: The `board-world` div has `width:0; height:0` and a CSS `transform`. Rendering tool overlays inside it with `position:fixed` would still resolve relative to the transformed ancestor (per CSS spec). Moving them outside `BoardViewport` fixes this.

4. **`cameraRef` passed to PenTool for wheel-safe coordinate mapping**: The `camera` prop is captured at render time and goes stale after wheel-to-pan. `cameraRef.current` is read in event handlers to always get the live camera.

5. **Wheel event forwarding from PenTool overlay**: The PenTool overlay (a sibling of BoardViewport) intercepts wheel events before they reach the viewport's wheel handler. A synthetic WheelEvent is dispatched on the viewport element to preserve pan/zoom behavior.

6. **Stroke SVG uses local path coordinates**: Path points are relative to the stroke's bounding-box origin, and the SVG element is positioned at `(stroke.x, stroke.y)`. This avoids pointer-events failures from SVG paths outside the element viewport.

7. **Hit test uses registry's `distanceToPolyline` with zoom-aware tolerance**: `max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom)` ensures consistent screen-space hit target regardless of zoom level.

8. **`aspectLocked: true` for strokes**: Resize handles scale uniformly, preserving the aspect ratio of freehand strokes.

9. **Pre-existing e2e failures**: Shapes and connector e2e tests were already failing before this story (same overlay positioning issue). Fixing the tool overlays to render outside BoardViewport resolves those tests as a side effect.

---

# Story 9 Notes

## Decisions made

1. **`snapshot()` return type widened to `readonly ObjectSnapshot[]`**: The union `StickySnapshot | TextObjectSnapshot` replaces the prior `readonly StickySnapshot[]`. Existing tests required a cast (`as StickySnapshot`) when accessing sticky-specific fields like `.color`. This is the cleanest path without a discriminated-union type guard pattern in every consumer.

2. **Text objects get their own `TextLayer`**: Mirrors the `NoteLayer` pattern for stickies. Each layer filters `notes` by `type` and renders only its own kind. The registry `Component` field is unused at the app level (kept for extensibility).

3. **`createText(doc, at, createdBy)` accepts a `createdBy` string**: No identity module exists (story 6 is excluded). The field is stored for audit purposes but not used in UI logic.

4. **`useTextBoxSync` writes only after local changes**: The hook exposes `remeasureAfterLocalChange()` which callers invoke explicitly after local text edits. Remote updates are not remeasured locally because the originating peer already wrote the box dimensions.

5. **`layoutText()` uses a `Measurer` function type**: Enables injection of fake measurers in unit tests. In production, `createCanvasMeasurer()` provides a canvas-based implementation with a proportional fallback for environments without canvas (jsdom).

6. **`TextEditor` is separate from `StickyTextEditor`**: Rather than wrapping or modifying `StickyTextEditor`, the new `TextEditor` was written independently to preserve story 2 behavior exactly. Both share `clampToLimit` and `applyTextDiff` from `@shared/text-edit`.

7. **Toolbar `aria-label` changed from "Sticky note" to "Sticky note (N)"**: Per the design spec which shows keyboard shortcuts in labels. Existing tests updated accordingly.

8. **Horizontal-only resize via `setTextWidthFixed` in gesture**: When all selected objects have `handles === 'horizontal'`, the resize gesture computes width from the drag delta and calls `setTextWidthFixed` (which sets `widthMode = 'fixed'`). This avoids going through the generic `resizeObjects` path which would also set height.

9. **`registeredTypes` for board-model validation**: The `_registerTypeForModel('text')` call ensures `createText` passes the type-validity check in board-model without coupling the model to the client registry.

---

# Story 8 Notes

## Decisions made

1. **`_um` property on UndoController**: Exposed the internal `Y.UndoManager` as `_um` for testing purposes. This allows boundary tests to manipulate `lastChange` directly since `lib0/time.getUnixTime` captures `Date.now` at module load time and cannot be faked by vitest fake timers (the yjs package is pre-bundled and bypasses vitest's module mocking).

2. **`applyTextDiff` origin**: Changed from `null` to `LOCAL_ORIGIN` in `StickyTextEditor.handleInput()`. Text edits must use LOCAL_ORIGIN so the UndoManager tracks them; previously text edits used `null` which is not in `trackedOrigins`.

3. **Boundary before undo/redo in useBoardKeys**: The `useBoardKeys` handler calls `boundary()` before `undo()`/`redo()` to ensure the current capture window is closed before stepping the stack. This prevents edge cases where a keystroke immediately before the shortcut would be merged with an unrelated future action.

4. **TC-23 e2e adaptation**: After Yjs deletes an object (remotely), the UndoManager removes all stack items referencing that object. So undoing a move of a deleted object has no effect AND the next undo targets the next unrelated step. The test verifies no errors and that the deleted object stays deleted, rather than asserting a specific remaining count.

5. **Pre-existing flaky test**: `collaboration.spec.ts` TC-23 (concurrent typing merges) was already failing before this story's changes. It is a CRDT text interleaving assertion that fails intermittently due to timing.
