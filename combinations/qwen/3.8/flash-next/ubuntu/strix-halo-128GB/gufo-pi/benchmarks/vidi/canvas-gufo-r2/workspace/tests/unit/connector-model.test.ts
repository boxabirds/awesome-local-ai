/**
 * Unit tests for the connector model and geometry (TC-07 to TC-14, TC-29).
 * Uses a real Y.Doc.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { initDoc, LOCAL_ORIGIN, deleteObjects } from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function createRect(doc: Y.Doc, x: number, y: number, w: number, h: number): string {
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const yMap = new Y.Map();
    objects.set(id, yMap);
    yMap.set('type', 'shape');
    yMap.set('kind', 'rect');
    yMap.set('x', x);
    yMap.set('y', y);
    yMap.set('width', w);
    yMap.set('height', h);
    yMap.set('fill', 'white');
    yMap.set('stroke', 'dark');
    yMap.set('z', 1);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', 'user');
    yMap.set('label', new Y.Text());
  }, LOCAL_ORIGIN);
  return id;
}

describe('connector model', () => {
  let doc: Y.Doc;
  let updateCount: number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    updateCount = 0;
    doc.on('update', () => { updateCount++; });
  });

  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks = side anchors; 1 update
  it('TC-07: attached A→B stores correct endpoints with fallbacks', () => {
    const idA = createRect(doc, 0, 0, 100, 100); // A centre at (50, 50)
    const idB = createRect(doc, 400, 0, 100, 100); // B centre at (450, 50)

    updateCount = 0;
    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user1');
    expect(connId).not.toBeNull();
    expect(updateCount).toBe(1);

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const conn = objects.get(connId!);
    expect(conn!.get('type')).toBe('connector');
    const storedFrom = conn!.get('from') as any;
    const storedTo = conn!.get('to') as any;
    expect(storedFrom.kind).toBe('attached');
    expect(storedFrom.objectId).toBe(idA);
    expect(storedTo.kind).toBe('attached');
    expect(storedTo.objectId).toBe(idB);
    // Fallbacks
    expect(storedFrom.fallback).toEqual({ x: 100, y: 50 });
    expect(storedTo.fallback).toEqual({ x: 400, y: 50 });
  });

  // TC-08: A→A → null, 0 updates (negative)
  it('TC-08: self-connection is rejected', () => {
    const idA = createRect(doc, 0, 0, 100, 100);
    updateCount = 0;
    const ep: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } };
    const result = createConnector(doc, ep, { ...ep }, 'user');
    expect(result).toBeNull();
    expect(updateCount).toBe(0);
  });

  // TC-09: free→free length 7.9 → null; 8 → created (boundary)
  it('TC-09: minimum connector length boundary', () => {
    updateCount = 0;
    const from1: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to1: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const r1 = createConnector(doc, from1, to1, 'user');
    expect(r1).toBeNull();

    const from2: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to2: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };
    const r2 = createConnector(doc, from2, to2, 'user');
    expect(r2).not.toBeNull();
  });

  // TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top
  it('TC-10: nearestSide switches at the diagonal', () => {
    // A at (0,0), width=200, height=100 → centre at (100, 50)
    // We test with the centre of B approaching from various angles
    const A: Rect = { x: 0, y: 0, width: 200, height: 100 };
    // cx=100, cy=50; diagonal slope = height/width = 100/200 = 0.5
    // 0° → B directly to the right: dx>0, dy=0 → right
    expect(nearestSide(A, { x: 400, y: 50 })).toBe('right');
    // 44° → dx large, dy small → still right (tan44° ≈ 0.965 > height/width ratio of 0.5 for this rect)
    // At 44° from centre, dx = cos(44°), dy = sin(44°)
    // Need |dx|*height >= |dy|*width → cos(44°)*100 >= sin(44°)*200?
    // 0.719*100 = 71.9 >= 0.695*200 = 139 → false → top!
    // Let me reconsider: at 44° with the ratio height/width = 0.5, the diagonal angle is atan(0.5)=26.57°
    // So at 44° we're above the diagonal → top
    // Wait, but TC-10 expects right at 44° and top at 46°. Let me use a square:
    const S: Rect = { x: 0, y: 0, width: 200, height: 200 }; // square: diagonal at 45°
    // 0° → right
    expect(nearestSide(S, { x: 300, y: 100 })).toBe('right');
    // 44° → dx = cos44° > dy = sin44° → |dx|*height >= |dy|*width → cos44°*200 >= sin44°*200 → cos44° >= sin44° → true → right
    const angle44 = 44 * Math.PI / 180;
    const _p44: Point = { x: 100 + Math.cos(angle44) * 200, y: 100 + Math.sin(angle44) * 200 };
    void _p44;
    // Note: in screen coords, y increases downward. sin(44°)>0 means below centre → bottom side
    // Actually, let me re-read: dy >= 0 → bottom. The test says "top" at 90°.
    // 90° → sin90°=1, cos90°=0 → |dx|*h < |dy|*w → dy>0 → bottom
    // But the test says "top" at 90°. This must be using a coordinate system where "up" is negative y.
    // At 90°, the point is ABOVE the rect (negative y in math convention = up)
    // Let me use: angle measured from positive x, going counter-clockwise in standard math (so y is up)
    // In screen coords (y-down), to get "top" we need the point above, i.e. y < cy
    // At "44°" in math (counter-clockwise from right, up = positive) → screen: dy < 0
    // At "90°" in math (up) → screen: dx=0, dy=-r → nearestSide should return 'top'

    const cx = 100, cy = 100; // centre of S
    // 0°: point to the right → (cx+r, cy)
    expect(nearestSide(S, { x: cx + 300, y: cy })).toBe('right');
    // 44° above horizontal (math angle 44°): dx=cos44°, dy=-sin44° (up in screen)
    const p1: Point = { x: cx + Math.cos(angle44) * 200, y: cy - Math.sin(angle44) * 200 };
    // dx≈143.8, dy≈-138.9 → |dx|*h=143.8*200=28757 >= |dy|*w=138.9*200=27786 → right ✓
    expect(nearestSide(S, p1)).toBe('right');
    // 46° above horizontal:
    const angle46 = 46 * Math.PI / 180;
    const p2: Point = { x: cx + Math.cos(angle46) * 200, y: cy - Math.sin(angle46) * 200 };
    // dx≈138.9, dy≈-143.8 → |dx|*h=27786 < |dy|*w=28757 → top ✓
    expect(nearestSide(S, p2)).toBe('top');
    // 90°: point directly above → dx=0, dy=-200 → |0|*h=0 < 200*w → top ✓
    expect(nearestSide(S, { x: cx, y: cy - 200 })).toBe('top');
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw
  it('TC-11: orphaned endpoint renders at fallback', () => {
    const from: Endpoint = { kind: 'attached', objectId: 'idA', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'idB_missing', fallback: { x: 400, y: 50 } };
    const rects = new Map<string, Rect>();
    rects.set('idA', { x: 0, y: 0, width: 100, height: 100 });
    // idB_missing is NOT in rects
    const resolved = resolveEndpoints({ from, to }, rects);
    // 'to' should be at fallback since its object is missing
    expect(resolved.to).toEqual({ x: 400, y: 50 });
    // 'from' should resolve to nearest side anchor of A toward to.fallback (which is right side)
    expect(resolved.from).toEqual({ x: 100, y: 50 });
  });

  // TC-12: setConnectorEndpoint: to free → updated; to attached C → updated; to opposite end object → false
  it('TC-12: setConnectorEndpoint valid and invalid operations', () => {
    const idA = createRect(doc, 0, 0, 100, 100);
    const idB = createRect(doc, 400, 0, 100, 100);
    const idC = createRect(doc, 200, 200, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user')!;

    updateCount = 0;
    // Detach 'to' to free
    const r1 = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 300 });
    expect(r1).toBe(true);
    expect(updateCount).toBe(1);
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const storedTo = objects.get(connId)!.get('to') as any;
    expect(storedTo.kind).toBe('free');
    expect(storedTo.x).toBe(500);

    // Attach 'to' to C
    updateCount = 0;
    const r2 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 250, y: 200 } });
    expect(r2).toBe(true);
    expect(updateCount).toBe(1);

    // Attach 'to' to A (the object at the opposite end) → false
    updateCount = 0;
    const r3 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } });
    expect(r3).toBe(false);
    expect(updateCount).toBe(0);
  });

  // TC-13: deleteObjects([A]) with a connector attached to A → from becomes free at A's anchor; exactly one update
  it('TC-13: delete connected object detaches its connectors in one update', () => {
    const idA = createRect(doc, 0, 0, 100, 100);
    const idB = createRect(doc, 400, 0, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user')!;

    updateCount = 0;
    deleteObjects(doc, [idA]);
    // Should be exactly 1 update (detach + delete in same transaction)
    expect(updateCount).toBe(1);

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objects.has(idA)).toBe(false);
    expect(objects.has(connId)).toBe(true);
    const storedFrom = objects.get(connId)!.get('from') as any;
    expect(storedFrom.kind).toBe('free');
    // The from anchor should be A's right side midpoint: (100, 50) since B is to the right
    expect(storedFrom.x).toBe(100);
    expect(storedFrom.y).toBe(50);
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment
  it('TC-14: distanceToPolyline returns correct distances', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    // Point on the line
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0, 10);
    // Point 5.99 units away (perpendicular)
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 2);
    // Point 6.01 units away
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  // TC-29: setConnectorEndpoint on a deleted connector id → false (stale id)
  it('TC-29: setConnectorEndpoint on deleted connector returns false', () => {
    const idA = createRect(doc, 0, 0, 100, 100);
    const idB = createRect(doc, 400, 0, 100, 100);
    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user')!;

    // Delete the connector directly
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    doc.transact(() => { objects.delete(connId); }, LOCAL_ORIGIN);

    updateCount = 0;
    const r = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 10, y: 10 });
    expect(r).toBe(false);
    expect(updateCount).toBe(0);
  });
});

describe('geometry helpers', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 60 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 80 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 50 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 50 });
  });

  it('connectorBBox spans both points', () => {
    const bbox = connectorBBox({ x: 10, y: 20 }, { x: 100, y: 50 });
    expect(bbox).toEqual({ x: 10, y: 20, width: 90, height: 30 });
  });

  it('connectorBBox with zero distance', () => {
    const bbox = connectorBBox({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(bbox).toEqual({ x: 50, y: 50, width: 0, height: 0 });
  });
});
