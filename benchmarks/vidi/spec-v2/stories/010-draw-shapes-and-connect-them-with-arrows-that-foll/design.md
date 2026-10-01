# Technical Design

Adds shape and connector object types to the Yjs board model with pure geometry for side anchors, nearest-side selection and line hit-testing. ShapeObject and ConnectorObject register in the story 7 object registry; Shape and Connector tools (with an active-tool hook shared by stories 9-12) create them. Connector endpoints resolve at render time from live object rectangles, so moves by anyone redraw arrows; deletions detach ends inside the same transaction.

## Overview

## Context
Builds on story 1 (`camera.ts`, `BoardViewport`), story 2 (`src/shared/board-model.ts`, Y.Doc `objects`, `StickyText` editor), story 3 (live sync — no server change needed here), and the cross-story conventions for story 7 (object registry, `Set` selection, generic `moveObjects/resizeObject/deleteObjects`) and story 8 (every local mutation is a `LOCAL_ORIGIN` transaction; gesture end calls `undoManager.stopCapturing()`).

## Files
| Path | Change | Purpose |
|---|---|---|
| `src/shared/objects/shape.ts` | added | shape schema, `createShape`, `setShapeStyle`, `getShapeLabel` |
| `src/shared/objects/connector.ts` | added | connector schema, `createConnector`, `setConnectorEndpoint`, `detachConnectorsTo` |
| `src/shared/geometry/connector-geometry.ts` | added | `sideAnchor`, `nearestSide`, `resolveEndpoints`, `connectorBBox` |
| `src/shared/geometry/polyline.ts` | added | `distanceToPolyline` (reused by story 11) |
| `src/shared/board-model.ts` | modified | story 7's `deleteObjects` calls `detachConnectorsTo(doc, ids)` inside its transaction; `snapshot` derives connector bbox |
| `src/shared/config.ts` | modified | settings below |
| `src/client/tools/useActiveTool.ts` | added if absent, else extended | active tool id, shortcuts (S, L, V, Escape), return-to-select |
| `src/client/tools/ShapeTool.tsx` | added | drag/click creation with preview |
| `src/client/tools/ConnectorTool.tsx` | added | hover dots, drag preview, creation |
| `src/client/objects/ShapeObject.tsx` | added | SVG shape + centred wrapping label |
| `src/client/objects/ShapeToolbar.tsx` | added | fill and outline swatches |
| `src/client/objects/ConnectorObject.tsx` | added | SVG line, arrowhead, end handles for re-attach |
| `src/client/objects/registry.tsx` | modified | register `shape` and `connector` |
| `src/client/board/Toolbar.tsx` | modified | Shape button with kind menu, Connector button |

## Named settings added
```ts
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
export const SHAPE_STROKE_WIDTH_WORLD = 2;
export const SHAPE_FILL_COLORS = { none: 'transparent', white: '#FFFFFF', blue: '#BBDEFB', green: '#C8E6C9', yellow: '#FFF9C4', pink: '#F8BBD0', grey: '#E0E0E0' } as const;
export const SHAPE_STROKE_COLORS = { dark: '#263238', blue: '#1E88E5', green: '#43A047', orange: '#FB8C00', red: '#E53935', grey: '#9E9E9E' } as const;
export const DEFAULT_SHAPE_FILL = 'white';
export const DEFAULT_SHAPE_STROKE = 'dark';
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;
```

## Schema additions (additive; `meta.schemaVersion` stays 1)
```
shape:     common fields + kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
connector: common fields (x, y, width, height stored as 0, derived in snapshot)
           + from: Endpoint, to: Endpoint
Endpoint = { kind: 'attached', objectId: string, fallback: { x, y } }
         | { kind: 'free', x: number, y: number }
```
Decision: attached endpoints store no side. The side is recomputed from current rectangles every render (`nearestSide`), which is what makes arrows switch sides as objects move and follow remote moves without writes. `fallback` is the anchor point at attach time, used only if the target vanished concurrently (connector.target_deleted race).

