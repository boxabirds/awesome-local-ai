// tests/unit/connector-model.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObjects } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import { nearestSide, resolveEndpoints, type ConnectorSnap, type Endpoint } from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function countUpdatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return count;
}

function makeRect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, width: w, height: h };
}

describe('connector.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-07: attached A→B 300 apart
  describe('TC-07: createConnector attached to attached', () => {
    it('stores endpoints with fallbacks = side anchors; 1 update', () => {
      // Create two shapes 300 apart
      const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
      const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'u1')!;

      const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
      const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };

      const updates = countUpdatesDuring(doc, () => {
        const id = createConnector(doc, from, to, 'u1');
        expect(id).not.toBeNull();
      });
      expect(updates).toBe(1);

      const snap = snapshot(doc);
      const conn = snap.find(s => s.type === 'connector') as any;
      expect(conn).toBeDefined();
      expect(conn.from.objectId).toBe(idA);
      expect(conn.to.objectId).toBe(idB);
      // Fallbacks should be computed side anchors
      expect(conn.from.fallback).toEqual({ x: 100, y: 50 });
      expect(conn.to.fallback).toEqual({ x: 400, y: 50 });
    });
  });

  // TC-08: A→A → null, 0 updates
  describe('TC-08: self-connection rejected', () => {
    it('createConnector A to A → null, 0 updates', () => {
      const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;

      const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 50, y: 0 } };
      const to: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 50, y: 100 } };

      const updates = countUpdatesDuring(doc, () => {
        const result = createConnector(doc, from, to, 'u1');
        expect(result).toBeNull();
      });
      expect(updates).toBe(0);
    });
  });

  // TC-09: free→free length 7.9 → null; 8 → created
  describe('TC-09: minimum length boundary', () => {
    it('free→free length 7.9 → null', () => {
      const from: Endpoint = { kind: 'free', x: 0, y: 0 };
      const to: Endpoint = { kind: 'free', x: 7.9, y: 0 };

      const updates = countUpdatesDuring(doc, () => {
        const result = createConnector(doc, from, to, 'u1');
        expect(result).toBeNull();
      });
      expect(updates).toBe(0);
    });

    it('free→free length 8 (CONNECTOR_MIN_LENGTH_WORLD) → created', () => {
      const from: Endpoint = { kind: 'free', x: 0, y: 0 };
      const to: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };

      const updates = countUpdatesDuring(doc, () => {
        const result = createConnector(doc, from, to, 'u1');
        expect(result).not.toBeNull();
      });
      expect(updates).toBe(1);
    });
  });

  // TC-10: nearestSide as B orbits A
  describe('TC-10: nearestSide orbital test', () => {
    const rectA = makeRect(0, 0, 100, 100); // centre at (50, 50)

    it('B at 0° (right) → right', () => {
      expect(nearestSide(rectA, { x: 200, y: 50 })).toBe('right');
    });

    it('B at 44° → right (just before diagonal)', () => {
      // 44° from centre: dx = cos(44°)*r, dy = sin(44°)*r
      // For a 100x100 rect, the diagonal is at 45°
      const angle = 44 * Math.PI / 180;
      const r = 200;
      expect(nearestSide(rectA, { x: 50 + Math.cos(angle) * r, y: 50 + Math.sin(angle) * r })).toBe('right');
    });

    it('B at 46° → top (just after diagonal)', () => {
      const angle = 46 * Math.PI / 180;
      const r = 200;
      expect(nearestSide(rectA, { x: 50 + Math.cos(angle) * r, y: 50 + Math.sin(angle) * r })).toBe('bottom');
    });

    it('B at 90° (bottom) → bottom', () => {
      expect(nearestSide(rectA, { x: 50, y: 200 })).toBe('bottom');
    });
  });

  // TC-11: resolveEndpoints with B missing from rects → fallback
  describe('TC-11: orphaned endpoint uses fallback', () => {
    it('resolveEndpoints with B absent → end at fallback, no throw', () => {
      const conn: ConnectorSnap = {
        id: 'c1',
        type: 'connector',
        from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
        to: { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
        z: 1,
      };

      // Only A is present in rects
      const rects = new Map<string, Rect>();
      rects.set('A', makeRect(0, 0, 100, 100));

      const result = resolveEndpoints(conn, rects);
      expect(result.to).toEqual({ x: 400, y: 50 }); // fallback
      // from should be on A's right side (toward B's fallback)
      expect(result.from.x).toBe(100);
    });
  });

  // TC-12: setConnectorEndpoint
  describe('TC-12: setConnectorEndpoint', () => {
    it('to free → updated; to attached C → updated; to opposite end → false', () => {
      const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
      const idB = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u1')!;
      const idC = createShape(doc, { kind: 'rect', rect: { x: 300, y: 200, width: 100, height: 100 }, at: { x: 300, y: 200 } }, 'u1')!;

      const connId = createConnector(doc,
        { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: idB, fallback: { x: 300, y: 50 } },
        'u1'
      )!;

      // Change to free
      expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 300 })).toBe(true);
      const snap1 = snapshot(doc).find(s => s.id === connId) as any;
      expect(snap1.to.kind).toBe('free');
      expect(snap1.to.x).toBe(500);

      // Change to attached C
      expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 300, y: 250 } })).toBe(true);
      const snap2 = snapshot(doc).find(s => s.id === connId) as any;
      expect(snap2.to.objectId).toBe(idC);

      // Try to attach to the opposite end's object (idA)
      const updates = countUpdatesDuring(doc, () => {
        const result = setConnectorEndpoint(doc, connId, 'from', { kind: 'attached', objectId: idC, fallback: { x: 300, y: 250 } });
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  // TC-13: deleteObjects([A]) with a connector attached to A
  describe('TC-13: delete target detaches connector', () => {
    it('A removed and connector from becomes free at A anchor; exactly 1 update', () => {
      const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
      const idB = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u1')!;

      const connId = createConnector(doc,
        { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: idB, fallback: { x: 300, y: 50 } },
        'u1'
      )!;

      const updates = countUpdatesDuring(doc, () => {
        const deleted = deleteObjects(doc, [idA]);
        expect(deleted).toBe(1);
      });
      expect(updates).toBe(1);

      const snap = snapshot(doc);
      expect(snap.find(s => s.id === idA)).toBeUndefined();
      const conn = snap.find(s => s.id === connId) as any;
      expect(conn).toBeDefined();
      expect(conn.from.kind).toBe('free');
      expect(conn.from.x).toBe(100);
      expect(conn.from.y).toBe(50);
      // to should still be attached to B
      expect(conn.to.objectId).toBe(idB);
    });
  });

  // TC-14: distanceToPolyline
  describe('TC-14: distanceToPolyline', () => {
    const segment: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

    it('point on the segment → 0', () => {
      expect(distanceToPolyline(segment, { x: 5, y: 0 })).toBe(0);
    });

    it('point 5.99 units away → 5.99', () => {
      expect(distanceToPolyline(segment, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 2);
    });

    it('point 6.01 units away → 6.01', () => {
      expect(distanceToPolyline(segment, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 2);
    });
  });

  // TC-29: setConnectorEndpoint on a deleted connector id
  describe('TC-29: stale connector id', () => {
    it('setConnectorEndpoint on deleted connector → false', () => {
      const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
      const idB = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u1')!;

      const connId = createConnector(doc,
        { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: idB, fallback: { x: 300, y: 50 } },
        'u1'
      )!;

      // Delete the connector
      deleteObjects(doc, [connId]);

      const result = setConnectorEndpoint(doc, connId, 'from', { kind: 'free', x: 0, y: 0 });
      expect(result).toBe(false);
    });
  });
});
