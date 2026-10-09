/**
 * Story 10 unit tests (TC-07 to TC-14, TC-29): the connector model
 * (connector.model) and its geometry, against a real Y.Doc.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { deleteObjects, initDoc, registerKnownObjectType, snapshot } from '../../src/shared/board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import {
  ConnectorSnap,
  createConnector,
  detachConnectorsTo,
  Endpoint,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

registerKnownObjectType('shape'); // as the client registry does at load
registerKnownObjectType('connector');

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function item(doc: Y.Doc, id: string): Y.Map<any> {
  return doc.getMap('objects').get(id) as Y.Map<any>;
}

/** A 160x160 rect at the given top-left corner. */
function makeSquare(doc: Y.Doc, x: number, y: number, kind: 'rect' | 'diamond' = 'rect'): string {
  return createShape(
    doc,
    { kind, rect: { x, y, width: 160, height: 160 }, at: { x, y } },
    'dana',
  )!;
}

/**
 * The fixture board: A at (0,0), B at (460,0) (edges 300 apart),
 * C at (460,400).
 */
function board(): { doc: Y.Doc; A: string; B: string; C: string } {
  const doc = newDoc();
  const A = makeSquare(doc, 0, 0);
  const B = makeSquare(doc, 460, 0);
  const C = makeSquare(doc, 460, 400);
  return { doc, A, B, C };
}

const attached = (objectId: string, fallback: { x: number; y: number }): Endpoint => ({
  kind: 'attached',
  objectId,
  fallback,
});
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

