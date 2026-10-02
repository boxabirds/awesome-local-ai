// connector.model unit tests (TC-07 … TC-14, TC-29) against a REAL Y.Doc.
//
// The property these tests exist for is that an arrow is not a drawing of a line
// but a pair of references: two shapes, and the sides of them the line runs
// between. So the tests read the arrow back after the shapes have been moved and
// after one of them has been deleted, and they count document updates, because a
// connector that had to be written on every move of the shape it points at would
// be a connector that drifts, echoes and undoes badly.
import { describe, expect, it, beforeEach } from 'vitest';
import { Doc } from 'yjs';
import {
  createSticky,
  deleteObjects,
  getObjects,
  initDoc,
  moveObjects,
  snapshotAll,
  type ConnectorSnapshot,
} from '../../src/shared/board-model';
import {
  createConnector,
  connectorHitTest,
  detachConnectorsTo,
  deleteConnector,
  listConnectors,
  readConnector,
  readConnectorSnapshot,
  setConnectorEndpoint,
  setConnectorFreeEnds,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  rectCenter,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createShape } from '../../src/shared/objects/shape';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  type ConnectorEndpoint,
} from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';

function updateCounter(doc: Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  return () => count;
}

function newDoc(): Doc {
  const doc = new Doc();
  initDoc(doc);
  return doc;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** A shape at `r`, so a test can say "a shape" without saying "a rect". */
function shapeAt(doc: Doc, r: Rect): string {
  const id = createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } });
  if (id === null) throw new Error('shape refused');
  return id;
}

function boxOf(doc: Doc, id: string): Rect {
  const map = getObjects(doc).get(id);
  const read = (key: string): number => {
    const value = map?.get(key);
    if (typeof value !== 'number') throw new Error(`${key} is not a number on ${id}`);
    return value;
  };
  return rect(read('x'), read('y'), read('width'), read('height'));
}

function connectorOf(doc: Doc, id: string): ConnectorSnapshot {
  const snapshot = readConnectorSnapshot(doc, id);
  if (snapshot === null) throw new Error(`connector ${id} is not on the board`);
  return snapshot;
}

function attached(objectId: string, fallback: Point): ConnectorEndpoint {
  return { kind: 'attached', objectId, fallback };
}

const free = (x: number, y: number): ConnectorEndpoint => ({ kind: 'free', x, y });

