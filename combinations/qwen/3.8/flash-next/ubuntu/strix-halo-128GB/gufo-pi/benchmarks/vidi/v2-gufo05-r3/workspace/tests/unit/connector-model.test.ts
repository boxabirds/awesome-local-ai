/**
 * Connector model and geometry unit tests (story 10, task 9): TC-07 to TC-14,
 * TC-29.
 *
 * A stored connector keeps only its ends, so these tests read an arrow back as
 * plain data (`readConnector`) and ask the geometry where its ends are given a
 * map of live rectangles — the same two calls the renderer makes whenever the
 * board changes.
 *
 * Every case that expects a refusal also asserts the number of `update` events: a
 * rejected call must not open a transaction, because an empty transaction would
 * travel to every other screen and would occupy an undo step.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  detachConnectorsTo,
  readConnector,
  setConnectorEndpoint,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import { deleteObjects, moveObjects, snapshot } from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';

/** Count the `update` events `fn` produces. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => {
    updates++;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

/** Put a plain object into the document at an exact box. */
function seedObject(doc: Y.Doc, id: string, type: string, box: Rect, z = 1): void {
  const map = new Y.Map<unknown>();
  map.set('type', type);
  map.set('x', box.x);
  map.set('y', box.y);
  map.set('width', box.width);
  map.set('height', box.height);
  map.set('z', z);
  map.set('createdAt', 0);
  doc.getMap<Y.Map<unknown>>('objects').set(id, map);
}

