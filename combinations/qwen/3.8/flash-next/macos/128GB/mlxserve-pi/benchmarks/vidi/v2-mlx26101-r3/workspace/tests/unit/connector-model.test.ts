import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CONNECTOR_TYPE,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  endpointPoint,
  nearestSide,
  readEndpoint,
  resolveEndpoints,
  sideAnchor,
  type ConnectorEnds,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import {
  asConnectorSnapshot,
  boardRects,
  createConnector,
  detachConnectorsTo,
  getConnectorEnds,
  setConnectorEndpoint,
  type ConnectorSnapshot,
} from '../../src/shared/objects/connector';

/**
 * connector.model unit tests (TC-07 to TC-14, TC-29) against a **real** `Y.Doc`.
 *
 * The claim this suite exists to hold is the one in the story's title - an arrow *follows* what it is
 * attached to - and the way to hold it is to look at where an arrow's ends are drawn *after the board
 * under them has changed*, rather than only at what was written when the arrow was made. An
 * implementation that stored two points and re-wrote them whenever a shape moved would answer TC-07
 * correctly and fail here, on the update count.
 *
 * As in the shape suite, every model case counts `update` events: one per accepted write, none for a
 * rejection, and - the one a screen can never show - none for following a shape somebody else moved.
 */

interface Counted<T> {
  result: T;
  updates: number;
  origins: unknown[];
}

/** Run `run` while counting the doc's `update` events and the origins that caused them. */
function countUpdates<T>(doc: Y.Doc, run: () => T): Counted<T> {
  let updates = 0;
  const origins: unknown[] = [];
  const observer = (_update: Uint8Array, origin: unknown): void => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates, origins };
  } finally {
    doc.off('update', observer);
  }
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsOf(doc).get(id);
}

/** A change that came from another screen: the same document, a different origin. */
function remoteChange<T>(doc: Y.Doc, write: () => T): T {
  let result: T | undefined;
  doc.transact(() => {
    result = write();
  }, 'a-peer-far-away');
  return result as T;
}

/**
 * Two shapes with the sides that face each other 300 units apart, and not on the same line: an arrow
 * between them has a box with a width *and* a height in it, so a derived box cannot be right by
 * accident.
 */
const A_BOX: Rect = { x: 0, y: 100, width: 100, height: 100 };
const B_BOX: Rect = { x: 400, y: 200, width: 100, height: 100 };
const C_BOX: Rect = { x: 0, y: 600, width: 100, height: 100 };

function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Where an end fastened to A, aimed at B, is drawn: the middle of A's right side. */
const A_ANCHOR: Point = { x: 100, y: 150 };
/** ... and the same for B, aimed at A: the middle of B's left side. */
const B_ANCHOR: Point = { x: 400, y: 250 };

