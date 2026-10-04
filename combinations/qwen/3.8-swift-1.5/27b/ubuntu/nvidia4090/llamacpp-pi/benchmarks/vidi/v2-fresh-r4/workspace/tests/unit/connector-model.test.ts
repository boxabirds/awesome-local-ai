/**
 * Story 10 — connector model and geometry unit tests (TC-07 to TC-14, TC-29).
 * Pure model on a real Y.Doc; each case asserts the `update` event count.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  deleteObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point, Rect } from '../../src/shared/geometry';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * Count subsequent `update` events on the doc. (No unsubscribe: in yjs 13.6
 * the function returned by `doc.on('update')` emits a phantom update with an
 * undefined origin when called, which would pollute the count.)
 */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates++;
  });
  return () => updates;
}

function snap(doc: Y.Doc, id: string): ObjectSnapshot {
  const s = snapshot(doc).find((x) => x.id === id);
  if (!s) throw new Error(`object ${id} missing from snapshot`);
  return s;
}

function connSnap(doc: Y.Doc, id: string): ConnectorSnap {
  return snap(doc, id) as ConnectorSnap;
}

/** Shape A at (0,0) 100x100 and shape B at (400,50) 100x100. */
function twoShapes(doc: Y.Doc): { a: string; b: string } {
  const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'local')!;
  const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 50, width: 100, height: 100 }, at: { x: 400, y: 50 } }, 'local')!;
  return { a, b };
}

// --- TC-07: createConnector attached to two shapes → one update ---
describe('TC-07: create attached connector', () => {
  it('stores attached endpoints with resolved fallback anchors, one update', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const stop = countUpdates(doc);

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'local',
    );

    expect(id).toBeTruthy();
    const c = connSnap(doc, id!);
    expect(c.type).toBe('connector');
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 100 } });
    expect(stop()).toBe(1);
  });
});

// --- TC-08: A→A → null, no transaction ---
describe('TC-08: same object on both ends', () => {
  it('returns null and writes nothing', () => {
    const doc = newDoc();
    const { a } = twoShapes(doc);
    const stop = countUpdates(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      'local',
    );
    expect(id).toBeNull();
    expect(snapshot(doc)).toHaveLength(2);
    expect(stop()).toBe(0);
  });
});

// --- TC-09: free→free shorter than the minimum length → null ---
describe('TC-09: minimum length', () => {
  it('7.9 world units → null; 8 → created', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    const short = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 7.9, y: 0 },
      'local',
    );
    expect(short).toBeNull();

    const ok = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 8, y: 0 },
      'local',
    );
    expect(ok).toBeTruthy();
    expect(connSnap(doc, ok!)).toMatchObject({ from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'free', x: 8, y: 0 } });
    expect(stop()).toBe(1);
  });
});

// --- TC-10: nearestSide switches on the 45° diagonal ---
describe('TC-10: nearestSide', () => {
  const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const centre: Point = { x: 50, y: 50 };
  const orbit = (deg: number, radius = 300): Point => {
    const rad = (deg * Math.PI) / 180;
    return { x: centre.x + radius * Math.cos(rad), y: centre.y + radius * Math.sin(rad) };
  };

  // Screen coordinates: +y is down, so 90° orbits below the rect.
  it('right at 0° and 44°, bottom at 46° and 90° (switches on the diagonal)', () => {
    expect(nearestSide(r, orbit(0))).toBe('right');
    expect(nearestSide(r, orbit(44))).toBe('right');
    expect(nearestSide(r, orbit(46))).toBe('bottom');
    expect(nearestSide(r, orbit(90))).toBe('bottom');
    expect(nearestSide(r, orbit(180))).toBe('left');
    expect(nearestSide(r, orbit(270))).toBe('top');
  });

  it('works for a non-square rect', () => {
    const wide: Rect = { x: 0, y: 0, width: 200, height: 50 };
    // centre (100,25); toward (250,225): |dx|*h = 7500 < |dy|*w = 40000 → bottom
    expect(nearestSide(wide, { x: 250, y: 225 })).toBe('bottom');
    // toward (250,30): |dx|*h = 7500 > |dy|*w = 1000 → right
    expect(nearestSide(wide, { x: 250, y: 30 })).toBe('right');
  });
});

// --- sideAnchor: midpoints of the four sides ---
describe('sideAnchor', () => {
  it('returns the four side midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 60 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 50 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 80 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 50 });
  });
});