## Structure diagram
```mermaid
flowchart TD
    Toolbar[Toolbar S and L buttons] --> Active[useActiveTool]
    Active --> STool[ShapeTool]
    Active --> CTool[ConnectorTool]
    STool --> ShapeM[objects shape.ts]
    CTool --> ConnM[objects connector.ts]
    CTool --> Geo[connector-geometry]
    ShapeM --> Doc[Y.Doc objects]
    ConnM --> Doc
    Model[board-model deleteObjects story 7] --> ConnM
    Doc --> Snap[snapshot]
    Snap --> Registry[objects registry]
    Registry --> ShapeC[ShapeObject and ShapeToolbar]
    Registry --> ConnC[ConnectorObject]
    ConnC --> Geo
    Geo --> Poly[polyline distance]
```

## State diagrams
Connector endpoint (persisted in the doc):
```mermaid
stateDiagram-v2
    [*] --> Attached : created released over object
    [*] --> Free : created released over empty space
    Attached --> Attached : target moved or resized side recomputed no write
    Attached --> Free : handle dragged to empty space
    Free --> Attached : handle dragged onto object
    Attached --> Attached : handle dragged onto another object
    Attached --> Free : target deleted detach at current anchor
    Attached --> Orphaned : target missing after concurrent delete
    Orphaned --> Free : next local write normalises to fallback point
```
Orphaned is a render-time condition (target id absent from snapshot) drawn at `fallback`.

Connector tool gesture (local, not persisted):
```mermaid
stateDiagram-v2
    [*] --> Hovering
    Hovering --> Hovering : pointer over object show side dots
    Hovering --> Dragging : pointerdown
    Dragging --> Dragging : pointermove highlight target dot
    Dragging --> Hovering : pointerup rejected same object or too short
    Dragging --> [*] : pointerup created switch to Select
    Hovering --> [*] : Escape switch to Select
    Dragging --> Hovering : pointercancel nothing created
```

Shape tool gesture (local):
```mermaid
stateDiagram-v2
    [*] --> Ready
    Ready --> Sizing : pointerdown
    Sizing --> Sizing : pointermove preview Shift squares
    Sizing --> [*] : pointerup create and switch to Select
    Sizing --> Ready : pointercancel nothing created
    Ready --> [*] : Escape switch to Select
```

## Sequence: create shape
```mermaid
sequenceDiagram
    participant U as User
    participant T as ShapeTool
    participant M as shape.ts
    participant D as Y.Doc
    participant A as useActiveTool
    U->>T: pointerdown at p0
    U->>T: pointermove preview rect Shift squares
    U->>T: pointerup at p1
    T->>T: screenToWorld rect
    alt rect width or height below SHAPE_MIN_SIZE_WORLD
        T->>M: createShape rect null at p0 default size
    else
        T->>M: createShape rect
    end
    alt unknown kind
        M-->>T: null nothing created
    else created
        M->>D: LOCAL_ORIGIN transaction
        T->>A: select id switch to Select stopCapturing
    end
```

## Sequence: create connector
```mermaid
sequenceDiagram
    participant U as User
    participant T as ConnectorTool
    participant G as geometry
    participant M as connector.ts
    participant A as useActiveTool
    U->>T: pointerdown on object A or empty space
    loop pointermove
        T->>G: hit test target and nearestSide
        T-->>U: highlight target dot
    end
    U->>T: pointerup
    alt target is start object or length below CONNECTOR_MIN_LENGTH_WORLD
        T-->>U: nothing created tool stays Connector
    else target object B
        T->>M: createConnector attached A attached B with fallbacks
    else empty space
        T->>M: createConnector to free point
    end
    alt B was deleted concurrently
        M-->>T: created attached rendered at fallback
    else created
        T->>A: select arrow switch to Select
    end
```

## Sequence: object moved or resized by anyone
```mermaid
sequenceDiagram
    participant R as Local or remote change
    participant D as Y.Doc
    participant S as snapshot
    participant C as ConnectorObject
    participant G as geometry
    R->>D: x y width height changed on A
    D-->>S: observeDeep recompute rects
    S-->>C: new rects map
    C->>G: resolveEndpoints
    alt A present
        G-->>C: nearest side anchors
    else A missing
        G-->>C: fallback point
    end
    C-->>R: redraw line and arrowhead
```

