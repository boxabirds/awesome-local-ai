// Story 10, task 9: unit tests for the connector model and geometry
// (TC-07..TC-14, TC-29) plus the design's rejection cases.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createConnector,
  isValidEndpoint,
  readEndpoint,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  type ShapeKind,
} from '../../src/shared/config';
import {
  createShape,
} from '../../src/shared/objects/shape';
import {
  createSticky,
  deleteObjects,
  moveObjects,
  objectMap,
  objectSnapshot,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

/** Create a shape with an explicit rect and return its id. */
function addShape(doc: Y.Doc, rect: Rect, kind: ShapeKind = 'rect'): string {
  const id = createShape(doc, { kind, rect, at: { x: rect.x, y: rect.y }, square: false }, 'seed');
  return id!;
}

function connectorOf(doc: Y.Doc, id: string): ConnectorSnap | undefined {
  const snap = objectSnapshot(doc).find((o) => o.id === id);
  return snap !== undefined && snap.type === 'connector' ? (snap as ConnectorSnap) : undefined;
}

const RECT_A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const RECT_B: Rect = { x: 300, y: 50, width: 100, height: 100 };

describe('createConnector attached (TC-07, TC-09)', () => {
  it('TC-07 A and B 300 apart: stored endpoints with fallbacks = the side anchors, 1 update', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const count = countUpdates(doc);

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    );
    expect(id).not.toBeNull();
    expect(count()).toBe(1);

    const storedFrom = readEndpoint(objectMap(doc).get(id!)!.get('from'));
    const storedTo = readEndpoint(objectMap(doc).get(id!)!.get('to'));
    // A's nearest side to B is its right side; B's nearest side to A is its
    // left side. The fallbacks ARE the attach-time anchors.
    expect(storedFrom).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(storedTo).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 100 } });

    const snap = connectorOf(doc, id!);
    expect(snap!.fromPoint).toEqual({ x: 100, y: 50 });
    expect(snap!.toPoint).toEqual({ x: 300, y: 100 });
  });

  it('TC-09 releasing over B attaches to B; releasing over empty space drops a free end', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);

    // Drag from A, release over B (attached end).
    const idAttached = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 350, y: 100 } },
      'dana',
    );
    const attached = readEndpoint(objectMap(doc).get(idAttached!)!.get('to'));
    expect(attached.kind).toBe('attached');
    if (attached.kind === 'attached') expect(attached.objectId).toBe(b);

    // Drag from A, release over empty space (free end at the drop point).
    const idFree = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 150, y: 400 },
      'dana',
    );
    const free = readEndpoint(objectMap(doc).get(idFree!)!.get('to'));
    expect(free).toEqual({ kind: 'free', x: 150, y: 400 });
  });
});

describe('createConnector free (TC-08, TC-29)', () => {
  it('TC-08 free endpoints are stored exactly, 1 update', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    const id = createConnector(doc, { kind: 'free', x: 10, y: 20 }, { kind: 'free', x: 110, y: 120 }, 'dana');
    expect(id).not.toBeNull();
    expect(count()).toBe(1);
    expect(readEndpoint(objectMap(doc).get(id!)!.get('from'))).toEqual({ kind: 'free', x: 10, y: 20 });
    expect(readEndpoint(objectMap(doc).get(id!)!.get('to'))).toEqual({ kind: 'free', x: 110, y: 120 });
  });

  it('TC-29 a free end stays put when other objects move', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const id = createConnector(
      doc,
      { kind: 'free', x: 100, y: 100 },
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      'dana',
    );
    // Move A far away: the free end must not follow it.
    expect(moveObjects(doc, new Map([[a, { x: 800, y: 600 }]]))).toBe(1);
    const snap = connectorOf(doc, id!);
    expect(snap!.fromPoint).toEqual({ x: 100, y: 100 });
    const storedFrom = readEndpoint(objectMap(doc).get(id!)!.get('from'));
    expect(storedFrom).toEqual({ kind: 'free', x: 100, y: 100 });
    // The attached end DID follow A (connector.endpoints).
    expect(snap!.toPoint).toEqual({ x: 800, y: 650 });
  });
});

