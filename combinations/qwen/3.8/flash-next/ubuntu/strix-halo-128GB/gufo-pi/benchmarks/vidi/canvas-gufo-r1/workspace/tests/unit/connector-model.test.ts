import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObjects } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Rect, Point } from '../../src/shared/geometry';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => { count++; };
  doc.on('update', listener);
  fn();
  doc.off('update', listener);
  return count;
}

describe('connector model', () => {
  // TC-07: attached A→B 300 apart → stored with fallbacks; 1 update
  it('TC-07 createConnector attached A→B with fallbacks', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 450, y: 50 } }, 'u1')!;

    // A is at [0,0,100,100], B is at [400,0,100,100]
    // Nearest side of A toward B's center (450,50): right side → (100, 50)
    // Nearest side of B toward A's center (50,50): left side → (400, 50)
    const fromEp: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const toEp: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };

    let connId: string | null = null;
    const updates = countUpdates(doc, () => {
      connId = createConnector(doc, fromEp, toEp, 'u1');
    });
    expect(connId).not.toBeNull();
    expect(updates).toBe(1);

    const snaps = snapshot(doc);
    const conn = snaps.find((s) => s.id === connId) as any;
    expect(conn.type).toBe('connector');
    expect(conn.from.kind).toBe('attached');
    expect(conn.to.kind).toBe('attached');
  });

  // TC-08: A→A → null, 0 updates
  it('TC-08 self-connection returns null with 0 updates', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u1')!;
    const ep: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };

    const updates = countUpdates(doc, () => {
      const r = createConnector(doc, ep, { ...ep }, 'u1');
      expect(r).toBeNull();
    });
    expect(updates).toBe(0);
  });

  // TC-09: free→free length 7.9 → null; 8 → created
  it('TC-09 minimum length boundary', () => {
    const doc = newDoc();

    // Length 7.9: below minimum
    const updates1 = countUpdates(doc, () => {
      const r = createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: 7.9, y: 0 },
        'u1',
      );
      expect(r).toBeNull();
    });
    expect(updates1).toBe(0);

    // Length 8: at minimum → created
    const updates2 = countUpdates(doc, () => {
      const r = createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: 8, y: 0 },
        'u1',
      );
      expect(r).not.toBeNull();
    });
    expect(updates2).toBe(1);
  });

  // TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90°
  it('TC-10 nearestSide determines correct side at cardinal and diagonal angles', () => {
    // A is at center: rect { x: -50, y: -50, width: 100, height: 100 }
    const r: Rect = { x: -50, y: -50, width: 100, height: 100 };

    // 0° → right: toward is at (100, 0) from center
    expect(nearestSide(r, { x: 100, y: 0 })).toBe('right');

    // 44° (still in horizontal wedge): toward at angle 44° from center
    const dx44 = Math.cos((44 * Math.PI) / 180) * 100;
    const dy44 = Math.sin((44 * Math.PI) / 180) * 100;
    expect(nearestSide(r, { x: dx44, y: dy44 })).toBe('right');

    // 46° (in vertical wedge): toward at angle 46° from center
    const dx46 = Math.cos((46 * Math.PI) / 180) * 100;
    const dy46 = Math.sin((46 * Math.PI) / 180) * 100;
    expect(nearestSide(r, { x: dx46, y: dy46 })).toBe('bottom');

    // 90° → bottom
    expect(nearestSide(r, { x: 0, y: 100 })).toBe('bottom');
  });

  // TC-11: resolveEndpoints with B missing → end at fallback
  it('TC-11 resolveEndpoints uses fallback for missing target', () => {
    const fallback: Point = { x: 500, y: 300 };
    const ep: Endpoint = { kind: 'attached', objectId: 'nonexistent', fallback };
    const free: Endpoint = { kind: 'free', x: 0, y: 0 };
    const rects: ReadonlyMap<string, Rect> = new Map();

    const result = resolveEndpoints(ep, free, rects);
    expect(result.from.x).toBeCloseTo(500);
    expect(result.from.y).toBeCloseTo(300);
  });

  // TC-12: setConnectorEndpoint to free, to attached C, to opposite object
  it('TC-12 setConnectorEndpoint handles re-attach, detach, and opposite rejection', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 450, y: 50 } }, 'u1')!;
    const idC = createShape(doc, { kind: 'rect', rect: { x: 200, y: 300, width: 100, height: 100 }, at: { x: 250, y: 350 } }, 'u1')!;

    const fromEp: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const toEp: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, fromEp, toEp, 'u1')!;

    // Re-attach 'to' to C
    const r1 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 250, y: 300 } });
    expect(r1).toBe(true);

    // Detach 'to' to free
    const r2 = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 300, y: 200 });
    expect(r2).toBe(true);

    // Attach 'to' to opposite end's object (idA) → false, 0 updates
    const updates3 = countUpdates(doc, () => {
      const r = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } });
      expect(r).toBe(false);
    });
    expect(updates3).toBe(0);
  });

  // TC-13: deleteObjects([A]) → connector from becomes free at anchor; one update
  it('TC-13 deleteObjects detaches connector endpoints', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 450, y: 50 } }, 'u1')!;

    const fromEp: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const toEp: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, fromEp, toEp, 'u1')!;

    // deleteObjects should produce exactly 1 update (one transaction)
    let updates: number;
    const idsToDelete = [idA];
    updates = countUpdates(doc, () => {
      deleteObjects(doc, idsToDelete);
    });
    expect(updates).toBe(1);

    // A is gone
    const snaps = snapshot(doc);
    expect(snaps.find((s) => s.id === idA)).toBeUndefined();

    // Connector 'from' is now free
    const conn = snaps.find((s) => s.id === connId) as any;
    expect(conn).toBeDefined();
    expect(conn.from.kind).toBe('free');
    // The free point should be at A's right side anchor: x=100, y=50
    expect(conn.from.x).toBeCloseTo(100);
    expect(conn.from.y).toBeCloseTo(50);
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment
  it('TC-14 distanceToPolyline computes correct distances', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // Point on the line
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0);

    // Point 5.99 above the midpoint of the segment
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99);

    // Point 6.01 above the midpoint
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01);
  });

  // TC-29: setConnectorEndpoint on deleted connector → false
  it('TC-29 setConnectorEndpoint on stale id returns false', () => {
    const doc = newDoc();
    const r = setConnectorEndpoint(doc, 'nonexistent-id', 'from', { kind: 'free', x: 0, y: 0 });
    expect(r).toBe(false);
  });
});

describe('geometry helpers', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 200 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 100 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 200 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 100 });
  });

  it('connectorBBox returns bounding box of line', () => {
    const from: Point = { x: 10, y: 20 };
    const to: Point = { x: 110, y: 50 };
    const bbox = connectorBBox(from, to);
    expect(bbox.x).toBe(10);
    expect(bbox.y).toBe(20);
    expect(bbox.width).toBe(100);
    expect(bbox.height).toBe(30);
  });
});
