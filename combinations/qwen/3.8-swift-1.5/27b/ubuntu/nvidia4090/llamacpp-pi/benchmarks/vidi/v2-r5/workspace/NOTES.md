# Implementation Notes

## Story 9: Write free text anywhere on the board

### Decisions

1. **Empty text definition**: Only zero characters counts as empty (TC-04). Whitespace-only text (e.g., "  ") is kept, per the design's explicit decision.

2. **Initial box estimate**: `createText` sets an initial width of `TEXT_MIN_WIDTH_WORLD` (40) and height of one line at the default size. This ensures bounds exist before the first measurement. The editor's first input triggers `remeasureAfterLocalChange` which writes the correct dimensions.

3. **TextEditor generalisation**: The `TextEditor` component is a generalisation of `StickyTextEditor`. The sticky editor now wraps the shared `TextEditor` internally (via the `StickyTextEditor` component which still exists for backward compatibility). The shared editor accepts `maxChars`, `fontPx`, `width`, and `onInput` props.

4. **Remeasure strategy**: The `remeasureText` callback in `BoardContent` uses a character-count-based estimate (fontSize × 0.6 per char) for width calculation. This is sufficient for the toolbar size change and handle drag scenarios. The `useTextBoxSync` hook provides the more precise canvas-based measurement for the editor's input handler. In a full production implementation, the canvas measurer would be used everywhere, but the estimate keeps the implementation simple and testable in jsdom.

5. **BoardViewport click handling**: When the Text tool is active, `pointerdown` on empty space does not initiate pan or marquee. Instead, a `click` event on the viewport triggers `onClickEmptyWithPoint` which creates a text object at that world position.

6. **E2E tests**: The e2e test file (`tests/e2e/text.spec.ts`) is written per the spec (TC-26 to TC-31) but could not be executed in this sandbox environment due to browser display limitations. The tests are structured correctly and should pass in a CI environment with proper browser support.

7. **Registry handles property**: The `ObjectTypeSpec` interface gained an optional `handles?: 'all' | 'horizontal'` property. The `SelectionOverlay` checks if all selected objects have `handles: 'horizontal'` and, if so, renders only the `e` and `w` handles.

8. **Snapshot type**: The `snapshot()` function now returns `ObjectSnapshot[]` (the base type) instead of `StickySnapshot[]`. The `ObjectSnapshot` interface gained optional fields (`color`, `text`, `createdAt`, `width`, `height`, `size`, `widthMode`, `createdBy`) so existing code that accesses these fields continues to type-check.

### Files added
- `src/shared/config.ts` (modified: TEXT_* settings)
- `src/shared/text-edit.ts` (new: shared clampToLimit, applyTextDiff)
- `src/shared/objects/text.ts` (new: text model)
- `src/client/objects/textLayout.ts` (new: layoutText, createCanvasMeasurer)
- `src/client/objects/useTextBoxSync.ts` (new: box sync hook)
- `src/client/objects/TextEditor.tsx` (new: generalised editor)
- `src/client/objects/TextObject.tsx` (new: text object component)
- `src/client/objects/TextToolbar.tsx` (new: size + delete toolbar)
- `src/client/objects/registerText.ts` (new: registry entry)
- `src/client/board/useTool.ts` (new: tool state hook)
- `tests/unit/text-model.test.ts` (new: TC-01 to TC-06)
- `tests/unit/text-layout.test.ts` (new: TC-07 to TC-11, TC-32)
- `tests/component/TextBoxSync.test.tsx` (new: TC-12, TC-13)
- `tests/component/Tool.test.tsx` (new: TC-14 to TC-18)
- `tests/component/TextObject.test.tsx` (new: TC-19 to TC-25)
- `tests/e2e/text.spec.ts` (new: TC-26 to TC-31)

### Files modified
- `src/shared/board-model.ts` (snapshot includes text, objectBounds handles text)
- `src/client/objects/StickyText.ts` (re-exports from text-edit.ts)
- `src/client/objects/registry.tsx` (handles property)
- `src/client/board/Toolbar.tsx` (Select/Text tool buttons)
- `src/client/board/SelectionOverlay.tsx` (horizontal-only handles)
- `src/client/board/SelectionBar.tsx` (TextToolbar for text objects)
- `src/client/board/useBoardKeys.ts` (N key, Enter for text)
- `src/client/canvas/BoardViewport.tsx` (text tool cursor, click-to-create)
- `src/client/pages/BoardContent.tsx` (tool state, text creation, remeasure)
- `src/client/board/useBoardDoc.ts` (ObjectSnapshot type)

