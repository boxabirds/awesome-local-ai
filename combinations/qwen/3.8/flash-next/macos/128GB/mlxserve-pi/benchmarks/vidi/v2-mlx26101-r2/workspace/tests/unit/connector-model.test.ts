/**
 * The connector model and its geometry - `tests/unit/connector-model.test.ts`.
 *
 * An arrow stores which *object* each end is attached to and never which side of
 * it, because the side is decided again from the live rectangles every time the
 * board is rendered. That decision is what this file is about, and it is the part
 * of story 10 that a browser would only show slowly: which side an end sits on,
 * when it switches to another side as the object at the other end moves, what
 * happens when the object is gone, and what an arrow costs when it is refused
 * (nothing - no transaction, no sync traffic, no undo step).
 *
 * Every case counts the `update` events the document emits. The geometry
 * functions are called directly where that is the contract
 * ({@link nearestSide}, {@link sideAnchor}, {@link resolveEndpoints},
 * {@link connectorBBox}, {@link distanceToPolyline}) and through the document
 * where the document is the thing under test.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  deleteObjects,
  DOC_OBJECTS_MAP,
  initDoc,
  objectBounds,
  objectSnapshot,
} from '../../src/shared/board-model.js';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
} from '../../src/shared/config.js';
import type { Rect } from '../../src/shared/geometry.js';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Side,
} from '../../src/shared/geometry/connector-geometry.js';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline.js';
import { createShape, type ShapeSnap } from '../../src/shared/objects/shape.js';
import {
  createConnector,
  detachConnectorsTo,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector.js';

const newDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown>>;

/** Count the transactions a call actually puts on the document. */
const countUpdates = (doc: Y.Doc, run: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    run();
  } finally {
    doc.off('update', observer);
  }
  return updates;
};

/** A shape by dragging a rectangle of exactly this box. */
const shape = (doc: Y.Doc, rect: Rect): string => {
  const id = createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'g_local');
  if (typeof id !== 'string') throw new Error('the shape was not created');
  return id;
};

const snapOf = <T,>(doc: Y.Doc, id: string): T => {
  const object = objectSnapshot(doc).find((candidate) => candidate.id === id) as T | undefined;
  if (object === undefined) throw new Error(`no object in the snapshot at ${id}`);
  return object;
};

const connectorOf = (doc: Y.Doc, id: string): ConnectorSnap => snapOf<ConnectorSnap>(doc, id);

/** The rectangles of every object in the document, as the renderer builds them. */
const rectsOf = (doc: Y.Doc): Map<string, Rect> => {
  const rects = new Map<string, Rect>();
  for (const object of objectSnapshot(doc)) rects.set(object.id, objectBounds(object));
  return rects;
};

/** Two shapes 300 units apart, A on the left and B on the right. */
const twoShapes = (doc: Y.Doc): { a: string; b: string } => {
  const a = shape(doc, { x: 0, y: 0, width: 100, height: 100 });
  const b = shape(doc, { x: 400, y: 0, width: 100, height: 100 });
  return { a, b };
};

const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