describe('connector model', () => {
  let doc: Doc;
  // A and B, centred 300 board units apart and on the same line.
  let a: string;
  let b: string;
  const A = rect(0, 0, 100, 100);
  const B = rect(300, 0, 100, 100);

  beforeEach(() => {
    doc = newDoc();
    a = shapeAt(doc, A);
    b = shapeAt(doc, B);
  });

  // TC-07: an arrow between two shapes stores two references and one update.
  describe('TC-07 createConnector attached to attached', () => {
    it('stores both ends attached, each with the anchor of the side it faces', () => {
      const updates = updateCounter(doc);

      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      });

      expect(id).not.toBeNull();
      // One arrow is one update: not one for the object and one for its ends.
      expect(updates()).toBe(1);

      const ends = readConnector(doc, id!);
      expect(ends).not.toBeNull();
      expect(ends!.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
      expect(ends!.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
      expect(ends!.detached).toBe(false);

      // What is drawn is the two anchors, which is the gap between the boxes and
      // not the distance between their centres.
      const snapshot = connectorOf(doc, id!);
      expect(snapshot.resolved).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
      expect(snapshot.x).toBe(100);
      expect(snapshot.width).toBe(200);
      expect(listConnectors(doc)).toEqual([id]);
    });

    it('gives the arrow a z above every object, and stores who drew it', () => {
      const id = createConnector(
        doc,
        { from: attached(a, sideAnchor(A, 'right')), to: free(200, 50), createdBy: 'dana' },
      );
      const map = getObjects(doc).get(id!);
      expect(map?.get('type')).toBe('connector');
      expect(map?.get('createdBy')).toBe('dana');
      const z = map?.get('z');
      expect(typeof z === 'number' && z > 0).toBe(true);
    });
  });

  // TC-08: an arrow from a shape to itself is refused, and refused quietly.
  describe('TC-08 createConnector to the same object', () => {
    it('writes nothing and returns null', () => {
      const updates = updateCounter(doc);

      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(a, sideAnchor(A, 'left')),
      });

      expect(id).toBeNull();
      expect(updates()).toBe(0);
      expect(listConnectors(doc)).toEqual([]);
      expect(getObjects(doc).size).toBe(2);
    });

    it('refuses an end that is not an end at all', () => {
      const updates = updateCounter(doc);
      const bogus = { kind: 'somewhere', x: 10 } as unknown as ConnectorEndpoint;

      expect(createConnector(doc, { from: attached(a, { x: 100, y: 50 }), to: bogus })).toBeNull();
      expect(createConnector(doc, { from: free(Number.NaN, 0), to: free(0, 50) })).toBeNull();
      expect(updates()).toBe(0);
    });
  });

  // TC-09: the shortest arrow worth drawing, tested on both sides of the line.
  describe('TC-09 minimum arrow length', () => {
    it('refuses a free-to-free drag of less than the minimum and keeps one of exactly it', () => {
      const updates = updateCounter(doc);
      const min = CONNECTOR_MIN_LENGTH_WORLD;

      const short = createConnector(doc, { from: free(0, 0), to: free(min - 0.1, 0) });
      expect(short).toBeNull();
      expect(updates()).toBe(0);

      const exact = createConnector(doc, { from: free(0, 0), to: free(min, 0) });
      expect(exact).not.toBeNull();
      expect(updates()).toBe(1);
      expect(connectorOf(doc, exact!).resolved).toEqual({ from: { x: 0, y: 0 }, to: { x: min, y: 0 } });
    });

    it('measures the minimum between the ends as they resolve, not as they were handed over', () => {
      // Both ends are 300 units from each other as points, but they are attached
      // to the two faces of one box each side of them: the line is 200 long.
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      });
      expect(id).not.toBeNull();
      expect(connectorOf(doc, id!).width).toBe(200);
    });
  });

  // TC-10: which side an arrow takes as the other end goes around it, including
  // the diagonal, where the answer changes.
  describe('TC-10 nearestSide as the other end orbits', () => {
    it('takes right, right, top, top at 0, 44, 46 and 90 degrees', () => {
      const centre = rectCenter(A);
      const orbit = (degrees: number, radius = 300): Point => ({
        x: centre.x + radius * Math.cos((degrees * Math.PI) / 180),
        // Board y grows downwards, so a positive angle is above the shape.
        y: centre.y - radius * Math.sin((degrees * Math.PI) / 180),
      });

      expect(nearestSide(A, orbit(0))).toBe('right');
      expect(nearestSide(A, orbit(44))).toBe('right');
      expect(nearestSide(A, orbit(46))).toBe('top');
      expect(nearestSide(A, orbit(90))).toBe('top');
    });

    it('gives one answer and one only to a target exactly on the diagonal', () => {
      const centre = rectCenter(A);
      const onDiagonal = { x: centre.x + 200, y: centre.y - 200 };
      const once = nearestSide(A, onDiagonal);
      expect(['top', 'right']).toContain(once);
      expect(nearestSide(A, onDiagonal)).toBe(once);
    });

    it('moves the arrow by moving the shape, and writes nothing to the arrow', () => {
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      })!;
      const updates = updateCounter(doc);

      // A goes a long way down: B is now above it, so the end fastened to A stops
      // being its right face and becomes its top one.
      moveObjects(doc, new Map([[a, { x: 0, y: 400 }]]));

      // One update, for the shape that was moved. An arrow that had to be written
      // on every move would be written on every frame of every drag.
      expect(updates()).toBe(1);
      expect(connectorOf(doc, id!).resolved).toEqual({ from: { x: 50, y: 400 }, to: { x: 350, y: 100 } });
    });

    it('follows a shape that is moved again, on the read and not on the write', () => {
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      })!;
      const storedBefore = boxOf(doc, id!);

      moveObjects(doc, new Map([[b, { x: 300, y: -60 }]]));

      const snapshot = connectorOf(doc, id!);
      expect(snapshot.resolved.to).toEqual({ x: 300, y: -10 });
      // The box stored in the document is where the arrow was left, and the board
      // draws where it is: the snapshot is never the stale one.
      expect(boxOf(doc, id!)).toEqual(storedBefore);
      expect(snapshot.x).toBe(100);
      expect(snapshot.y).toBe(-10);
    });
  });

  // TC-11: the object an end belongs to is gone. The arrow keeps the point it was
  // drawn to rather than falling off the board with its shape.
  describe('TC-11 resolving an end whose object is absent', () => {
    it('ends at the stored fallback and does not throw', () => {
      const id = createConnector(doc, {
        from: attached(a, { x: 100, y: 50 }),
        to: attached('not-on-this-board', { x: 700, y: 50 }),
      })!;

      const snapshot = connectorOf(doc, id!);
      expect(snapshot.resolved.to).toEqual({ x: 700, y: 50 });
      // The end whose object is gone is the one that says so; the end that is
      // still fastened is still fastened, and still follows its shape about.
      expect(snapshot.detached).toBe(true);
      expect(snapshot.resolved.from).toEqual({ x: 100, y: 50 });

      // The other end of this arrow is a shape that is not on the board, so what
      // it is aimed at is the point it was left with, and a shape moving past is
      // nobody's business: the side A offers does not change.
      moveObjects(doc, new Map([[b, { x: 300, y: 500 }]]));
      expect(connectorOf(doc, id!).resolved).toEqual({ from: { x: 100, y: 50 }, to: { x: 700, y: 50 } });
    });

    it('draws both ends at their fallbacks when both objects are gone', () => {
      // Two ends fastened to two ids this board has never heard of — which is
      // what a connector left by a board that lost some of its shapes is.
      const id = createConnector(doc, {
        from: attached('never-was-a', { x: 100, y: 50 }),
        to: attached('never-was-b', { x: 300, y: 50 }),
      })!;

      const snapshot = connectorOf(doc, id!);
      expect(snapshot.resolved).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
      expect(snapshot.detached).toBe(true);
    });
  });

  // TC-12: moving one end. Onto the air, onto another shape, and no further.
  describe('TC-12 setConnectorEndpoint', () => {
    it('frees an end, re-attaches it, and refuses the object at the other end', () => {
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      })!;

      expect(setConnectorEndpoint(doc, id, 'to', free(500, 20))).toBe(true);
      expect(readConnector(doc, id)!.to).toEqual(free(500, 20));

      // A third shape, because attaching it back to A is the thing that is refused.
      const c = shapeAt(doc, rect(600, 0, 100, 100));
      expect(setConnectorEndpoint(doc, id, 'to', attached(c, sideAnchor(rect(600, 0, 100, 100), 'left')))).toBe(true);
      expect(readConnector(doc, id)!.to.kind).toBe('attached');

      const updates = updateCounter(doc);
      expect(setConnectorEndpoint(doc, id, 'to', attached(a, { x: 100, y: 50 }))).toBe(false);
      expect(updates()).toBe(0);
      expect(readConnector(doc, id)!.to.kind).toBe('attached');
      const end = readConnector(doc, id)!.to;
      expect(end.kind === 'attached' ? end.objectId : null).toBe(c);
    });

    it('moves the box the end moves into, so the arrow can still be clicked where it is', () => {
      const id = createConnector(doc, { from: free(0, 0), to: free(200, 0) })!;

      setConnectorEndpoint(doc, id, 'to', free(0, 400));

      const snapshot = connectorOf(doc, id!);
      expect(snapshot.x).toBe(0);
      expect(snapshot.y).toBe(0);
      expect(snapshot.width).toBe(0);
      expect(snapshot.height).toBe(400);
      expect(connectorBBox({ x: 0, y: 0 }, { x: 0, y: 400 })).toEqual({ x: 0, y: 0, width: 0, height: 400 });
    });

    it('refuses an endpoint that is not an endpoint, and a connector that is not there', () => {
      const id = createConnector(doc, { from: free(0, 0), to: free(200, 0) })!;
      const updates = updateCounter(doc);

      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 'x', y: 0 } as unknown as ConnectorEndpoint)).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'middle' as 'from', free(1, 1))).toBe(false);
      expect(updates()).toBe(0);
    });

    it('deletes an arrow of its own accord', () => {
      const id = createConnector(doc, { from: free(0, 0), to: free(200, 0) })!;

      expect(deleteConnector(doc, id)).toBe(true);
      expect(deleteConnector(doc, id)).toBe(false);
      expect(listConnectors(doc)).toEqual([]);
    });
  });

  // TC-13: deleting a shape leaves the arrow, with its end turned loose at the
  // point the shape last held it, in the same update as the deletion.
  describe('TC-13 deleteObjects with an attached connector', () => {
    it('turns the end free at the anchor it was drawn to, in one update', () => {
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      })!;
      const updates = updateCounter(doc);

      deleteObjects(doc, [a]);

      // One update for the deletion and the release together: Undo has to bring
      // the shape back with the arrow still fastened to it, or it is undoing half
      // of what the person did.
      expect(updates()).toBe(1);
      expect(getObjects(doc).has(a)).toBe(false);

      const ends = readConnector(doc, id)!;
      expect(ends.from).toEqual(free(100, 50));
      expect(ends.to.kind).toBe('attached');
      expect(ends.detached).toBe(false);
      expect(connectorOf(doc, id!).resolved).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
    });

    it('releases the side the arrow was actually touching, not the one it was stored with', () => {
      // The end says A with a fallback of its right face; B is moved below, so the
      // face it is drawn to is A's bottom one. Deleting A must loose the arrow at
      // (50, 100) — where it was — and not at where the old fallback would put it.
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      })!;
      moveObjects(doc, new Map([[b, { x: 300, y: 400 }]]));

      const touched = detachConnectorsTo(doc, [a]);

      expect(touched).toEqual([id]);
      expect(readConnector(doc, id)!.from).toEqual(free(50, 100));
    });

    it('touches nothing when the deleted object had no arrow on it', () => {
      const note = createSticky(doc, { x: 0, y: 900 });
      const updates = updateCounter(doc);

      expect(detachConnectorsTo(doc, [note])).toEqual([]);
      expect(deleteObjects(doc, [note])).toBe(1);
      expect(updates()).toBe(1);
    });

    it('releases both ends at once when both shapes go', () => {
      const id = createConnector(doc, {
        from: attached(a, sideAnchor(A, 'right')),
        to: attached(b, sideAnchor(B, 'left')),
      })!;

      deleteObjects(doc, [a, b]);

      expect(readConnector(doc, id)).toEqual({
        id,
        from: free(100, 50),
        to: free(300, 50),
        detached: false,
      });
      // The arrow is still an object on the board, and still in the snapshot.
      expect(snapshotAll(doc).map((object) => object.id)).toEqual([id]);
    });
  });

  // TC-14: clicking an arrow. The tolerance is stated in screen pixels, so the
  // arrow is as easy to catch at 10 % as at 400 %.
  describe('TC-14 hit tolerance around the line', () => {
    const line = { resolved: { from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } } };

    it('measures the distance to the polyline at 0, 5.99 and 6.01 units', () => {
      expect(distanceToPolyline({ x: 500, y: 0 }, [{ x: 0, y: 0 }, { x: 1000, y: 0 }])).toBe(0);
      expect(distanceToPolyline({ x: 500, y: 5.99 }, [{ x: 0, y: 0 }, { x: 1000, y: 0 }])).toBeCloseTo(5.99, 6);
      expect(distanceToPolyline({ x: 500, y: 6.01 }, [{ x: 0, y: 0 }, { x: 1000, y: 0 }])).toBeCloseTo(6.01, 6);
    });

    it('catches a click inside the tolerance and misses one outside it', () => {
      expect(connectorHits(line, { x: 500, y: 0 })).toBe(true);
      expect(connectorHits(line, { x: 500, y: CONNECTOR_HIT_TOLERANCE_PX - 0.01 })).toBe(true);
      expect(connectorHits(line, { x: 500, y: CONNECTOR_HIT_TOLERANCE_PX + 0.01 })).toBe(false);
    });

    it('keeps the same tolerance on the screen at every zoom', () => {
      // Six screen pixels are sixty board units at 10 %, and 1.5 at 400 %.
      expect(connectorHits(line, { x: 500, y: 59 }, 0.1)).toBe(true);
      expect(connectorHits(line, { x: 500, y: 61 }, 0.1)).toBe(false);
      expect(connectorHits(line, { x: 500, y: 1.4 }, 4)).toBe(true);
      expect(connectorHits(line, { x: 500, y: 1.6 }, 4)).toBe(false);
    });

    it('holds its tolerance out as far as the ends of the line and no further', () => {
      expect(connectorHits(line, { x: 1000, y: 0 })).toBe(true);
      expect(connectorHits(line, { x: 1020, y: 0 })).toBe(false);
      expect(connectorHits(line, { x: -20, y: 0 })).toBe(false);
    });

    it('measures an arrow of no length at all as a point', () => {
      const dot = { resolved: { from: { x: 10, y: 10 }, to: { x: 10, y: 10 } } };
      expect(connectorHits(dot, { x: 10, y: 10 })).toBe(true);
      expect(connectorHits(dot, { x: 20, y: 10 })).toBe(false);
    });
  });

  // TC-29: an end that has no arrow left to be moved on.
  describe('TC-29 setConnectorEndpoint on a deleted connector', () => {
    it('returns false and writes nothing', () => {
      const id = createConnector(doc, { from: free(0, 0), to: free(200, 0) })!;
      deleteConnector(doc, id);
      const updates = updateCounter(doc);

      expect(setConnectorEndpoint(doc, id, 'from', free(10, 10))).toBe(false);
      expect(updates()).toBe(0);
      expect(readConnector(doc, id)).toBeNull();
    });

    it('refuses an end of an object that is not a connector at all', () => {
      const updates = updateCounter(doc);

      expect(setConnectorEndpoint(doc, a, 'from', free(10, 10))).toBe(false);
      expect(updates()).toBe(0);
    });
  });

  // An arrow dragged by its own body: the model is asked where its free ends have
  // got to, because an arrow has no position of its own to add a distance to.
  describe('setConnectorFreeEnds, which is how an arrow is dragged', () => {
    it('moves a free end and leaves an attached one to its shape', () => {
      const id = createConnector(doc, { from: free(200, 300), to: attached(b, sideAnchor(B, 'left')) })!;

      const moved = setConnectorFreeEnds(doc, new Map([[id, { from: { x: 250, y: 350 }, to: { x: 999, y: 999 } }]]));

      expect(moved).toBe(1);
      const ends = readConnector(doc, id)!;
      expect(ends.from).toEqual(free(250, 350));
      // The point offered for the fastened end is refused: B is where it is, and an
      // arrow's own drag does not move the shapes it joins.
      expect(ends.to).toEqual({ kind: 'attached', objectId: b, fallback: sideAnchor(B, 'left') });
    });

    it('moves nothing the second time the same points are written', () => {
      // A drag reports where the pointer has got to, and several frames of it say
      // the same thing; an end that moved again on each of those travels off the
      // board while the pointer stands still.
      const id = createConnector(doc, { from: free(200, 300), to: free(400, 300) })!;
      const positions = new Map([[id, { from: { x: 260, y: 300 }, to: { x: 460, y: 300 } }]]);
      const updates = updateCounter(doc);

      setConnectorFreeEnds(doc, positions);
      const after = readConnector(doc, id)!;
      expect(setConnectorFreeEnds(doc, positions)).toBe(0);
      expect(readConnector(doc, id)).toEqual(after);
      // A frame that writes nothing is a frame that costs no undo step either.
      expect(updates()).toBe(1);
    });

    it('refuses an end that is not a number and writes nothing at all', () => {
      const id = createConnector(doc, { from: free(200, 300), to: free(400, 300) })!;
      const before = readConnector(doc, id)!;
      const updates = updateCounter(doc);

      expect(setConnectorFreeEnds(doc, new Map([[id, { from: { x: Number.NaN, y: 0 }, to: { x: 0, y: 0 } }]]))).toBe(0);
      expect(readConnector(doc, id)).toEqual(before);
      expect(updates()).toBe(0);
    });

    it('says nothing about an object that is not an arrow', () => {
      const updates = updateCounter(doc);

      expect(setConnectorFreeEnds(doc, new Map([[a, { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }]]))).toBe(0);
      expect(updates()).toBe(0);
    });

    it('is what a drag of the arrow itself does, and a move of the board is not', () => {
      const id = createConnector(doc, { from: free(200, 300), to: attached(b, sideAnchor(B, 'left')) })!;
      const before = readConnectorSnapshot(doc, id)!;

      // The model's move of everything takes no notice of an arrow, rather than
      // moving it by however much has accumulated since it was drawn.
      moveObjects(doc, new Map([[id, { x: before.x + 60, y: before.y + 60 }]]));
      expect(readConnectorSnapshot(doc, id)).toEqual(before);
    });
  });
});

/** The click test the registry runs, in the terms a test wants to state. */
function connectorHits(
  snapshot: { resolved: { from: Point; to: Point } },
  point: Point,
  zoom = 1,
): boolean {
  return connectorHitTest(snapshot, point, zoom);
}