/** Two shapes 300 units apart, and the arrow between them. */
function flow(): { doc: Y.Doc; a: string; b: string; arrow: string } {
  const doc = newDoc();
  const a = shape(doc, A_BOX, 'rect');
  const b = shape(doc, B_BOX, 'rect');
  const arrow = createConnector(
    doc,
    { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
    { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
    'me',
  ) as string;
  return { doc, a, b, arrow };
}

function shape(doc: Y.Doc, rect: Rect, kind: 'rect' | 'ellipse' | 'diamond' = 'rect'): string {
  return createShape(doc, { kind, rect, at: centre(rect) }, 'me') as string;
}

function boxOf(doc: Y.Doc, id: string): Rect {
  const object = snapshot(doc).find((candidate) => candidate.id === id);
  if (object === undefined) {
    throw new Error(`no object ${id} on the board`);
  }
  return objectBounds(object);
}

function endsOf(doc: Y.Doc, id: string): ConnectorEnds {
  const ends = getConnectorEnds(doc, id);
  if (ends === null) {
    throw new Error(`no connector ${id} on the board to read`);
  }
  return ends;
}

/** Where a connector's two ends are drawn, given the board as it is now. */
function drawn(doc: Y.Doc, id: string): { from: Point; to: Point } {
  return resolveEndpoints(endsOf(doc, id), boardRects(snapshot(doc)));
}

/** The arrow with this id, as the board reads it; throws when there is not exactly that arrow. */
function arrowOf(doc: Y.Doc, id: string): ConnectorSnapshot {
  const object = snapshot(doc).find((candidate) => candidate.id === id);
  if (object === undefined) {
    throw new Error(`no object ${id} on the board`);
  }
  const connector = asConnectorSnapshot(object);
  if (connector === null) {
    throw new Error(`object ${id} does not read as a connector`);
  }
  return connector;
}

/** The one arrow on the board, as the board reads it. */
function onlyArrow(doc: Y.Doc): ConnectorSnapshot {
  const connectors = snapshot(doc).filter((object) => object.type === CONNECTOR_TYPE);
  if (connectors.length !== 1) {
    throw new Error(`expected exactly one connector, found ${connectors.length}`);
  }
  const connector = asConnectorSnapshot(connectors[0]);
  if (connector === null) {
    throw new Error('the connector on the board does not read as a connector');
  }
  return connector;
}

function arrows(doc: Y.Doc): ConnectorSnapshot[] {
  return snapshot(doc)
    .filter((object) => object.type === CONNECTOR_TYPE)
    .map((object) => asConnectorSnapshot(object))
    .filter((connector): connector is ConnectorSnapshot => connector !== null);
}

describe('connector.geometry: sides, anchors and distances', () => {
  it('TC-10: fastens to the side that faces the other end, and switches at the diagonal', () => {
    const box: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const middle = centre(box);
    const orbit = (degrees: number, distance = 300): Point => ({
      x: middle.x + distance * Math.cos((degrees * Math.PI) / 180),
      // Screen y goes down, so a positive angle is a point *above* the box: an arrow thrown at a
      // shape's upper right is what the degrees in the story mean.
      y: middle.y - distance * Math.sin((degrees * Math.PI) / 180),
    });

    expect(nearestSide(box, orbit(0)), 'due east is the right side').toBe('right');
    expect(nearestSide(box, orbit(44)), 'still under the diagonal, so still the right side').toBe(
      'right',
    );
    expect(nearestSide(box, orbit(46)), 'past the diagonal, so now the top').toBe('top');
    expect(nearestSide(box, orbit(90)), 'due north is the top').toBe('top');

    // The other three quadrants, and the mirror image of the switch.
    expect(nearestSide(box, orbit(135))).toBe('top');
    expect(nearestSide(box, orbit(136))).toBe('left');
    expect(nearestSide(box, orbit(180))).toBe('left');
    expect(nearestSide(box, orbit(224))).toBe('left');
    expect(nearestSide(box, orbit(226))).toBe('bottom');
    expect(nearestSide(box, orbit(270))).toBe('bottom');
    expect(nearestSide(box, orbit(314))).toBe('bottom');
    expect(nearestSide(box, orbit(316))).toBe('right');

    // Exactly on the diagonal takes the vertical sides: one answer, and the same one from both sides
    // of the line, is what keeps two shapes sitting level with each other from having an arrow that
    // changes sides as they are nudged.
    expect(nearestSide(box, { x: middle.x + 100, y: middle.y - 100 })).toBe('right');
    expect(nearestSide(box, middle), 'a point inside the box still has a nearest side').toBe('right');

    // The anchors are the side midpoints, which is the one point that lies on the boundary of a
    // rectangle, an ellipse and a diamond alike - so an arrow touches every kind it is fastened to.
    expect(sideAnchor(box, 'top')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(box, 'right')).toEqual({ x: 300, y: 200 });
    expect(sideAnchor(box, 'bottom')).toEqual({ x: 200, y: 300 });
    expect(sideAnchor(box, 'left')).toEqual({ x: 100, y: 200 });

    // A tall box and a wide box switch at their own diagonals, not at 45 degrees: to get to the bottom
    // of a shape four times as tall as it is wide you have to be much steeper than halfway down.
    const tall: Rect = { x: 0, y: 0, width: 100, height: 400 };
    expect(nearestSide(tall, { x: 300, y: 100 })).toBe('right');
    expect(nearestSide(tall, { x: 100, y: 500 }), 'steep enough for the bottom').toBe('bottom');
    const wide: Rect = { x: 0, y: 0, width: 400, height: 100 };
    expect(nearestSide(wide, { x: 100, y: 300 })).toBe('bottom');
    expect(nearestSide(wide, { x: 500, y: 100 }), 'shallow enough for the right').toBe('right');
    // A box of no size at all still answers, because the board can be asked about anything.
    expect(nearestSide({ x: 5, y: 5, width: 0, height: 0 }, { x: 100, y: 100 })).toBe('right');
  });

  it('TC-14: measures how far a point is from a line, and stops at its ends', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(line, { x: 50, y: -6.01 }), 'above is as far as below').toBeCloseTo(
      6.01,
      10,
    );

    // Past either end the distance is to the end of the line, not to the infinite line through it:
    // an arrow does not go on for ever, and a click beyond its head is not on it.
    expect(distanceToPolyline(line, { x: 150, y: 0 })).toBeCloseTo(50, 10);
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBeCloseTo(10, 10);

    // A polyline of two segments is measured against whichever is nearer, including the joint.
    const bent: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline(bent, { x: 100, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(bent, { x: 110, y: 50 })).toBeCloseTo(10, 10);
    // The nearer of the two segments answers, not the one the point was measured against in one's head:
    // (50, 60) is 60 from the horizontal leg and 50 from the vertical one.
    expect(distanceToPolyline(bent, { x: 50, y: 60 })).toBeCloseTo(50, 10);

    // A line of one point is a point, and of none is nowhere: never a crash, because the answer is
    // asked of a board that may hold anything.
    expect(distanceToPolyline([], { x: 3, y: 4 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 0, y: 0 }], { x: 3, y: 4 })).toBeCloseTo(5, 10);
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(7.07, 2);
  });

  it('reads an endpoint, or nothing, and never invents a point', () => {
    expect(readEndpoint({ kind: 'free', x: 1, y: 2 })).toEqual({ kind: 'free', x: 1, y: 2 });
    expect(readEndpoint({ kind: 'attached', objectId: 'a', fallback: { x: 1, y: 2 } })).toEqual({
      kind: 'attached',
      objectId: 'a',
      fallback: { x: 1, y: 2 },
    });

    // An attached end with no fallback cannot be drawn once its object is gone, so it is not an
    // endpoint at all: defaulting it to (0, 0) would be an arrow pointing at a place nobody aimed at.
    for (const value of [
      { kind: 'attached', objectId: 'a' },
      { kind: 'attached', objectId: '' },
      { kind: 'attached', objectId: 'a', fallback: { x: Number.NaN, y: 1 } },
      { kind: 'free', x: 1, y: Number.POSITIVE_INFINITY },
      { kind: 'corner', x: 1, y: 2 },
      { kind: 'free' },
      'free',
      null,
      undefined,
      42,
    ]) {
      expect(readEndpoint(value), `${JSON.stringify(value)} is not an endpoint`).toBeNull();
    }
  });

  it('TC-11: draws an end whose object is gone at the point it was written at', () => {
    const ends: ConnectorEnds = {
      from: { kind: 'attached', objectId: 'a', fallback: A_ANCHOR },
      to: { kind: 'attached', objectId: 'b', fallback: B_ANCHOR },
    };

    // Both boxes present: each end is on the side of its own box that faces the other.
    const both = new Map<string, Rect>([
      ['a', A_BOX],
      ['b', B_BOX],
    ]);
    expect(resolveEndpoints(ends, both)).toEqual({ from: A_ANCHOR, to: B_ANCHOR });

    // B has left the board. The end stays exactly where it was drawn, which is what "the arrow is
    // still there, with a free end where the shape used to be" means as a function.
    const missing = new Map<string, Rect>([['a', A_BOX]]);
    expect(resolveEndpoints(ends, missing)).toEqual({ from: A_ANCHOR, to: B_ANCHOR });
    expect(resolveEndpoints(ends, new Map())).toEqual({ from: A_ANCHOR, to: B_ANCHOR });
    expect(endpointPoint({ kind: 'free', x: 7, y: 9 }, new Map())).toEqual({ x: 7, y: 9 });

    // A box that has moved has its anchor moved with it - which is the whole of the following.
    const moved = new Map<string, Rect>([
      ['a', A_BOX],
      ['b', { x: -400, y: 200, width: 100, height: 100 }],
    ]);
    expect(resolveEndpoints(ends, moved).to).toEqual({ x: -300, y: 250 });

    // The box an arrow is drawn in, corner to corner: the box the selection outline goes round.
    expect(connectorBBox({ x: 100, y: 150 }, { x: 400, y: 250 })).toEqual({
      x: 100,
      y: 150,
      width: 300,
      height: 100,
    });
    expect(connectorBBox({ x: 400, y: 250 }, { x: 100, y: 150 })).toEqual({
      x: 100,
      y: 150,
      width: 300,
      height: 100,
    });
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('connector.model: createConnector', () => {
  it('TC-07: fastens both ends to the sides that face each other, in one update', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const b = shape(doc, B_BOX);

    const { result: id, updates, origins } = countUpdates(doc, () =>
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
        { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
        'g_test',
      ),
    );

    expect(id).toBeTruthy();
    expect(updates, 'one arrow is one change to the board').toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);

    const connector = arrowOf(doc, id as string);
    expect(connector.type).toBe(CONNECTOR_TYPE);
    expect(connector.createdBy).toBe('g_test');
    // The two objects, not the points: an arrow stores its *cause*. Where each end is drawn is looked
    // up from the boxes every time the board is read, so nothing stored here can go out of date.
    expect(connector.from).toEqual({ kind: 'attached', objectId: a, fallback: A_ANCHOR });
    expect(connector.to).toEqual({ kind: 'attached', objectId: b, fallback: B_ANCHOR });

    // The box the board gives it is where those two anchors put it - the box the selection, the
    // marquee and the hit test all work on.
    expect(boxOf(doc, id as string)).toEqual(connectorBBox(A_ANCHOR, B_ANCHOR));

    // Raw fields, so a mistake here cannot be hidden by the reader.
    const raw = rawObject(doc, id as string);
    expect(typeof raw?.get('createdAt')).toBe('number');
    expect((raw?.get('z') as number) ?? 0).toBeGreaterThan(0);
    expect(raw?.get('label'), 'an arrow has no label to type into').toBeUndefined();
    expect(raw?.get('text'), 'an arrow has no text either').toBeUndefined();
    expect(raw?.get('color'), 'an arrow has no sticky colour').toBeUndefined();
  });

  it('stores an end released over empty space as a point of its own', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'free', x: 900, y: 600 },
      'me',
    ) as string;

    expect(arrowOf(doc, id).from).toEqual({ kind: 'attached', objectId: a, fallback: A_ANCHOR });
    expect(arrowOf(doc, id).to).toEqual({ kind: 'free', x: 900, y: 600 });
    expect(drawn(doc, id)).toEqual({ from: A_ANCHOR, to: { x: 900, y: 600 } });

    // Both ends free is an arrow between two points, and it follows nothing at all.
    const both = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 200, y: 0 },
      'me',
    ) as string;
    expect(drawn(doc, both)).toEqual({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    expect(boxOf(doc, both)).toEqual({ x: 0, y: 0, width: 200, height: 0 });
  });

  it('TC-08: refuses to connect a shape to itself, without a transaction', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);

    const { result, updates } = countUpdates(doc, () =>
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: a, fallback: { x: 500, y: 500 } },
        'me',
      ),
    );
    expect(result, 'an arrow from a shape to itself is not an arrow').toBeNull();
    expect(updates, 'a rejected arrow costs no sync traffic').toBe(0);
    expect(snapshot(doc)).toHaveLength(1);

    // A sticky is an object to connect too, and the same rule holds for it.
    const note = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(
      createConnector(
        doc,
        { kind: 'attached', objectId: note, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: note, fallback: { x: 900, y: 900 } },
        'me',
      ),
    ).toBeNull();
    expect(arrows(doc)).toHaveLength(0);
  });

  it('TC-09: refuses an arrow shorter than the shortest one that can be clicked, and takes exactly that length', () => {
    const doc = newDoc();

    const short = countUpdates(doc, () =>
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, 'me'),
    );
    expect(short.result, '7.9 units of arrow is a click that drifted').toBeNull();
    expect(short.updates).toBe(0);

    const exact = countUpdates(doc, () =>
      createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
        'me',
      ),
    );
    expect(exact.result, `${CONNECTOR_MIN_LENGTH_WORLD} units is an arrow`).toBeTruthy();
    expect(exact.updates).toBe(1);

    // A drag that travelled a long way on the screen but landed on a shape next door is short on the
    // board, and the board is what decides: the length that counts is between the two ends where they
    // are drawn, four units apart here however far the pointer went.
    const doc2 = newDoc();
    const a = shape(doc2, A_BOX);
    const next = shape(doc2, { x: 96, y: 140, width: 20, height: 20 });
    const { updates } = countUpdates(doc2, () =>
      createConnector(
        doc2,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: next, fallback: { x: 500, y: 500 } },
        'me',
      ),
    );
    expect(updates).toBe(0);
    expect(arrows(doc2)).toHaveLength(0);

    // A drag of no length at all, and the same length come from the other side.
    expect(
      createConnector(doc, { kind: 'free', x: 10, y: 10 }, { kind: 'free', x: 10, y: 10 }, 'me'),
    ).toBeNull();
    expect(
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: -5.6, y: -5.7 }, 'me'),
    ).toBeNull();
    expect(arrows(doc)).toHaveLength(1);
  });

  it('TC-06: refuses nonsense without writing any of it', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);

    for (const endpoint of [
      { kind: 'free', x: Number.NaN, y: 0 },
      { kind: 'free', x: 0, y: Number.POSITIVE_INFINITY },
      { kind: 'attached', objectId: a, fallback: { x: Number.NaN, y: 0 } },
      { kind: 'attached', objectId: '', fallback: { x: 0, y: 0 } },
      { kind: 'corner', x: 0, y: 0 },
    ] as unknown as Endpoint[]) {
      const from = countUpdates(doc, () =>
        createConnector(doc, endpoint, { kind: 'free', x: 400, y: 400 }, 'me'),
      );
      expect(from.result, `${JSON.stringify(endpoint)} is not an endpoint`).toBeNull();
      expect(from.updates).toBe(0);
      const to = countUpdates(doc, () =>
        createConnector(doc, { kind: 'free', x: -400, y: -400 }, endpoint, 'me'),
      );
      expect(to.result).toBeNull();
      expect(to.updates).toBe(0);
    }

    // Nobody to credit the arrow with, and nowhere for one end to be.
    expect(
      countUpdates(doc, () =>
        createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 300, y: 0 }, ''),
      ).result,
    ).toBeNull();
    expect(
      countUpdates(doc, () =>
        createConnector(
          doc,
          { kind: 'free', x: Number.NaN, y: 0 },
          { kind: 'free', x: 300, y: 0 },
          'me',
        ),
      ).result,
    ).toBeNull();
    expect(arrows(doc)).toHaveLength(0);
  });

  it('still creates an arrow whose object was deleted while it was being drawn', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    // The other end names an object that is not on the board at all: an arrow aimed at a shape that
    // went away in the same moment (TC-27, in a browser). It is created, and drawn to the point it
    // was aimed at, because the point is the only part of that end that is still true.
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'attached', objectId: 'never-was', fallback: { x: 700, y: 300 } },
      'me',
    ) as string;
    expect(id).toBeTruthy();
    expect(drawn(doc, id)).toEqual({ from: A_ANCHOR, to: { x: 700, y: 300 } });
  });

  it('stacks an arrow above what is already on the board', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const b = shape(doc, B_BOX);
    const arrow = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
      'me',
    ) as string;
    const zOf = (id: string): number => snapshot(doc).find((object) => object.id === id)?.z ?? -1;
    expect(zOf(arrow)).toBeGreaterThan(zOf(a));
    expect(zOf(arrow)).toBeGreaterThan(zOf(b));

    const second = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 100, y: 100 },
      'me',
    ) as string;
    expect(zOf(second)).toBeGreaterThan(zOf(arrow));
  });
});

