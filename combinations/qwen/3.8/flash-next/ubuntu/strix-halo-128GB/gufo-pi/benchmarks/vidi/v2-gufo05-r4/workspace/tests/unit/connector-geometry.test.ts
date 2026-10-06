/**
 * Story 10 unit tests for the connector model and its geometry (schema: `connector.model`):
 * TC-07 to TC-13 and TC-29.
 *
 * The model is a real `Y.Doc` because the rules under test are document rules — one
 * transaction per arrow, a rejected arrow that costs no update, an endpoint that is rewritten
 * atomically when an object is deleted. The geometry is pure: an anchor is the midpoint of a
 * side, and "nearest" is decided by the rect's own diagonals, which is what makes an arrow
 * that goes round the corner snap to a sensible side.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { boardObjects, moveObjects, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  createConnector,
  setConnectorEndpoint,
  CONNECTOR_OBJECT_TYPE,
  type ConnectorEndpoint,
  type ConnectorSnap
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  arrowheadPath,
  connectorBBox,
  nearestSide,
  polylinePath,
  resolveEndpoints,
  sideAnchor
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point, Rect } from '../../src/shared/geometry';

function updatesDuring(doc: Y.Doc, run: () => void): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return updates;
}

function snapOf(doc: Y.Doc, id: string): ConnectorSnap {
  const found = boardObjects(doc).find((object: ObjectSnapshot) => object.id === id);
  if (!found) throw new Error(`object ${id} is not in the snapshot`);
  return found as ConnectorSnap;
}

function raw(doc: Y.Doc, id: string, key: string): ConnectorEndpoint | undefined {
  const map = doc.getMap<Y.Map<unknown>>('objects').get(id);
  const value = map?.get(key);
  return value instanceof Y.Map ? decodeEndpoint(value) : undefined;
}

/** What the document holds for one end, decoded back into the shape it was written as. */
function decodeEndpoint(value: Y.Map<unknown>): ConnectorEndpoint {
  const kind = value.get('kind');
  if (kind === 'attached') {
    const fallback = value.get('fallback') as Y.Map<number>;
    return { kind: 'attached', objectId: String(value.get('objectId')), fallback: { x: fallback.get('x')!, y: fallback.get('y')! } };
  }
  return { kind: 'free', x: Number(value.get('x')), y: Number(value.get('y')) };
}

/**
 * Two shapes 300 board units apart: A from 0 to 100, B from 400 to 500, both 100 tall.
 * Every anchor in these tests is one of their side midpoints.
 */
function twoShapes(): { doc: Y.Doc; a: string; b: string } {
  const doc = new Y.Doc();
  const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'ana');
  const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'ana');
  if (!a || !b) throw new Error('the fixture could not draw two shapes');
  return { doc, a, b };
}

function rectsOf(a: Rect, b: Rect): Map<string, Rect> {
  return new Map([
    ['a', a],
    ['b', b]
  ]);
}

const A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const B: Rect = { x: 400, y: 0, width: 100, height: 100 };

