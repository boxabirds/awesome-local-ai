# Story 10 Notes

## Design Decisions

1. **Shape rendering**: Shapes are rendered as SVG elements (rect, ellipse, polygon for diamond) within a positioned div. The SVG approach allows for clean stroke/fill styling and easy label overlay.

2. **Connector endpoint resolution**: Attached endpoints resolve to the nearest side anchor point of the target object's current bounding box. The `resolveEndpoints` function is called on every render of the ConnectorObject, reading live rects from the Y.Doc snapshot.

3. **Detachment on delete**: `deleteObjects` calls `detachConnectorsTo` which converts any attached endpoint referencing a deleted object to a free endpoint at the object's last known side anchor position (fallback).

4. **Shape label editing**: Double-click opens a textarea overlay. The label is stored in a Y.Text for collaborative editing. On blur or Escape, the editor closes and the label is clamped to SHAPE_LABEL_MAX_CHARS (600).

5. **Tool state**: The active tool is managed by `useActiveTool` hook with keyboard shortcuts (V, T, S, L). After shape/connector creation, the tool returns to 'select' and the new object is selected.

6. **Connector hit test**: Uses `distanceToPolyline` with `CONNECTOR_HIT_TOLERANCE_PX / zoom` tolerance. The registry's `hitTest` for connectors returns false (simplified); the real hit test is handled in selection logic.

7. **Shape toolbar**: Appears when a single shape is selected. Shows fill (7 colors) and stroke (6 colors) swatches. Clicking a swatch calls `setShapeStyle` which updates the Y.Map fields.

## Test Coverage

- **Unit (15 tests)**: Shape model (6), connector model (9)
- **Component (9 tests)**: Shape tool create (TC-15), label editing (TC-16), colors (TC-17), connector hover dots (TC-18), connector create (TC-19), connector hit test (TC-20), end handle drag (TC-21), tool shortcuts (TC-22), shape tool over sticky (TC-28)
- **E2E (6 tests)**: Shape drag create (TC-23), diamond at 200% (TC-24), collaborative rearrange (TC-25), delete with connector (TC-26), concurrent drag+delete (TC-27), connector delivery time (TC-25 in connectors.spec)

# Story 11 Notes

## Design Decisions

1. **Real tool hook**: The live tool state is `src/client/board/useTool.ts` (the `useActiveTool.ts` file is dead code, unused by the app). The `pen` tool was added to its `Tool` union; `P`/`Escape`/`V` are handled in `useBoardKeys.ts` like the other tools.

2. **Pen overlay placement**: The PenTool overlay is rendered *inside* the BoardViewport container (new `penOverlay` prop), above the world layer but as a sibling of the transformed world div. This lets wheel events bubble to the container's existing wheel handler, so scrolling pans and Ctrl/Cmd+scroll zooms while the Pen is active — no duplicate camera logic in the tool.

3. **Select-by-line rendering**: `StrokeObject`'s container div is `pointer-events: none`; an invisible SVG hit path (`pointer-events: stroke`, width `max(thickness, 2*STROKE_HIT_TOLERANCE_PX/zoom)`) is the only selectable surface. Clicks in empty space inside the stroke's bbox therefore fall through to objects below, satisfying pen.select ("selection is by the line, not by the empty area around it").

4. **Registry hitTest zoom parameter**: The registry `hitTest` signature was extended to `(obj, worldPoint, zoom?) => boolean` (backward compatible; existing types ignore `zoom`). The stroke's hit test uses `distanceToPolyline` over `scaledPoints` with tolerance `max(thickness/2, STROKE_HIT_TOLERANCE_PX/zoom)`.

5. **Stroke storage**: `createStroke` stores points *relative to the bbox origin* at the creation size, plus `baseWidth`/`baseHeight` (the creation bbox). The object is then moved/resized/deleted by the generic story 7 operations on x/y/width/height. `scaledPoints` maps stored points to world space at the current size (x + rel * width/baseWidth); the thickness is never scaled. The SVG path is drawn from the *relative* points scaled by the current ratio, because the SVG is local to the bbox.

6. **RDP simplification**: `simplify` is an iterative (explicit stack) Ramer–Douglas–Peucker. A fix-up loop re-inserts any point farther than the tolerance from the final polyline: RDP removes points against chords that are not necessarily edges of the output, so the raw "max distance to chord" guarantee does not by itself bound the distance to the output polyline. Inserting only shrinks distances, so the loop terminates.

7. **ObjectSnapshot widening**: `ObjectSnapshot.color` is now `StickyColor | PenColor` (strokes store their pen colour in the same field as the design specifies). `StickySnapshot` still narrows to `StickyColor`; `StickyNote`/`SelectionBar` defensively narrow with `isStickyColor`. New optional fields: `points`, `baseWidth`, `baseHeight`, `thickness`.

8. **Pen undo hook (small extension)**: `PenTool` accepts an optional `undo?: UndoController` and calls `undo.boundary()` after each successful commit, so undo works on pen strokes like the other tools. The design contract doesn't require this (pen strokes are immutable after creation) but it keeps the story 8 invariant "undo my last change" consistent across object types. It is a new, optional prop — existing callers are unaffected.

9. **Long strokes**: At `STROKE_MAX_POINTS` (5000) raw points, the current part is committed and drawing continues from the shared join point (the part's last point is the next part's first point), so the parts draw on with no visible gap. Each part is its own object (the design's "splits" = consecutive parts, each an object).

10. **Pre-existing test noise**: `tests/component/pages.test.tsx` emits one unhandled `checkBoard(...).then` TypeError on a clean tree (story 5 retry logic in the jsdom environment); it is not caused by this story and all 104 component tests pass.
