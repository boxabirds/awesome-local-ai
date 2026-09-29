// connector.model + geometry unit tests (story 10, TC-07 to TC-14, TC-29)
// against a real Y.Doc.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc } from '../../src/shared/board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../../src/shared/config';
import {
  createConnector,
  detachConnectorsTo,
  setConnectorEndpoint,
  type Endpoint,
} from '../../src/shared/objects/connector';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  parseEndpoint,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createShape } from '../../src/shared/objects/shape';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Create a 100x100 rect shape with its top-left at (x, y). */
function rectAt(doc: Y.Doc, x: number, y: number): string {
  return createShape(doc, { kind: 'rect', rect: { x, y, width: 100, height: 100 }, at: { x: x + 50, y: y + 50 } }, 'g_test')!;
}

/** The stored endpoint value of a connector's end. */
function storedEnd(doc: Y.Doc, id: string, end: 'from' | 'to'): Endpoint {
  const value = objects(doc).get(id)?.get(end);
  const parsed = parseEndpoint(value);
  expect(parsed, `stored ${end} endpoint is malformed`).not.toBeNull();
  return parsed!;
}

/** Number of doc transactions that happen while `fn` runs. */
function withDocTransactions(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('afterTransaction', listener);
  try {
    fn();
  } finally {
    doc.off('afterTransaction', listener);
  }
  return count;
}

const A100: Rect = { x: 0, y: 0, width: 100, height: 100 };

