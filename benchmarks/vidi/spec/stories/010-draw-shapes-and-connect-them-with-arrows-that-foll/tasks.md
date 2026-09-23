# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 7 | Write shape model unit tests first (TC-01 to TC-06) | proposed | test:unit | shape.model |
| 8 | Implement shape model: create by drag/click/Shift, style validation, label Y.Text | proposed | implementation | shape.model |
| 9 | Write connector model and geometry unit tests first (TC-07 to TC-14, TC-29) | proposed | test:unit | connector.model |
| 10 | Implement connector model, geometry and detach-on-delete in board-model | proposed | implementation | connector.model |
| 11 | Implement active tool hook with shortcuts and return-to-Select | proposed | implementation | tools.active_tool |
| 12 | Implement Shape tool, ShapeObject with centred label, and ShapeToolbar | proposed | implementation | shape.ui |
| 13 | Implement Connector tool with hover dots, ConnectorObject with arrowhead and re-attach handles | proposed | implementation | connector.ui |
| 14 | Component tests for shape tool/object/toolbar, connector tool/object and active tool (TC-15 to TC-22, TC-28) | proposed | test:ui-component | shape.ui, connector.ui, tools.active_tool |
| 15 | E2E: draw a flow, collaborative rearrange, delete race (TC-23 to TC-27) | proposed | test:e2e | shape.ui, connector.ui |

## Details

### 7. Write shape model unit tests first (TC-01 to TC-06)

## Goal
Test-first suite for the shape.model contract (`createShape`, `setShapeStyle`, `getShapeLabel`) against a real Y.Doc; add story 10 named settings (SHAPE_KINDS, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_STROKE_WIDTH_WORLD) and stub exports.

## Cases (each asserts `update` event count)
- TC-01 createShape rect 200x120 → 1 object, width 200, height 120, fill DEFAULT_SHAPE_FILL, stroke DEFAULT_SHAPE_STROKE, empty label Y.Text, z = maxZ+1, createdBy set.
- TC-02 rect 19x200 and rect null → SHAPE_DEFAULT_SIZE_WORLD square centred at `at` (click behaviour).
- TC-03 rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary).
- TC-04 `square: true` on 200x120 → 200x200 anchored at drag origin.
- TC-05 setShapeStyle fill 'blue' → applied, 1 update, label/size unchanged; fill 'teal' → false, 0 updates (negative).
- TC-06 kind 'triangle' and non-finite rect → null, 0 updates (error path).

## Done when
Suite compiles and fails only with "not implemented"; committed.

### 8. Implement shape model: create by drag/click/Shift, style validation, label Y.Text

## Goal
Implement shape.model per contract so the shape unit tests pass.

## Approach
- Schema: common fields + `kind`, `fill`, `stroke`, `label: Y.Text`; `ShapeSnap` added to `snapshot()` output.
- `createShape`: validate kind and finiteness first (null, no transaction); rect null or below SHAPE_MIN_SIZE_WORLD in either dimension → SHAPE_DEFAULT_SIZE_WORLD centred at `at` (click); `square` → both sides = larger dimension anchored at the drag origin; z = maxZ + 1; one LOCAL_ORIGIN transaction.
- `setShapeStyle`: validate names against SHAPE_FILL_COLORS / SHAPE_STROKE_COLORS; stale id or unknown colour → false without a transaction; only colour keys touched.
- `getShapeLabel` returns the Y.Text for story 2's text editor with SHAPE_LABEL_MAX_CHARS.

## Done when
TC-01..TC-06 pass; typecheck passes.

### 9. Write connector model and geometry unit tests first (TC-07 to TC-14, TC-29)

## Goal
Test-first suite for connector.model (`createConnector`, `setConnectorEndpoint`, `detachConnectorsTo`, `sideAnchor`, `nearestSide`, `resolveEndpoints`, `connectorBBox`, `distanceToPolyline`) on a real Y.Doc; add CONNECTOR_* settings and stubs.

