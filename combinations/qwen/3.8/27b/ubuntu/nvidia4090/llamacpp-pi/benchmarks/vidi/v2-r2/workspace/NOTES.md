# Story 10 — decisions and deviations

## Decisions

- **Object ids are strings (UUIDs)** — existing model convention (story 9+); the design
  sketch's `number` ids are not used anywhere.
- **Object IDs in the Y.Map `objects` are stored as written** — connector endpoint
  `objectId` values are the string object ids.
- **`inert` is implemented** on StickyNote and TextObject (pointer + double-click
  guards, `pointer-events: none` while inert). The board passes
  `inert={tool !== 'select'}`, which also realises the documented story-9 intent that
  the Text tool clicks create text *on top of* objects (a click lands on the viewport).
  Existing tests never click an object while the Text tool is active, so nothing
  regresses.
- **Registry `hitTest` gains a `zoom` parameter** (`(obj, worldPoint, zoom)`). Existing
  object specs ignore it; the connector spec uses it for the screen-px tolerance.
  Existing registry unit tests are updated mechanically (pass zoom = 1).
- **Connector geometry lives in `src/shared/geometry/connector-geometry.ts`** and the
  segment-distance helper in `src/shared/geometry/polyline.ts` (shared/ so it is
  unit-testable without a client; `distanceToPolyline` is written generically for
  future multi-segment paths, story 11 reuses it).
- **`ObjectSnapshot` gains optional fields** for shapes (`kind`, `fill`, `stroke`;
  label content also exposed through the generic `text` field) and connectors
  (`from`, `to` endpoint descriptors plus *derived* `fromPoint`/`toPoint` and the
  derived `x/y/width/height` bounding box). `snapshotAll` computes them; sticky/text
  snaps are unchanged.
- **Connector `x/y` are stored as 0** (as designed) and the snapshot derives the
  bounding box via `resolveEndpoints` + `connectorBBox`. `objectBounds` therefore
  returns the live bbox, so marquee containment and union rects work unchanged.
- **`moveObjects` and `resizeObjects` skip connector entries.** An arrow's geometry is
  fully defined by its endpoints: dragging the shapes it is attached to moves the
  arrow (the point of the story), and ends are repositioned with the Select-tool
  re-attach handles. A connector-only selection therefore has no resize handles
  (registry entry `resizable: false`) and dragging it is a no-op. This is documented
  here because the design does not specify arrow-move mechanics and no TC covers
  dragging a lone arrow.