describe('connector geometry (connector.model)', () => {
  it('TC-10: an anchor is the midpoint of the side it names', () => {
    expect(sideAnchor(A, 'left')).toEqual({ x: 0, y: 50 });
    expect(sideAnchor(A, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(A, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(A, 'bottom')).toEqual({ x: 50, y: 100 });
    // A negative rect: a rect is defined by its own numbers, not by being in the positive.
    expect(sideAnchor({ x: -40, y: -40, width: 20, height: 60 }, 'bottom')).toEqual({ x: -30, y: 20 });
  });

  it('TC-10: the nearest side switches at the rect diagonals, not at 45 degrees of a circle', () => {
    const centre = { x: 50, y: 50 };
    const orbit = (degrees: number): Point => {
      const radians = (degrees * Math.PI) / 180;
      return { x: centre.x + 300 * Math.cos(radians), y: centre.y - 300 * Math.sin(radians) };
    };
    expect(nearestSide(A, orbit(0))).toBe('right');
    expect(nearestSide(A, orbit(44))).toBe('right');
    expect(nearestSide(A, orbit(46))).toBe('top');
    expect(nearestSide(A, orbit(90))).toBe('top');
    // The other three quadrants, and the diagonal of a wide rect: a rect twice as wide
    // switches later, because "nearest" means the shortest way out of this shape.
    expect(nearestSide(A, orbit(180))).toBe('left');
    expect(nearestSide(A, orbit(270))).toBe('bottom');
    const wide: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(nearestSide(wide, { x: 300, y: 120 })).toBe('right');
    expect(nearestSide(wide, { x: 300, y: 200 })).toBe('bottom');
    // The direction that is nothing at all still answers with a side instead of NaN.
    expect(['left', 'right', 'top', 'bottom']).toContain(nearestSide(A, { x: 50, y: 50 }));
  });

  it('TC-29: the distance to a polyline is perpendicular inside a segment, endpoint-wise outside it', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ];
    expect(distanceToPolyline(line, { x: 50, y: 3 })).toBeCloseTo(3, 6);
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 100, y: 60 })).toBe(0);
    // Past the start: the distance to the first endpoint, not to the infinite line.
    expect(distanceToPolyline(line, { x: -6, y: -8 })).toBeCloseTo(10, 6);
    // Past the corner, the second segment is nearer than either endpoint.
    expect(distanceToPolyline(line, { x: 104, y: 40 })).toBeCloseTo(4, 6);
    // A one-point polyline is a dot; an empty one is nowhere, and the furthest thing from it.
    expect(distanceToPolyline([{ x: 10, y: 10 }], { x: 13, y: 14 })).toBeCloseTo(5, 6);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    // A segment of zero length is a dot at its own position.
    expect(distanceToPolyline([{ x: 5, y: 5 }, { x: 5, y: 5 }], { x: 5, y: 9 })).toBeCloseTo(4, 6);
  });

  it('TC-29: the drawn path is the polyline, and the arrowhead points where the line goes', () => {
    expect(polylinePath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }])).toBe('M 0 0 L 10 5 L 20 0');
    expect(polylinePath([{ x: 1.5, y: -2 }])).toBe('M 1.5 -2');
    expect(polylinePath([])).toBe('');

    const head = arrowheadPath({ x: 0, y: 50 }, { x: 100, y: 50 }, 10);
    // Tip at the end point, base pulled back along the line, symmetric about it.
    expect(head).toContain('100 50');
    expect(head).toContain('90 45');
    expect(head).toContain('90 55');
    expect(head.startsWith('M')).toBe(true);
    expect(head.endsWith('Z')).toBe(true);
    // A line with no direction has no arrowhead: drawing one would be a guess.
    expect(arrowheadPath({ x: 7, y: 7 }, { x: 7, y: 7 }, 10)).toBe('');
  });

  it('TC-12: the bounding box of an arrow covers both ends, whichever way it runs', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 110, y: 20 })).toEqual({ x: 10, y: 20, width: 100, height: 0 });
    expect(connectorBBox({ x: 110, y: 20 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 100, height: 0 });
    expect(connectorBBox({ x: -30, y: -40 }, { x: 10, y: -10 })).toEqual({ x: -30, y: -40, width: 40, height: 30 });
  });

  it('TC-11: a free end is exact, and an attached end with no object falls back', () => {
    const free = { kind: 'free', x: 123, y: 456 } as const;
    const attached = { kind: 'attached', objectId: 'gone', fallback: { x: 12, y: 34 } } as const;
    const resolved = resolveEndpoints({ from: attached, to: free }, rectsOf(A, B));
    expect(resolved.to).toEqual({ x: 123, y: 456 });
    expect(resolved.from).toEqual({ x: 12, y: 34 });
    // Both ends missing their objects: the arrow is still drawable, so a broken reference
    // never makes an arrow vanish from a board that is otherwise fine.
    const both = resolveEndpoints(
      {
        from: { kind: 'attached', objectId: 'gone', fallback: { x: 1, y: 2 } },
        to: { kind: 'attached', objectId: 'also-gone', fallback: { x: 3, y: 4 } }
      },
      rectsOf(A, B)
    );
    expect(both).toEqual({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
  });

  it('TC-07: an arrow between two shapes stores both ends tied, with an anchor each', () => {
    const { doc, a, b } = twoShapes();
    let id = '';
    const updates = updatesDuring(doc, () => {
      const created = createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'attached', objectId: b } }, 'ana');
      if (!created) throw new Error('the arrow was refused');
      id = created;
    });

    expect(updates).toBe(1);
    // Right side of A, left side of B: the sides facing each other.
    expect(raw(doc, id, 'from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(raw(doc, id, 'to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });

    const snap = snapOf(doc, id);
    expect(snap.type).toBe(CONNECTOR_OBJECT_TYPE);
    expect(snap.from.kind).toBe('attached');
    // The snapshot's box is derived from the resolved ends, so selection and marquee work
    // on an arrow the same way they work on anything else.
    expect({ x: snap.x, y: snap.y, width: snap.width, height: snap.height }).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 0
    });
  });

  it('TC-08: the drawn line follows the objects it is tied to', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'attached', objectId: b } }, 'ana');
    if (!id) throw new Error('the arrow was refused');
    const snap = snapOf(doc, id);

    moveObjects(doc, new Map([[b, { x: 400, y: 250 }]]));
    const moved = snapOf(doc, id);
    const ends = resolveEndpoints(moved, rectsByBounds(doc));
    // A did not move, so its end is where it was; B moved down and to the right of A still,
    // so its end stays on the side facing A.
    expect(ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 300 } });
    // The stored tie is untouched: only the objects moved.
    expect(moved.from).toEqual(snap.from);
    expect(moved.to).toEqual(snap.to);
  });
});

