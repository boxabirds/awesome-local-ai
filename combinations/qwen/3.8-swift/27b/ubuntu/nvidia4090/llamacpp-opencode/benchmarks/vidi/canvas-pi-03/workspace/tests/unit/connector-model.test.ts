/**
 * Story 10, connector.model (tasks 9/10) — unit tests for `createConnector`,
 * `setConnectorEndpoint`, `detachConnectorsTo` (via deleteObjects), the pure
 * geometry (`sideAnchor`, `nearestSide`, `resolveEndpoints`, `connectorBBox`,
 * `distanceToPolyline`) on a real Y.Doc.
 *
 * TC-07..TC-14, TC-29: creation (attached/free, same-object and min-length
 * boundaries), side choice on the 45° diagonal, orphaned resolution,
 * re-attach rules, delete-target detach and the polyline hit distance.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, deleteObjects, allObjects } from 'src/shared/board-model';
import { createShape } from 'src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  type Endpoint,
} from 'src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
  type Side,
} from 'src/shared/geometry/connector-geometry';
import { distanceToPolyline } from 'src/shared/geometry/polyline';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from 'src/shared/config';
import type { Point, Rect } from 'src/shared/geometry';

/** Counts `update` events emitted on the doc. */
function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function rawConnector(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!(obj instanceof Y.Map)) throw new Error(`connector ${id} missing`);
  return obj;
}

function rectDoc(aId: string, bId: string, ra: Rect, rb: Rect): ReadonlyMap<string, Rect> {
  return new Map([[aId, ra], [bId, rb]]);
}

const A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const B: Rect = { x: 300, y: 0, width: 100, height: 100 };
const A_CENTRE: Point = { x: 50, y: 50 };
const B_CENTRE: Point = { x: 350, y: 50 };

function attachedTo(id: string, rect: Rect, toward: Point): Endpoint {
  return { kind: 'attached', objectId: id, fallback: sideAnchor(rect, nearestSide(rect, toward)) };
}

