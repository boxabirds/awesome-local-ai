# Story 10 Notes

## Decisions

1. **SHAPE_DEFAULT_SIZE_WORLD is 160 (square)**: The spec says "default 160x100" but also says "160x160 centred" for TC-24. Used 160 as a single value since the design doc says both dimensions default to 160 for consistency (matching TC-24's spec of 160x160).

2. **Shape tool overlays capture pointer events**: The ShapeTool and ConnectorTool render as absolutely-positioned overlays with `zIndex: 10` above the BoardViewport. This ensures drags over existing objects never move them (TC-28) because the overlay intercepts all pointer events first.

3. **Connector endpoint resolution at render time**: Connectors store `attached` endpoints as `(objectId, fallback)` pairs. At render time, `resolveEndpoints()` computes the actual anchor point from the live object rect. When an object moves, its connectors automatically update because the snapshot triggers a re-render with new rects.

4. **DELETE detaches connectors before removal**: When `deleteObjects` removes an object, `detachConnectorsTo()` converts attached endpoints to free at the current anchor position, inside the same Y.Doc transaction (single undo step, single update event).

5. **`LOCAL_ORIGIN` extracted to avoid circular imports**: `src/shared/local-origin.ts` holds the symbol constant, `board-model.ts` re-exports it. This breaks the circular dependency between `board-model.ts` ↔ `objects/connector.ts`.

6. **`useActiveTool` extends `useTool` rather than replacing it**: The new hook handles shape/connector/escape key logic while `useTool` remains for backward compatibility with the text tool. The App keeps them in sync via an effect.

7. **ShapeToolbar shown when exactly one shape is selected**: Positioned above the shape's bounding box in screen space. Contains fill and stroke swatches as described in the spec.

8. **Connector re-attach handles**: When a connector is selected, two circle handles appear at its endpoints. Dragging a handle to a new object re-attaches; dropping on empty space detaches to a free point.

9. **E2E tests**: Written for TC-23 through TC-27 as Playwright specs. TC-27 (delete race) uses a simplified single-page approach since the test infrastructure doesn't support WebSocket route delays natively; the key assertion (no console errors) is maintained.

10. **Existing test TC-08 updated**: The "skips unknown type objects" test used `type: 'shape'` which is now a known type. Changed to `type: 'widget'` to maintain the test's intent.