## Sequence: re-attach an end handle
```mermaid
sequenceDiagram
    participant U as User
    participant C as ConnectorObject
    participant M as connector.ts
    U->>C: drag end handle of selected arrow
    U->>C: release
    alt over object other than the opposite end object
        C->>M: setConnectorEndpoint to attached
    else over empty space
        C->>M: setConnectorEndpoint to free
    else over the object at the other end
        C-->>U: rejected handle snaps back
    end
    alt connector deleted meanwhile
        M-->>C: false interaction ends
    end
```

## Sequence: delete connected object
```mermaid
sequenceDiagram
    participant U as User
    participant B as board-model deleteObjects
    participant M as connector.ts
    participant D as Y.Doc
    U->>B: delete ids
    B->>D: begin LOCAL_ORIGIN transaction
    B->>M: detachConnectorsTo ids
    loop each connector attached to a deleted id
        M->>D: endpoint to free at current anchor
    end
    B->>D: remove objects
    alt id already gone
        B-->>U: skipped no error
    end
    D-->>U: one update one undo step
```

## Test Strategy

## Test scopes and boundaries
| Capability | Levels | Boundary exercised | Why sufficient |
|---|---|---|---|
| shape.model | unit | pure model on a real Y.Doc | creation sizing, clamping and style validation are deterministic |
| connector.model | unit | pure model and geometry on a real Y.Doc | endpoint rules, side choice, detach and hit distance are deterministic |
| shape.ui | ui-component, e2e | jsdom components; real browser | gestures and label editing need events; exact geometry needs real layout |
| connector.ui | ui-component, e2e | jsdom; real browser with two contexts | hover dots and handles are DOM; follow-on-remote-move needs the real sync path |
| tools.active_tool | ui-component | hook + toolbar in jsdom | shortcut and return-to-select logic is pure UI state |

No server code changes, so no integration tests; sync correctness is proven in story 3 and exercised here only in e2e.

Timing policy: e2e tests wait up to E2E_EVENTUAL_TIMEOUT_MS (story 3) for remote changes to appear and log the measured delivery time against LIVE_UPDATE_LATENCY_BUDGET_MS; the budget is reported, not asserted, because the model, browsers and server share one machine.

## Dimensions crossed
- **D1 Operation**: create shape (drag, click, Shift), label, style, create connector, re-attach, follow, delete target, select arrow.
- **D2 Endpoint kind**: attached, free, orphaned (target missing).
- **D3 Zoom**: 100%, 50%, 200% (geometry-dependent cases).
- **D4 Actor**: local user, remote user.

D2 classes are exhaustive and non-overlapping for a given endpoint.