describe('connector.model: arrows follow what they are attached to', () => {
  it('TC-25 (model): an end moves to the side that faces its object, whoever moved it', () => {
    const { doc, a, b, arrow } = flow();
    expect(drawn(doc, arrow)).toEqual({ from: A_ANCHOR, to: B_ANCHOR });
    const raw = rawObject(doc, arrow);
    const stored = (): string => `${JSON.stringify(raw?.get('from'))}${JSON.stringify(raw?.get('to'))}`;
    const before = stored();

    // A peer drags B above and to the left of A. One update arrives, nothing else is written, and the
    // arrow is simply asked where it is again.
    const { updates } = countUpdates(doc, () => {
      remoteChange(doc, () => {
        moveObjects(doc, new Map([[b, { x: -400, y: -200 }]]));
      });
    });
    expect(updates, 'one remote move is one update; the arrow adds none').toBe(1);

    expect(drawn(doc, arrow)).toEqual({
      from: { x: 0, y: 150 },
      to: { x: -300, y: -150 },
    });
    expect(stored(), 'following writes nothing').toBe(before);

    // The box the board holds for the arrow came with it, so the arrow is selected, marquee'd and
    // clicked in the box its ends are drawn in - not the one it happened to be created in.
    expect(boxOf(doc, arrow)).toEqual(connectorBBox({ x: 0, y: 150 }, { x: -300, y: -150 }));

    // The same for the shape this client moves, which is the shape the other end is fastened to: A is
    // now far below B, so its end is drawn on A's top side, whichever side it started on.
    moveObjects(doc, new Map([[a, { x: 0, y: 900 }]]));
    expect(drawn(doc, arrow).from).toEqual({ x: 50, y: 900 });
  });

  it('TC-10 (model): the side an end is drawn on goes all the way round as its object orbits', () => {
    const { doc, b, arrow } = flow();
    const steps = [
      { at: { x: 400, y: 200 }, side: 'left' },
      { at: { x: 0, y: -200 }, side: 'bottom' },
      { at: { x: -300, y: 100 }, side: 'right' },
      { at: { x: 0, y: 420 }, side: 'top' },
    ] as const;
    for (const step of steps) {
      moveObjects(doc, new Map([[b, step.at]]));
      const rects = boardRects(snapshot(doc));
      const box = rects.get(b) as Rect;
      const aimed = nearestSide(box, centre(A_BOX));
      expect(aimed, `a shape at ${JSON.stringify(step.at)} shows its ${step.side}`).toBe(step.side);
      // The end is drawn exactly where that side's midpoint is.
      expect(resolveEndpoints(endsOf(doc, arrow), rects).to).toEqual(sideAnchor(box, aimed));
    }
  });

  it('leaves an end whose object was deleted at the point it was drawn at, and rewrites nothing', () => {
    const { doc, b, arrow } = flow();
    deleteObjects(doc, [b]);
    expect(objectsOf(doc).has(b)).toBe(false);
    // The end is free now (TC-13 did that); what this case holds is that an end whose object is
    // missing is still drawn at the point it was left at, which is what TC-27 proves in a browser.
    expect(onlyArrow(doc).to.kind).toBe('free');
    expect(drawn(doc, arrow).to).toEqual(B_ANCHOR);
  });
});

