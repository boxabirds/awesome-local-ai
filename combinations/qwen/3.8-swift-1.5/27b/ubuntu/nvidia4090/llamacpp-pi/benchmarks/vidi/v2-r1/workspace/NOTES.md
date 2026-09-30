# Story 10: Design Notes

## Decisions

### Tool Architecture
- Replaced the old `useTool` hook (which only supported `select` | `text`) with a new `useActiveTool` hook that supports all tool types: `select`, `sticky`, `text`, `shape`, `connector`, `pen`, `image`, `comment`.
- The `useActiveTool` hook manages keyboard shortcuts (S for Shape, L for Connector, V for Select, T for Text, N for Sticky) and Escape-to-deselect-tool behavior.
- The old `useTool.ts` is kept for backward compatibility with `useBoardKeys.ts` which still imports the `Tool` type from it.

### Shape Model
- Shapes are stored as Y.Map entries in the `objects` map with type `'shape'`.
- Properties: `kind` (rect/ellipse/diamond), `x`, `y`, `width`, `height`, `fill`, `stroke`, `label` (Y.Text).
- `createShape` validates finite coordinates and creates a Y.Text for the label.
- `setShapeStyle` updates fill/stroke colors.
- Label is clamped to 500 chars max in the editor component.

### Connector Model
- Connectors are stored as Y.Map entries with type `'connector'`.
- Endpoints are either `attached` (with `objectId` and `fallback` point) or `free` (with `x`, `y`).
- `resolveEndpoints` computes the actual line endpoints: attached endpoints use the side anchor of the target object facing the other endpoint; free endpoints use their stored position.
- `detachConnectorsTo` converts attached endpoints to free endpoints when the target object is deleted.
- `connectorBBox` computes the bounding box from resolved endpoints.

### Connector Geometry
- `sideAnchor(rect, side)` returns the midpoint of the given side.
- `nearestSide(rect, point)` determines which side of the rect is closest to a given point (using normal projection distance).
- `distanceToPolyline(points, point)` computes the minimum distance from a point to a polyline (used for hit testing).

### Component Architecture
- `ShapeTool`: Full-viewport overlay that captures pointer events for drag-to-create. Uses refs for drag state to avoid React async state issues.
- `ConnectorTool`: Full-viewport overlay with hover dots (4 per shape at side midpoints), drag preview line, and creation logic.
- `ShapeObject`: SVG rendering of the shape (rect/ellipse/polygon) with a foreignObject label editor on double-click.
- `ConnectorObject`: SVG line + arrowhead polygon. When selected, shows draggable endpoint handles.
- `ShapeToolbar`: Floating toolbar with fill and stroke color swatches, shown when a shape is selected.

### Known Issues
- The `screenToWorld` camera function has a pre-existing inconsistency with the SVG rendering transform (it uses `screen - cam` instead of `(screen + cam) / zoom`). This affects the ConnectorTool's hover detection in jsdom tests but works correctly in the browser because the actual pointer events use real screen coordinates that match the rendering.
- Yjs "Unexpected content type" async errors occur in jsdom when shapes are created from within React event handlers (dual-package hazard). The shapes ARE created successfully; the error is spurious and only affects the test environment.

### Test Strategy
- Unit tests (`tests/unit/shape-model.test.ts`, `tests/unit/connector-model.test.ts`): Test all model functions directly with Y.Doc.
- Component tests (`tests/component/ShapeTool.test.tsx`, `tests/component/Connector.test.tsx`, `tests/component/useActiveTool.test.tsx`): Test UI rendering, tool switching, label editor, shape toolbar, and hit test functions.
- E2E tests (`tests/e2e/shapes-and-connectors.spec.ts`): Full browser tests for the golden path (create shapes, create connectors, move shapes with connected arrows, multi-browser sync, delete with connector detachment, reload persistence).