// --- TC-11: resolveEndpoints with a missing target uses the fallback ---
describe('TC-11: orphaned endpoint', () => {
  it('missing target → its stored fallback, no throw', () => {
    const c: { from: Endpoint; to: Endpoint } = {
      from: { kind: 'attached', objectId: 'ghost', fallback: { x: 12, y: 34 } },
      to: { kind: 'free', x: 500, y: 500 },
    };
    const rects = new Map<string, Rect>(); // no 'ghost'
    const ends = resolveEndpoints(c, rects);
    expect(ends.from).toEqual({ x: 12, y: 34 });
    expect(ends.to).toEqual({ x: 500, y: 500 });
  });

  it('both attached, one missing: the live end resolves against the fallback point', () => {
    const c: { from: Endpoint; to: Endpoint } = {
      from: { kind: 'attached', objectId: 'a', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached', objectId: 'ghost', fallback: { x: 12, y: 34 } },
    };
    const rects = new Map<string, Rect>([['a', { x: 0, y: 0, width: 100, height: 100 }]]);
    const ends = resolveEndpoints(c, rects);
    // 'a' faces the ghost fallback at (12,34) → left side midpoint
    expect(ends.from).toEqual({ x: 0, y: 50 });
    expect(ends.to).toEqual({ x: 12, y: 34 });
  });
});

// --- TC-12: setConnectorEndpoint re-attach / free / same-object rejection ---
describe('TC-12: setConnectorEndpoint', () => {
  it('to free point → true, endpoint updated, one update', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'local',
    )!;
    const stop = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 500 })).toBe(true);
    expect(connSnap(doc, id).to).toEqual({ kind: 'free', x: 500, y: 500 });
    expect(stop()).toBe(1);
  });

  it('re-attach to another object → true, updated with a resolved anchor', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    // C directly to the right of A → the new anchor is C's left midpoint.
    const cId = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'local')!;
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'local',
    )!;
    const stop = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: cId, fallback: { x: 0, y: 0 } })).toBe(true);
    const c = connSnap(doc, id);
    expect(c.to).toEqual({ kind: 'attached', objectId: cId, fallback: { x: 300, y: 50 } });
    expect(stop()).toBe(1);
  });

  it('to the same object as the other end → false, zero updates (negative)', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'local',
    )!;
    const stop = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } })).toBe(false);
    expect(connSnap(doc, id).to).toMatchObject({ objectId: b });
    expect(stop()).toBe(0);
  });

  it('stale id → false, zero updates', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    expect(setConnectorEndpoint(doc, 'nope', 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(stop()).toBe(0);
  });
});

// --- TC-13: delete an object → its connector end becomes free at the last anchor ---
describe('TC-13: detach-on-delete', () => {
  it('deleting A converts the connector end to free at the last anchor, one update total', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'local',
    )!;

    const stop = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);

    expect(snapshot(doc).find((s) => s.id === a)).toBeUndefined();
    const c = connSnap(doc, id);
    // A was at (0,0,100,100), facing B (centre 450,100) → right side midpoint (100,50)
    expect(c.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(stop()).toBe(1);
  });

  it('detachConnectorsTo is a no-op when no connector points at the ids', () => {
    const doc = newDoc();
    const stop = countUpdates(doc);
    detachConnectorsTo(doc, ['ghost']);
    expect(stop()).toBe(0);
  });
});

// --- TC-14: distanceToPolyline for a two-point line ---
describe('TC-14: distanceToPolyline', () => {
  const line: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it('perpendicular distance inside the segment', () => {
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBeCloseTo(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01);
  });

  it('beyond an endpoint → distance to the nearest endpoint', () => {
    expect(distanceToPolyline(line, { x: 100, y: 10 })).toBeCloseTo(10);
    expect(distanceToPolyline(line, { x: 150, y: 0 })).toBeCloseTo(50);
    expect(distanceToPolyline(line, { x: -10, y: 10 })).toBeCloseTo(Math.hypot(10, 10));
  });

  it('empty polyline → Infinity; single point → point distance', () => {
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBeCloseTo(5);
  });
});

// --- TC-29: deleting an arrow → its ids are stale for setConnectorEndpoint ---
describe('TC-29: stale arrow id', () => {
  it('setConnectorEndpoint on a deleted connector → false, zero updates', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'local',
    )!;
    deleteObjects(doc, [id]);

    const stop = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 1, y: 1 })).toBe(false);
    expect(stop()).toBe(0);
  });
});

// --- connectorBBox (used by snapshot() for selection bounds) ---
describe('connectorBBox', () => {
  it('bounding rect of two points, any orientation', () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});