describe('connector.model: setConnectorEndpoint', () => {
  it('TC-12: re-fastens an end, and refuses the object at the other end of it', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const b = shape(doc, B_BOX);
    const c = shape(doc, C_BOX, 'ellipse');
    const arrow = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
      'me',
    ) as string;

    // Dragged off B and dropped on empty board: the end becomes the point it was dropped at.
    const freed = countUpdates(doc, () =>
      setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: 800, y: 700 }),
    );
    expect(freed.result).toBe(true);
    expect(freed.updates).toBe(1);
    expect(arrowOf(doc, arrow).to).toEqual({ kind: 'free', x: 800, y: 700 });
    expect(arrowOf(doc, arrow).from, 'the end that was not dragged is untouched').toEqual({
      kind: 'attached',
      objectId: a,
      fallback: A_ANCHOR,
    });

    // Dropped on a third shape: fastened to it, at the side of it that faces the other end.
    const moved = countUpdates(doc, () =>
      setConnectorEndpoint(doc, arrow, 'to', {
        kind: 'attached',
        objectId: c,
        fallback: centre(C_BOX),
      }),
    );
    expect(moved.result).toBe(true);
    expect(moved.updates).toBe(1);
    // The point stored with the new end is the anchor it is drawn at - the midpoint of C's top side,
    // because the other end of this arrow sits above C. It is a fallback, so it only has to be the
    // last honest answer, but writing the anchor rather than where the pointer was let go is what
    // keeps the arrow on the shape's edge when the pointer hovers just inside it.
    expect(arrowOf(doc, arrow).to).toEqual({ kind: 'attached', objectId: c, fallback: { x: 50, y: 600 } });

    // The shape at the other end of this arrow: that would make an arrow with both ends on one shape,
    // which is what TC-08 refuses when it is made and this refuses when it is moved. The client snaps
    // the handle back; nothing was written.
    const same = countUpdates(doc, () =>
      setConnectorEndpoint(doc, arrow, 'to', {
        kind: 'attached',
        objectId: a,
        fallback: centre(A_BOX),
      }),
    );
    expect(same.result, 'an end cannot join the shape the other end is on').toBe(false);
    expect(same.updates).toBe(0);
    expect(arrowOf(doc, arrow).to).toEqual({ kind: 'attached', objectId: c, fallback: { x: 50, y: 600 } });

    // The end that is not being moved can be refused the same way.
    expect(setConnectorEndpoint(doc, arrow, 'from', { kind: 'attached', objectId: c, fallback: { x: 1, y: 1 } })).toBe(
      false,
    );

    // A point that is not a point, an end that is not an end, an object that is not an arrow.
    expect(setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: Number.NaN, y: 4 })).toBe(false);
    expect(setConnectorEndpoint(doc, arrow, 'from', { kind: 'free', x: 4, y: Number.NaN })).toBe(false);
    expect(
      setConnectorEndpoint(doc, arrow, 'middle' as 'from', { kind: 'free', x: 0, y: 0 }),
    ).toBe(false);
    expect(setConnectorEndpoint(doc, a, 'to', { kind: 'free', x: 800, y: 800 }), 'a shape is not an arrow').toBe(
      false,
    );
    expect(setConnectorEndpoint(doc, 'missing-object', 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);

    // Fastened where it already is: not a change, so not a message to anybody else either.
    expect(
      countUpdates(doc, () => setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: 1, y: 1 })).result,
    ).toBe(true);
    expect(
      countUpdates(doc, () => setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: 1, y: 1 })).updates,
    ).toBe(0);

    // An end dragged to within a click of the other end: an arrow that short cannot be found with a
    // cursor afterwards, so the rule that refuses it at creation refuses it here too, and the handle
    // the person was dragging goes back where it came from.
    expect(
      countUpdates(doc, () => setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: 50, y: 104 })).result,
    ).toBe(false);

    // An end fastened to an object that has gone: allowed, and drawn at its fallback - the arrow is
    // never left with an end that cannot be drawn.
    expect(
      setConnectorEndpoint(doc, arrow, 'from', {
        kind: 'attached',
        objectId: 'never-was',
        fallback: { x: 700, y: 700 },
      }),
    ).toBe(true);
    expect(arrowOf(doc, arrow).from).toEqual({
      kind: 'attached',
      objectId: 'never-was',
      fallback: { x: 700, y: 700 },
    });
  });

  it('TC-29: says no to an arrow that is no longer on the board', () => {
    const { doc, a, b, arrow } = flow();
    expect(deleteObjects(doc, [arrow])).toBe(1);
    expect(
      countUpdates(doc, () => setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: 1, y: 2 })).result,
    ).toBe(false);
    expect(
      countUpdates(doc, () => setConnectorEndpoint(doc, arrow, 'to', { kind: 'free', x: 9, y: 9 })).updates,
    ).toBe(0);
    expect(getConnectorEnds(doc, arrow)).toBeNull();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });
});