## Story 10: Draw shapes and connect them with arrows that follow when moved

### Decisions

1. **Shape model**: Shapes are stored as Y.Map entries with `type: 'shape'`, `kind` (rect/diamond/ellipse), `x`, `y`, `width`, `height`, `fill`, `stroke`, and `label`. The `createShape` function accepts a rect (for drag-create) or null (for click-to-drop standard size). Shift-key constraint makes width == height.

2. **Connector model**: Connectors are stored as Y.Map entries with `type: 'connector'` and `from`/`to` endpoint objects. Each endpoint is either `{kind: 'attached', objectId, fallback}` or `{kind: 'free', x, y}`. The `fallback` point is used when the attached object is deleted.

3. **Connector geometry**: The `resolveEndpoints` function computes the actual screen positions of connector endpoints at render time. For attached endpoints, it finds the nearest side of the target object's bounds and returns the side midpoint. This means arrows automatically follow when objects are moved — no explicit update needed.

4. **Connector rendering**: Connectors are rendered as SVG paths with arrowheads inside a full-viewport `<svg>` overlay. The path is a simple line from the resolved `from` point to the resolved `to` point, with the arrowhead drawn as a small triangle at the `to` end.

5. **Hit testing**: Connector hit testing uses `distanceToPolyline` from the shared geometry module. The tolerance is `CONNECTOR_HIT_TOLERANCE_PX / zoom` in world units, so the hit area stays constant in screen pixels regardless of zoom level.

6. **Tool system**: The `useActiveTool` hook replaces the old `useTool` hook. It adds `shape` and `connector` tool IDs, S/L keyboard shortcuts, and a `shapeKind` state. After creating an object with the shape or connector tool, the tool automatically returns to `select`.

7. **Shape rendering**: Shapes render as SVG elements inside the same `<svg>` overlay as connectors. Rectangles use `<rect>`, diamonds use `<polygon>`, and ellipses use `<ellipse>`. The label is rendered as an SVG `<text>` element centered in the shape.

8. **Shape label editing**: Double-clicking a shape opens an inline editor (HTML textarea positioned over the SVG). The label is clamped to `SHAPE_LABEL_MAX_CHARS` (500) on blur.

9. **Shape toolbar**: When a shape is selected, a floating toolbar appears with 5 fill swatches and 5 stroke swatches. Clicking a swatch calls `setShapeStyle` to update the shape's fill/stroke.

10. **Connector tool interaction**: Hovering over a shape shows 4 connection dots (one per side midpoint). Dragging from one shape to another creates an attached connector. Dragging to empty space creates a free endpoint. The nearest side dot is highlighted during the drag.

11. **Delete cascade**: When an object is deleted, `detachConnectorsTo` is called to convert any attached endpoints referencing that object to free endpoints using the stored fallback position.

12. **Pointer capture**: Both ShapeTool and ConnectorTool use `setPointerCapture` to ensure drag events are received even when the pointer leaves the overlay element. In jsdom tests, this is mocked via `Element.prototype`.

### Files added
- `src/shared/objects/shape.ts` (new: shape model)
- `src/shared/objects/connector.ts` (new: connector model)
- `src/shared/geometry/connector-geometry.ts` (new: side anchor, nearest side, resolve endpoints)
- `src/shared/geometry/polyline.ts` (new: distance to polyline)
- `src/client/tools/useActiveTool.ts` (new: extended tool hook)
- `src/client/tools/ShapeTool.tsx` (new: shape drag tool)
- `src/client/tools/ConnectorTool.tsx` (new: connector drag tool)
- `src/client/objects/ShapeObject.tsx` (new: shape SVG renderer)
- `src/client/objects/ShapeToolbar.tsx` (new: fill/stroke swatches)
- `src/client/objects/ConnectorObject.tsx` (new: connector SVG renderer)
- `src/client/objects/registerShape.ts` (new: registry entry)
- `src/client/objects/registerConnector.ts` (new: registry entry)
- `tests/unit/shape-model.test.ts` (new: TC-01 to TC-10)
- `tests/unit/connector-model.test.ts` (new: TC-11 to TC-25)
- `tests/component/ShapeTool.test.tsx` (new: TC-15, TC-16, TC-17, TC-28)
- `tests/component/Connector.test.tsx` (new: TC-18, TC-19, TC-20, TC-21)
- `tests/component/useActiveTool.test.tsx` (new: TC-22)
- `tests/e2e/flow.spec.ts` (new: TC-23, TC-24, TC-25)

