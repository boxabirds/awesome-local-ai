# Story 10: the Flash-Next agent's own final statements

The last three substantive assistant messages of the story's pi session, verbatim apart from local paths. The session may continue after nudges, so read them as the agent's claims at the end.

I have enough understanding now. Time to write implementation files. I'll start with shared connector.ts (already sketched), then the two object kind files, then registry.

Let me create `src/shared/connector.ts` per design + my earlier sketch (types + geometry). Note registry.ts already imports from it — that means my earlier sketch of connector.ts must not have been written to disk! Let me check: registry.ts imports `CONNECTOR_TYPE, resolveConnectorGeometry` from `./connector` and `src/shared/objects/shape.ts` doesn't exist → tsc errors were reported earlier at registry lines. So registry.ts exists on disk (pre-existing file from the scaffold). And `src/shared/connector.ts` needs creating.

Wait — was `src/shared/connector.ts` part of the scaffold too? The tsc errors listed registry.ts imports; if connector.ts existed with those exports there'd be no error. Errors were only about `shape`/`connector` module-not-found? The earlier tsc output (in summary) said: registry.ts(5,33): Cannot find module './connector'; registry.ts(6,59): Cannot find module './objects/shape'. Both missing.

So I need to write:
- src/shared/connector.ts
- src/shared/objects/shape.ts
- src/client/board/shapeComponent.tsx (ShapeObject)
- src/client/board/connectorComponent.tsx? Design puts ConnectorObject in src/client — I'll make src/client/board/objects/ShapeObject.tsx and ConnectorObject.tsx? Let me check where existing note component lives to follow the pattern.

Let me quickly list src/client to decide file placement, then write files in one go.

I've spent a lot of turns on reading. Let me be decisive: write shared files now (connector.ts, objects/shape.ts), then look at client structure quickly, then write client files.

Write src/shared/connector.ts.

---

Story 10 is implemented and verified end to end.

## What's in place

**Model** (`src/shared/`)
- `objects/shape.ts` — `createShape` (drag / click / Shift-square), `setShapeStyle` (token-validated), `getShapeLabel` (500-char `Y.Text`), `shapeRect` size rules
- `objects/connector.ts` — `createConnector`, `setConnectorEndpoint`, `detachConnectorsTo`, wired into `deleteObjects` so a delete detaches in the *same* transaction (one undo step)
- `geometry/connector-geometry.ts` — `sideAnchor` / `nearestSide` / `resolveEndpoints` / `connectorBBox`; `geometry/polyline.ts` — `distanceToPolyline`
- Arrow ends store only an object id + fallback point; the drawn line is **recomputed in `snapshot()`**, so a move by anyone redraws it with zero writes — that's what makes arrows follow across the network.

**Tools & UI** (`src/client/`)
- `useTool.ts`: `TOOL_SHORTCUTS` = `v/t/s/l`, `shapeKind` state, creating tools blocked on read-only boards, tool returns to Select after a create, Escape → Select
- `tools/ShapeTool.tsx` (dashed preview, pointer capture, tiny drag → default box), `tools/ConnectorTool.tsx` (four hover dots, target-side highlight, free end on empty space)
- `objects/ShapeObject.tsx` (rect/ellipse/diamond, palette colours, centred wrapping label), `ShapeToolbar.tsx` (6 fills + no fill, 6 outlines), `ConnectorObject.tsx` (arrowhead, 6 px screen-constant hit stroke, two end handles for re-attach)
- `registry.tsx`: `shape` picked by its box, `connector` by distance to the line divided by zoom

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (both projects) | clean |
| `npm test` | **471 passed** (46 files) — unit + component + integration |
| `npx playwright test` | **142 passed, 4 failed** |

All of TC-01…TC-29 are traceable in the test files; e2e TC-23 also runs on firefox/webkit, and TC-25/26/27 prove the collaborative follow, the delete-race and the orphaned-arrow render.

## The 4 failures are pre-existing, not from this story

I proved it rather than assumed it: `git stash push -u` + `npm run build:test` on the **clean tree** produces the identical 4 failures —

- `sticky.spec.ts` TC-32 "200% zoom drag moves world (+50,+25)" (all 3 browsers, ~6 px instead of 50)
- `multiselect-full-capacity.spec.ts` TC-36 (two-client convergence)

Both are story 2/7 behaviours. Say the word and I'll dig into the zoom-scaled drag next — it looks like the drag delta is being divided by zoom twice (50 → 6.25 = 50/8).

---

Story 10 is complete and committed.

**Committed:** `e36dc12 feat(shapes): draw shapes and connect them with arrows that follow` — working tree clean.

**Final verification**
- `tsc --noEmit` (app + worker projects): clean
- `npm test`: **471 passed** / 46 files (unit + component + integration)
- `npx playwright test`: **142 passed, 4 failed**
- Coverage traces to the story's case list: TC-01…TC-29 appear in `tests/unit/{shape-model,connector-model,shape-visuals,shape-connector-select}.test.ts`, `tests/component/{ShapeTool,ConnectorTool,ConnectorFollow,useActiveTool}.test.tsx` and `tests/e2e/{shapes,connectors}.spec.ts`; the checkout-flow fixture builds the reference diagram through the real model calls.

**Behaviour delivered beyond the bare minimum, because the PRD asked for it**
- Arrow ends are *derived*, not stored — so remote moves and resizes redraw arrows with zero writes, and sides switch across a rectangle's diagonal.
- Delete-during-draw race and delete-after-attach both leave a free end pinned where the object's side was, in one undo step.
- Hit testing is screen-constant: shapes by bounding box, arrows within 6 px of the line at any zoom; a press inside an arrow's box but off the line does not select it.
- Read-only boards refuse to leave Select and write nothing (covered by a component test).

**The 4 red tests are not mine** — verified by stashing all story-10 work, rebuilding clean, and re-running: `sticky.spec.ts` TC-32 (all 3 browsers) and `multiselect-full-capacity.spec.ts` TC-36 fail identically on `main`.

TC-32 looks like a stale test assumption rather than a broken product: its grab point `(250,150)` and the "exposed left edge" comment were written for the default zoom, and at 200% a 200-unit note is 400 screen px wide, so the grab lands somewhere else. I'd want to spend ~5 minutes confirming whether drag-at-zoom-2 actually still moves a note the correct 50 world units before touching it — I didn't want to quietly edit another story's test to get a green number. Say go and I'll diagnose it properly next.