describe('the connector model (connector.model)', () => {
  it('TC-09: an arrow that is not an arrow is refused with no update', () => {
    const { doc, a, b } = twoShapes();
    const updates = updatesDuring(doc, () => {
      // Tied to the same object at both ends.
      expect(createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'attached', objectId: a } }, 'ana')).toBeNull();
      // Two free ends in the same place: a line of no length.
      expect(createConnector(doc, { from: { kind: 'free', x: 250, y: 50 }, to: { kind: 'free', x: 250, y: 50 } }, 'ana')).toBeNull();
      // A free end dropped exactly on the anchor it would resolve to.
      expect(createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'free', x: 100, y: 50 } }, 'ana')).toBeNull();
      // An end that is not an end.
      expect(createConnector(doc, { from: null as never, to: { kind: 'attached', objectId: b } }, 'ana')).toBeNull();
      expect(createConnector(doc, { from: { kind: 'attached', objectId: '' }, to: { kind: 'attached', objectId: b } }, 'ana')).toBeNull();
      expect(createConnector(doc, { from: { kind: 'free', x: Number.NaN, y: 10 }, to: { kind: 'attached', objectId: b } }, 'ana')).toBeNull();
      // An end tied to something that is not on the board: the tool cannot hit-test to one,
      // and a stale id would be an arrow pointed at a memory.
      expect(createConnector(doc, { from: { kind: 'attached', objectId: 'no-such-object' }, to: { kind: 'attached', objectId: b } }, 'ana')).toBeNull();
    });
    expect(updates).toBe(0);
    expect(boardObjects(doc)).toHaveLength(2);
  });

  it('TC-13: an end can be re-tied to another object, with the anchor worked out here', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'attached', objectId: b } }, 'ana');
    if (!id) throw new Error('the arrow was refused');
    const c = createShape(doc, { kind: 'ellipse', rect: { x: 100, y: 400, width: 100, height: 100 }, at: { x: 100, y: 400 } }, 'ana');
    if (!c) throw new Error('the fixture could not draw a third shape');

    let applied = false;
    const updates = updatesDuring(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    // B is out of the arrow, and the new anchor is the side of C nearest A: C's top.
    expect(raw(doc, id, 'to')).toEqual({ kind: 'attached', objectId: c, fallback: { x: 150, y: 400 } });
    const snap = snapOf(doc, id);
    expect(snap.to.kind).toBe('attached');
    expect(snap.from.kind).toBe('attached');
    // A's end is no longer facing B across the board, it is facing C below it, so it leaves
    // from A's bottom; the two ends are always the pair they resolve to together.
    expect(resolveEndpoints(snap, rectsByBounds(doc))).toEqual({ from: { x: 50, y: 100 }, to: { x: 150, y: 400 } });
  });

  it('TC-13: an end can be dropped on empty board, and bad requests write nothing', () => {
    const { doc, a, b } = twoShapes();
    const id = createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'attached', objectId: b } }, 'ana');
    if (!id) throw new Error('the arrow was refused');

    // Tying the head to the object the tail is already tied to would be an arrow pointing at
    // itself, so it is refused before anything moves.
    const selfTied = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a })).toBe(false);
    });
    expect(selfTied).toBe(0);

    let applied = false;
    const updates = updatesDuring(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 700, y: 80 });
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    expect(raw(doc, id, 'from')).toEqual({ kind: 'free', x: 700, y: 80 });
    expect(resolveEndpoints(snapOf(doc, id), rectsByBounds(doc)).from).toEqual({ x: 700, y: 80 });

    const refused = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, 'no-such-arrow', 'to', { kind: 'free', x: 1, y: 1 })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'middle' as never, { kind: 'free', x: 1, y: 1 })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', null as never)).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: '' })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 1, y: Number.NaN })).toBe(false);
      // An end pointed at an object that is not on the board.
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: 'no-such-object' })).toBe(false);
      // An end dropped on the other end of the arrow, which would leave a line of no length.
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 700, y: 80 })).toBe(false);
      // An end dropped where the arrow already ends is not a change.
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: b })).toBe(false);
    });
    expect(refused).toBe(0);
    expect(raw(doc, id, 'to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
  });

  it('TC-13: an arrow is stored with both ends from the start, so no reader ever sees half of one', () => {
    const { doc, a } = twoShapes();
    let id = '';
    const updates = updatesDuring(doc, () => {
      const created = createConnector(doc, { from: { kind: 'attached', objectId: a }, to: { kind: 'free', x: 250, y: 300 } }, 'ana');
      if (!created) throw new Error('the arrow was refused');
      id = created;
    });
    // One update for both ends and the common fields.
    expect(updates).toBe(1);
    expect(boardObjects(doc).filter((object) => object.type === CONNECTOR_OBJECT_TYPE)).toHaveLength(1);
    expect(raw(doc, id, 'from')?.kind).toBe('attached');
    expect(raw(doc, id, 'to')).toEqual({ kind: 'free', x: 250, y: 300 });
    // A's free end is below and to the right of it, so the tied end leaves from A's bottom.
    expect(resolveEndpoints(snapOf(doc, id), rectsByBounds(doc))).toEqual({ from: { x: 50, y: 100 }, to: { x: 250, y: 300 } });
  });
});

/** Every object's box by id, the way the client builds it for `resolveEndpoints`. */
function rectsByBounds(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of boardObjects(doc)) {
    if (object.type === CONNECTOR_OBJECT_TYPE) continue;
    rects.set(object.id, {
      x: object.x,
      y: object.y,
      width: typeof object.width === 'number' ? object.width : 0,
      height: typeof object.height === 'number' ? object.height : 0
    });
  }
  return rects;
}