describe('connector.model: drawing an arrow', () => {
  it('TC-07 stores both ends attached, each with its own side anchor as fallback', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const before = objectSnapshot(doc).length;

    let id = '';
    const updates = countUpdates(doc, () => {
      id = createConnector(doc, attached(a), attached(b), 'g_local') as string;
    });
    expect(typeof id).toBe('string');
    expect(updates).toBe(1);

    const connector = connectorOf(doc, id);
    expect(connector.type).toBe('connector');
    expect(connector.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(connector.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    expect(connector.createdBy).toBe('g_local');

    // The box the selection draws is the box the arrow is drawn in, derived from
    // the ends rather than stored.
    const ends = resolveEndpoints(connector, rectsOf(doc));
    expect(ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(objectBounds(connector)).toEqual(connectorBBox(ends.from, ends.to));
    expect(objectSnapshot(doc)).toHaveLength(before + 1);
  });

  it('TC-08 refuses an arrow from an object to itself', () => {
    const doc = newDoc();
    const { a } = twoShapes(doc);
    let result: string | null = 'not called';
    const updates = countUpdates(doc, () => {
      result = createConnector(doc, attached(a), attached(a), 'g_local');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(2);
  });

  it('TC-09 refuses a free end too short to be an arrow, and keeps the boundary', () => {
    const doc = newDoc();

    let result: string | null = 'not called';
    let updates = countUpdates(doc, () => {
      result = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'g_local');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);

    updates = countUpdates(doc, () => {
      result = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'g_local');
    });
    expect(typeof result).toBe('string');
    expect(updates).toBe(1);
    const connector = connectorOf(doc, result as string);
    expect(connector.from).toEqual(free(0, 0));
    expect(connector.to).toEqual(free(CONNECTOR_MIN_LENGTH_WORLD, 0));
    // The tail is never the arrowhead: a drag in any direction stores the ends as drawn.
    expect(objectBounds(connector)).toEqual({
      x: 0,
      y: 0,
      width: CONNECTOR_MIN_LENGTH_WORLD,
      height: 0,
    });
  });

  it('refuses an endpoint that is not a point or not an object', () => {
    const doc = newDoc();
    const { a } = twoShapes(doc);
    expect(createConnector(doc, free(0, Number.NaN), free(100, 0), 'g_local')).toBeNull();
    expect(createConnector(doc, attached(a), free(Number.POSITIVE_INFINITY, 0), 'g_local')).toBeNull();
    // An attached end needs the object it is attached to.
    expect(createConnector(doc, attached(''), free(100, 0), 'g_local')).toBeNull();
    expect(
      createConnector(doc, { kind: 'dangling' } as unknown as Endpoint, free(100, 0), 'g_local'),
    ).toBeNull();
    expect(objectSnapshot(doc)).toHaveLength(2);
  });
});

describe('connector.model: which side an end sits on', () => {
  /** A square box, and a point at `distance` from its centre at `degrees`. */
  const box: Rect = { x: 0, y: 0, width: 200, height: 200 };
  const orbit = (degrees: number, distance = 400): { x: number; y: number } => {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: 100 + distance * Math.cos(radians),
      // Screen y grows downwards, so a positive angle is anticlockwise on screen.
      y: 100 - distance * Math.sin(radians),
    };
  };

  it('TC-10 keeps the side facing the other end and switches it at the diagonal', () => {
    const cases: [number, Side][] = [
      [0, 'right'],
      [44, 'right'],
      // The 45-degree diagonal of a square is the switch: past it, the point is
      // nearer the top edge than the right edge.
      [46, 'top'],
      [90, 'top'],
      [134, 'top'],
      [136, 'left'],
      [180, 'left'],
      [224, 'left'],
      [226, 'bottom'],
      [270, 'bottom'],
      [314, 'bottom'],
      [316, 'right'],
    ];
    for (const [degrees, expected] of cases) {
      expect(nearestSide(box, orbit(degrees))).toBe(expected);
    }
  });

  it('places each end at the middle of the side facing the other end', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_local') as string;
    const connector = connectorOf(doc, id);
    const rects = rectsOf(doc);

    expect(resolveEndpoints(connector, rects)).toEqual({
      from: sideAnchor(rects.get(a)!, 'right'),
      to: sideAnchor(rects.get(b)!, 'left'),
    });

    // The four side midpoints of a box, which is also where the four connection
    // dots of the Connector tool appear.
    const r: Rect = { x: 10, y: 20, width: 100, height: 60 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 50 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 80 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 50 });
  });

  it('moves an attached end with its object, with nothing written', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_local') as string;
    const rects = rectsOf(doc);
    const before = resolveEndpoints(connectorOf(doc, id), rects);

    // Move B down past A's bottom edge: the end it faces changes side because the
    // rectangles say so, not because anybody rewrote the arrow.
    const moved = new Map(rects);
    moved.set(b, { x: 60, y: 400, width: 100, height: 100 });
    const after = resolveEndpoints(connectorOf(doc, id), moved);
    expect(before).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(after).toEqual({ from: { x: 50, y: 100 }, to: { x: 110, y: 400 } });
    // The stored arrow never mentions a side.
    const stored = objectsMap(doc).get(id)!.get('to') as { kind: string };
    expect(stored.kind).toBe('attached');
  });

  it('TC-11 draws an end at its fallback when its object is gone', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_local') as string;
    const connector = connectorOf(doc, id);
    const rects = rectsOf(doc);
    const fallback = (connector.to as { fallback: { x: number; y: number } }).fallback;

    // B is missing from the rects: the arrow is still drawn, to where it was attached.
    const without = new Map(rects);
    without.delete(b);
    let ends: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
    expect(() => {
      ends = resolveEndpoints(connector, without) as {
        from: { x: number; y: number };
        to: { x: number; y: number };
      };
    }).not.toThrow();
    expect(ends).toEqual({ from: { x: 100, y: 50 }, to: fallback });

    // Both ends missing is still a line, and still no throw.
    expect(() => resolveEndpoints(connector, new Map())).not.toThrow();
  });

  it('connectorBBox encloses the two points however the arrow runs', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 60, y: 90 })).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 70,
    });
    // Upwards and leftwards, which is the same line.
    expect(connectorBBox({ x: 60, y: 90 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 70,
    });
    // A vertical arrow has no width, which is honest: nothing but the line is there.
    expect(connectorBBox({ x: 5, y: 0 }, { x: 5, y: 40 })).toEqual({ x: 5, y: 0, width: 0, height: 40 });
  });
});