## Cases
- TC-07 attached A→B 300 apart → stored endpoints with fallbacks = side anchors; 1 update.
- TC-08 A→A → null, 0 updates (negative).
- TC-09 free→free length 7.9 → null; 8 (CONNECTOR_MIN_LENGTH_WORLD) → created (boundary).
- TC-10 nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top (diagonal switch).
- TC-11 resolveEndpoints with B missing from rects → end at fallback, no throw (orphaned, error path).
- TC-12 setConnectorEndpoint to free → updated; to attached C → updated; to the object at the opposite end → false, 0 updates (negative).
- TC-13 deleteObjects([A]) with a connector attached to A → A removed and the connector's `from` becomes free at A's current anchor in exactly one update.
- TC-14 distanceToPolyline at 0, 5.99, 6.01 units from a segment → exact distances.
- TC-29 setConnectorEndpoint on a deleted connector id → false (stale id).

## Done when
Suite compiles and fails only with "not implemented".

### 10. Implement connector model, geometry and detach-on-delete in board-model

## Goal
Implement connector.model per contract.

## Approach
- Schema: `from`, `to` Endpoint (`attached` with `objectId` + `fallback`, or `free` x/y); x/y/width/height stored 0 and derived in `snapshot()` via `connectorBBox(resolveEndpoints(...))`.
- `createConnector`: reject same-object and length < CONNECTOR_MIN_LENGTH_WORLD before writing; fallback = `sideAnchor(rect, nearestSide(rect, otherEnd))`.
- `nearestSide`: compare direction vector with the rect's diagonals; `sideAnchor` = side midpoint (on the boundary of rect, ellipse and diamond).
- `resolveEndpoints`: recompute sides from current rects each call; missing target → fallback. No writes, so remote moves redraw automatically.
- `setConnectorEndpoint`: stale id, non-finite point or attaching to the opposite end's object → false.
- `detachConnectorsTo(doc, ids)`: inside caller's transaction convert attached ends on deleted ids to free at the current anchor.
- Modify story 7's `deleteObjects` to call `detachConnectorsTo` inside its LOCAL_ORIGIN transaction (one update, one undo step).
- `distanceToPolyline` in `polyline.ts` (shared with story 11).

## Done when
TC-07..TC-14 and TC-29 pass.

### 11. Implement active tool hook with shortcuts and return-to-Select

## Goal
Implement tools.active_tool per contract (create `useActiveTool` if no earlier story added it; otherwise extend it).

## Approach
- `ToolId` union and `TOOL_SHORTCUTS` (v select, n sticky, t text, s shape, l connector, p pen, i image, c comment) from the cross-story convention.
- Window keydown maps single letters to tools, ignored when focus is in a textarea/input/contenteditable.
- `shapeKind` state with `setShapeKind` for the Shape menu.
- `toolCreated(id)` selects the new id via `useSelection` and sets tool to `select` (return to Select after creating).
- Escape while Shape or Connector is active sets `select` without creating anything.
- Toolbar: Shape button with kind menu (Rectangle/Ellipse/Diamond) and Connector button showing active state (`aria-pressed`).

## Done when
TC-22 passes.

### 12. Implement Shape tool, ShapeObject with centred label, and ShapeToolbar

## Goal
Implement shape.ui per contract.

