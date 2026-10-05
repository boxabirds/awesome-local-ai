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