## Coverage table
| TC | Capability | D1 | D2 | D3 | D4 | Action | Expected before → after | Level |
|---|---|---|---|---|---|---|---|---|
| TC-01 | shape.model | create drag | not applicable: shapes have no endpoints | not applicable: world units | local | createShape rect 200x120 | objects 0→1; width 200 height 120; fill white stroke dark; label '' | unit |
| TC-02 | shape.model | create click | not applicable: no endpoints | not applicable: world units | local | rect 19x200; rect null | default 160x160 centred at point for both | unit |
| TC-03 | shape.model | create drag boundary | not applicable: no endpoints | not applicable: world units | local | rect exactly 20x20 | kept 20x20 | unit |
| TC-04 | shape.model | create Shift | not applicable: no endpoints | not applicable: world units | local | rect 200x120 square true | 200x200 | unit |
| TC-05 | shape.model | style | not applicable: no endpoints | not applicable: world units | local | setShapeStyle fill blue; fill 'teal' | blue applied one update; teal false zero updates | unit |
| TC-06 | shape.model | create | not applicable: no endpoints | not applicable: world units | local | kind 'triangle'; non-finite rect | null; zero updates | unit |
| TC-07 | connector.model | create connector | attached to attached | not applicable: world units | local | A and B 300 apart | from A to B stored with fallbacks; one update | unit |
| TC-08 | connector.model | create connector | attached to same object | not applicable: world units | local | createConnector A to A | null zero updates | unit |
| TC-09 | connector.model | create connector | free to free | not applicable: world units | local | length 7.9; length 8 | null; created | unit |
| TC-10 | connector.model | follow | attached | not applicable: world units | local | nearestSide as B orbits A at 0, 44, 46, 90 degrees | right, right, top, top switch at diagonal | unit |
| TC-11 | connector.model | follow | orphaned | not applicable: world units | remote | resolveEndpoints with B absent | end at fallback; no throw | unit |
| TC-12 | connector.model | re-attach | attached to free | not applicable: world units | local | setConnectorEndpoint to free; to attached; to opposite end's object | updated; updated; false zero updates | unit |
| TC-13 | connector.model | delete target | attached | not applicable: world units | local | deleteObjects [A] | connector from becomes free at A's anchor; A removed; exactly one update | unit |
| TC-14 | connector.model | select arrow | free | not applicable: world units | local | distanceToPolyline at 0, 5.99, 6.01 units | 0, 5.99, 6.01 | unit |
| TC-15 | shape.ui | create drag | not applicable: no endpoints | 100% | local | S tool pointerdown/move/up | preview then createShape called once; selection = new id | ui-component |
| TC-16 | shape.ui | label | not applicable: no endpoints | 100% | local | dblclick, type 600 chars | editor open; label length 500 | ui-component |
| TC-17 | shape.ui | style | not applicable: no endpoints | 100% | local | click blue fill and red outline swatches | fill blue stroke red; label and selection unchanged | ui-component |
| TC-18 | connector.ui | create connector | attached | 100% | local | hover shape with L tool | four dots at side midpoints | ui-component |
| TC-19 | connector.ui | create connector | attached | 100% | local | drag from A over B | B's nearest dot highlighted; release creates attached arrow | ui-component |
| TC-20 | connector.ui | select arrow | free | 50% and 200% | local | click 5 px and 7 px from line (screen) | selected; not selected at both zooms | ui-component |
| TC-21 | connector.ui | re-attach | attached | 100% | local | drag selected arrow end handle onto C; onto empty space | end attached to C; end free at release point | ui-component |
| TC-22 | tools.active_tool | create | not applicable: tool state | not applicable: tool state | local | S then create; L then create; S then Escape; L then Escape | Select active after each; Escape creates nothing | ui-component |
| TC-23 | shape.ui | create drag | not applicable: no endpoints | 100% | local | real drag (100,100)→(300,220) | shape 200x120 at that position ±1px | e2e |
| TC-24 | shape.ui | create click and label | not applicable: no endpoints | 200% | local | Diamond click, type label longer than width, resize via handle | 160x160 centred; label wraps and stays centred after resize | e2e |
| TC-25 | connector.ui | follow | attached | 100% | remote | Dana connects A to B, drags B past A; Sam's context | arrow stays attached and switches side on both screens; delivery time to Sam logged against LIVE_UPDATE_LATENCY_BUDGET_MS (not asserted) | e2e |
| TC-26 | connector.ui | delete target | attached | 100% | remote | Sam deletes B | arrow remains, end free where B's side was, on both screens | e2e |
| TC-27 | connector.ui | create connector | orphaned | 100% | remote | Dana drags arrow to B while Sam deletes B (route delay to force overlap) | Dana's arrow visible with end at fallback; no console errors | e2e |

## Boundary values
- Shape min size: 19 / 20 units (TC-02, TC-03).
- Label: 500 / 600 characters (TC-16).
- Connector min length: 7.9 / 8 units (TC-09).
- Hit tolerance: 5 / 7 px on screen at two zoom levels (TC-14, TC-20).
- Side switch at the 45° diagonal (TC-10).

## Negative scenarios
| TC | Must not happen | Level |
|---|---|---|
| TC-05, TC-06 | invalid colour or kind must not write | unit |
| TC-08 | self-connection must not be created | unit |
| TC-12 | end must not attach to the object at the other end | unit |
| TC-20 | far click must not select an arrow | ui-component |
| TC-22 | Escape must not create anything | ui-component |
| TC-28 | dragging from an object with the Shape tool must not move that object (tool owns the gesture) | ui-component |

