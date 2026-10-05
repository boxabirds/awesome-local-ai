# Story 10 Progress

## Status: COMPLETE

### Tasks Completed:
- [x] Task 7: Named settings (SHAPE_KINDS, SHAPE_DEFAULT_SIZE_WORLD, etc.)
- [x] Task 8: Shape model (createShape, setShapeStyle, getShapeLabel)
- [x] Task 9: Connector geometry (sideAnchor, resolveEndpoints, connectorBBox)
- [x] Task 10: Polyline hit test (distanceToPolyline)
- [x] Task 11: Connector model (createConnector, setConnectorEndpoint, detachConnectorsTo)
- [x] Task 12: deleteObjects detach integration
- [x] Task 13: Active tool hook (useActiveTool, TOOL_SHORTCUTS)
- [x] Task 14: Component tests (TC-15 to TC-22, TC-28)
- [x] Task 15: E2E tests (TC-23 to TC-27)

### Test Results:
- Unit: 165/165 passing
- Component: 95/95 passing
- E2E: 45/45 passing
- Build: ✓
- Typecheck: ✓

### Key Files:
- `src/shared/config.ts` — named settings
- `src/shared/objects/shape.ts` — shape model
- `src/shared/objects/connector.ts` — connector model
- `src/shared/geometry/connector-geometry.ts` — anchor/side resolution
- `src/shared/geometry/polyline.ts` — hit test
- `src/shared/board-model.ts` — detach integration, snapshot extensions
- `src/client/tools/useActiveTool.ts` — tool state hook
- `src/client/tools/ShapeTool.tsx` — shape creation tool
- `src/client/tools/ConnectorTool.tsx` — connector creation tool
- `src/client/objects/ShapeObject.tsx` — shape rendering + label editing
- `src/client/objects/ShapeToolbar.tsx` — fill/stroke toolbar
- `src/client/objects/ConnectorObject.tsx` — arrow rendering + end handles
- `src/client/board/Toolbar.tsx` — Shape/Connector buttons
- `src/client/pages/BoardPage.tsx` — wiring