describe('connector.model: deleting what an arrow is fastened to', () => {
  it('TC-13: keeps the arrow and frees its end, in exactly one update', () => {
    const { doc, a, b, arrow } = flow();
    // B has been dragged somewhere else first, so the point the end is left at has to be where the
    // arrow was *actually drawn*, not where it was written.
    moveObjects(doc, new Map([[b, { x: 400, y: 0 }]]));
    const anchor = drawn(doc, arrow).to;
    expect(anchor).toEqual({ x: 400, y: 50 });

    const { result, updates, origins } = countUpdates(doc, () => deleteObjects(doc, [b]));
    expect(result, 'one shape was deleted').toBe(1);
    expect(updates, 'the shape and the arrow are one change to the board').toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);

    const connector = onlyArrow(doc);
    expect(connector.id).toBe(arrow);
    expect(connector.to).toEqual({ kind: 'free', x: anchor.x, y: anchor.y });
    // The other end is still fastened, and still follows A.
    expect(connector.from).toEqual({ kind: 'attached', objectId: a, fallback: A_ANCHOR });
    expect(objectsOf(doc).has(b)).toBe(false);
    expect(boxOf(doc, arrow)).toEqual(connectorBBox(A_ANCHOR, anchor));
  });

  it('TC-13: gives one undo step, not two, for the delete and the detach', () => {
    const { doc, b, arrow } = flow();
    // Story 8's undo sees a single local transaction for "delete this shape". If detaching the arrow
    // came as a second transaction, undo would leave an arrow fastened to a shape that came back on a
    // later undo, and redo would not put the pair back together.
    const { origins } = countUpdates(doc, () => deleteObjects(doc, [b]));
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(onlyArrow(doc).to.kind).toBe('free');
    expect(arrow).toBeTruthy();
  });

  it('frees both ends when both shapes go, in one update, and leaves a free end alone', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const b = shape(doc, B_BOX);
    const arrow = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
      'me',
    ) as string;
    const loose = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 300, y: 300 },
      'me',
    ) as string;
    const note = createSticky(doc, { x: 900, y: 900 }) as string;

    const { updates } = countUpdates(doc, () => deleteObjects(doc, [a, b, note]));
    expect(updates, 'three objects and two detached ends are still one change').toBe(1);
    const connector = arrowOf(doc, arrow);
    expect(connector.from).toEqual({ kind: 'free', x: A_ANCHOR.x, y: A_ANCHOR.y });
    expect(connector.to).toEqual({ kind: 'free', x: B_ANCHOR.x, y: B_ANCHOR.y });
    expect(arrowOf(doc, loose).to).toEqual({ kind: 'free', x: 300, y: 300 });
    expect(arrows(doc)).toHaveLength(2);
  });

  it('leaves an end at the side it was drawn on when its shape had just been moved', () => {
    const { doc, a, b, arrow } = flow();
    moveObjects(doc, new Map([[a, { x: 200, y: 20 }]]));
    // A is now above and to the left of B, so the end on A sits on A's own bottom side rather than the
    // right side it was created on. Deleting A has to leave the end where the arrow was drawn, not
    // where it was first written - which is the difference between an arrow that stays put and one
    // that jumps.
    const expected = drawn(doc, arrow).from;
    expect(expected).not.toEqual(A_ANCHOR);
    deleteObjects(doc, [a]);
    expect(onlyArrow(doc).from).toEqual({ kind: 'free', x: expected.x, y: expected.y });
    expect(b).toBeTruthy();
  });

  it('detachConnectorsTo writes inside the caller\'s transaction, and only to the ends it is asked about', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const b = shape(doc, B_BOX);
    const arrow = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
      'me',
    ) as string;

    const { updates, origins } = countUpdates(doc, () => {
      doc.transact(() => {
        detachConnectorsTo(doc, [a]);
      }, LOCAL_ORIGIN);
    });
    expect(updates, 'the work is one transaction, and the work itself opens none').toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(onlyArrow(doc).id).toBe(arrow);
    expect(onlyArrow(doc).from.kind).toBe('free');
    expect(onlyArrow(doc).to.kind).toBe('attached');

    // Nothing to detach, nothing written: a delete that takes a note and nothing else must not cost an
    // update for every arrow on the board.
    expect(countUpdates(doc, () => detachConnectorsTo(doc, ['already-gone'])).updates).toBe(0);
    expect(countUpdates(doc, () => detachConnectorsTo(doc, [])).updates).toBe(0);
  });

  it('leaves a label, a note and the rest of the board alone when it detaches an arrow', () => {
    const { doc, a, arrow } = flow();
    // The work is on the arrow. Everything else on the board is left where it was, including the words
    // in a shape that was not deleted: a detach that took a label with it would be a story 7 bug
    // wearing a story 10 hat, and the way to know it did not happen is to look at the other object.
    const other = shape(doc, C_BOX, 'ellipse');
    const label = getShapeLabel(doc, other);
    label?.insert(0, 'Checkout');
    const sticky = createSticky(doc, { x: 0, y: 500 }) as string;
    expect(objectsOf(doc).get(sticky)?.get('text')).toBeInstanceOf(Y.Text);

    deleteObjects(doc, [a]);
    expect(arrowOf(doc, arrow).from.kind).toBe('free');
    expect(getShapeLabel(doc, other)?.toString(), 'a label on the board stays on the board').toBe(
      'Checkout',
    );
    expect(objectsOf(doc).has(sticky)).toBe(true);
    expect(snapshot(doc).map((object) => object.id)).toEqual(
      expect.arrayContaining([arrow, other, sticky]),
    );
  });
});