/** The raw stored record of an object. */
function stored(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

const A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const B: Rect = { x: 300, y: 0, width: 100, height: 100 };

function rects(entries: Record<string, Rect>): Map<string, Rect> {
  return new Map(Object.entries(entries));
}

function attached(objectId: string, fallback: Point = { x: 0, y: 0 }): Endpoint {
  return { kind: 'attached', objectId, fallback };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

/** A two-ended connector for the geometry tests. */
function connector(from: Endpoint, to: Endpoint) {
  return { id: 'c', type: 'connector' as const, from, to, z: 1, createdAt: 0 };
}

describe('connector model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-07: an arrow between two objects stores both ends as attached, with the
  // point it was drawn at as the fallback, and the arrow itself has no position.
  it('TC-07 createConnector stores two attached ends in one transaction', () => {
    seedObject(doc, 'A', 'sticky', A);
    seedObject(doc, 'B', 'sticky', B, 2);

    let id: string | null = null;
    const updates = countUpdates(doc, () => {
      id = createConnector(doc, attached('A', { x: 100, y: 50 }), attached('B', { x: 300, y: 50 }), 'dana');
    });
    expect(id).toBeTruthy();
    expect(updates).toBe(1);

    const storedConnector = readConnector(id!, stored(doc, id!))!;
    expect(storedConnector.type).toBe('connector');
    expect(storedConnector.from).toEqual({ kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } });
    expect(storedConnector.to).toEqual({ kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } });
    expect(storedConnector.z).toBe(3);
    expect(storedConnector.createdBy).toBe('dana');
    // No side is stored: which side an end uses is recomputed from the rectangles.
    expect(stored(doc, id!).get('from')).toBeInstanceOf(Y.Map);
    expect((stored(doc, id!).get('from') as Y.Map<unknown>).has('side')).toBe(false);

    // The snapshot derives the arrow's box from the objects it joins.
    const snap = snapshot(doc).find((object) => object.id === id)!;
    expect(snap.type).toBe('connector');
    if (snap.type === 'connector') {
      expect(snap.from).toEqual({ kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } });
      // The right side of A to the left side of B.
      expect(snap.x).toBe(100);
      expect(snap.y).toBe(50);
      expect(snap.width).toBe(200);
      expect(snap.height).toBe(0);
    }
  });

  // TC-07b: an unusable end is refused without writing.
  it('TC-07 an unusable endpoint creates nothing', () => {
    let id: string | null = 'x';
    let updates = countUpdates(doc, () => {
      id = createConnector(doc, attached(''), free(0, 0), 'dana');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);

    id = 'x';
    updates = countUpdates(doc, () => {
      id = createConnector(doc, free(Number.NaN, 0), attached('B'), 'dana');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);

    id = 'x';
    updates = countUpdates(doc, () => {
      id = createConnector(doc, attached('A', { x: Number.POSITIVE_INFINITY, y: 0 }), free(10, 10), 'dana');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
  });

  // TC-08: an arrow from an object to itself is a mistake, not a drawing.
  it('TC-08 both ends on the same object creates nothing', () => {
    seedObject(doc, 'A', 'sticky', A);
    let id: string | null = 'x';
    const updates = countUpdates(doc, () => {
      id = createConnector(doc, attached('A', { x: 100, y: 50 }), attached('A', { x: 0, y: 50 }), 'dana');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(1);
  });

  // TC-09: a loose arrow needs a length; 7.9 units is nothing, 8 units is an arrow.
  it('TC-09 a free-to-free drag below the minimum length creates nothing', () => {
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);

    let id: string | null = 'x';
    let updates = countUpdates(doc, () => {
      id = createConnector(doc, free(0, 0), free(7.9, 0), 'dana');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);

    id = 'x';
    updates = countUpdates(doc, () => {
      id = createConnector(doc, free(0, 0), free(8, 0), 'dana');
    });
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
  });

  // TC-10: the side an end uses follows the other end and switches at the diagonal.
  it('TC-10 nearestSide follows the other end and switches at the diagonal', () => {
    const centre: Point = { x: 50, y: 50 };
    const radius = 450;
    const at = (degrees: number): Point => ({
      x: centre.x + radius * Math.cos((degrees * Math.PI) / 180),
      y: centre.y - radius * Math.sin((degrees * Math.PI) / 180),
    });
    expect(nearestSide(A, at(0))).toBe('right');
    expect(nearestSide(A, at(44))).toBe('right');
    expect(nearestSide(A, at(46))).toBe('top');
    expect(nearestSide(A, at(90))).toBe('top');
    expect(nearestSide(A, at(180))).toBe('left');
    expect(nearestSide(A, at(270))).toBe('bottom');

    // The offsets are compared against the side lengths, so a wide shape takes a
    // side connector from something far off to the side.
    const wide: Rect = { x: 0, y: 0, width: 400, height: 40 };
    expect(nearestSide(wide, { x: 2000, y: 100 })).toBe('right');
    expect(nearestSide(wide, { x: -2000, y: 100 })).toBe('left');
    expect(nearestSide(wide, { x: 200, y: -2000 })).toBe('top');
    expect(nearestSide(wide, { x: 200, y: 2000 })).toBe('bottom');
    // A point inside the box still gets a definite side.
    expect(['left', 'right', 'top', 'bottom']).toContain(nearestSide(wide, { x: 380, y: 38 }));

    expect(sideAnchor(A, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(A, 'left')).toEqual({ x: 0, y: 50 });
    expect(sideAnchor(A, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(A, 'bottom')).toEqual({ x: 50, y: 100 });
  });

  // TC-10b: an end follows its object, and switches to the facing side when the
  // object passes the other end.
  it('TC-10 an end follows its object and switches side as it passes', () => {
    const ends = connector(attached('A'), attached('B'));
    expect(resolveEndpoints(ends, rects({ A, B }))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 300, y: 50 },
    });

    // B moved to the left of A: the arrow now leaves A's left side.
    expect(resolveEndpoints(ends, rects({ A, B: { x: -200, y: 0, width: 100, height: 100 } }))).toEqual({
      from: { x: 0, y: 50 },
      to: { x: -100, y: 50 },
    });

    // B above A.
    expect(resolveEndpoints(ends, rects({ A, B: { x: 0, y: -300, width: 100, height: 100 } }))).toEqual({
      from: { x: 50, y: 0 },
      to: { x: 50, y: -200 },
    });

    // Growing B moves the end with it.
    expect(resolveEndpoints(ends, rects({ A, B: { x: 300, y: 0, width: 200, height: 100 } }))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 300, y: 50 },
    });
  });

  // TC-11: an end whose object is gone is drawn at its fallback point, and
  // nothing throws.
  it('TC-11 an end pointing at a missing object keeps its fallback', () => {
    const id = createConnector(doc, attached('gone', { x: 120, y: 20 }), free(400, 20), 'dana')!;
    const storedConnector = readConnector(id, stored(doc, id))!;
    expect(storedConnector.from).toEqual({ kind: 'attached', objectId: 'gone', fallback: { x: 120, y: 20 } });

    const ends = resolveEndpoints(storedConnector, new Map());
    expect(ends.from).toEqual({ x: 120, y: 20 });
    expect(ends.to).toEqual({ x: 400, y: 20 });

    // A board where the target never existed still draws the arrow.
    const snap = snapshot(doc).find((object) => object.id === id)!;
    expect(snap.type).toBe('connector');
    expect({ x: snap.x, y: snap.y, width: snap.width, height: snap.height }).toEqual({
      x: 120,
      y: 20,
      width: 280,
      height: 0,
    });
  });

  // TC-12: one end at a time; the object at the other end is refused.
  it('TC-12 setConnectorEndpoint moves one end and refuses the opposite object', () => {
    seedObject(doc, 'A', 'sticky', A);
    seedObject(doc, 'B', 'sticky', B, 2);
    seedObject(doc, 'C', 'sticky', { x: 0, y: 300, width: 100, height: 100 }, 3);
    const id = createConnector(doc, attached('A', { x: 100, y: 50 }), attached('B', { x: 300, y: 50 }), 'dana')!;

    // Loose: the end becomes a point on the board.
    let ok = false;
    let updates = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, id, 'to', free(300, 40));
    });
    expect(ok).toBe(true);
    expect(updates).toBe(1);
    let storedConnector = readConnector(id, stored(doc, id))!;
    expect(storedConnector.to).toEqual({ kind: 'free', x: 300, y: 40 });
    expect(storedConnector.from).toEqual({ kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } });

    // Re-attached to a different object.
    ok = false;
    updates = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, id, 'to', attached('C', { x: 50, y: 300 }));
    });
    expect(ok).toBe(true);
    expect(updates).toBe(1);
    storedConnector = readConnector(id, stored(doc, id))!;
    expect(storedConnector.to).toEqual({ kind: 'attached', objectId: 'C', fallback: { x: 50, y: 300 } });

    // The object at the other end: refused, and nothing written.
    ok = true;
    updates = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, id, 'to', attached('A', { x: 100, y: 50 }));
    });
    expect(ok).toBe(false);
    expect(updates).toBe(0);
    expect(readConnector(id, stored(doc, id))!.to).toEqual({
      kind: 'attached',
      objectId: 'C',
      fallback: { x: 50, y: 300 },
    });

    // The same end it already has is not worth a transaction either.
    ok = true;
    updates = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, id, 'to', attached('C', { x: 50, y: 300 }));
    });
    expect(ok).toBe(false);
    expect(updates).toBe(0);

    // A non-finite point is refused.
    ok = true;
    updates = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, id, 'to', free(Number.NaN, 0));
    });
    expect(ok).toBe(false);
    expect(updates).toBe(0);
  });

  // TC-13: deleting a connected object frees the ends pointing at it, in the same
  // transaction as the delete, and leaves the other end attached.
  it('TC-13 deleting an object frees the ends attached to it in one update', () => {
    seedObject(doc, 'A', 'sticky', A);
    seedObject(doc, 'B', 'sticky', B, 2);
    const id = createConnector(doc, attached('A', { x: 100, y: 50 }), attached('B', { x: 300, y: 50 }), 'dana')!;

    let removed = 0;
    const updates = countUpdates(doc, () => {
      removed = deleteObjects(doc, ['A']);
    });
    expect(removed).toBe(1);
    // One transaction: the arrow is re-written inside the delete.
    expect(updates).toBe(1);
    expect(doc.getMap<Y.Map<unknown>>('objects').has('A')).toBe(false);

    const storedConnector = readConnector(id, stored(doc, id))!;
    // Freed where it was drawn: the middle of A's right side.
    expect(storedConnector.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(storedConnector.to).toEqual({ kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } });

    // The remaining end still follows its object.
    const ends = resolveEndpoints(storedConnector, rects({ B: { x: 400, y: 0, width: 100, height: 100 } }));
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(ends.to).toEqual({ x: 400, y: 50 });

    // Detaching a second time writes nothing.
    const again = countUpdates(doc, () => {
      detachConnectorsTo(doc, ['A']);
    });
    expect(again).toBe(0);
  });

  // TC-14: selecting an arrow is a distance to its line, in world units at the
  // current zoom — the tolerance is 6 screen pixels.
  it('TC-14 distanceToPolyline measures the gap to the line', () => {
    const ends = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
    expect(distanceToPolyline(ends, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(ends, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(ends, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 6);
    // At zoom 2 the tolerance in world units is half as big.
    expect(distanceToPolyline(ends, { x: 50, y: 3 }) <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(true);
    expect(distanceToPolyline(ends, { x: 50, y: 3.01 }) <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(false);
    // Past the ends the nearest thing on the line is that end.
    expect(distanceToPolyline(ends, { x: 120, y: 0 })).toBeCloseTo(20);
    expect(distanceToPolyline(ends, { x: -3, y: -4 })).toBeCloseTo(5);
    // Degenerate input.
    expect(distanceToPolyline([], { x: 1, y: 1 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBeCloseTo(5);
    expect(distanceToPolyline(ends, { x: Number.NaN, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    // A polyline with an elbow is measured along every segment.
    const elbow = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(elbow, { x: 100, y: 50 })).toBe(0);
  });

  // TC-14b: the arrow's box is the box of its two resolved ends.
  it('TC-14 connectorBBox covers the resolved ends', () => {
    const ends = resolveEndpoints(connector(attached('A'), attached('B')), rects({ A, B }));
    expect(connectorBBox(ends.from, ends.to)).toEqual({ x: 100, y: 50, width: 200, height: 0 });

    const low = resolveEndpoints(connector(attached('A'), attached('B')), rects({ A, B: { x: 300, y: 200, width: 100, height: 100 } }));
    expect(connectorBBox(low.from, low.to)).toEqual({ x: 100, y: 50, width: 200, height: 200 });

    // A loose end takes part in the box. The arrow leaves B through its bottom
    // edge, because 450 units of drop beats 400 of sideways reach once each is
    // divided by its own side length.
    const drooping = resolveEndpoints(connector(free(-50, 500), attached('B')), rects({ B }));
    expect(connectorBBox(drooping.from, drooping.to)).toEqual({ x: -50, y: 100, width: 400, height: 400 });
  });

  // TC-14c: overlapping objects still get finite ends, each on its own boundary.
  it('TC-14 overlapping objects keep finite ends', () => {
    const overlap = rects({ A, B: { x: 60, y: -20, width: 100, height: 100 } });
    const ends = resolveEndpoints(connector(attached('A'), attached('B')), overlap);
    const boxB: Rect = { x: 60, y: -20, width: 100, height: 100 };
    expect(onBoundary(ends.from, A)).toBe(true);
    expect(onBoundary(ends.to, boxB)).toBe(true);
    expect(Number.isFinite(connectorBBox(ends.from, ends.to).width)).toBe(true);
  });

  // TC-29: a connector that is gone cannot be rewritten — the handle was in the
  // air while somebody else deleted the arrow.
  it('TC-29 setConnectorEndpoint on a deleted connector returns false', () => {
    seedObject(doc, 'A', 'sticky', A);
    seedObject(doc, 'B', 'sticky', B, 2);
    const id = createConnector(doc, attached('A', { x: 100, y: 50 }), attached('B', { x: 300, y: 50 }), 'dana')!;
    deleteObjects(doc, [id]);

    let ok = true;
    const updates = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, id, 'to', free(10, 10));
    });
    expect(ok).toBe(false);
    expect(updates).toBe(0);

    // And a record that is not a connector at all.
    seedObject(doc, 'note', 'sticky', { x: 500, y: 0, width: 100, height: 100 });
    ok = true;
    const other = countUpdates(doc, () => {
      ok = setConnectorEndpoint(doc, 'note', 'to', free(10, 10));
    });
    expect(ok).toBe(false);
    expect(other).toBe(0);
  });

  // Moving an arrow drags the ends that are loose and leaves attached ones to
  // their objects; a fully attached arrow does not move at all.
  it('moving a connector drags its free ends only', () => {
    seedObject(doc, 'A', 'sticky', A);
    const id = createConnector(doc, attached('A', { x: 100, y: 50 }), free(300, 50), 'dana')!;
    // Its position is derived, so the record carries no x/y of its own: the
    // gesture targets the box the snapshot reports.
    const snap = snapshot(doc).find((object) => object.id === id)!;
    expect(snap.x).toBe(100);

    moveObjects(doc, new Map([[id, { x: snap.x + 20, y: snap.y + 40 }]]));

    expect(readConnector(id, stored(doc, id))!.to).toEqual({ kind: 'free', x: 320, y: 90 });
    expect(readConnector(id, stored(doc, id))!.from).toEqual({
      kind: 'attached',
      objectId: 'A',
      fallback: { x: 100, y: 50 },
    });
    // The record keeps the common fields, but they say nothing: an arrow's box is
    // always derived from its ends, never read back out of these numbers.
    expect(stored(doc, id).get('x')).toBe(0);
    expect(stored(doc, id).get('width')).toBe(0);
    const moved = snapshot(doc).find((object) => object.id === id)!;
    // The attached end pins one side of the box; only the loose end moved.
    expect({ x: moved.x, y: moved.y, width: moved.width, height: moved.height }).toEqual({
      x: 100,
      y: 50,
      width: 220,
      height: 40,
    });
  });

  // An unreadable end must not throw and must not reach the renderer.
  it('a connector with an unreadable end is left out of the snapshot', () => {
    seedObject(doc, 'A', 'sticky', A);
    const id = createConnector(doc, attached('A', { x: 100, y: 50 }), free(300, 50), 'dana')!;
    // Corrupt one end the way a hand-edited or half-migrated record would be.
    const broken = new Y.Map<unknown>();
    broken.set('kind', 'free');
    broken.set('x', 'far');
    (stored(doc, id) as Y.Map<unknown>).set('to', broken);

    expect(readConnector(id, stored(doc, id))).toBeNull();
    expect(snapshot(doc).map((object) => object.id)).toEqual(['A']);
    expect(() => snapshot(doc)).not.toThrow();
  });
});

/** Is `p` on the boundary of `rect` (within a rounding epsilon)? */
function onBoundary(p: Point, rect: Rect): boolean {
  const epsilon = 1e-6;
  const inside =
    p.x >= rect.x - epsilon &&
    p.x <= rect.x + rect.width + epsilon &&
    p.y >= rect.y - epsilon &&
    p.y <= rect.y + rect.height + epsilon;
  const onEdge =
    Math.abs(p.x - rect.x) < epsilon ||
    Math.abs(p.x - (rect.x + rect.width)) < epsilon ||
    Math.abs(p.y - rect.y) < epsilon ||
    Math.abs(p.y - (rect.y + rect.height)) < epsilon;
  return inside && onEdge;
}
