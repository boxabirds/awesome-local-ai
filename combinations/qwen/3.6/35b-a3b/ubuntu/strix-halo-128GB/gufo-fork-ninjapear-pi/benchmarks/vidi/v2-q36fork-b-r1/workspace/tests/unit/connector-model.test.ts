/**
 * Task 9: Connector model and geometry unit tests (TC-07 to TC-14, TC-29)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '@/shared/board-model';
import { createShape, ShapeSnap } from '@/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
} from '@/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
  distanceToPolyline,
} from '@/shared/geometry/connector-geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@/shared/config';
import type { Rect, Point, AttachedEndpoint, FreeEndpoint, Endpoint } from '@/shared/geometry/connector-geometry';

function countUpdateEvents(doc: Y.Doc, cb: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  cb();
  doc.off('update', handler);
  return count;
}

// Re-export the config value for tests that reference it directly
const MIN_LEN = CONNECTOR_MIN_LENGTH_WORLD;

describe('connector.model and geometry unit tests', () => {
  let doc: Y.Doc;
  let rectA: string;
  let rectB: string;
  let shapeACenter: Point;
  let shapeBCenter: Point;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);

    // Create two shapes positioned apart
    rectA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 }, square: false }, 'user-1')!;
    rectB = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 350, y: 50 }, square: false }, 'user-1')!;

    shapeACenter = { x: 50, y: 50 };   // center of A
    shapeBCenter = { x: 350, y: 50 };   // center of B
  });

  // ---- TC-07: create connector attached → attached ----
  it('TC-07: createConnector from A to B (attached→attached) with fallbacks = side anchors', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectB, fallback: shapeBCenter };
    const updates = countUpdateEvents(doc, () => {
      const id = createConnector(doc, fromEp, toEp, 'user-1');
      expect(id).toBeDefined();

      const snaps = doc.getMap('objects') as any;
      const inner = snaps.get(id);
      expect(inner.get('type')).toBe('connector');
      expect(inner.get('x')).toBe(0);
      expect(inner.get('from')).toEqual(fromEp);
      expect(inner.get('to')).toEqual(toEp);
    });
    expect(updates).toBe(1);
  });

  // ---- TC-08: same object → null ----
  it('TC-08: createConnector A→A → null, 0 updates', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const updates = countUpdateEvents(doc, () => {
      const id = createConnector(doc, fromEp, toEp, 'user-1');
      expect(id).toBe(null);
    });
    expect(updates).toBe(0);
  });

  // ---- TC-09: free→free near boundary ----
  it('TC-09a: free endpoints 7.9 units apart → null', () => {
    const fromEp: FreeEndpoint = { kind: 'free', x: 0, y: 0 };
    const toEp: FreeEndpoint = { kind: 'free', x: 7.9, y: 0 };
    const updates = countUpdateEvents(doc, () => {
      const id = createConnector(doc, fromEp, toEp, 'user-1');
      expect(id).toBe(null);
    });
    expect(updates).toBe(0);
  });

  it('TC-09b: free endpoints exactly 8 units apart → created', () => {
    const fromEp: FreeEndpoint = { kind: 'free', x: 0, y: 0 };
    const toEp: FreeEndpoint = { kind: 'free', x: 8, y: 0 };
    const updates = countUpdateEvents(doc, () => {
      const id = createConnector(doc, fromEp, toEp, 'user-1');
      expect(id).toBeDefined();
    });
    expect(updates).toBe(1);
  });

  // ---- TC-10: nearestSide diagonal switch ----
  it('TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    const r: Rect = { x: -50, y: -50, width: 100, height: 100 }; // center at 0,0

    // 0°: on the right → right
    expect(nearestSide(r, { x: 100, y: 0 })).toBe('right');

    // 44°: closer to right than top (|dx| > |dy|) → right
    const d44 = Math.cos(44 * Math.PI / 180) * 100;
    const d44y = Math.sin(44 * Math.PI / 180) * 100;
    expect(nearestSide(r, { x: d44, y: d44y })).toBe('right');

    // 46°: closer to top than right (|dy| > |dx|) → top
    const d46 = Math.cos(46 * Math.PI / 180) * 100;
    const d46y = Math.sin(46 * Math.PI / 180) * 100;
    expect(nearestSide(r, { x: d46, y: -d46y })).toBe('top');

    // 90°: straight above → top
    expect(nearestSide(r, { x: 0, y: -100 })).toBe('top');
  });

  // ---- TC-11: resolveEndpoints with missing target ----
  it('TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: 'missing-id', fallback: { x: 500, y: 500 } };
    const toEp: FreeEndpoint = { kind: 'free', x: 600, y: 600 };
    const emptyRects = new Map<string, Rect>();

    const result = resolveEndpoints({ from: fromEp, to: toEp }, emptyRects);
    expect(result.from).toEqual({ x: 500, y: 500 });
    expect(result.to).toEqual({ x: 600, y: 600 });
  });

  // ---- TC-12: setConnectorEndpoint ----
  it('TC-12a: setConnectorEndpoint to free → updated', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectB, fallback: shapeBCenter };
    const id = createConnector(doc, fromEp, toEp, 'user-1')!;

    const freeEp: FreeEndpoint = { kind: 'free', x: 999, y: 999 };
    const updates = countUpdateEvents(doc, () => {
      const ok = setConnectorEndpoint(doc, id, 'from', freeEp);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);

    const objs = doc.getMap('objects') as any;
    expect(objs.get(id).get('from')).toEqual(freeEp);
  });

  it('TC-12b: setConnectorEndpoint to attached C → updated', () => {
    // Add a third shape
    const rectC = createShape(doc, { kind: 'rect', rect: { x: 600, y: 600, width: 100, height: 100 }, at: { x: 650, y: 650 }, square: false }, 'user-1')!;

    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectB, fallback: shapeBCenter };
    const id = createConnector(doc, fromEp, toEp, 'user-1')!;

    const newToEp: AttachedEndpoint = { kind: 'attached', objectId: rectC, fallback: { x: 650, y: 650 } };
    const updates = countUpdateEvents(doc, () => {
      const ok = setConnectorEndpoint(doc, id, 'to', newToEp);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);
  });

  it('TC-12c: setConnectorEndpoint to opposite end\'s object → false, 0 updates', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectB, fallback: shapeBCenter };
    const id = createConnector(doc, fromEp, toEp, 'user-1')!;

    // Try attaching `from` to rectB (the object at the other end)
    const updates = countUpdateEvents(doc, () => {
      const ok = setConnectorEndpoint(doc, id, 'from', { kind: 'attached' as const, objectId: rectB, fallback: shapeBCenter });
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // ---- TC-13: deleteObjects triggers detach ----
  it('TC-13: deleteObjects([A]) with a connector attached to A → from becomes free at anchor; A removed; one update', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectB, fallback: shapeBCenter };
    const connId = createConnector(doc, fromEp, toEp, 'user-1');
    expect(connId).toBeDefined();

    const objectsMap = doc.getMap('objects');

    const totalUpdates = countUpdateEvents(doc, () => {
      // Begin transaction manually
      doc.transact(() => {
        detachConnectorsTo(doc, [rectA]);
        objectsMap.delete(rectA);

        // Verify detached endpoint
        const connInner = connId ? (objectsMap.get(connId) as any) : undefined;
        if (!connId || !connInner) throw new Error('Missing connector');
        const fromAfter = connInner.get('from') as { kind: string; x: number; y: number };
        expect(fromAfter.kind).toBe('free');

        // A should be gone
        expect(objectsMap.has(rectA)).toBe(false);
      }, 'local-origin');
    });
    expect(totalUpdates).toBe(1);
  });

  // ---- TC-14: distanceToPolyline ----
  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment', () => {
    const pts: readonly Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

    // On the line → 0
    expect(distanceToPolyline(pts, { x: 5, y: 0 })).toBe(0);
    // Just below 6 → 5.99
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 })).toBeCloseTo(5.99);
    // Just above 6 → 6.01
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 })).toBeCloseTo(6.01);
  });

  // ---- TC-29: setConnectorEndpoint on deleted connector ----
  it('TC-29: setConnectorEndpoint on deleted connector id → false', () => {
    const fromEp: AttachedEndpoint = { kind: 'attached', objectId: rectA, fallback: shapeACenter };
    const toEp: AttachedEndpoint = { kind: 'attached', objectId: rectB, fallback: shapeBCenter };
    const connId = createConnector(doc, fromEp, toEp, 'user-1')!;
    doc.getMap('objects').delete(connId);

    const updates = countUpdateEvents(doc, () => {
      const ok = setConnectorEndpoint(doc, connId, 'from', { kind: 'free', x: 0, y: 0 });
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // ---- sideAnchor helper tests ----
  it('sideAnchor returns correct midpoint for each side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 200 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 100 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 200 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 100 });
  });

  // ---- connectorBBox helper tests ----
  it('connectorBBox computes bounding box correctly', () => {
    const bb = connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(bb.x).toBe(0);
    expect(bb.y).toBe(0);
    expect(bb.width).toBe(100);
    expect(bb.height).toBe(50);
  });

  it('connectorBBox handles reversed points', () => {
    const bb = connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 });
    expect(bb.x).toBe(0);
    expect(bb.y).toBe(0);
    expect(bb.width).toBe(100);
    expect(bb.height).toBe(50);
  });
});
