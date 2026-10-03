/**
 * Unit tests for the connector model and geometry (connector.model contract).
 * TC-07 to TC-14 and TC-29, against a real Y.Doc.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  insertRawObject,
  deleteObjects,
  objects,
  objectBounds,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  getConnectorEndpoints,
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
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count doc updates fired between the start and end of a mutation. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return updates;
}

/** Two 100x100 objects 300 apart on the x axis: A at (0,0), B at (300,0). */
function pairAB(doc: Y.Doc): { a: string; b: string } {
  const a = insertRawObject(doc, 'sticky', { x: 0, y: 0 }, { width: 100, height: 100 });
  const b = insertRawObject(doc, 'sticky', { x: 300, y: 0 }, { width: 100, height: 100 });
  return { a, b };
}

describe('connector.model', () => {
  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks = side
  // anchors; one update.
  it('TC-07: createConnector attached→attached stores side-anchor fallbacks', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);

    const updates = withUpdateCount(doc, () => {
      const id = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
        'g_dana',
      );
      expect(id).not.toBeNull();
    });
    expect(updates).toBe(1);

    const endpoints = getConnectorEndpoints(doc, objects(doc).find((o) => o.type === 'connector')!.id)!;
    expect(endpoints.from).toEqual({
      kind: 'attached',
      objectId: a,
      // A's side nearest B: the right side, midpoint (100, 50).
      fallback: { x: 100, y: 50 },
    });
    expect(endpoints.to).toEqual({
      kind: 'attached',
      objectId: b,
      // B's side nearest A: the left side, midpoint (300, 50).
      fallback: { x: 300, y: 50 },
    });

    // The snapshot derives the bbox from the resolved endpoints.
    const conn = objects(doc).find((o) => o.type === 'connector')!;
    expect(conn.x).toBe(100);
    expect(conn.y).toBe(50);
    expect(conn.width).toBe(200);
    expect(conn.height).toBe(0);
  });

  // TC-08: A→A (same object) → null, 0 updates (negative).
  it('TC-08: a self-connection is rejected without a transaction', () => {
    const doc = makeDoc();
    const { a } = pairAB(doc);
    const updates = withUpdateCount(doc, () => {
      expect(
        createConnector(
          doc,
          { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
          { kind: 'attached', objectId: a, fallback: { x: 0, y: 50 } },
          'g_dana',
        ),
      ).toBeNull();
    });
    expect(updates).toBe(0);
    expect(objects(doc).filter((o) => o.type === 'connector')).toHaveLength(0);
  });

  // TC-09: free→free length 7.9 → null; exactly 8 (CONNECTOR_MIN_LENGTH_WORLD)
  // → created (boundary).
  it('TC-09: connectors shorter than the minimum length are rejected', () => {
    const doc = makeDoc();
    const short = CONNECTOR_MIN_LENGTH_WORLD - 0.1; // 7.9
    const updates = withUpdateCount(doc, () => {
      expect(
        createConnector(
          doc,
          { kind: 'free', x: 0, y: 0 },
          { kind: 'free', x: short, y: 0 },
          'g_dana',
        ),
      ).toBeNull();
    });
    expect(updates).toBe(0);

    const id = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
      'g_dana',
    );
    expect(id).not.toBeNull();
    const endpoints = getConnectorEndpoints(doc, id!)!;
    expect(endpoints.from).toEqual({ kind: 'free', x: 0, y: 0 });
    expect(endpoints.to).toEqual({ kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 });
  });

  // TC-10: nearestSide as B orbits A at 0, 44, 46, 90 degrees →
  // right, right, top, top (switch at the diagonal).
  it('TC-10: nearestSide switches at the 45° diagonal', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const centre: Point = { x: 50, y: 50 };
    const at = (deg: number): Point => {
      const rad = (deg * Math.PI) / 180;
      // Screen coordinates: positive angle above the +x axis is -y.
      return { x: centre.x + 300 * Math.cos(rad), y: centre.y - 300 * Math.sin(rad) };
    };
    expect(nearestSide(a, at(0))).toBe('right');
    expect(nearestSide(a, at(44))).toBe('right');
    expect(nearestSide(a, at(46))).toBe('top');
    expect(nearestSide(a, at(90))).toBe('top');
    // The other quadrants for completeness.
    expect(nearestSide(a, at(180))).toBe('left');
    expect(nearestSide(a, at(270))).toBe('bottom');
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback,
  // no throw (orphaned, error path).
  it('TC-11: resolveEndpoints falls back to the stored point when the target is missing', () => {
    const conn = {
      from: { kind: 'attached' as const, objectId: 'a', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached' as const, objectId: 'b', fallback: { x: 300, y: 50 } },
    };
    const onlyA = new Map<string, Rect>([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ]);
    // B missing: the to end renders at its fallback, no throw.
    const resolved = resolveEndpoints(conn, onlyA);
    expect(resolved.from).toEqual({ x: 100, y: 50 });
    expect(resolved.to).toEqual({ x: 300, y: 50 });

    // Both missing.
    const none = new Map<string, Rect>();
    const resolved2 = resolveEndpoints(conn, none);
    expect(resolved2.from).toEqual({ x: 100, y: 50 });
    expect(resolved2.to).toEqual({ x: 300, y: 50 });
  });

  // TC-12: setConnectorEndpoint to free → updated; to attached C → updated;
  // to the object at the opposite end → false, 0 updates (negative).
  it('TC-12: setConnectorEndpoint attaches, detaches and rejects the opposite object', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);
    const c = insertRawObject(doc, 'sticky', { x: 0, y: 300 }, { width: 100, height: 100 });
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    )!;

    // Detach the to end to a free point.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 200 })).toBe(true);
    expect(getConnectorEndpoints(doc, id)!.to).toEqual({ kind: 'free', x: 500, y: 200 });

    // Re-attach to C.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 50, y: 300 } })).toBe(true);
    expect(getConnectorEndpoints(doc, id)!.to!.kind).toBe('attached');
    expect((getConnectorEndpoints(doc, id)!.to as { objectId: string }).objectId).toBe(c);

    // Attaching to the object at the other end (a) → false, 0 updates.
    const updates = withUpdateCount(doc, () => {
      expect(
        setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 50, y: 50 } }),
      ).toBe(false);
    });
    expect(updates).toBe(0);
    expect((getConnectorEndpoints(doc, id)!.to as { objectId: string }).objectId).toBe(c);

    // Non-finite free point → false.
    const updates2 = withUpdateCount(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: NaN, y: 0 })).toBe(false);
    });
    expect(updates2).toBe(0);
  });

  // TC-13: deleteObjects([A]) with a connector attached to A → A removed and
  // the connector's from becomes free at A's current anchor, exactly one
  // update.
  it('TC-13: deleting a connected object frees its ends at the current anchor', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    )!;

    const updates = withUpdateCount(doc, () => {
      expect(deleteObjects(doc, [a])).toBe(1);
    });
    expect(updates).toBe(1);

    const all = objects(doc);
    expect(all.find((o) => o.id === a)).toBeUndefined();
    const conn = all.find((o) => o.id === id)!;
    expect(conn).toBeDefined();
    const endpoints = getConnectorEndpoints(doc, id)!;
    // A's current anchor (right side midpoint) became a free end.
    expect(endpoints.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(endpoints.to!.kind).toBe('attached');
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment → the
  // exact distances (hit tolerance is CONNECTOR_HIT_TOLERANCE_PX = 6).
  it('TC-14: distanceToPolyline measures exact distances to a segment', () => {
    const seg: [Point, Point] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // Beyond the segment ends the distance is to the nearest endpoint.
    expect(distanceToPolyline(seg, { x: 110, y: 0 })).toBe(10);
    // The tolerance setting is 6 screen px.
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
  });

  // TC-29: setConnectorEndpoint on a deleted connector id → false (stale id).
  it('TC-29: setConnectorEndpoint on a deleted connector returns false', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    )!;
    deleteObjects(doc, [id]);
    const updates = withUpdateCount(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // detachConnectorsTo inside an open transaction: both ends attached to
  // deleted objects are freed at their anchors.
  it('detachConnectorsTo frees both ends attached to deleted objects', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    )!;

    const updates = withUpdateCount(doc, () => {
      expect(deleteObjects(doc, [a, b])).toBe(2);
    });
    expect(updates).toBe(1);
    const endpoints = getConnectorEndpoints(doc, id)!;
    expect(endpoints.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(endpoints.to).toEqual({ kind: 'free', x: 300, y: 50 });
  });

  // createConnector with a target that was deleted concurrently: the
  // connector is created and the missing end keeps the caller's fallback.
  it('createConnector keeps the caller fallback when the target is already gone', () => {
    const doc = makeDoc();
    const { a } = pairAB(doc);
    // b is deleted before the (racing) create.
    const b = objects(doc).find((o) => o.id !== a && o.type === 'sticky')!.id;
    deleteObjects(doc, [b]);

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    );
    expect(id).not.toBeNull();
    const endpoints = getConnectorEndpoints(doc, id!)!;
    // A exists: fresh anchor. B is gone: the caller's fallback is kept.
    expect(endpoints.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(endpoints.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
  });

  // LOCAL_ORIGIN transactions: createConnector and setConnectorEndpoint use
  // the local origin so per-user undo captures them (story 8).
  it('mutations use LOCAL_ORIGIN so undo tracks them', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    )!;
    setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 400, y: 100 });
    expect(origins).toHaveLength(2);
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });

  // connectorBBox spans the two resolved points.
  it('connectorBBox spans both endpoints', () => {
    expect(connectorBBox({ x: 100, y: 50 }, { x: 300, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 0,
    });
    expect(connectorBBox({ x: 300, y: 80 }, { x: 100, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 30,
    });
  });

  // sideAnchor returns the side midpoints.
  it('sideAnchor returns the four side midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 45 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 70 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 45 });
  });

  // objectBounds of a connector snapshot is the derived bbox.
  it('connector snapshot entries carry derived bounds', () => {
    const doc = makeDoc();
    const { a, b } = pairAB(doc);
    createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_dana',
    );
    const conn = objects(doc).find((o) => o.type === 'connector')!;
    expect(objectBounds(conn)).toEqual({ x: 100, y: 50, width: 200, height: 0 });
  });
});
