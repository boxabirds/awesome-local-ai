import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  objectSnapshot,
  moveObjects,
  deleteObjects,
  readEndpoint,
  type Endpoint,
} from '@/shared/board-model';
import {
  createConnector,
  readConnector,
  setConnectorEndpoint,
  isConnectorSnap,
} from '@/shared/objects/connector';
import { createShape } from '@/shared/objects/shape';
import { resolveEndpoints, nearestSide, sideAnchor } from '@/shared/geometry/connector-geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@/shared/config';
import type { Point, Rect } from '@/shared/geometry';

function trackUpdates(doc: Y.Doc): { count: () => number; lastOrigin: () => unknown; dispose: () => void } {
  let count = 0;
  let lastOrigin: unknown = undefined;
  const cb = (_update: Uint8Array, origin: unknown) => {
    count += 1;
    lastOrigin = origin;
  };
  doc.on('update', cb);
  return {
    count: () => count,
    lastOrigin: () => lastOrigin,
    dispose: () => doc.off('update', cb),
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A 200x200 shape at top-left (x, y) — deterministic side anchors. */
function addSquare(doc: Y.Doc, x: number, y: number, kind: 'rect' | 'ellipse' | 'diamond' = 'rect'): string {
  const id = createShape(doc, { kind, rect: { x, y, width: 200, height: 200 }, at: { x: x + 100, y: y + 100 } }, 'dana');
  if (id === null) throw new Error('createShape failed in fixture');
  return id;
}

const attached = (objectId: string, fallback: Point): Endpoint => ({ kind: 'attached', objectId, fallback });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

function connectorSnap(doc: Y.Doc, id: string) {
  const snap = objectSnapshot(doc).find((o) => o.id === id);
  if (!snap) throw new Error('connector missing from snapshot');
  return snap;
}

describe('connector.model (unit, real Y.Doc)', () => {
  let doc: Y.Doc;
  let aId: string; // rect (0,0)-(200,200), centre (100,100)
  let bId: string; // rect (300,0)-(500,200), centre (400,100)

  beforeEach(() => {
    doc = makeDoc();
    aId = addSquare(doc, 0, 0);
    bId = addSquare(doc, 300, 0);
  });

  afterEach(() => {
    doc.destroy();
  });

  it('TC-07: attached A -> attached B stores both endpoints with fallbacks in one update', () => {
    const updates = trackUpdates(doc);
    // Fallbacks passed by the caller are recomputed from live rects; the
    // test deliberately passes stale-ish points to prove that.
    const id = createConnector(doc, attached(aId, { x: 1, y: 1 }), attached(bId, { x: 2, y: 2 }), 'dana');
    expect(id).toBeTruthy();
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);
    updates.dispose();

    const snap = readConnector(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.from).toEqual({ kind: 'attached', objectId: aId, fallback: { x: 200, y: 100 } });
    expect(snap!.to).toEqual({ kind: 'attached', objectId: bId, fallback: { x: 300, y: 100 } });
    // Bbox of the resolved endpoints (derived, for selection/marquee).
    expect(snap!).toMatchObject({ x: 200, y: 100, width: 100, height: 0 });
    expect(isConnectorSnap(snap!)).toBe(true);

    // The generic snapshot carries resolved points (connector.follow).
    const generic = connectorSnap(doc, id!);
    expect(generic.fromPoint).toEqual({ x: 200, y: 100 });
    expect(generic.toPoint).toEqual({ x: 300, y: 100 });
    // readEndpoint handles the Y.Map stored form (Yjs deep-converted the
    // plain objects on set).
    const raw = doc.getMap<Y.Map<unknown>>('objects').get(id!);
    expect(readEndpoint(raw!.get('from'))).toEqual({ kind: 'attached', objectId: aId, fallback: { x: 200, y: 100 } });
  });

  it('TC-08: an endpoint attached to the same object at both ends is rejected', () => {
    const updates = trackUpdates(doc);
    expect(createConnector(doc, attached(aId, { x: 0, y: 0 }), attached(aId, { x: 1, y: 1 }), 'dana')).toBeNull();
    expect(updates.count()).toBe(0);
    updates.dispose();
  });

  it('TC-09: free endpoints below the min length are rejected; exactly at it are created', () => {
    let updates = trackUpdates(doc);
    const short = CONNECTOR_MIN_LENGTH_WORLD - 0.1;
    expect(createConnector(doc, free(0, 0), free(short, 0), 'dana')).toBeNull();
    expect(updates.count()).toBe(0);
    updates.dispose();

    updates = trackUpdates(doc);
    const id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'dana');
    expect(id).toBeTruthy();
    expect(updates.count()).toBe(1);
    updates.dispose();
    expect(readConnector(doc, id!)).toMatchObject({ x: 0, y: 0, width: CONNECTOR_MIN_LENGTH_WORLD, height: 0 });
  });

  it('TC-10: the anchor side follows the direction to the other end; a square switches at 45 degrees', () => {
    // A is a 100x100 rect at (0,0); orbit B (centre only, no size needed)
    // around A's centre at radius 500.
    const rectA: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const centre: Point = { x: 50, y: 50 };
    const orbit = (degrees: number): Point => {
      const rad = (degrees * Math.PI) / 180;
      return { x: centre.x + 500 * Math.cos(rad), y: centre.y - 500 * Math.sin(rad) };
    };
    const cases: Array<[number, 'top' | 'right' | 'bottom' | 'left']> = [
      [0, 'right'],
      [44, 'right'],
      [46, 'top'],
      [90, 'top'],
    ];
    for (const [deg, expected] of cases) {
      const b = orbit(deg);
      const side = nearestSide(rectA, b);
      expect(side, `orbit ${deg}deg`).toBe(expected);
      // The connector anchor is the midpoint of that side.
      const resolved = resolveEndpoints(
        { from: attached('A', { x: 0, y: 0 }), to: attached('B', { x: 0, y: 0 }) },
        new Map<string, Rect>([
          ['A', rectA],
          ['B', { x: b.x - 50, y: b.y - 50, width: 100, height: 100 }],
        ]),
      );
      expect(resolved.from, `orbit ${deg}deg`).toEqual(sideAnchor(rectA, expected));
    }
  });

  it('TC-11: when the attached object is missing the endpoint renders at its fallback', () => {
    const id = createConnector(doc, attached(aId, { x: 200, y: 100 }), attached(bId, { x: 300, y: 100 }), 'dana');
    expect(id).toBeTruthy();
    deleteObjects(doc, [bId]);

    const snap = connectorSnap(doc, id!);
    // The surviving end resolves live (A's side facing the fallback point).
    expect(snap.fromPoint).toEqual({ x: 200, y: 100 });
    // The orphaned end draws at the fallback captured at attach time.
    expect(snap.toPoint).toEqual({ x: 300, y: 100 });
    expect(readConnector(doc, id!)).toBeDefined();
  });

  it('TC-12: setConnectorEndpoint re-attaches, frees, and rejects the opposite object', () => {
    const id = createConnector(doc, attached(aId, { x: 200, y: 100 }), attached(bId, { x: 300, y: 100 }), 'dana');
    expect(id).toBeTruthy();
    const cId = addSquare(doc, 100, 300); // centre (200, 400); its top faces A

    let updates = trackUpdates(doc);
    expect(setConnectorEndpoint(doc, id!, 'to', free(123, 45))).toBe(true);
    expect(updates.count()).toBe(1);
    expect(readConnector(doc, id!)!.to).toEqual({ kind: 'free', x: 123, y: 45 });
    updates.dispose();

    updates = trackUpdates(doc);
    expect(setConnectorEndpoint(doc, id!, 'to', attached(cId, { x: 9, y: 9 }))).toBe(true);
    expect(updates.count()).toBe(1);
    // The fallback is recomputed from the live rect (C's top anchor).
    expect(readConnector(doc, id!)!.to).toEqual({ kind: 'attached', objectId: cId, fallback: { x: 200, y: 300 } });
    updates.dispose();

    updates = trackUpdates(doc);
    // Re-attaching to the object at the OTHER end (A) is rejected.
    expect(setConnectorEndpoint(doc, id!, 'from', attached(cId, { x: 0, y: 0 }))).toBe(false);
    // Stale id and non-finite points are rejected too.
    expect(setConnectorEndpoint(doc, 'missing', 'to', free(0, 0))).toBe(false);
    expect(setConnectorEndpoint(doc, id!, 'to', free(NaN, 0))).toBe(false);
    expect(updates.count()).toBe(0);
    updates.dispose();
  });

  it('TC-13: deleting an attached object detaches the connector end in the same transaction', () => {
    const id = createConnector(doc, attached(aId, { x: 200, y: 100 }), attached(bId, { x: 300, y: 100 }), 'dana');
    expect(id).toBeTruthy();

    const updates = trackUpdates(doc);
    expect(deleteObjects(doc, [bId])).toBe(1);
    expect(updates.count()).toBe(1); // ONE update: detach + delete together
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);
    updates.dispose();

    const snap = readConnector(doc, id!);
    expect(snap!.from).toEqual({ kind: 'attached', objectId: aId, fallback: { x: 200, y: 100 } });
    expect(snap!.to).toEqual({ kind: 'free', x: 300, y: 100 }); // B's left anchor at delete time
  });

  it('TC-14: moving the connector shifts free ends by the bbox delta; attached ends stay put', () => {
    // Free-free: both ends follow the arrow.
    const idFree = createConnector(doc, free(0, 0), free(100, 100), 'dana');
    expect(idFree).toBeTruthy();
    const moved = moveObjects(doc, new Map([[idFree!, { x: 10, y: 10 }]]));
    expect(moved).toBe(1);
    expect(readConnector(doc, idFree!)).toMatchObject({
      from: { kind: 'free', x: 10, y: 10 },
      to: { kind: 'free', x: 110, y: 110 },
    });

    // Attached-free: the attached end stays on its object; the free end
    // follows the (moved) bbox.
    const idMix = createConnector(doc, attached(aId, { x: 200, y: 100 }), free(1000, 1000), 'dana');
    expect(idMix).toBeTruthy();
    // A's right anchor (200,100) -> free (1000,1000): bbox (200,100,800,900).
    // Move the arrow by (+50,+50): free end -> (1050,1050), attached unchanged.
    const moved2 = moveObjects(doc, new Map([[idMix!, { x: 250, y: 150 }]]));
    expect(moved2).toBe(1);
    const mixed = readConnector(doc, idMix!);
    expect(mixed!.from).toEqual({ kind: 'attached', objectId: aId, fallback: { x: 200, y: 100 } });
    expect(mixed!.to).toEqual({ kind: 'free', x: 1050, y: 1050 });
  });
});