describe('connector objects as the board reads them', () => {
  it('TC-11: skips an arrow whose ends cannot be read, without taking the rest of the board with it', () => {
    const doc = newDoc();
    const a = shape(doc, A_BOX);
    const b = shape(doc, B_BOX);
    const arrow = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: centre(A_BOX) },
      { kind: 'attached', objectId: b, fallback: centre(B_BOX) },
      'me',
    ) as string;

    // An arrow written down by something that is not this model: it has a box, which is what a client
    // that stored points would have, and no ends. There is no way to know where it would be drawn, so
    // it is not drawn - and the alternative, an arrow at (0, 0), is a lie about where somebody aimed.
    const crafted = new Y.Map<unknown>();
    crafted.set('type', CONNECTOR_TYPE);
    crafted.set('x', 10);
    crafted.set('y', 10);
    crafted.set('width', 300);
    crafted.set('height', 200);
    crafted.set('z', 99);
    crafted.set('createdAt', 1);
    objectsOf(doc).set('crafted-no-ends', crafted);

    // Half an endpoint is the same problem one step on: an attached end with nowhere to fall back to.
    const half = new Y.Map<unknown>();
    half.set('type', CONNECTOR_TYPE);
    half.set('x', 0);
    half.set('y', 0);
    half.set('width', 10);
    half.set('height', 10);
    half.set('z', 98);
    half.set('createdAt', 1);
    half.set('from', { kind: 'attached', objectId: a });
    half.set('to', { kind: 'free', x: 400, y: 400 });
    objectsOf(doc).set('crafted-half-end', half);

    const ids = snapshot(doc).map((object) => object.id);
    expect(ids, 'the board still shows everything it can read').toEqual(
      expect.arrayContaining([a, b, arrow]),
    );
    expect(ids).not.toContain('crafted-no-ends');
    expect(ids).not.toContain('crafted-half-end');
    expect(arrows(doc)).toHaveLength(1);
    expect(
      asConnectorSnapshot({ id: 'x', type: CONNECTOR_TYPE } as unknown as ObjectSnapshot),
    ).toBeNull();
  });

  it('gives an arrow a box that is its ends, so the outline, the marquee and the click all agree', () => {
    const { doc, a, b, arrow } = flow();
    const object = snapshot(doc).find((candidate) => candidate.id === arrow) as ObjectSnapshot;
    expect(objectBounds(object)).toEqual(connectorBBox(A_ANCHOR, B_ANCHOR));
    // What an arrow keeps in the document is where its ends are fastened. The box written down at the
    // moment it was made is there for a client that cannot work a box out from ends - it draws the
    // arrow where it was drawn then - but it is a photograph, not a fact: nothing re-writes it, and
    // nothing on this screen reads it.
    expect(rawObject(doc, arrow)?.get('width')).toBe(object.width);
    expect(rawObject(doc, arrow)?.get('height')).toBe(object.height);

    // B is now above and to the right of A, so its end is drawn on B's own left side and the box comes
    // with it: the box the board answers with is the arrow's, and the stored one is left behind as
    // evidence of when it was made.
    moveObjects(doc, new Map([[b, { x: 200, y: 0 }]]));
    const after = snapshot(doc).find((candidate) => candidate.id === arrow) as ObjectSnapshot;
    const now = connectorBBox(A_ANCHOR, { x: 200, y: 50 });
    expect(after).not.toEqual(object);
    expect(objectBounds(after)).toEqual(now);
    expect(rawObject(doc, arrow)?.get('x')).toBe(object.x);
    expect(a).toBeTruthy();
  });

  it('is still an arrow when a field it does not use turns up on it', () => {
    const { doc, arrow } = flow();
    // Not a label a shape can have, but a field that arrived from elsewhere. An arrow is not turned
    // into another kind of object by a field it ignores, and is not dropped for it either.
    countUpdates(doc, () => {
      rawObject(doc, arrow)?.set('label', new Y.Text('strange'));
    });
    expect(onlyArrow(doc).id).toBe(arrow);
    expect(onlyArrow(doc).type).toBe(CONNECTOR_TYPE);
  });
});

describe('connector named settings', () => {
  it('are the numbers the story names', () => {
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBeGreaterThan(0);
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBeGreaterThan(0);
    // A click tolerance measured on the screen has to be at least a few pixels, or an arrow would be
    // a thing you could see and not touch.
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBeGreaterThanOrEqual(4);
  });
});
