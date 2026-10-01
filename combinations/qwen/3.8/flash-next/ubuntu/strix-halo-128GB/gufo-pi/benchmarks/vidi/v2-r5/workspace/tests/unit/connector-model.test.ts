import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  readConnectorSnapshot,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import type { Rect, Point } from '../../src/shared/geometry';

/** Count the `update` events a call emits on the document. */
const withUpdateCount = <T>(doc: Y.Doc, run: () => T): { result: T; updates: number } => {
  let updates = 0;
  const observer = () => { updates += 1; };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
};

/** Create a raw object in the doc for testing. */
function putObject(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, value);
    }
    (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).set(id, map);
  });
}

describe('connector model', () => {
  it('TC-07: create attached A→B 300 apart → stored endpoints with fallbacks, 1 update', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });
    putObject(doc, 'B', { type: 'rect', x: 400, y: 0, width: 100, height: 100, z: 2 });

    // A is at centre (50,50), B is at centre (450,50) → nearest side of A toward B is 'right' → anchor (100, 50)
    // nearest side of B toward A is 'left' → anchor (400, 50)
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };

    const { result: id, updates } = withUpdateCount(doc, () => createConnector(doc, from, to, 'user-1'));
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
    const snap = readConnectorSnapshot(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.from.kind).toBe('attached');
    expect(snap!.to.kind).toBe('attached');
    if (snap!.from.kind === 'attached') expect(snap!.from.objectId).toBe('A');
    if (snap!.to.kind === 'attached') expect(snap!.to.objectId).toBe('B');
  });

  it('TC-08: A→A (same object) → null, 0 updates', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });

    const ep: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const { result, updates } = withUpdateCount(doc, () => createConnector(doc, ep, ep, 'user-1'));
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-09: free→free length 7.9 → null (below min)', () => {
    const doc = new Y.Doc();
    const from: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const { result, updates } = withUpdateCount(doc, () => createConnector(doc, from, to, 'user-1'));
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-09b: free→free length exactly 8 → created', () => {
    const doc = new Y.Doc();
    const from: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to: Endpoint = { kind: 'free', x: 8, y: 0 };
    const { result, updates } = withUpdateCount(doc, () => createConnector(doc, from, to, 'user-1'));
    expect(result).toBeTruthy();
    expect(updates).toBe(1);
  });

  it('TC-10: nearestSide — B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    // A is a square 200x200 at origin, centre at (100, 100)
    const r: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const cx = 100, cy = 100;

    // 0° → B is to the right: (300, 100)
    expect(nearestSide(r, { x: 300, y: 100 })).toBe('right');

    // 44° → (cx + 200*cos(-44°), cy + 200*sin(-44°)) — slightly above the 45° diagonal
    const angle44 = (44 * Math.PI) / 180;
    const p44: Point = { x: cx + 200 * Math.cos(angle44), y: cy - 200 * Math.sin(angle44) };
    expect(nearestSide(r, p44)).toBe('right');

    // 46° → just past 45°, should switch to 'top'
    const angle46 = (46 * Math.PI) / 180;
    const p46: Point = { x: cx + 200 * Math.cos(angle46), y: cy - 200 * Math.sin(angle46) };
    expect(nearestSide(r, p46)).toBe('top');

    // 90° → directly above
    expect(nearestSide(r, { x: 100, y: -100 })).toBe('top');
  });

  it('TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw', () => {
    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    // B is NOT in rects

    const from = { kind: 'attached' as const, objectId: 'A', fallback: { x: 100, y: 50 } };
    const to = { kind: 'attached' as const, objectId: 'B', fallback: { x: 500, y: 150 } };

    const result = resolveEndpoints({ from, to }, rects);
    expect(result.to.x).toBe(500);
    expect(result.to.y).toBe(150);
    // from should resolve normally using A's rect
    expect(result.from).toBeDefined();
  });

  it('TC-12: setConnectorEndpoint to free → updated', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });
    putObject(doc, 'B', { type: 'rect', x: 400, y: 0, width: 100, height: 100, z: 2 });
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, from, to, 'user-1')!;

    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 300, y: 200 }),
    );
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const snap = readConnectorSnapshot(doc, id);
    expect(snap!.to.kind).toBe('free');
    if (snap!.to.kind === 'free') {
      expect(snap!.to.x).toBe(300);
      expect(snap!.to.y).toBe(200);
    }
  });

  it('TC-12b: setConnectorEndpoint to attached C → updated', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });
    putObject(doc, 'B', { type: 'rect', x: 400, y: 0, width: 100, height: 100, z: 2 });
    putObject(doc, 'C', { type: 'rect', x: 200, y: 300, width: 100, height: 100, z: 3 });
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, from, to, 'user-1')!;

    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: 'C', fallback: { x: 250, y: 300 } }),
    );
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const snap = readConnectorSnapshot(doc, id);
    expect(snap!.to.kind).toBe('attached');
    if (snap!.to.kind === 'attached') expect(snap!.to.objectId).toBe('C');
  });

  it('TC-12c: setConnectorEndpoint to the object at the opposite end → false, 0 updates', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });
    putObject(doc, 'B', { type: 'rect', x: 400, y: 0, width: 100, height: 100, z: 2 });
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, from, to, 'user-1')!;

    // Try to set 'from' to B (the object at the 'to' end)
    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } }),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-13: deleteObjects([A]) with connector → A removed, connector from becomes free at anchor', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });
    putObject(doc, 'B', { type: 'rect', x: 400, y: 0, width: 100, height: 100, z: 2 });
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user-1')!;

    // Simulate deleteObjects: detachConnectorsTo then delete in same transaction
    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    doc.transact(() => {
      detachConnectorsTo(doc, ['A']);
      objMap.delete('A');
    }, LOCAL_ORIGIN);
    doc.off('update', () => { updates += 1; });

    expect(updates).toBe(1);
    expect(objMap.has('A')).toBe(false);
    const snap = readConnectorSnapshot(doc, connId);
    expect(snap).toBeDefined();
    expect(snap!.from.kind).toBe('free');
    if (snap!.from.kind === 'free') {
      // Should be at the right side of A's rect (nearest to B): (100, 50)
      expect(snap!.from.x).toBe(100);
      expect(snap!.from.y).toBe(50);
    }
  });

  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from segment', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    // Point exactly on the line
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBe(0);
    // Point 5.99 units away (perpendicular)
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    // Point 6.01 units away
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  it('TC-29: setConnectorEndpoint on deleted connector → false (stale id)', () => {
    const doc = new Y.Doc();
    putObject(doc, 'A', { type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 1 });
    putObject(doc, 'B', { type: 'rect', x: 400, y: 0, width: 100, height: 100, z: 2 });
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, from, to, 'user-1')!;

    // Delete the connector
    (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).delete(id);

    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 0, y: 0 }),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('connector-geometry', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 200, y: 50 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 100, y: 100 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('connectorBBox returns correct rect', () => {
    const from: Point = { x: 10, y: 20 };
    const to: Point = { x: 50, y: 80 };
    const bbox = connectorBBox(from, to);
    expect(bbox.x).toBe(10);
    expect(bbox.y).toBe(20);
    expect(bbox.width).toBe(40);
    expect(bbox.height).toBe(60);
  });
});