describe('nearestSide (TC-10)', () => {
  it('TC-10 B orbiting A at 0, 44, 46, 90 degrees -> right, right, top, top', () => {
    // A: 100x100 at the origin, centre (50,50). B orbits at radius 300.
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const orbit = (deg: number): { x: number; y: number } => {
      const rad = (deg * Math.PI) / 180;
      return { x: 50 + 300 * Math.cos(rad), y: 50 - 300 * Math.sin(rad) };
    };
    expect(nearestSide(rect, orbit(0))).toBe('right');
    expect(nearestSide(rect, orbit(44))).toBe('right');
    expect(nearestSide(rect, orbit(46))).toBe('top');
    expect(nearestSide(rect, orbit(90))).toBe('top');
    // The full circle.
    expect(nearestSide(rect, orbit(180))).toBe('left');
    expect(nearestSide(rect, orbit(270))).toBe('bottom');
  });

  it('the switch happens exactly on the rectangle diagonal (non-square)', () => {
    // A wide 200x100 rect: centre (100,50), halfW=100, halfH=50.
    const rect: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const deg = (d: number): { x: number; y: number } => {
      const rad = (d * Math.PI) / 180;
      return { x: 100 + 400 * Math.cos(rad), y: 50 - 400 * Math.sin(rad) };
    };
    // 45 degrees: |dx|*halfH == |dy|*halfW only when halfW == halfH; for a
    // wide rect the top/bottom sides win well before 45 degrees.
    expect(nearestSide(rect, deg(45))).toBe('top');
    // Shallow angle: the right side wins.
    expect(nearestSide(rect, deg(20))).toBe('right');
    // On the diagonal itself (slope halfH/halfW = 0.5 -> angle 26.565deg):
    // the strict inequality puts the point on the vertical side.
    const rad = Math.atan2(0.5, 1);
    expect(nearestSide(rect, { x: 100 + 400 * Math.cos(rad), y: 50 - 400 * Math.sin(rad) })).toBe('top');
  });

  it('all four sides are reachable', () => {
    const rect: Rect = { x: 10, y: 20, width: 30, height: 40 }; // centre (25,40)
    expect(nearestSide(rect, { x: 25, y: -100 })).toBe('top');
    expect(nearestSide(rect, { x: 300, y: 40 })).toBe('right');
    expect(nearestSide(rect, { x: 25, y: 300 })).toBe('bottom');
    expect(nearestSide(rect, { x: -300, y: 40 })).toBe('left');
  });
});

describe('sideAnchor (TC-11)', () => {
  it('TC-11 midpoints of all four sides', () => {
    const rect: Rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(sideAnchor(rect, 'top')).toEqual({ x: 25, y: 20 });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 40, y: 40 });
    expect(sideAnchor(rect, 'bottom')).toEqual({ x: 25, y: 60 });
    expect(sideAnchor(rect, 'left')).toEqual({ x: 10, y: 40 });
  });
});

describe('setConnectorEndpoint (TC-12)', () => {
  function seeded() {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const c = addShape(doc, { x: 150, y: 400, width: 100, height: 100 });
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;
    return { doc, a, b, c, id };
  }

  it('TC-12 dragging the end to a free point stores the free point (1 update)', () => {
    const { doc, id } = seeded();
    const count = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 200 })).toBe(true);
    expect(count()).toBe(1);
    expect(readEndpoint(objectMap(doc).get(id)!.get('to'))).toEqual({ kind: 'free', x: 500, y: 200 });
  });

  it('TC-12 dragging the end onto C attaches it to C (1 update)', () => {
    const { doc, c, id } = seeded();
    const count = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 150, y: 450 } })).toBe(true);
    expect(count()).toBe(1);
    const stored = readEndpoint(objectMap(doc).get(id)!.get('to'));
    expect(stored.kind).toBe('attached');
    if (stored.kind === 'attached') {
      expect(stored.objectId).toBe(c);
      expect(stored.fallback).toEqual({ x: 150, y: 450 });
    }
  });

  it('TC-12 dragging the end onto the other end object is rejected (0 updates)', () => {
    const { doc, a, id } = seeded();
    const count = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 50, y: 50 } })).toBe(false);
    expect(count()).toBe(0);
    const stored = readEndpoint(objectMap(doc).get(id)!.get('to'));
    expect(stored.kind).toBe('attached');
    if (stored.kind === 'attached') expect(stored.objectId).not.toBe(a);
  });

  it('unknown ids and invalid endpoints are rejected with no update', () => {
    const { doc, id } = seeded();
    const count = countUpdates(doc);
    expect(setConnectorEndpoint(doc, 'nope', 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: NaN, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: '', fallback: { x: 0, y: 0 } })).toBe(false);
    expect(count()).toBe(0);
  });
});

describe('detachConnectorsTo via deleteObjects (TC-13)', () => {
  it('TC-13 deleting A leaves the arrow with a free end at A current anchor, 1 update', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;

    // Move A first, so "current anchor" differs from the attach-time anchor.
    expect(moveObjects(doc, new Map([[a, { x: 0, y: 250 }]]))).toBe(1);

    const count = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(count()).toBe(1); // one transaction: detach + delete

    // A is gone.
    expect(objectMap(doc).get(a)).toBeUndefined();
    // The arrow remains, its `from` is free at A's CURRENT right-side anchor:
    // A is now {x:0,y:250,100x100} (centre 50,300); B's centre is (350,100):
    // dx=300, dy=-200 -> the right side wins -> anchor (100,300).
    const snap = connectorOf(doc, id);
    expect(snap).toBeDefined();
    const stored = readEndpoint(objectMap(doc).get(id)!.get('from'));
    expect(stored).toEqual({ kind: 'free', x: 100, y: 300 });
    expect(snap!.fromPoint).toEqual({ x: 100, y: 300 });
    // The other end still follows B.
    expect(snap!.toPoint).toEqual({ x: 300, y: 100 });
  });

  it('deleting the `to` object frees the `to` end', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;
    expect(deleteObjects(doc, [b])).toBe(1);
    const stored = readEndpoint(objectMap(doc).get(id)!.get('to'));
    expect(stored).toEqual({ kind: 'free', x: 300, y: 100 });
  });

  it('deleting an unrelated object leaves the connector untouched', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const other = createSticky(doc, { x: 900, y: 900 });
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;
    const before = readEndpoint(objectMap(doc).get(id)!.get('from'));
    expect(deleteObjects(doc, [other])).toBe(1);
    expect(readEndpoint(objectMap(doc).get(id)!.get('from'))).toEqual(before);
  });

  it('deleting BOTH endpoints frees both ends', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;
    expect(deleteObjects(doc, [a, b])).toBe(2);
    const from = readEndpoint(objectMap(doc).get(id)!.get('from'));
    const to = readEndpoint(objectMap(doc).get(id)!.get('to'));
    expect(from.kind).toBe('free');
    expect(to.kind).toBe('free');
  });
});