## Error paths
| Contract error | TC |
|---|---|
| unknown kind / non-finite rect | TC-06 |
| unknown colour | TC-05 |
| self or too-short connector | TC-08, TC-09 |
| endpoint to opposite object / stale connector id | TC-12, TC-29: setConnectorEndpoint on deleted connector returns false (unit) |
| missing target at render | TC-11, TC-27 |

## Mock vs real boundaries
| Dependency | Mocked? | Reason |
|---|---|---|
| Y.Doc | real in all levels | the store under test; deterministic in-process |
| Story 7 registry/selection | real modules | shapes must behave like other objects |
| Sync server | real `wrangler dev` in e2e | proves remote follow and delete |
| Timing of concurrent delete | Playwright route delay on Sam's socket traffic | only way to force the race deterministically |

## E2E workflows
1. **Draw a flow** (TC-23 → TC-24): shapes by drag and click, labels wrap.
2. **Collaborative rearrange** (TC-25 → TC-26): arrows follow remote moves and survive deletes.
3. **Delete race** (TC-27): orphaned arrow renders safely.

## Fixtures
Checkout-flow board built with real model calls: 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached connectors, 1 free-ended connector.

## Not covered
Deliberately not covered by automated tests:
- Story 7 resize handle internals (tested in story 7).
- Screen-reader announcement wording.
- Wall-clock delivery time as a pass/fail criterion: on a shared machine it is logged (TC-25), not asserted.

## Shape model

> Anchor: `shape.model`

## Contract
```ts
// src/shared/objects/shape.ts
export type ShapeKind = typeof SHAPE_KINDS[number];
export interface ShapeSnap extends ObjectSnap { type: 'shape'; kind: ShapeKind; fill: FillColor; stroke: StrokeColor; label: string }
export function createShape(doc: Y.Doc, a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean }, by: string): string | null;
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean;
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined;
```
- **Inputs**: world-space rect (or null for a click), click point, Shift flag, identity id.
- **Outputs**: new id; `ShapeSnap` in `snapshot()`.
- **Errors**: unknown kind, non-finite rect/point → null; unknown colour or stale id → false. No transaction on error.
- **Side effects**: one `LOCAL_ORIGIN` transaction per success.

## Implementation
- **Draw by dragging (shape.create_drag):** with the Shape tool active, the drag's start and end screen points are converted with `screenToWorld` and `createShape` creates a shape of the chosen kind (rectangle, ellipse or diamond) exactly covering that world rectangle. At 100% zoom, dragging from (100,100) to (300,220) screen pixels creates a 200 × 120 board-unit shape at that position. The new shape is then selected (tools.return_to_select).
- **Drop a standard shape by clicking (shape.create_click):** a click without dragging (rect null), or a drag smaller than SHAPE_MIN_SIZE_WORLD (20 board units) in either direction, creates a standard SHAPE_DEFAULT_SIZE_WORLD shape (160 × 160 board units) centred on the click point. A drag of exactly 20 × 20 is kept as drawn.
- **Constrain with Shift (shape.constrain):** while Shift is held during the drag (`square: true`), width and height are both set to the larger of the two dragged dimensions, anchored at the drag origin (e.g. 200 × 120 becomes 200 × 200); the preview shows the same.
- Label is a `Y.Text` (shape.label, shape.ui); `setShapeStyle` validates colours against the palettes (shape.style, shape.ui).
- z = maxZ + 1, `createdBy` = identity id, `createdAt` epoch ms.

## Tests
unit: TC-01 to TC-06 in `tests/unit/shape-model.test.ts`. e2e: TC-23, TC-24.

## Connector model and geometry

> Anchor: `connector.model`

## Contract
```ts
// src/shared/objects/connector.ts
export type Endpoint = { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null;
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean;
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void; // call inside an open transaction
// src/shared/geometry/connector-geometry.ts
export type Side = 'top' | 'right' | 'bottom' | 'left';
export function sideAnchor(r: Rect, s: Side): Point;
export function nearestSide(r: Rect, toward: Point): Side;
export function resolveEndpoints(c: ConnectorSnap, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point };
export function connectorBBox(from: Point, to: Point): Rect;
// src/shared/geometry/polyline.ts
export function distanceToPolyline(pts: readonly Point[], p: Point): number;
```
- **Errors**: `createConnector` returns null when both ends attach to the same object or resolved length < `CONNECTOR_MIN_LENGTH_WORLD`; `setConnectorEndpoint` returns false for stale id, attaching to the object at the opposite end, or non-finite points.
- **Side effects**: one `LOCAL_ORIGIN` transaction per success; `detachConnectorsTo` writes inside the caller's transaction.