describe('connector.model: moving an end', () => {
  it('TC-12 detaches an end, attaches it elsewhere, and refuses the object at the other end', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const c = shape(doc, { x: 0, y: 400, width: 100, height: 100 });
    const id = createConnector(doc, attached(a), attached(b), 'g_local') as string;

    // Release over empty board space: the end is fixed there.
    let applied = false;
    let updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'to', free(300, 250));
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    expect(connectorOf(doc, id).to).toEqual(free(300, 250));

    // Release over another object: it is attached again, with that side as its fallback.
    updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'to', attached(c));
    });
    expect(applied).toBe(true);
    expect(updates).toBe(1);
    const to = connectorOf(doc, id).to;
    expect(to.kind).toBe('attached');
    if (to.kind === 'attached') expect(to.objectId).toBe(c);

    // The object at the other end is not a target: an arrow of no length is not an arrow.
    updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'to', attached(a));
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    if (to.kind === 'attached') expect((connectorOf(doc, id).to as { objectId: string }).objectId).toBe(c);

    // A point that is not a point, and an id that is not there.
    updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'from', free(10, Number.NaN));
      expect(setConnectorEndpoint(doc, 'g_missing', 'to', free(1, 1))).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: Number.POSITIVE_INFINITY, y: 0 } })).toBe(false);
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);

    // An end already where it is asked to go writes nothing.
    updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'to', attached(c));
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-29 ends the interaction with a false on a connector that has been deleted', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_local') as string;
    expect(deleteObjects(doc, [id])).toBe(1);

    let applied = true;
    const updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'to', free(10, 10));
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('connector.model: deleting what an arrow points at', () => {
  it('TC-13 keeps the arrow and fixes its end where the object was', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_local') as string;

    // One delete: one update, holding both the removal and the detaching.
    let removed = 0;
    const updates = countUpdates(doc, () => {
      removed = deleteObjects(doc, [a]);
    });
    expect(removed).toBe(1);
    expect(updates).toBe(1);

    expect(objectsMap(doc).get(a)).toBeUndefined();
    const connector = connectorOf(doc, id);
    // A's last anchor, facing B: the arrow stays exactly where it was drawn.
    expect(connector.from).toEqual(free(100, 50));
    expect(connector.to.kind).toBe('attached');
    expect(resolveEndpoints(connector, rectsOf(doc))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 400, y: 50 },
    });
    expect(objectSnapshot(doc)).toHaveLength(2);
  });

  it('detaches every arrow of every deleted object in the open transaction', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const c = shape(doc, { x: 200, y: 400, width: 100, height: 100 });
    const one = createConnector(doc, attached(a), attached(b), 'g_local') as string;
    const two = createConnector(doc, attached(c), attached(a), 'g_local') as string;

    let removed = 0;
    const updates = countUpdates(doc, () => {
      removed = deleteObjects(doc, [a, c]);
    });
    expect(removed).toBe(2);
    expect(updates).toBe(1);
    expect(connectorOf(doc, one).from.kind).toBe('free');
    // ... but the end aimed at B, which is still on the board, stays attached.
    expect(connectorOf(doc, one).to.kind).toBe('attached');
    expect(connectorOf(doc, two).from.kind).toBe('free');
    expect(connectorOf(doc, two).to.kind).toBe('free');
    // Both arrows are still on the board.
    expect(objectSnapshot(doc).filter((object) => object.type === 'connector')).toHaveLength(2);
  });

  it('detachConnectorsTo leaves a board with no arrows alone', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    let count = -1;
    const updates = countUpdates(doc, () => {
      detachConnectorsTo(doc, [a, b]);
      count = objectSnapshot(doc).length;
    });
    expect(count).toBe(2);
    expect(updates).toBe(0);
    expect(() => detachConnectorsTo(doc, [])).not.toThrow();
  });

  it('a shape still carries its own size, so the arrow has real boxes to aim at', () => {
    const doc = newDoc();
    const id = shape(doc, { x: 0, y: 0, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD });
    expect(objectBounds(snapOf<ShapeSnap>(doc, id)).width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });
});

describe('connector.select: how close a click has to come to the line', () => {
  it('TC-14 measures the distance to the line, not to its box', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);

    // Inside the bounding box but far from the line: the far corner of a long,
    // thin arrow is a long way from the arrow.
    expect(distanceToPolyline(line, { x: 99, y: 40 })).toBeCloseTo(40, 10);
    // Beyond the end of the line it is the distance to the end point.
    expect(distanceToPolyline(line, { x: 130, y: 40 })).toBeCloseTo(50, 10);
    // A diagonal line, which is the case a box test gets most wrong.
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(
      Math.SQRT1_2 * 100,
      8,
    );
    // Not a line at all, which is never "near".
    expect(distanceToPolyline([], { x: 1, y: 1 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 1, y: 1 }], { x: 1, y: 1 })).toBe(Infinity);
    expect(
      distanceToPolyline(
        [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
        { x: 100, y: 60 },
      ),
    ).toBe(0);
  });
});