describe('orphaned endpoints render at their fallback (connector.fallback)', () => {
  it('an endpoint attached to a deleted object resolves to the stored fallback', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const b = addShape(doc, RECT_B);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'dana',
    )!;
    // Simulate the concurrent-delete race: A vanishes from the doc WITHOUT
    // going through deleteObjects (its detach step never runs for this
    // connector), so the endpoint stays attached-but-orphaned.
    doc.transact(() => {
      objectMap(doc).delete(a);
    });
    const snap = connectorOf(doc, id);
    expect(snap).toBeDefined();
    expect(snap!.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    // It renders at the attach-time anchor.
    expect(snap!.fromPoint).toEqual({ x: 100, y: 50 });
    expect(snap!.toPoint).toEqual({ x: 300, y: 100 });
  });

  it('resolveEndpoints falls back per endpoint independently', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const endA: Endpoint = { kind: 'attached', objectId: 'missing', fallback: { x: 7, y: 8 } };
    const endB: Endpoint = { kind: 'free', x: 50, y: 50 };
    const resolved = resolveEndpoints({ from: endA, to: endB }, new Map([[ 'b', rect ] as const]));
    expect(resolved.from).toEqual({ x: 7, y: 8 });
    expect(resolved.to).toEqual({ x: 50, y: 50 });
  });
});

describe('createConnector rejections', () => {
  it('an arrow from an object to itself is rejected with no update', () => {
    const doc = freshDoc();
    const a = addShape(doc, RECT_A);
    const count = countUpdates(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } },
      'dana',
    );
    expect(id).toBeNull();
    expect(count()).toBe(0);
  });

  it('a resolved length below the minimum is rejected with no update', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    const id = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 2, y: 0 },
      'dana',
    );
    expect(id).toBeNull();
    expect(count()).toBe(0);
  });

  it('non-finite endpoints are rejected with no update', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    expect(createConnector(doc, { kind: 'free', x: NaN, y: 0 }, { kind: 'free', x: 100, y: 0 }, 'dana')).toBeNull();
    expect(
      createConnector(doc, { kind: 'attached', objectId: 'a', fallback: { x: 0, y: Infinity } }, { kind: 'free', x: 100, y: 0 }, 'dana'),
    ).toBeNull();
    expect(count()).toBe(0);
  });
});

describe('isValidEndpoint', () => {
  it('accepts exactly the two endpoint shapes', () => {
    expect(isValidEndpoint({ kind: 'free', x: 0, y: 0 })).toBe(true);
    expect(isValidEndpoint({ kind: 'attached', objectId: 'x', fallback: { x: 0, y: 0 } })).toBe(true);
    expect(isValidEndpoint({ kind: 'free', x: NaN, y: 0 })).toBe(false);
    expect(isValidEndpoint({ kind: 'free', x: 0 })).toBe(false);
    expect(isValidEndpoint({ kind: 'attached', objectId: '', fallback: { x: 0, y: 0 } })).toBe(false);
    expect(isValidEndpoint({ kind: 'attached', objectId: 'x', fallback: null })).toBe(false);
    expect(isValidEndpoint({ kind: 'bogus' })).toBe(false);
    expect(isValidEndpoint(null)).toBe(false);
  });
});

describe('distanceToPolyline (TC-14)', () => {
  it('TC-14 distances 0, 5.99 and 6.01 from a segment are exact', () => {
    const seg = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(distanceToPolyline(seg, { x: 5, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(seg, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(seg, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 10);
    // Beyond the segment ends the distance is to the nearest endpoint.
    expect(distanceToPolyline(seg, { x: 15, y: 0 })).toBeCloseTo(5, 10);
    // Empty and single-vertex degenerate cases.
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBeCloseTo(5, 10);
  });

  it('a multi-segment polyline measures to the nearest segment', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(distanceToPolyline(pts, { x: 10, y: 5 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(pts, { x: 6, y: 5 })).toBeCloseTo(4, 10); // nearest is the vertical segment at x=10
  });
});

