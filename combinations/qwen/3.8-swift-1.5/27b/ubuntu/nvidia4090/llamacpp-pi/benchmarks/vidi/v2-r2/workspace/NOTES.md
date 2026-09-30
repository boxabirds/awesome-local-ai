# Story 10: Draw shapes and connect them with arrows that follow when moved

## Implementation Notes

### Architecture

- **Shape model** (`src/shared/objects/shape.ts`): CRUD operations for shape objects stored in Y.Map. Shapes have `kind` (rect/ellipse/diamond), `fill`, `stroke`, and a `Y.Text` label. Minimum size enforced at creation; below-min drags fall back to 160×160 centred at the drag origin.

- **Connector model** (`src/shared/objects/connector.ts`): Connectors have `from` and `to` endpoints, each either `attached` (objectId + fallback position) or `free` (x, y). Self-connections rejected. Minimum length enforced. `detachConnectorsTo` converts attached endpoints to free when a target is deleted.

- **Connector geometry** (`src/shared/geometry/connector-geometry.ts`): `sideAnchor` computes midpoint of a rect side. `nearestSide` picks the side facing the other object using an 8-sector compass. `resolveEndpoints` resolves attached endpoints to world positions using a rects map, falling back to stored positions for missing objects.

- **Active tool hook** (`src/client/tools/useActiveTool.ts`): Manages the current tool (select/shape/connector/text) with keyboard shortcuts (V, S, L, T, N, Escape). Shape/connector tools revert to select after creation.

- **ShapeTool** (`src/client/tools/ShapeTool.tsx`): Drag-to-create with live preview overlay. Shift constrains to square. Click creates default-size shape.

- **ConnectorTool** (`src/client/tools/ConnectorTool.tsx`): Hover shows 4 anchor dots on objects. Drag from one object to another creates an attached connector. Drag to empty space creates a free-end connector.

- **ShapeObject** (`src/client/objects/ShapeObject.tsx`): SVG renderer for rect/ellipse/diamond with fill/stroke. Label is centred and editable via contentEditable on double-click.

- **ConnectorObject** (`src/client/objects/ConnectorObject.tsx`): SVG line with arrowhead marker. Invisible thick hit-test line. End handles when selected for re-attach/detach.

- **ShapeToolbar** (`src/client/objects/ShapeToolbar.tsx`): Fill and outline colour swatches shown when a single shape is selected.

### Key decisions

1. **Shape kind stored in Y.Map**: The `kind` field is a plain string in the Y.Map (not a separate type), keeping the object type as `'shape'` with kind as a property.

2. **Connector endpoint resolution at render time**: `resolveEndpoints` is called in the render loop with the current snapshot's rects map. This means arrows automatically follow when shapes move — no explicit "update connector" step needed.

3. **Detach on delete in deleteObjects**: `deleteObjects` calls `detachConnectorsTo` within the same transaction, so the Yjs update is atomic.

4. **Active tool vs useTool**: The new `useActiveTool` hook coexists with the existing `useTool` hook. The Toolbar reads from `activeTool` (which takes priority). Both are kept in sync for backward compatibility with existing tests.

5. **Hit test for connectors**: Uses `distanceToPolyline` with a screen-space tolerance converted to world units via zoom. The invisible hit-test line in the SVG provides the visual hit area.

### Test coverage

- **Unit** (17 tests): Shape model (TC-01–TC-06), connector model + geometry (TC-07–TC-14, TC-29)
- **Component** (11 tests): ShapeTool drag/click (TC-15, TC-28), ShapeObject label (TC-16), ShapeToolbar (TC-17), ConnectorTool hover/drag (TC-18, TC-19), ConnectorObject hit test (TC-20), re-attach (TC-21), useActiveTool shortcuts (TC-22)
- **E2E** (5 tests): Shape drag creation (TC-23), shape click + label (TC-24), connector follows remote move (TC-25), connector survives delete (TC-26), orphaned connector race (TC-27)