describe('connector.snapshot (unit, real Y.Doc)', () => {
  it('TC-29: objectSnapshot carries shape and connector fields alongside stickies', () => {
    const doc = makeDoc();
    try {
      const s1 = createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 120, height: 80 }, at: { x: 60, y: 40 } }, 'dana');
      const s2 = createShape(doc, { kind: 'diamond', rect: { x: 300, y: 0, width: 120, height: 80 }, at: { x: 360, y: 40 } }, 'dana');
      const cid = createConnector(doc, attached(s1!, { x: 120, y: 40 }), attached(s2!, { x: 300, y: 40 }), 'dana');
      const label = doc.getMap<Y.Map<unknown>>('objects').get(s1!);
      const ytext = label!.get('label') as Y.Text;
      ytext.insert(0, 'Charge');

      const snaps = objectSnapshot(doc);
      expect(snaps).toHaveLength(3);
      const [first] = snaps;
      const shape1 = snaps.find((o) => o.id === s1)!;
      expect(shape1).toMatchObject({ type: 'shape', kind: 'ellipse', fill: 'white', stroke: 'dark', label: 'Charge' });
      expect(snaps.find((o) => o.id === s2)).toMatchObject({ type: 'shape', kind: 'diamond', label: '' });
      const conn = snaps.find((o) => o.id === cid)!;
      expect(conn).toMatchObject({ type: 'connector', x: 120, y: 40, width: 180, height: 0 });
      expect(conn.fromPoint).toEqual({ x: 120, y: 40 });
      expect(conn.toPoint).toEqual({ x: 300, y: 40 });
      // Connectors carry none of the shape fields (and stickies none of either).
      expect(first.kind).toBe('ellipse');
      expect(conn.kind).toBeUndefined();
      expect(conn.fill).toBeUndefined();
    } finally {
      doc.destroy();
    }
  });
});
