// `connector.model` and `connectors.geometry` — the arrow's document contract and the
// maths it is drawn with, tested against a real Y.Doc.
//
// TC-07 to TC-14 plus TC-29. An arrow stores what it points at and no position of its
// own, so the interesting questions are all about resolution: which side of a shape an
// end leaves from, what happens when the shape it points at is gone, and what a delete
// does to the arrow that survived it.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
//       (connector.model, connectors.geometry)
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  deleteObject,
  deleteObjects,
  initDoc,
  moveObject,
  objectBounds,
  snapshotObjects,
} from '../../src/shared/board-model';
import { createShape, type CreateShapeOptions } from '../../src/shared/objects/shape';
import {
  connectorSnapshots,
  createConnector,
  detachConnectorsTo,
  isConnectorSnapshot,
  readConnectorSnapshot,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  SIDES,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point, Rect } from '../../src/shared/geometry';

const CREATED_BY = 'g_test';

const seed = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const objects = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>('objects');

const raw = (doc: Y.Doc, id: string): Y.Map<unknown> => {
  const object = objects(doc).get(id);
  if (!(object instanceof Y.Map)) throw new Error(`"${id}" is not in the document`);
  return object;
};

/** Count the transactions that touched the document while `body` ran. */
const updatesDuring = (doc: Y.Doc, body: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  body();
  doc.off('update', observer);
  return updates;
};

/** A shape at a known rectangle, for arrows to point at. */
const shapeAt = (doc: Y.Doc, x: number, y: number, width = 100, height = 100): string => {
  const options: CreateShapeOptions = { kind: 'rect', rect: { x, y, width, height } };
  const id = createShape(doc, options, CREATED_BY);
  if (id === null) throw new Error('the test shape was refused');
  return id;
};

const attached = (objectId: string, fallback?: Point): Endpoint =>
  ({ kind: 'attached', objectId, ...(fallback ? { fallback } : {}) });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

/** Every object's box, the way the renderer resolves ends against them. */
const rectsOf = (doc: Y.Doc): Map<string, Rect> =>
  new Map(
    snapshotObjects(doc)
      .filter((object) => !isConnectorSnapshot(object))
      .map((object) => [object.id, objectBounds(object)]),
  );