describe('connector.model', () => {
  it('TC-07: attached A → B (300 apart) stores both endpoints with side-anchor fallbacks; 1 update', () => {
    const { doc, A, B } = board();
    let updates = 0;
    doc.on('update', () => updates++);

    const id = createConnector(
      doc,
      attached(A, { x: 160, y: 80 }),
      attached(B, { x: 460, y: 80 }),
      'dana',
    );

    expect(id).toBeTruthy();
    expect(updates).toBe(1); // one LOCAL_ORIGIN transaction
    const o = item(doc, id!);
    expect(o.get('type')).toBe('connector');
    expect(o.get('from')).toMatchObject({ kind: 'attached', objectId: A });
    expect(o.get('to')).toMatchObject({ kind: 'attached', objectId: B });
    // fallbacks are the side anchors at attach time: A's right, B's left
    expect(o.get('from').fallback).toEqual({ x: 160, y: 80 });
    expect(o.get('to').fallback).toEqual({ x: 460, y: 80 });
    // x/y/width/height are stored as 0 (derived in the snapshot)
    expect(o.get('x')).toBe(0);
    expect(o.get('y')).toBe(0);
    expect(o.get('width')).toBe(0);
    expect(o.get('height')).toBe(0);
    expect(o.get('createdBy')).toBe('dana');

    // the snapshot derives the connector bbox from the live rects
    const snap = snapshot(doc).find((s) => s.id === id)! as ConnectorSnap;
    expect(snap).toMatchObject({ x: 160, y: 80, width: 300, height: 0 });
    expect(snap.from).toMatchObject({ kind: 'attached', objectId: A });
    expect(snap.to).toMatchObject({ kind: 'attached', objectId: B });
  });

  it('TC-08: a connector from an object to itself → null, 0 updates (negative)', () => {
    const { doc, A } = board();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(createConnector(doc, attached(A, { x: 0, y: 0 }), attached(A, { x: 10, y: 0 }), 'dana')).toBeNull();
    expect(updates).toBe(0);
  });

  it(`TC-09: free → free length 7.9 → null; length ${CONNECTOR_MIN_LENGTH_WORLD} (boundary) → created`, () => {
    const { doc } = board();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(
      createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'dana'),
    ).toBeNull();
    expect(updates).toBe(0);
    const id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'dana');
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
    const o = item(doc, id!);
    expect(o.get('from')).toEqual(free(0, 0));
    expect(o.get('to')).toEqual(free(CONNECTOR_MIN_LENGTH_WORLD, 0));
  });

  it('TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top (diagonal switch)', () => {
    const A = { x: 0, y: 0, width: 160, height: 160 } as const;
    const cx = 80;
    const cy = 80;
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return { x: cx + 300 * Math.cos(r), y: cy - 300 * Math.sin(r) };
    };
    expect(nearestSide(A, at(0))).toBe('right');
    expect(nearestSide(A, at(44))).toBe('right');
    expect(nearestSide(A, at(46))).toBe('top');
    expect(nearestSide(A, at(90))).toBe('top');
    // the other quadrants
    expect(nearestSide(A, at(180))).toBe('left');
    expect(nearestSide(A, at(270))).toBe('bottom');
  });

  it('TC-11: resolveEndpoints with B missing from rects → that end at its fallback; no throw (orphaned)', () => {
    const { A, B } = board();
    const c: ConnectorSnap = {
      id: 'c',
      type: 'connector',
      x: 0,
      y: 0,
      z: 0,
      createdAt: 0,
      from: attached(A, { x: 160, y: 80 }),
      to: attached(B, { x: 460, y: 80 }),
    };
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      [A, { x: 0, y: 0, width: 160, height: 160 }],
      // B intentionally absent
    ]);
    const { from, to } = resolveEndpoints(c, rects);
    expect(from).toEqual({ x: 160, y: 80 }); // A's right side, toward B's last position
    expect(to).toEqual({ x: 460, y: 80 }); // B's fallback
  });

  it('TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to the opposite end’s object → false, 0 updates', () => {
    const { doc, A, B, C } = board();
    const id = createConnector(doc, attached(A, { x: 160, y: 80 }), attached(B, { x: 460, y: 80 }), 'dana')!;

    let updates = 0;
    doc.on('update', () => updates++);
    expect(setConnectorEndpoint(doc, id, 'to', free(700, 900))).toBe(true);
    expect(item(doc, id).get('to')).toEqual(free(700, 900));
    expect(updates).toBe(1);

    updates = 0;
    expect(setConnectorEndpoint(doc, id, 'to', attached(C, { x: 460, y: 480 }))).toBe(true);
    expect(item(doc, id).get('to')).toMatchObject({ kind: 'attached', objectId: C });
    expect(updates).toBe(1);

    updates = 0;
    // the opposite end is attached to A: re-attaching 'to' to A is rejected
    expect(setConnectorEndpoint(doc, id, 'to', attached(A, { x: 160, y: 80 }))).toBe(false);
    expect(updates).toBe(0);
    expect(item(doc, id).get('to')).toMatchObject({ kind: 'attached', objectId: C });
    // non-finite free points are rejected too
    expect(setConnectorEndpoint(doc, id, 'from', free(Number.NaN, 0))).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-13: deleteObjects([A]) with a connector attached to A → A removed, the end free at A’s anchor, exactly one update', () => {
    const { doc, A, B } = board();
    const id = createConnector(doc, attached(A, { x: 160, y: 80 }), attached(B, { x: 460, y: 80 }), 'dana')!;

    let updates = 0;
    doc.on('update', () => updates++);
    const deleted = deleteObjects(doc, [A]);
    expect(updates).toBe(1); // detach + delete in the one transaction
    expect(deleted).toBe(1);
    expect(doc.getMap('objects').has(A)).toBe(false);
    const o = item(doc, id);
    expect(o).toBeDefined();
    expect(o.get('from')).toEqual(free(160, 80)); // A’s right-side anchor (nearest B)
    expect(o.get('to')).toMatchObject({ kind: 'attached', objectId: B });
  });

  it('TC-14: distanceToPolyline returns the exact distance at 0, 5.99 and 6.01 units from a segment', () => {
    const seg = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBe(5.99);
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBe(6.01);
    // beyond an endpoint: distance to the endpoint
    expect(distanceToPolyline(seg, { x: -10, y: 0 })).toBe(10);
    expect(distanceToPolyline(seg, { x: 110, y: 12 })).toBe(Math.hypot(10, 12));
    // the hit tolerance boundary: 6 screen px at zoom 1
    expect(distanceToPolyline(seg, { x: 50, y: CONNECTOR_HIT_TOLERANCE_PX })).toBe(CONNECTOR_HIT_TOLERANCE_PX);
  });

  it('TC-29: setConnectorEndpoint on a deleted connector id → false (stale id)', () => {
    const { doc, A, B } = board();
    const id = createConnector(doc, attached(A, { x: 160, y: 80 }), attached(B, { x: 460, y: 80 }), 'dana')!;
    deleteObjects(doc, [id]);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(setConnectorEndpoint(doc, id, 'from', free(0, 0))).toBe(false);
    expect(setConnectorEndpoint(doc, 'stale', 'to', free(0, 0))).toBe(false);
    expect(updates).toBe(0);
  });

  it('sideAnchor returns the midpoint of each side (on the boundary)', () => {
    const r = { x: 10, y: 20, width: 100, height: 40 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 40 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 60 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 40 });
  });

  it('connectorBBox spans the two endpoints (zero size allowed)', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 40, y: 10 })).toEqual({ x: 10, y: 10, width: 30, height: 10 });
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });

  it('detachConnectorsTo converts attached ends on deleted ids to free at the current anchor (inside the caller’s transaction)', () => {
    const { doc, A, B } = board();
    const id = createConnector(doc, attached(A, { x: 160, y: 80 }), attached(B, { x: 460, y: 80 }), 'dana')!;
    let updates = 0;
    doc.on('update', () => updates++);
    doc.transact(() => {
      detachConnectorsTo(doc, [B]);
    });
    expect(updates).toBe(1); // wrote inside the caller's transaction
    const o = item(doc, id);
    expect(o.get('from')).toMatchObject({ kind: 'attached', objectId: A });
    expect(o.get('to')).toEqual(free(460, 80)); // B’s left-side anchor
  });

  it('createConnector with an already-missing attached target keeps the given fallback (concurrent delete race)', () => {
    const { doc, A } = board();
    const ghost = 'ghost-object-id';
    const id = createConnector(
      doc,
      attached(A, { x: 160, y: 80 }),
      attached(ghost, { x: 460, y: 80 }),
      'dana',
    );
    expect(id).toBeTruthy();
    const o = item(doc, id!);
    expect(o.get('to')).toEqual(attached(ghost, { x: 460, y: 80 }));
    // renders at the fallback while the target is absent
    const snap = snapshot(doc).find((s) => s.id === id)! as ConnectorSnap;
    const { to } = resolveEndpoints(snap, new Map([[A, { x: 0, y: 0, width: 160, height: 160 }]]));
    expect(to).toEqual({ x: 460, y: 80 });
  });
});