## Approach
- `ShapeTool`: captures the pointer (so drags over existing objects don't move them), draws a dashed screen-space preview, reads Shift on each move, converts to world with `screenToWorld`, calls `createShape` once on pointerup (rect null for clicks/tiny drags), then `undoManager.stopCapturing()` and `onCreated(id)` → select + switch to Select. pointercancel creates nothing.
- `ShapeObject`: SVG `rect` / `ellipse` / diamond `polygon` with fill/stroke colours and SHAPE_STROKE_WIDTH_WORLD; label in a `foreignObject` sized to width/height using story 2's text editor (dblclick starts editing, SHAPE_LABEL_MAX_CHARS clamp, centred wrapping, re-wraps on resize).
- `ShapeToolbar`: `button[aria-label="<colour> fill"]` and `"<colour> outline"` swatches → `setShapeStyle`, selection kept.
- Registry: `shape` → `{ Component: ShapeObject, resizable: true, aspectLocked: false, minSize: SHAPE_MIN_SIZE_WORLD, editableText: true, hitTest: bbox }`.

## Done when
TC-15..TC-17, TC-28 and e2e TC-23, TC-24 pass.

### 13. Implement Connector tool with hover dots, ConnectorObject with arrowhead and re-attach handles

## Goal
Implement connector.ui per contract.

## Approach
- `ConnectorTool`: hover hit-tests the snapshot and shows four CONNECTOR_DOT_RADIUS_PX dots at side midpoints; on drag highlights the target's `nearestSide` dot; on release over another object → `createConnector` attached, over empty space → free end; rejected (same object or too short) → nothing created, tool stays; pointercancel creates nothing; success → `stopCapturing()`, `onCreated` selects the arrow and returns to Select.
- `ConnectorObject`: SVG line with arrowhead marker (CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_STROKE_WIDTH_WORLD) using `resolveEndpoints` on every snapshot, so moves/resizes by anyone redraw it and orphaned/detached ends render at stored points; when selected shows two end handles; handle release over an object → `setConnectorEndpoint` attached, over empty space → free, over the opposite end's object → snap back.
- Registry: `connector` → `{ resizable: false, aspectLocked: false, editableText: false, hitTest: distanceToPolyline(ends, p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom }`.

## Done when
TC-18..TC-21 and e2e TC-25..TC-27 pass.

### 14. Component tests for shape tool/object/toolbar, connector tool/object and active tool (TC-15 to TC-22, TC-28)

## Goal
jsdom tests with a real Y.Doc covering the ui-component cases for shape.ui (ShapeTool, ShapeObject label, ShapeToolbar), connector.ui (ConnectorTool hover/creation, ConnectorObject hit test and handles) and tools.active_tool (shortcuts, return to Select, Escape).

## Cases
- TC-15 S tool pointerdown/move/up → preview shown, `createShape` called once, selection = new id.
- TC-16 dblclick shape, type 600 chars → editor open, label length SHAPE_LABEL_MAX_CHARS (boundary).
- TC-17 click blue fill and red outline swatches → colours applied; label and selection unchanged.
- TC-18 L tool hover over shape → four dots at side midpoints.
- TC-19 drag from A over B → B's nearest dot highlighted; release → attached connector created.
- TC-20 click 5 px and 7 px (screen) from an arrow at 50% and 200% zoom → selected / not selected (boundary, negative).
- TC-21 drag end handle onto C → attached to C; onto empty space → free at release point.
- TC-22 S then create, L then create → Select active; S then Escape, L then Escape → Select active and nothing created (negative).
- TC-28 Shape tool drag starting over an existing sticky → sticky position unchanged (negative).

## Done when
All pass in `npm run test:component`.

### 15. E2E: draw a flow, collaborative rearrange, delete race (TC-23 to TC-27)

## Goal
Real-browser proof for shape.ui (ShapeTool geometry, label wrap on resize) and connector.ui (ConnectorObject follows remote moves, detached ends after deletes, orphaned render) against `wrangler dev`.

## Workflows
- "Draw a flow": TC-23 real drag (100,100)→(300,220) at 100% → shape 200x120 at that position ±1px; TC-24 at 200% zoom Diamond click → 160x160 centred, label longer than width wraps and stays centred after resizing via handle.
- "Collaborative rearrange": TC-25 Dana connects A→B and drags B past A; Sam's context sees the arrow attached and switching side within LIVE_UPDATE_LATENCY_BUDGET_MS; TC-26 Sam deletes B → arrow remains with free end where B's side was on both screens.
- "Delete race": TC-27 Dana drags an arrow to B while Sam deletes B (Playwright route delay on Sam's WebSocket traffic to force overlap) → Dana's arrow visible with end at fallback, no console errors.

## Fixtures
`tests/fixtures/checkout-flow.ts`: 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached connectors, 1 free-ended connector built with real model calls.

## Done when
All pass in chromium; TC-23 also in firefox and webkit.

