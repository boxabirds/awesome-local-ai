import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  snapshotConnector,
  type Endpoint,
} from '@shared/objects/connector';
import {
  createSticky,
  deleteObjects,
  initDoc,
  moveObject,
  snapshotAll,
} from '@shared/board-model';
import { createShape } from '@shared/objects/shape';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@shared/config';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
} from '@shared/geometry/connector-geometry';
import { distanceToPolyline } from '@shared/geometry/polyline';
import type { Rect } from '@shared/geometry';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const handler = () => n++;
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return n;
}

// Two shapes 300 apart on a horizontal line
function twoShapes(doc: Y.Doc) {
  const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 50, y: 40 } }, 'user')!;
  const b = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 80 }, at: { x: 350, y: 40 } }, 'user')!;
  return { a, b };
}

function attached(id: string): Endpoint {
  return { kind: 'attached', objectId: id, fallback: { x: 0, y: 0 } };
}
function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

describe('connector model (TC-07..TC-14, TC-29)', () => {
  it('TC-07: A to B creates one doc update; endpoints attached; fallback = side anchor', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    const before = countUpdates(doc, () => {});
    void before;
    const updates = countUpdates(doc, () => {
      const id = createConnector(doc, attached(a), attached(b), 'user');
      expect(id).toBeTruthy();
    });
    expect(updates).toBe(1);
    const snap = snapshotConnector(doc);
    expect(snap.length).toBe(1);
    expect(snap[0].from.kind).toBe('attached');
    expect(snap[0].to.kind).toBe('attached');
    if (snap[0].from.kind === 'attached' && snap[0].from.objectId === a) {
      // A's nearest side to B (B is to the right) => right edge midpoint
      expect(snap[0].from.fallback.x).toBeCloseTo(100);
      expect(snap[0].from.fallback.y).toBeCloseTo(40);
    } else {
      throw new Error('from should attach to a');
    }
  });

  it('TC-08: A to A returns null with zero updates', () => {
    const doc = makeDoc();
    const { a } = twoShapes(doc);
    let id!: string | null;
    const updates = countUpdates(doc, () => {
      id = createConnector(doc, attached(a), attached(a), 'user');
    });
    expect(id!).toBeNull();
    expect(updates).toBe(0);
    expect(snapshotConnector(doc).length).toBe(0);
  });

  it('TC-09: free to free length 7.9 rejected; length 8 created', () => {
    const doc = makeDoc();
    let shortId: string | null = null;
    const updates1 = countUpdates(doc, () => {
      shortId = createConnector(doc, free(0, 0), free(7.9, 0), 'user');
    });
    expect(shortId).toBeNull();
    expect(updates1).toBe(0);
    let longId: string | null = null;
    countUpdates(doc, () => {
      longId = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'user');
    });
    expect(longId).toBeTruthy();
    expect(snapshotConnector(doc).length).toBe(1);
  });

  it('TC-10: nearest side as B orbits A at 0, 44, 46, 90 degrees (right, right, top, top)', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50;
    const cy = 50;
    const at = (deg: number): { x: number; y: number } => ({
      x: cx + Math.cos((deg * Math.PI) / 180) * 400,
      y: cy - Math.sin((deg * Math.PI) / 180) * 400, // screen y is down
    });
    expect(nearestSide(r, at(0))).toBe('right');
    expect(nearestSide(r, at(44))).toBe('right');
    expect(nearestSide(r, at(46))).toBe('top');
    expect(nearestSide(r, at(90))).toBe('top');
  });

  it('TC-11: resolveEndpoints gives the side anchors when both attached', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'user')!;
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    const rects = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 100, height: 80 }],
      [b, { x: 300, y: 0, width: 100, height: 80 }],
    ]);
    const ends = resolveEndpoints(snap, rects);
    // from A right edge, to B left edge
    expect(ends.from.x).toBeCloseTo(100);
    expect(ends.from.y).toBeCloseTo(40);
    expect(ends.to.x).toBeCloseTo(300);
    expect(ends.to.y).toBeCloseTo(40);
  });

  it('TC-12: setConnectorEndpoint false for stale, non-finite and same-object; applied otherwise', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'user')!;

    const updates = countUpdates(doc, () => {
      expect(setConnectorEndpoint(doc, 'missing', 'to', free(10, 10))).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', free(NaN, 5))).toBe(false);
      // attaching `to` to the same object as `from` (a) is rejected
      expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    });
    expect(updates).toBe(0);

    // valid: move `to` to a free point
    const okUpdates = countUpdates(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', free(500, 500))).toBe(true);
    });
    expect(okUpdates).toBe(1);
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    expect(snap.to.kind).toBe('free');

    // valid: move `to` onto a different object (attached)
    const c = createShape(doc, { kind: 'rect', rect: { x: 700, y: 0, width: 100, height: 80 }, at: { x: 750, y: 40 } }, 'user')!;
    const attachUpdates = countUpdates(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    });
    expect(attachUpdates).toBe(1);
    const reattached = snapshotConnector(doc).find((x) => x.id === id)!;
    expect(reattached.to.kind === 'attached' ? reattached.to.objectId : null).toBe(c);
  });

  it('TC-13: deleting a target detaches to free within one update; connector survives', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'user')!;
    const updates = countUpdates(doc, () => {
      deleteObjects(doc, [b]);
    });
    expect(updates).toBe(1);
    // Connector still present
    const snap = snapshotConnector(doc).find((c) => c.id === id);
    expect(snap).toBeTruthy();
    expect(snap!.to.kind).toBe('free');
    // The free end sits at the previous anchor (A is at left; B's left edge was the anchor)
    expect(snap!.to.kind === 'free' ? snap!.to.x : NaN).toBeCloseTo(300);
  });

  it('TC-13b: single-object deleteObject also detaches attached connector ends', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const s = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 80 }, at: { x: 350, y: 40 } }, 'user')!;
    const id = createConnector(doc, attached(a), attached(s), 'user')!;
    deleteObjects(doc, [s]);
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    expect(snap.to.kind).toBe('free');
  });

  it('TC-29: free endpoints resolve exactly as stored; attached-then-detached keeps the last anchor', () => {
    const doc = makeDoc();
    const id = createConnector(doc, free(10, 20), free(110, 20), 'user')!;
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    const ends = resolveEndpoints(snap, new Map());
    expect(ends.from).toEqual({ x: 10, y: 20 });
    expect(ends.to).toEqual({ x: 110, y: 20 });

    // Orphaned attached endpoint uses its stored fallback
    const orphan: Endpoint = { kind: 'attached', objectId: 'gone', fallback: { x: 42, y: 43 } };
    const orphanEnds = resolveEndpoints({ from: orphan, to: free(0, 0) }, new Map());
    expect(orphanEnds.from).toEqual({ x: 42, y: 43 });
  });

  it('connector survives a move of the attached object (endpoints resolve to new side)', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'user')!;
    // Move B above A
    const bMap = doc.getMap('objects').get(b) as Y.Map<unknown>;
    doc.transact(() => {
      bMap.set('x', 0);
      bMap.set('y', -300);
    });
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    const rects = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 100, height: 80 }],
      [b, { x: 0, y: -300, width: 100, height: 80 }],
    ]);
    const ends = resolveEndpoints(snap, rects);
    // from A top edge, to B bottom edge
    expect(ends.from.x).toBeCloseTo(50);
    expect(ends.from.y).toBeCloseTo(0);
    expect(ends.to.x).toBeCloseTo(50);
    expect(ends.to.y).toBeCloseTo(-220);
  });

  it('detachConnectorsTo only affects the named objects', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    const c = createShape(doc, { kind: 'rect', rect: { x: 600, y: 0, width: 100, height: 80 }, at: { x: 650, y: 40 } }, 'user')!;
    const ab = createConnector(doc, attached(a), attached(b), 'user')!;
    const bc = createConnector(doc, attached(b), attached(c), 'user')!;
    doc.transact(() => detachConnectorsTo(doc, [a]));
    const byId = new Map(snapshotConnector(doc).map((x) => [x.id, x]));
    expect(byId.get(ab)!.from.kind).toBe('free');
    expect(byId.get(ab)!.to.kind).toBe('attached');
    // bc untouched
    expect(byId.get(bc)!.from.kind).toBe('attached');
    expect(byId.get(bc)!.to.kind).toBe('attached');
  });

  it('connectorBBox (via snapshot) spans the two resolved points', () => {
    const doc = makeDoc();
    const id = createConnector(doc, free(10, 90), free(210, 30), 'user')!;
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    expect(snap.x).toBeCloseTo(10);
    expect(snap.y).toBeCloseTo(30);
    expect(snap.width).toBeCloseTo(200);
    expect(snap.height).toBeCloseTo(60);
  });

  it('snapshotAll includes connectors alongside shapes', () => {
    const doc = makeDoc();
    const { a, b } = twoShapes(doc);
    createConnector(doc, attached(a), attached(b), 'user');
    const all = snapshotAll(doc);
    expect(all.filter((o) => o.type === 'connector').length).toBe(1);
    expect(all.filter((o) => o.type === 'shape').length).toBe(2);
  });

  it('sideAnchor returns side midpoints', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 25 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 50 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 25 });
  });

  it('distanceToPolyline: single point, segment interior, and beyond segment', () => {
    expect(distanceToPolyline([], { x: 3, y: 4 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 0, y: 0 }], { x: 3, y: 4 })).toBeCloseTo(5);
    // Perpendicular distance to a horizontal segment
    expect(distanceToPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 5, y: 3 })).toBeCloseTo(3);
    // Beyond the segment end uses the endpoint distance
    expect(distanceToPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 14, y: 3 })).toBeCloseTo(5);
  });

  it('TC-14: distanceToPolyline exact values 0, 5.99 and 6.01 from a segment', () => {
    const seg = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBeCloseTo(0);
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBeCloseTo(5.99);
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBeCloseTo(6.01);
  });

  it('moveObject keeps connector endpoints valid (integration of model + geometry)', () => {
    const doc = makeDoc();
    const { a } = twoShapes(doc);
    const b = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 80 }, at: { x: 350, y: 40 } }, 'user')!;
    const id = createConnector(doc, attached(a), attached(b), 'user')!;
    moveObject(doc, b, 900, 0);
    const snap = snapshotConnector(doc).find((c) => c.id === id)!;
    // Still attached to b; the resolved end follows b
    expect(snap.to.kind).toBe('attached');
    const rects = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 100, height: 80 }],
      [b, { x: 900, y: 0, width: 100, height: 80 }],
    ]);
    const ends = resolveEndpoints(snap, rects);
    expect(ends.to.x).toBeCloseTo(900);
  });
});