## Implementation
- **Connect two objects (connector.create_attached):** when a Connector drag starts on board object A and is released over a different board object B, `createConnector` stores both ends as `attached` (A and B). Each end is drawn at the midpoint of the side of its object nearest the other end (`nearestSide` + `sideAnchor`); that anchor is also stored as `fallback`.
- **Arrow to empty space (connector.create_free):** releasing over empty board space stores that end as `free` at the release board point; a drag that starts on empty space stores the start as `free` at that board point.
- **No accidental arrows (connector.no_accidental):** before any write, `createConnector` returns null (nothing created) if the drag ends on the same object it started on, or if the pointer moved less than CONNECTOR_MIN_LENGTH_WORLD (8 board units).
- **Deleting a connected object keeps arrows (connector.target_deleted):** story 7's `deleteObjects` calls `detachConnectorsTo` in the same transaction; every arrow end attached to a deleted object becomes `free` at the point where it was attached, so the arrow stays. If another person deletes the target at the same moment an arrow is being attached, the arrow is still created and `resolveEndpoints` draws that end at its stored `fallback` point, so the arrow is always shown.
- `resolveEndpoints` recomputes sides from current rects every snapshot (connector.follow, connector.ui); `setConnectorEndpoint` backs handle re-attach (connector.reattach); `distanceToPolyline` backs the hit test (connector.select).

## Tests
unit: TC-07 to TC-14, TC-29 in `tests/unit/connector-model.test.ts`. e2e: TC-26, TC-27.

## Shape tool, shape object and toolbar

> Anchor: `shape.ui`

## Contract
```tsx
// src/client/tools/ShapeTool.tsx
export function ShapeTool(props: { kind: ShapeKind; camera: Camera; onCreated(id: string): void }): JSX.Element;
// src/client/objects/ShapeObject.tsx
export function ShapeObject(props: { shape: ShapeSnap; doc: Y.Doc; selected: boolean; editing: boolean; onEndEdit(): void }): JSX.Element;
// src/client/objects/ShapeToolbar.tsx
export function ShapeToolbar(props: { fill: FillColor; stroke: StrokeColor; onFill(c: FillColor): void; onStroke(c: StrokeColor): void }): JSX.Element;
```
- **Inputs**: pointer gesture in Shape tool (Shift state read on every move), dblclick on a shape, swatch clicks.
- **Outputs**: screen-space dashed preview during drag; SVG `rect`/`ellipse`/`polygon` sized to the object with `SHAPE_STROKE_WIDTH_WORLD`; centred label; toolbar with `button[aria-label="<colour> fill"]` and `button[aria-label="<colour> outline"]`; registry entry `{ Component: ShapeObject, resizable: true, aspectLocked: false, minSize: SHAPE_MIN_SIZE_WORLD, editableText: true, hitTest: bbox }`.
- **Errors**: model rejections leave the tool active and create nothing.
- **Side effects**: `createShape` once on pointerup; `undoManager.stopCapturing()`; `onCreated` selects the id and switches to Select.

## Implementation
- **Label a shape (shape.label):** double-clicking a shape starts editing its `Y.Text` label in a `foreignObject` using story 2's text editor. The label is centred horizontally and vertically inside the shape and wraps within the shape's width; because the label box is the object's width and height, resizing the shape re-wraps the label and keeps it centred. `clampToLimit` with SHAPE_LABEL_MAX_CHARS stops typing or pasting beyond 500 characters.
- **Colour a shape (shape.style):** when exactly one shape is selected, ShapeToolbar shows six fill swatches plus "no fill" and six outline swatches. Clicking one calls `setShapeStyle`, which changes only the `fill` or `stroke` key, so the shape's label, size, position and selection are unchanged.
- The tool captures the pointer so drags starting over existing objects never move them (TC-28).