describe('connector.model', () => {
  it('TC-07 attached A→B 300 apart → stored endpoints with fallbacks = side anchors; one update', () => {
    const doc = freshDoc();
    const A = rectAt(doc, 0, 0);
    const B = rectAt(doc, 300, 0);

    let updates = 0;
    let id: string | null = null;
    updates = withDocTransactions(doc, () => {
      id = createConnector(
        doc,
        { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: B, fallback: { x: 0, y: 0 } },
        'g_test',
      );
    });
    expect(id).not.toBeNull();
    expect(updates).toBe(1);

    const from = storedEnd(doc, id!, 'from');
    const to = storedEnd(doc, id!, 'to');
    expect(from).toEqual({ kind: 'attached', objectId: A, fallback: { x: 100, y: 50 } });
    expect(to).toEqual({ kind: 'attached', objectId: B, fallback: { x: 300, y: 50 } });
  });

  it('TC-08 attached to the same object → null, zero updates (negative)', () => {
    const doc = freshDoc();
    const A = rectAt(doc, 0, 0);
    let updates = withDocTransactions(doc, () => {
      const id = createConnector(
        doc,
        { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
        'g_test',
      );
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
    expect(objects(doc).size).toBe(1);
  });

  it('TC-09 free→free length 7.9 → null; 8 (boundary) → created', () => {
    const doc = freshDoc();
    let updates = withDocTransactions(doc, () => {
      const id = createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 },
        'g_test',
      );
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);

    updates = withDocTransactions(doc, () => {
      const id = createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
        'g_test',
      );
      expect(id).not.toBeNull();
    });
    expect(updates).toBe(1);
    expect(objects(doc).size).toBe(1);
  });

  it('TC-10 nearestSide as the target orbits A at 0°, 44°, 46°, 90° → right, right, top, top (diagonal switch)', () => {
    const toward = (deg: number, radius = 200) => ({
      x: 50 + radius * Math.cos((deg * Math.PI) / 180),
      y: 50 - radius * Math.sin((deg * Math.PI) / 180),
    });
    expect(nearestSide(A100, toward(0))).toBe('right');
    expect(nearestSide(A100, toward(44))).toBe('right');
    expect(nearestSide(A100, toward(46))).toBe('top');
    expect(nearestSide(A100, toward(90))).toBe('top');

    // The other quadrants too.
    expect(nearestSide(A100, toward(180))).toBe('left');
    expect(nearestSide(A100, toward(270))).toBe('bottom');
    expect(nearestSide(A100, toward(134))).toBe('top');
    expect(nearestSide(A100, toward(226))).toBe('bottom');
    expect(nearestSide(A100, toward(155))).toBe('left');
    expect(nearestSide(A100, toward(335))).toBe('right');

    // Non-square: the diagonal follows the rect's own aspect (the switch
    // angle is atan(h/w) ≈ 26.6° for a 200x100 rect).
    const wide: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(nearestSide(wide, toward(20, 300))).toBe('right');
    expect(nearestSide(wide, toward(30, 300))).toBe('top');
  });

  it('TC-11 resolveEndpoints with B missing from rects → end at fallback, no throw (orphaned)', () => {
    const A: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const c = {
      from: { kind: 'attached' as const, objectId: 'A', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached' as const, objectId: 'B', fallback: { x: 400, y: 50 } },
    };
    const rects = new Map<string, Rect>([['A', A]]);
    const resolved = resolveEndpoints(c, rects);
    expect(resolved.from).toEqual({ x: 100, y: 50 });
    expect(resolved.to).toEqual({ x: 400, y: 50 });

    // When both are present, the anchors follow the nearest sides.
    const B: Rect = { x: 300, y: 0, width: 100, height: 100 };
    const resolved2 = resolveEndpoints(c, new Map([['A', A], ['B', B]]));
    expect(resolved2.from).toEqual({ x: 100, y: 50 });
    expect(resolved2.to).toEqual({ x: 300, y: 50 });
  });

  it('TC-12 setConnectorEndpoint to free → updated; to attached C → updated; to the opposite end object → false, zero updates', () => {
    const doc = freshDoc();
    const A = rectAt(doc, 0, 0);
    const B = rectAt(doc, 300, 0);
    const C = rectAt(doc, 0, 300);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: B, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;

    let updates = withDocTransactions(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 500 })).toBe(true);
    });
    expect(updates).toBe(1);
    expect(storedEnd(doc, id, 'to')).toEqual({ kind: 'free', x: 500, y: 500 });

    updates = withDocTransactions(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: C, fallback: { x: 0, y: 0 } })).toBe(true);
    });
    expect(updates).toBe(1);
    const toC = storedEnd(doc, id, 'to');
    expect(toC.kind).toBe('attached');
    if (toC.kind === 'attached') {
      expect(toC.objectId).toBe(C);
      // The fallback is recomputed toward the other end (A, above C? A at (0,0), C at (0,300): A is above C → top side midpoint (50, 300)).
      expect(toC.fallback).toEqual({ x: 50, y: 300 });
    }

    updates = withDocTransactions(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } })).toBe(false);
    });
    expect(updates).toBe(0);

    // Non-finite free point → false, zero updates.
    updates = withDocTransactions(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 1 })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-13 deleteObjects([A]) with a connector attached to A → A removed, the connector end free at A anchor, exactly one update', () => {
    const doc = freshDoc();
    const A = rectAt(doc, 0, 0);
    const B = rectAt(doc, 300, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: B, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;

    const updates = withDocTransactions(doc, () => {
      expect(deleteObjects(doc, [A])).toBe(1);
    });
    expect(updates).toBe(1);
    expect(objects(doc).get(A)).toBeUndefined();
    expect(objects(doc).get(id)).toBeDefined();
    expect(storedEnd(doc, id, 'from')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(storedEnd(doc, id, 'to')).toEqual({ kind: 'attached', objectId: B, fallback: { x: 300, y: 50 } });
  });

  it('TC-14 distanceToPolyline at 0, 5.99 and 6.01 units from a segment → exact distances', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 9);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 9);
    // Beyond an endpoint: the distance to that endpoint.
    expect(distanceToPolyline(line, { x: 150, y: 0 })).toBe(50);
    // Empty polyline: Infinity.
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
  });

  it('sideAnchor: the four side midpoints', () => {
    expect(sideAnchor(A100, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(A100, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(A100, 'bottom')).toEqual({ x: 50, y: 100 });
    expect(sideAnchor(A100, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('connectorBBox spans the two anchor points', () => {
    expect(connectorBBox({ x: 100, y: 50 }, { x: 300, y: 150 })).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(connectorBBox({ x: 300, y: 150 }, { x: 100, y: 50 })).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });

  it('parseEndpoint accepts the two shapes and rejects malformed values', () => {
    expect(parseEndpoint({ kind: 'attached', objectId: 'a', fallback: { x: 1, y: 2 } })).toEqual({
      kind: 'attached',
      objectId: 'a',
      fallback: { x: 1, y: 2 },
    });
    expect(parseEndpoint({ kind: 'free', x: 1, y: 2 })).toEqual({ kind: 'free', x: 1, y: 2 });
    expect(parseEndpoint({ kind: 'attached', objectId: 'a' })).toBeNull();
    expect(parseEndpoint({ kind: 'attached', objectId: 'a', fallback: { x: Number.NaN, y: 2 } })).toBeNull();
    expect(parseEndpoint({ kind: 'free', x: 1 })).toBeNull();
    expect(parseEndpoint({ kind: 'mystery' })).toBeNull();
    expect(parseEndpoint(null)).toBeNull();
    expect(parseEndpoint('x')).toBeNull();
  });

  it('TC-29 setConnectorEndpoint on a deleted connector → false (stale id)', () => {
    const doc = freshDoc();
    const id = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 50, y: 0 },
      'g_test',
    )!;
    expect(deleteObjects(doc, [id])).toBe(1);
    let updates = withDocTransactions(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 9, y: 9 })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('detachConnectorsTo converts every attached end on a deleted id to free at the current anchor (inside the caller transaction)', () => {
    const doc = freshDoc();
    const A = rectAt(doc, 0, 0);
    const B = rectAt(doc, 300, 0);
    const c1 = createConnector(
      doc,
      { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: B, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const c2 = createConnector(
      doc,
      { kind: 'attached', objectId: B, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: A, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;

    const updates = withDocTransactions(doc, () => {
      doc.transact(() => {
        detachConnectorsTo(doc, [A]);
        objects(doc).delete(A);
      }, undefined);
    });
    expect(updates).toBe(1);
    // c1: from (attached A) → free at A's right side midpoint (100,50); to unchanged.
    expect(storedEnd(doc, c1, 'from')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(storedEnd(doc, c1, 'to').kind).toBe('attached');
    // c2: to (attached A) → free at A's right side midpoint (100,50); from unchanged.
    expect(storedEnd(doc, c2, 'to')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(storedEnd(doc, c2, 'from').kind).toBe('attached');
  });
});
