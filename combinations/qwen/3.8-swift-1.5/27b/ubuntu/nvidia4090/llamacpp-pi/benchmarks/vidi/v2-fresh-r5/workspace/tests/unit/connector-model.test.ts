import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import {
  nearestSide,
  resolveEndpoints,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { deleteObjects } from '../../src/shared/board-model';
import type { Rect, Point } from '../../src/shared/geometry';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return count;
  };
}

function createTestShape(doc: Y.Doc, id: string, x: number, y: number, w: number, h: number): void {
  const objects = doc.getMap('objects');
  const shapeMap = new Y.Map<unknown>();
  shapeMap.set('type', 'shape');
  shapeMap.set('x', x);
  shapeMap.set('y', y);
  shapeMap.set('width', w);
  shapeMap.set('height', h);
  shapeMap.set('kind', 'rect');
  shapeMap.set('fill', 'white');
  shapeMap.set('stroke', 'dark');
  shapeMap.set('text', new Y.Text());
  shapeMap.set('z', 1);
  shapeMap.set('createdAt', Date.now());
  shapeMap.set('createdBy', 'local');
  doc.transact(() => {
    objects.set(id, shapeMap);
  });
}

describe('connector model and geometry', () => {
  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks = side anchors; 1 update.
  it('TC-07: creates connector with attached endpoints and fallbacks', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);

    const getUpdates = countUpdates(doc);
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };

    const id = createConnector(doc, from, to, 'local');
    expect(id).toBeTypeOf('string');
    expect(id).not.toBe('');
    expect(getUpdates()).toBe(1);

    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(obj).toBeDefined();
    expect(obj.get('type')).toBe('connector');
    expect(obj.get('from')).toEqual({ kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } });
    expect(obj.get('to')).toEqual({ kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } });
  });

  // TC-08: A→A → null, 0 updates (negative).
  it('TC-08: self-connection is rejected', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);

    const getUpdates = countUpdates(doc);
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 0, y: 50 } };

    const id = createConnector(doc, from, to, 'local');
    expect(id).toBeNull();
    expect(getUpdates()).toBe(0);
  });

  // TC-09: free→free length 7.9 → null; 8 (CONNECTOR_MIN_LENGTH_WORLD) → created (boundary).
  it('TC-09: minimum length boundary for free connectors', () => {
    const doc = newDoc();

    // Length 7.9 < 8
    const getUpdates1 = countUpdates(doc);
    const from1: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to1: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const id1 = createConnector(doc, from1, to1, 'local');
    expect(id1).toBeNull();
    expect(getUpdates1()).toBe(0);

    // Length exactly 8
    const getUpdates2 = countUpdates(doc);
    const from2: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to2: Endpoint = { kind: 'free', x: 8, y: 0 };
    const id2 = createConnector(doc, from2, to2, 'local');
    expect(id2).toBeTypeOf('string');
    expect(id2).not.toBe('');
    expect(getUpdates2()).toBe(1);
  });

  // TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top (diagonal switch).
  it('TC-10: nearestSide switches at 45 degree diagonal', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };

    // 0°: B is directly to the right → 'right'
    expect(nearestSide(a, { x: 200, y: 50 })).toBe('right');

    // 44°: B is mostly to the right → 'right'
    // At 44°, the point is more horizontal than vertical relative to center (50,50)
    // dx = 100*cos(44°) ≈ 71.9, dy = 100*sin(44°) ≈ 69.5
    // normalized: dx/width/2 = 71.9/50 = 1.44, dy/height/2 = 69.5/50 = 1.39
    // right wins
    expect(nearestSide(a, { x: 50 + 71.9, y: 50 + 69.5 })).toBe('right');

    // 46°: B is mostly above → 'top'
    // dx = 100*cos(46°) ≈ 69.5, dy = 100*sin(46°) ≈ 71.9
    // normalized: dx/width/2 = 69.5/50 = 1.39, dy/height/2 = 71.9/50 = 1.44
    // top wins
    expect(nearestSide(a, { x: 50 + 69.5, y: 50 - 71.9 })).toBe('top');

    // 90°: B is directly above → 'top'
    expect(nearestSide(a, { x: 50, y: -100 })).toBe('top');
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw (orphaned, error path).
  it('TC-11: resolveEndpoints with missing target uses fallback', () => {
    const c = {
      id: 'conn1',
      type: 'connector' as const,
      x: 0, y: 0, width: 0, height: 0,
      z: 1, createdAt: 0,
      from: { kind: 'attached' as const, objectId: 'A', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached' as const, objectId: 'B', fallback: { x: 300, y: 50 } },
    };

    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    // B is missing from rects

    const result = resolveEndpoints(c, rects);
    // A's end should be at the side anchor of A facing B's fallback
    // B's end should be at B's fallback since B is missing
    expect(result.to).toEqual({ x: 300, y: 50 });
    // A's end should be at the right side midpoint (facing B)
    expect(result.from.x).toBe(100);
    expect(result.from.y).toBe(50);
  });

  // TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to the object at the opposite end → false, 0 updates (negative).
  it('TC-12: setConnectorEndpoint updates endpoints and rejects opposite-end attachment', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);
    createTestShape(doc, 'C', 0, 300, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const id = createConnector(doc, from, to, 'local')!;

    // Set to free
    const getUpdates1 = countUpdates(doc);
    const r1 = setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 200 });
    expect(r1).toBe(true);
    expect(getUpdates1()).toBe(1);

    // Set to attached C
    const getUpdates2 = countUpdates(doc);
    const r2 = setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: 'C', fallback: { x: 50, y: 300 } });
    expect(r2).toBe(true);
    expect(getUpdates2()).toBe(1);

    // Set to attached A (the opposite end's object) → rejected
    const getUpdates3 = countUpdates(doc);
    const r3 = setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: 'A', fallback: { x: 50, y: 100 } });
    expect(r3).toBe(false);
    expect(getUpdates3()).toBe(0);
  });

  // TC-13: deleteObjects([A]) with a connector attached to A → A removed and the connector's `from` becomes free at A's current anchor in exactly one update.
  it('TC-13: deleting a connected object detaches connectors in one update', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const connId = createConnector(doc, from, to, 'local')!;

    const getUpdates = countUpdates(doc);
    const removed = deleteObjects(doc, ['A']);
    expect(removed).toBe(1);
    expect(getUpdates()).toBe(1);

    // A is gone
    expect(doc.getMap('objects').has('A')).toBe(false);

    // Connector's from is now free at A's anchor
    const conn = doc.getMap('objects').get(connId) as Y.Map<unknown>;
    expect(conn.get('from')).toEqual({ kind: 'free', x: 100, y: 50 });
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment → exact distances.
  it('TC-14: distanceToPolyline returns correct distances', () => {
    // Segment from (0,0) to (100,0)
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  // TC-29: setConnectorEndpoint on a deleted connector id → false (stale id).
  it('TC-29: setConnectorEndpoint on deleted connector returns false', () => {
    const doc = newDoc();
    createTestShape(doc, 'A', 0, 0, 100, 100);
    createTestShape(doc, 'B', 300, 0, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const id = createConnector(doc, from, to, 'local')!;

    // Delete the connector
    deleteObjects(doc, [id]);

    // Now try to set endpoint on deleted connector
    const result = setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 0, y: 0 });
    expect(result).toBe(false);
  });
});