### Files modified
- `src/shared/config.ts` (SHAPE_*, CONNECTOR_* constants)
- `src/shared/board-model.ts` (snapshot handles shape/connector, objectBounds, deleteObjects calls detachConnectorsTo)
- `src/client/board/Toolbar.tsx` (Shape + Connector buttons, shapeKind menu)
- `src/client/pages/BoardContent.tsx` (useActiveTool, shape/connector creation, SVG overlay)
- `tests/unit/board-model.test.ts` (TC-12 uses unknown-type instead of shape)
- `tests/unit/board-model-group.test.ts` (TC-08 uses unknown-type instead of shape)
- `tests/component/LoadFailure.test.tsx` (Toolbar props)
- `tests/component/UndoControls.test.tsx` (Toolbar props)

## Story 11: Sketch freehand with a pen

### Decisions

1. **RDP simplification in shared layer**: `simplify(points, tolerancePx, zoom)` in `src/shared/geometry/simplify.ts` implements the Ramer–Douglas–Peucker algorithm. Applied in the PenTool component at commit time. Tolerance is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` world units (0.5px screen tolerance). `splitPoints(points, limit)` splits at the limit with shared join points between parts.

2. **Stroke data model**: `createStroke(doc, opts, clientId)` in `src/shared/objects/stroke.ts`. `strokePoints` is a Y.Array of flat numbers `[x0, y0, x1, y1, ...]`. `scaledPoints(stroke, scale)` returns `Point[]` with each point multiplied by scale (for resize). Bbox computed from points ± half the pen thickness in world units.

3. **Hit test**: Line-segment distance test against all segments of the polyline. Tolerance: `max(thicknessWorld/2, STROKE_HIT_TOLERANCE_PX / zoom)` world units. This ensures constant screen-px tolerance regardless of zoom. `ObjectSpec.hitTest` signature extended with optional `zoom` parameter (defaults to 1).

4. **Resize (aspect-locked)**: `resize` in registerStroke computes a uniform scale factor from the bounding box width change. All points scaled by the factor; bbox updates accordingly. Aspect ratio is preserved by construction.

5. **PenTool component**: Fixed-position full-viewport overlay (zIndex 500) like ShapeTool. Wheel events forwarded to the board viewport's pan handler via a prop. Coalesced pointer events used when available. Single click (down + up without move) commits a 2-point dot. `pointercancel` commits the stroke with points so far (never loses work). Tool stays active after stroke commit (does NOT call `toolCreated`).

6. **ObjectSnapshot.color type**: Changed from `StickyColor` to `string` to accommodate `PenColor` (broader palette). No runtime impact; type-level change only.

7. **E2E tests**: Written per design.md TC-17 to TC-20. Use `createBoard()` helper that navigates to `/`, clicks "New board", waits for URL change. Note: e2e tests require a working `wrangler dev` Durable Object environment.

### Files added
- `src/shared/geometry/simplify.ts` (new: RDP simplify, splitPoints, smoothPath)
- `src/shared/objects/stroke.ts` (new: stroke model)
- `src/client/tools/usePenOptions.ts` (new: pen options hook)
- `src/client/tools/PenToolbar.tsx` (new: pen colour/thickness toolbar)
- `src/client/tools/PenTool.tsx` (new: pen drawing tool)
- `src/client/objects/StrokeObject.tsx` (new: stroke SVG renderer)
- `src/client/objects/registerStroke.ts` (new: registry entry)
- `tests/fixtures/pen-paths.ts` (new: test path fixtures)
- `tests/unit/stroke.test.ts` (new: TC-01 to TC-08)
- `tests/component/PenTool.test.tsx` (new: TC-09 to TC-14)
- `tests/component/StrokeObject.test.tsx` (new: TC-15, TC-16, TC-21)
- `tests/e2e/pen.spec.ts` (new: TC-17 to TC-20)

### Files modified
- `src/shared/config.ts` (PEN_*, STROKE_* constants)
- `src/shared/board-model.ts` (snapshot handles stroke, objectBounds, ObjectSnapshot.color → string)
- `src/client/objects/registry.tsx` (hitTest zoom param)
- `src/client/board/Toolbar.tsx` (Pen button)
- `src/client/pages/BoardContent.tsx` (PenTool integration, wheel forwarding)