describe('connector geometry (connectors.geometry)', () => {
  const box: Rect = { x: 0, y: 0, width: 200, height: 100 };

  it('anchors an end at the midpoint of the side it leaves from', () => {
    expect(sideAnchor(box, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(box, 'right')).toEqual({ x: 200, y: 50 });
    expect(sideAnchor(box, 'bottom')).toEqual({ x: 100, y: 100 });
    expect(sideAnchor(box, 'left')).toEqual({ x: 0, y: 50 });
  });

  // TC-10: the side an arrow leaves from turns over exactly at the diagonal.
  it('TC-10 switches sides at the diagonal as the other end orbits the shape', () => {
    const orbit = (degrees: number, radius = 400): Point => {
      const radians = (degrees * Math.PI) / 180;
      // World y grows downwards, so a positive angle is above the shape.
      return {
        x: box.x + box.width / 2 + radius * Math.cos(radians),
        y: box.y + box.height / 2 - radius * Math.sin(radians),
      };
    };
    expect(nearestSide(box, orbit(0))).toBe('right');
    expect(nearestSide(box, orbit(44))).toBe('right');
    expect(nearestSide(box, orbit(46))).toBe('top');
    expect(nearestSide(box, orbit(90))).toBe('top');
    // The other three sides, for completeness of the same rule.
    expect(nearestSide(box, orbit(91))).toBe('top');
    expect(nearestSide(box, orbit(179))).toBe('left');
    expect(nearestSide(box, orbit(181))).toBe('left');
    expect(nearestSide(box, orbit(270))).toBe('bottom');
    expect(nearestSide(box, orbit(359))).toBe('right');
    // A point dead centre has no side to face, and the answer is still a side.
    expect(SIDES).toContain(nearestSide(box, { x: 100, y: 50 }));
  });

  // TC-11: an arrow whose target is gone is drawn where it was attached.
  it('TC-11 draws an end at its fallback point when its object is missing', () => {
    const fallback = { x: 700, y: 700 };
    const ends = { from: attached('vanished', fallback), to: free(900, 700) };
    let resolved: { from: Point; to: Point } = { from: { x: -1, y: -1 }, to: { x: -1, y: -1 } };
    expect(() => {
      resolved = resolveEndpoints(ends, new Map());
    }).not.toThrow();
    expect(resolved.from).toEqual(fallback);

    // A free end needs nothing: it is stored as a point.
    expect(resolveEndpoints({ from: free(1, 2), to: free(3, 4) }, new Map())).toEqual({
      from: { x: 1, y: 2 },
      to: { x: 3, y: 4 },
    });
    // An end with nothing to fall back to is drawn at the origin rather than NaN.
    expect(
      resolveEndpoints({ from: { kind: 'attached', objectId: 'gone' }, to: free(0, 10) }, new Map())
        .from,
    ).toEqual({ x: 0, y: 0 });
  });

  it('resolves both ends onto the sides that face each other', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const b: Rect = { x: 400, y: 0, width: 100, height: 100 };
    const ends = { from: attached('a'), to: attached('b') };
    expect(resolveEndpoints(ends, new Map([['a', a], ['b', b]]))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 400, y: 50 },
    });
    // Move B above A and the same call answers with a different pair of sides: this
    // is the follow, with nothing stored about it.
    expect(resolveEndpoints(ends, new Map([['a', a], ['b', { x: 0, y: 400, width: 100, height: 100 }]])))
      .toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
  });

  it('gives an arrow a box that is never empty', () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    // A horizontal arrow has no height to speak of, so it gets its own thickness.
    const flat = connectorBBox({ x: 0, y: 10 }, { x: 100, y: 10 }, 2);
    expect(flat.width).toBe(100);
    expect(flat.height).toBe(2);
    // And so has a vertical one.
    expect(connectorBBox({ x: 10, y: 0 }, { x: 10, y: 100 }, 2).width).toBe(2);
  });

  // TC-14: selecting an arrow is a distance to its line, measured exactly.
  it('TC-14 measures the distance to an arrow as the distance to its line', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // The tolerance is in screen pixels, so at 200% it is half as many board units.
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
    // Straight down from the line, so the perpendicular is the answer, not the corner.
    expect(distanceToPolyline(line, { x: 6, y: 6 })).toBe(6);
    // Off the ends it is the distance to the end, not to the infinite line.
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBe(10);
    expect(distanceToPolyline(line, { x: -6, y: 6 })).toBeCloseTo(Math.sqrt(72), 10);
    // Two segments: the perpendicular one is the nearer.
    expect(distanceToPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { x: 99, y: 3 })).toBeCloseTo(1, 10);
    // One point is a point; no points is nothing to hit.
    expect(distanceToPolyline([{ x: 1, y: 1 }], { x: 1, y: 4 })).toBe(3);
    expect(distanceToPolyline([], { x: 1, y: 1 })).toBe(Infinity);
    // A zero-length arrow does not divide by zero.
    expect(distanceToPolyline([{ x: 5, y: 5 }, { x: 5, y: 5 }], { x: 8, y: 9 })).toBe(5);
  });
});