describe('connector.model', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  beforeEach(() => {
    doc = newDoc();
    a = createShape(doc, { kind: 'rect', rect: A, at: { x: A.x, y: A.y } }, 'me')!;
    b = createShape(doc, { kind: 'rect', rect: B, at: { x: B.x, y: B.y } }, 'me')!;
  });

  it('TC-07: attached A→B (300 apart) stores both endpoints with side-anchor fallbacks, one update', () => {
    const updates = countUpdates(doc);
    const from = attachedTo(a, A, B_CENTRE);
    const to = attachedTo(b, B, A_CENTRE);
    const id = createConnector(doc, from, to, 'me');
    expect(id).toBeTruthy();
    expect(updates()).toBe(1);

    const raw = rawConnector(doc, id!);
    const storedFrom = raw.get('from') as Endpoint;
    const storedTo = raw.get('to') as Endpoint;
    expect(storedFrom).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(storedTo).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
    // Common fields: z on top, identity recorded.
    expect(raw.get('z')).toBe(3); // a=1, b=2
    expect(raw.get('createdBy')).toBe('me');
  });

  it('TC-08: a connector from an object to itself is rejected with zero updates (negative)', () => {
    const updates = countUpdates(doc);
    const end = attachedTo(a, A, A_CENTRE);
    expect(createConnector(doc, end, { ...end }, 'me')).toBeNull();
    expect(updates()).toBe(0);
  });

  it('TC-09: free→free below the minimum length is rejected; exactly at it is created (boundary)', () => {
    let updates = countUpdates(doc);
    const short: Endpoint = { kind: 'free', x: 0, y: 0 };
    const shortTo: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 };
    expect(createConnector(doc, short, shortTo, 'me')).toBeNull();
    expect(updates()).toBe(0);

    updates = countUpdates(doc);
    const exactTo: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };
    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, exactTo, 'me');
    expect(id).toBeTruthy();
    expect(updates()).toBe(1);
  });

  it('TC-10: nearestSide switches at the 45° diagonal (B orbiting A: 0° right, 44° right, 46° top, 90° top)', () => {
    const centre = A_CENTRE;
    const orbit = (deg: number): Point => {
      const rad = (deg * Math.PI) / 180;
      // Math convention (y up) → world (y down).
      return { x: centre.x + 200 * Math.cos(rad), y: centre.y - 200 * Math.sin(rad) };
    };
    const expectSide = (deg: number, side: Side) => {
      expect(nearestSide(A, orbit(deg))).toBe(side);
    };
    expectSide(0, 'right');
    expectSide(44, 'right');
    expectSide(46, 'top');
    expectSide(90, 'top');
  });

  it('TC-11: resolveEndpoints with a missing target uses the fallback and does not throw (orphaned)', () => {
    const from: Endpoint = { kind: 'attached', objectId: 'gone', fallback: { x: 10, y: 20 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 99, y: 99 } };
    const rects = new Map<string, Rect>([
      ['B', B],
    ]);
    // 'gone' absent → fallback; 'B' present → side anchor toward the fallback.
    const resolved = resolveEndpoints({ from, to }, rects);
    expect(resolved.from).toEqual({ x: 10, y: 20 });
    expect(resolved.to).toEqual(sideAnchor(B, nearestSide(B, { x: 10, y: 20 })));
  });

  it('TC-12: setConnectorEndpoint attaches to free / to object C; attaching to the opposite end object is rejected (negative)', () => {
    const id = createConnector(doc, attachedTo(a, A, B_CENTRE), attachedTo(b, B, A_CENTRE), 'me')!;

    let updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 12, y: 34 })).toBe(true);
    expect(updates()).toBe(1);
    let raw = rawConnector(doc, id);
    expect(raw.get('to')).toEqual({ kind: 'free', x: 12, y: 34 });

    // Attach the free end to a third object C.
    const c = createShape(doc, { kind: 'ellipse', rect: { x: 600, y: 0, width: 100, height: 100 }, at: { x: 600, y: 0 } }, 'me')!;
    const cRect = { x: 600, y: 0, width: 100, height: 100 };
    updates = countUpdates(doc);
    expect(
      setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: c,
        fallback: sideAnchor(cRect, nearestSide(cRect, { x: 50, y: 50 })),
      }),
    ).toBe(true);
    expect(updates()).toBe(1);
    raw = rawConnector(doc, id);
    expect(raw.get('to')).toMatchObject({ kind: 'attached', objectId: c });

    // The `to` end is attached to C; moving `from` onto C (the opposite end's
    // object) must be rejected.
    updates = countUpdates(doc);
    expect(
      setConnectorEndpoint(doc, id, 'from', {
        kind: 'attached',
        objectId: c,
        fallback: { x: 650, y: 50 },
      }),
    ).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-13: deleting an attached object keeps the connector; the end becomes free at the object current anchor, one update', () => {
    const id = createConnector(doc, attachedTo(a, A, B_CENTRE), attachedTo(b, B, A_CENTRE), 'me')!;

    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates()).toBe(1);

    // A is gone; the connector remains with its `from` end free at A's
    // current side anchor (A's right side faces B).
    expect(allObjects(doc).some((o) => o.id === a)).toBe(false);
    const raw = rawConnector(doc, id);
    expect(raw.get('from')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(raw.get('to')).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('TC-14: distanceToPolyline returns exact distances at 0 / 5.99 / 6.01 units from a segment (hit tolerance boundary)', () => {
    const pts: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(distanceToPolyline(pts, { x: 5, y: 0 })).toBe(0);
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 10);
    // 5.99 is inside the 6 px tolerance, 6.01 is outside (at zoom 1 the
    // tolerance is CONNECTOR_HIT_TOLERANCE_PX world units).
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 }) <= CONNECTOR_HIT_TOLERANCE_PX / 1).toBe(true);
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 }) <= CONNECTOR_HIT_TOLERANCE_PX / 1).toBe(false);
    // Outside the segment's span the nearest endpoint wins.
    expect(distanceToPolyline(pts, { x: 14, y: 3 })).toBe(5);
  });

  it('TC-29: setConnectorEndpoint on a deleted connector id returns false (stale id)', () => {
    const id = createConnector(doc, attachedTo(a, A, B_CENTRE), attachedTo(b, B, A_CENTRE), 'me')!;
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 1, y: 1 })).toBe(false);
    expect(updates()).toBe(0);
  });

  it('connectorBBox spans the two resolved endpoints', () => {
    const box = connectorBBox({ x: 100, y: 50 }, { x: 300, y: 50 });
    expect(box).toEqual({ x: 100, y: 50, width: 200, height: 0 });
  });

  it('resolveEndpoints follows live rects: moving B switches the sides (connector.follow)', () => {
    const from = attachedTo(a, A, B_CENTRE);
    const to = attachedTo(b, B, A_CENTRE);
    // B on the right of A → A's right anchor, B's left anchor.
    let resolved = resolveEndpoints({ from, to }, rectDoc(a, b, A, B));
    expect(resolved.from).toEqual({ x: 100, y: 50 });
    expect(resolved.to).toEqual({ x: 300, y: 50 });
    // B moved above A → A's top anchor, B's bottom anchor.
    const B_ABOVE: Rect = { x: 50, y: -300, width: 100, height: 100 };
    resolved = resolveEndpoints({ from, to }, rectDoc(a, b, A, B_ABOVE));
    expect(resolved.from).toEqual({ x: 50, y: 0 });
    expect(resolved.to).toEqual({ x: 100, y: -200 });
  });
});