- **`deleteObjects` calls `detachConnectorsTo` inside the same transaction** (before
  the removals), so each deletion is exactly one update and the detach anchor is
  computed from the object's last known rect. `detachConnectorsTo` must be called
  inside an open transaction (it writes into the caller's).
- **Undo wiring:** the tool layers receive `boundary()` (the tab's
  `undo.boundary`) and call it around `createShape` / `createConnector`; ConnectorObject
  reuses the `onTextBoundary` prop channel (semantically "close the undo capture
  window") for re-attach boundaries. Each of create / restyle / label / re-attach is
  one undo step.
- **`useActiveTool` (new, `src/client/tools/useActiveTool.ts`)** replaces `useTool`
  (deleted). It owns v/t/s/l + Escape (ignored while an editor/input has focus),
  the `shapeKind` state, `toolCreated(id)` (selects the id, reverts to Select) and
  the load-failed guard (non-Select tools force back to Select when `canEdit` is
  false). `'n'` stays a *command* in `useBoardKeys` (creates a sticky at the viewport
  centre) — it is listed in `TOOL_SHORTCUTS` per the contract but is not a
  switchable tool state, since the sticky note button is an action, not a tool.
  `useBoardKeys` loses its v/t handling (and the `setTool` parameter).
- **`ObjectProps` gains optional `camera?: Camera`** (and `zoom?: number`) so the
  ConnectorObject can convert pointer positions and size its screen-constant
  handles/hit-stroke; existing components ignore them.
- **Connector click selection:** lines are ~2 world units wide, far smaller than the
  6-screen-px tolerance. The viewport receives an `onEmptyPointerDown(point)` hook
  (Select tool only, non-shift): the Board hit-tests connectors top-down at the
  point and selects on the first hit, otherwise the event proceeds to pan/clear.
  The wide invisible hit-stroke on the line itself covers on-line presses; the hook
  covers the tolerance band around it.
- **Shape label editing** reuses story 9's `TextEditor` (IME, clamp, undo
  boundaries, outside-click end) with a new optional `ui.textAlign` knob (default
  `'left'`, so sticky/text rendering is unchanged); the *displayed* label is a
  separate centred block (flex-centred, `pre-wrap`, `break-word`) inside the shape.
- **`CLIENT_ID` moves to `src/client/client-id.ts`** (was a module constant in
  Board.tsx) so the tool layers can pass `by` to the model.
- **Connector tool fallbacks:** each attached endpoint's `fallback` is computed at
  creation from the live rects — `sideAnchor(rect, nearestSide(rect, otherRef))`
  where `otherRef` is the other endpoint's anchor (its resolved point, or the other
  object's centre when attached). The orphan-on-concurrent-delete path (TC-27)
  therefore renders at the same point the other client's detach computed.
- **TC-27 determinism:** Playwright route delays cannot intercept an already-
  established WebSocket's frames, so the test wraps `WebSocket.prototype.send`
  on Sam's page in a `setTimeout` (600 ms) — Sam's *outbound* frames are delayed
  while inbound sync is untouched. Dana's create therefore reaches the room
  before Sam's delete, and the final state converges to the arrow rendered at
  the stored fallback point whether the race detached it (free end) or left it
  attached to a now-missing ship (orphan → fallback). The assertion is on the
  *rendered* `toPoint` plus "connector visible on both screens, no console
  errors", in both interleavings.
- **E2E checkout-flow fixture** (`tests/fixtures/checkout-flow.ts`): four labelled
  shapes (rect/diamond/ellipse/rect) + three attached connectors + one free-ended
  connector, built with the real model calls from a `NodeWsClient` seeder
  (probe client confirms the room holds all 8 objects before the browsers join).
- **TC-25 side-switch expectations** follow `resolveEndpoints` exactly: an
  attached end re-resolves against `endpointRef(other)` — the other end's *live
  target centre* (not the other resolved point). After dragging ship above cart:
  cart end switches bottom→top `(-220,-140)`, ship end switches top→bottom
  `(100,-250)`.
- **E2E observation:** `BoardObjectState` (test hook) and the `ObjectState`
  participant helper gain optional shape/connector fields (`kind`, `fill`,
  `stroke`, `from`, `to`, `fromPoint`, `toPoint`); shape labels are readable via
  the existing `text` field.
- **Shape default-size rule lives in the model** (`createShape`): a null rect or a
  rect below `SHAPE_MIN_SIZE_WORLD` in either dimension yields the default
  160×160 centred on `at` (the click/drag origin). `square` (Shift) applies only
  to a valid rect: `max(w,h)` on both axes, anchored at the drag origin.
- **Toolbar:** the Shape button (S) opens an inline 3-button kind row
  (Rectangle selected by default) while the Shape tool is active; the Connector
  button (L) sits next to the Text button. Both show `aria-pressed` and are
  disabled on load-failed boards.

## Deviations from design.md (recorded per repo convention)

1. `ShapeTool` / `ConnectorTool` receive `doc`, `boundary()` and (connector)
   `snapshot` in props; the design contract shows only `kind`/`camera`/`onCreated`
   (and no doc for the connector tool), but creating objects requires the doc and
   one-undo-step creation requires the boundary hook.
2. `Endpoint.fallback` is supplied by the *caller* (the tool, from live rects);
   `createConnector` validates and stores it rather than recomputing it. The unit
   tests compute expected fallbacks with the same shared geometry functions.
3. `ObjectProps` gains optional `camera`/`zoom` (the design puts `zoom` on the
   ConnectorObject contract; the registry only passes `ObjectProps`).
4. `setShapeStyle` with zero changed fields returns `false` (no no-op writes, no
   undo step).