describe('connector object model (connector.model)', () => {
  // TC-07: an arrow between two shapes stores both ends as attached, each with the
  // anchor it was attached at, in one transaction.
  it('TC-07 stores both ends attached, with their anchors as fallbacks', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 400, 0); // 300 board units of clear air between them.

    let id = '';
    const updates = updatesDuring(doc, () => {
      const created = createConnector(doc, attached(a), attached(b), CREATED_BY);
      if (created === null) throw new Error('an arrow between two shapes was refused');
      id = created;
    });
    expect(updates).toBe(1);

    const object = raw(doc, id);
    expect(object.get('type')).toBe('connector');
    expect(object.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(object.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    // Position is derived, so what is stored is nothing of a position.
    expect(object.get('x')).toBe(0);
    expect(object.get('y')).toBe(0);
    expect(object.get('createdBy')).toBe(CREATED_BY);
    expect(raw(doc, a).get('z')).toBeLessThan((object.get('z') as number));

    // The generic snapshot gives the arrow the box it is actually drawn in.
    const arrow = snapshotObjects(doc).find(isConnectorSnapshot);
    expect(arrow?.id).toBe(id);
    expect(arrow?.x).toBe(100);
    expect(arrow?.y).toBeCloseTo(49, 5);
    expect(arrow?.width).toBe(300);
    expect(arrow?.height).toBeCloseTo(2, 5);

    // Reading it back directly agrees, and gives the ends themselves.
    const read = readConnectorSnapshot(doc, id);
    expect(read?.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(connectorSnapshots(doc).map((c) => c.id)).toEqual([id]);
  });

  // TC-08: an arrow from a shape to itself is not a request.
  it('TC-08 refuses an arrow from an object to itself', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const updates = updatesDuring(doc, () => {
      expect(createConnector(doc, attached(a), attached(a), CREATED_BY)).toBeNull();
    });
    expect(updates).toBe(0);
    expect(connectorSnapshots(doc)).toHaveLength(0);
  });

  // TC-09: a drag shorter than the minimum arrow length is a click.
  it('TC-09 refuses an arrow shorter than the minimum length, and takes one at it', () => {
    const doc = seed();
    const short = updatesDuring(doc, () => {
      expect(
        createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), CREATED_BY),
      ).toBeNull();
    });
    expect(short).toBe(0);
    expect(connectorSnapshots(doc)).toHaveLength(0);

    const id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), CREATED_BY);
    expect(id).not.toBeNull();
    // A free end is stored as the point it was let go at, with no fallback needed.
    expect(raw(doc, id as string).get('to')).toEqual({ kind: 'free', x: 8, y: 0 });
  });

  // TC-12: an end handle dragged to empty board, onto another shape, and onto the
  // shape at the other end of the same arrow.
  it('TC-12 moves one end of an arrow and refuses the shape at its other end', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 400, 0);
    const c = shapeAt(doc, 0, 400);
    const id = createConnector(doc, attached(a), attached(b), CREATED_BY);
    if (id === null) throw new Error('the test arrow was refused');

    // To a free point.
    let updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', free(300, 300))).toBe(true);
    });
    expect(updates).toBe(1);
    expect(raw(doc, id).get('to')).toEqual({ kind: 'free', x: 300, y: 300 });
    expect(raw(doc, id).get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });

    // Onto another object: attached again, with the new anchor stored.
    updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    });
    expect(updates).toBe(1);
    const stored = raw(doc, id).get('to') as Endpoint;
    expect(stored.kind).toBe('attached');
    if (stored.kind === 'attached') expect(stored.objectId).toBe(c);

    // The object at the other end of the same arrow: refused, and nothing written.
    updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    });
    expect(updates).toBe(0);
    expect((raw(doc, id).get('to') as Endpoint).kind).toBe('attached');

    // A stale end name, a broken endpoint and a stale connector id are refused too.
    expect(setConnectorEndpoint(doc, id, 'middle' as 'from', free(0, 0))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: '' })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: Number.NaN, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, 'gone', 'from', free(0, 0))).toBe(false);
    // Asking for the end it already has is not a change.
    expect(setConnectorEndpoint(doc, id, 'from', attached(a))).toBe(false);
    // Nor is pointing an arrow at itself.
    expect(setConnectorEndpoint(doc, id, 'from', attached(id))).toBe(false);
  });

  // TC-13: deleting the shape an arrow points at leaves the arrow, drawn where it was.
  it('TC-13 puts an arrow down where its shape used to be, in one transaction', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 400, 0);
    const id = createConnector(doc, attached(a), attached(b), CREATED_BY);
    if (id === null) throw new Error('the test arrow was refused');

    let removed = 0;
    const updates = updatesDuring(doc, () => {
      removed = deleteObjects(doc, [a]);
    });
    expect(removed).toBe(1);
    // One transaction for the detach and the delete together, so one undo step undoes
    // both (story 8 needs this).
    expect(updates).toBe(1);

    expect(objects(doc).has(a)).toBe(false);
    const arrow = readConnectorSnapshot(doc, id);
    expect(arrow).not.toBeNull();
    // The end that was attached to A is now a point, at the anchor it had.
    expect(arrow?.from).toEqual({ kind: 'free', x: 100, y: 50 });
    // The end that was attached to B is still attached, and still follows B.
    expect((arrow?.to as { kind: string }).kind).toBe('attached');
    if (arrow === null || arrow === undefined) throw new Error('the arrow vanished with its shape');
    expect(resolveEndpoints({ from: arrow.from, to: arrow.to }, rectsOf(doc))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 400, y: 50 },
    });

    // Both ends went when the whole board was deleted at once.
    const both = updatesDuring(doc, () => {
      expect(deleteObjects(doc, [b])).toBe(1);
    });
    expect(both).toBe(1);
    expect(readConnectorSnapshot(doc, id)?.to).toEqual({ kind: 'free', x: 400, y: 50 });
    // The arrow outlived both shapes and is still an object on the board.
    expect(snapshotObjects(doc).map((object) => object.id)).toEqual([id]);
  });

  // TC-29: an arrow deleted between the drag and the write is not resurrected.
  it('TC-29 refuses to move the end of an arrow that is already gone', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 400, 0);
    const id = createConnector(doc, attached(a), attached(b), CREATED_BY);
    if (id === null) throw new Error('the test arrow was refused');
    expect(deleteObjects(doc, [id])).toBe(1);

    const updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'from', free(10, 10))).toBe(false);
      expect(readConnectorSnapshot(doc, id)).toBeNull();
      // And the single-object delete keeps arrows too, the same way.
      expect(deleteObject(doc, a)).toBe(true);
    });
    expect(updates).toBe(1);
    // Nothing is left but the arrow that was already deleted.
    expect(objects(doc).has(id)).toBe(false);
  });

  // The document keys are the ones the board knows: no side table, no registry.
  it('stores arrows in the objects map and nowhere else', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 400, 0);
    createConnector(doc, attached(a), attached(b), CREATED_BY);
    // The whole document, as its JSON: two keys, and the arrow is inside one of them.
    const json = doc.toJSON() as { objects: Record<string, unknown>; meta: unknown };
    expect(Object.keys(json).sort()).toEqual(['meta', 'objects']);
    expect(Object.keys(json.objects)).toHaveLength(3); // two shapes and the arrow
  });

  // The follow, at the model level: nobody wrote to the arrow, and it moved.
  it('follows a shape that moved without a single write to the arrow', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 400, 0);
    const id = createConnector(doc, attached(a), attached(b), CREATED_BY);
    if (id === null) throw new Error('the test arrow was refused');
    const before = readConnectorSnapshot(doc, id);

    expect(moveObject(doc, b, 0, 400)).toBe(true);
    const after = readConnectorSnapshot(doc, id);
    expect(after?.to).toEqual(before?.to); // still attached to the same object
    expect(after?.y).not.toBe(before?.y); // and drawn somewhere else

    // Detaching by hand (a remote delete observed as a change) works the same way from
    // the ids alone.
    expect(
      updatesDuring(doc, () => {
        detachConnectorsTo(doc, [b]);
      }),
    ).toBe(1);
    expect(readConnectorSnapshot(doc, id)?.to).toEqual({ kind: 'free', x: 50, y: 400 });
  });

  // An arrow is a shape's length, not a shape's minimum size.
  it('has no minimum size of its own to be squeezed by', () => {
    const doc = seed();
    const a = shapeAt(doc, 0, 0);
    expect(SHAPE_MIN_SIZE_WORLD).toBe(20);
    const b = shapeAt(doc, 30, 0, 10, 10);
    // The shapes are 20 board units apart, which is longer than the shortest arrow.
    const id = createConnector(doc, attached(a), attached(b), CREATED_BY);
    expect(id).not.toBeNull();
  });
});
