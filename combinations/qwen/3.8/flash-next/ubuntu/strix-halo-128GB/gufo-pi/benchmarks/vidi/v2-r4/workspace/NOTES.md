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

## Story 11 Notes

### Decisions

1. **Registry `hitTest` signature extended with optional `zoom?: number`**: Stroke hit-testing needs zoom to convert screen-space tolerance to world-space tolerance. Existing specs (sticky, shape, text, connector) ignore the parameter. `BoardViewport` passes `camera.zoom` through `objectsFor()` and `hitTestObjects()`.

2. **StrokeObject SVG pointer events**: The `<g>` element sets `style={{ pointerEvents: 'auto' }}` to override the parent SVG's `pointerEvents: 'none'`. Contains two paths: (a) an invisible wider hit-area path with `pointerEvents: 'stroke'` for reliable click targets; (b) a visible path with `pointerEvents: 'none'`.

3. **PenTool rendered inside BoardViewport overlay**: Placed in the viewport's `overlay` prop so wheel events naturally bubble to the viewport's wheel handler (enabling pan while pen is active). Pointer events on the overlay do not trigger panning because the viewport's `onPointerDown` checks `event.target !== el` and returns early for child elements.

4. **Stroke points stored relative to bbox origin**: Points in the snapshot are in object-local space (x, y >= 0). `scaledPoints()` scales by `(width/baseWidth, height/baseHeight)` at render time, enabling proportional resize via `commitGeometry`.

5. **Pen tool does NOT call `toolCreated`**: The pen stays active after committing a stroke. Only Escape switches to select. This matches the design: "the pen stays active. Escape returns to Select."

6. **STROKE_MAX_POINTS enforced in PenTool component**: When the point buffer reaches STROKE_MAX_POINTS, `splitPoints()` is called to commit the first segment and start a new stroke with the last point.

7. **Undo boundaries**: `undoBoundary()` is called before and after each `createStroke` transaction. Each stroke is one undo step.

8. **Simplification on commit**: Points are simplified with RDP at `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` world units to keep payload small.

9. **PenToolbar is session-only state**: Managed by `usePenOptions()` React hook; not persisted across sessions.

10. **Hit-area path width**: `thickness * 3 + 12 / zoom` — chosen empirically to be comfortable without being too generous.