## Tests
ui-component: TC-15 to TC-17, TC-28 in `tests/component/ShapeTool.test.tsx`. e2e: TC-23, TC-24 in `tests/e2e/shapes.spec.ts`.

## Connector tool and connector object

> Anchor: `connector.ui`

## Contract
```tsx
// src/client/tools/ConnectorTool.tsx
export function ConnectorTool(props: { camera: Camera; snapshot: readonly ObjectSnap[]; onCreated(id: string): void }): JSX.Element;
// src/client/objects/ConnectorObject.tsx
export function ConnectorObject(props: { connector: ConnectorSnap; rects: ReadonlyMap<string, Rect>; doc: Y.Doc; selected: boolean; zoom: number }): JSX.Element;
```
- **Inputs**: pointer over objects (hover), drag from object or empty space, end-handle drags on a selected arrow, snapshot rects.
- **Outputs**: side dots, highlighted target dot, SVG line with arrowhead sized `CONNECTOR_ARROWHEAD_SIZE_WORLD`, two end handles when selected; registry entry `{ Component: ConnectorObject, resizable: false, aspectLocked: false, editableText: false, hitTest: (p, zoom) => distanceToPolyline(ends, p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom }`.
- **Errors**: rejected creation keeps the tool active; handle release on the opposite object snaps back; stale connector ends the interaction.
- **Side effects**: `createConnector` / `setConnectorEndpoint`; `stopCapturing()`; `onCreated` selects the arrow and switches to Select.

## Implementation
- **Arrows follow objects (connector.follow):** attached ends store no side. When any person moves or resizes an object, story 3 delivers the change to every connected screen within 1 second, the snapshot recomputes, and `ConnectorObject` calls `resolveEndpoints`, which places each attached end at the midpoint of the object's side nearest the other end at its new position — switching sides as objects pass each other — on every screen, with no extra writes.
- **Connection points are shown (connector.hover_points):** while the Connector tool is active and the pointer is over a board object, four dots of CONNECTOR_DOT_RADIUS_PX appear at the midpoints of its four sides; while dragging an arrow over a target object, the dot the arrow will attach to (its nearest side) is highlighted.
- **Select an arrow precisely (connector.select):** with the Select tool, a click within 6 screen pixels (CONNECTOR_HIT_TOLERANCE_PX, divided by zoom to get board units) of the arrow's line selects it; a click farther than 6 screen pixels — even inside the arrow's bounding box — does not.
- **Move an arrow's ends (connector.reattach):** dragging an end handle of a selected arrow and releasing over a board object calls `setConnectorEndpoint` to attach that end to the object; releasing over empty space detaches it and fixes it at the release point. Releasing over the object at the other end is rejected and the handle snaps back.

## Tests
ui-component: TC-18 to TC-21 in `tests/component/Connector.test.tsx`. e2e: TC-25 to TC-27 in `tests/e2e/connectors.spec.ts`.

## Active tool and return to Select

> Anchor: `tools.active_tool`

## Contract
```ts
// src/client/tools/useActiveTool.ts
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';
export const TOOL_SHORTCUTS: Record<string, ToolId>; // v select, n sticky, t text, s shape, l connector, p pen, i image, c comment
export function useActiveTool(): { tool: ToolId; shapeKind: ShapeKind; setTool(t: ToolId): void; setShapeKind(k: ShapeKind): void; toolCreated(id: string): void };
```
- **Inputs**: toolbar clicks, single-letter shortcuts (ignored while typing in an editor or input), Escape.
- **Outputs**: active tool id; `toolCreated(id)` selects the id and sets tool to `select`.
- **Errors**: unknown shortcut ignored.
- **Side effects**: none persisted.

## Implementation
- **Return to Select after creating (tools.return_to_select):** when the Shape or Connector tool creates a shape or arrow, it calls `toolCreated(id)`, which makes the new item the only selected object and switches the active tool back to Select, so the item can be adjusted immediately. Pressing Escape while the Shape or Connector tool is active switches to Select and creates nothing (including during an unfinished drag).
- Created here if no earlier story (9–12) has added it; otherwise story 10 only adds `shape` and `connector` entries and `shapeKind`.

## Tests
ui-component: TC-22 in `tests/component/useActiveTool.test.tsx`.

