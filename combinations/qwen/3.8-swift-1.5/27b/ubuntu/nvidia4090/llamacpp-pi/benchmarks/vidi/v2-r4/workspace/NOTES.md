# Story 10: Draw shapes and connect them with arrows that follow when moved

## Decisions

1. **Extended existing `useTool` hook** rather than creating a new `src/client/tools/useActiveTool.ts`. The design doc said "added if absent, else extended" — the hook already existed at `src/client/board/useTool.ts` and was extended with `shape` and `connector` tool types, their keyboard shortcuts (S, L), and a `toolCreated` callback.

2. **Connector hit-testing uses `distanceToPolyline`** from a new shared geometry module (`src/shared/geometry/polyline.ts`). The connector's stored endpoints (resolved via `resolveEndpoints`) are used as the polyline points. The hit tolerance is `CONNECTOR_HIT_TOLERANCE_PX / zoom` in world units, making the 6px screen-space tolerance zoom-independent.

3. **Shape and connector tools use native DOM event listeners** (via `useEffect` + `addEventListener`) rather than React synthetic events. This is necessary for `setPointerCapture` to work correctly during drag operations, ensuring the tool receives all pointer events even when the pointer leaves the overlay element.

4. **Connector endpoints store a `fallback` position** (the anchor point at creation time). When the attached object is deleted, the connector's endpoint is converted to a `free` endpoint at the fallback position. This prevents connectors from breaking when their target is removed.

5. **Shape labels use the same `TextEditor` pattern** as sticky notes — a contenteditable div overlaid on the shape when in edit mode. The label is stored as a single string (max 500 chars) and rendered as centered text within the shape bounds.

6. **The `useBoardDoc` snapshot cache key** was extended to include shape-specific fields (kind, fill, stroke, label) and connector endpoint kinds, ensuring the cached snapshot is invalidated when these fields change.

7. **Shape toolbar appears when a shape is selected** — it shows fill and stroke color swatches. The selected shape's current colors are highlighted. Clicking a swatch calls `setShapeStyle` which writes to the Yjs doc in a single transaction.

8. **Connector re-attach handles** appear only when the connector is selected. Dragging a handle onto a shape re-attaches that endpoint; dragging onto empty space detaches it to a free endpoint. The `setConnectorEndpoint` model function validates that the new target isn't the opposite endpoint's object.

## Test coverage

- **Unit tests** (15 new): `tests/unit/shape-model.test.ts` (TC-01–TC-06), `tests/unit/connector-model.test.ts` (TC-07–TC-14, TC-29)
- **Component tests** (11 new): `tests/component/ShapeTool.test.tsx` (TC-15–TC-22, TC-28)
- **E2E tests** (5 new): `tests/e2e/shapes.spec.ts` (TC-23–TC-27)

## Files changed

### New files
- `src/shared/objects/shape.ts` — Shape model (create, style, label)
- `src/shared/objects/connector.ts` — Connector model (create, re-attach, detach)
- `src/shared/geometry/connector-geometry.ts` — Anchor/side/endpoint resolution
- `src/shared/geometry/polyline.ts` — Point-to-polyline distance
- `src/client/objects/ShapeObject.tsx` — Shape SVG rendering + label editing
- `src/client/objects/ShapeToolbar.tsx` — Fill/stroke color picker
- `src/client/objects/ConnectorObject.tsx` — Connector line + arrowhead + handles
- `src/client/tools/ShapeTool.tsx` — Drag-to-create shape overlay
- `src/client/tools/ConnectorTool.tsx` — Hover dots + drag-to-connect overlay
- `tests/unit/shape-model.test.ts`
- `tests/unit/connector-model.test.ts`
- `tests/component/ShapeTool.test.tsx`
- `tests/e2e/shapes.spec.ts`

### Modified files
- `src/shared/config.ts` — Shape/connector constants
- `src/shared/board-model.ts` — ShapeSnap/ConnectorSnap in AnySnapshot, deleteObjects detaches connectors
- `src/client/board/useTool.ts` — Added shape/connector tools
- `src/client/board/Toolbar.tsx` — Shape button + kind menu, Connector button
- `src/client/board/useBoardDoc.ts` — Extended snapshot cache key
- `src/client/objects/registry.tsx` — Registered shape and connector types
- `src/client/pages/BoardUI.tsx` — Integrated ShapeTool, ConnectorTool, ShapeToolbar
- `tests/unit/board-model.test.ts` — Updated TC-12 to use truly unknown type
- `tests/unit/registry.test.ts` — Updated TC-12 (shape is now registered)
