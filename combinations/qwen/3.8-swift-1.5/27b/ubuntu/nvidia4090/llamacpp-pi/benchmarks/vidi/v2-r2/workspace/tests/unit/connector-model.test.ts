/**
 * Unit tests for the connector model and geometry (story 10, connector.model).
 * TC-07 to TC-14, TC-29.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, objectSnapshot, deleteObjects } from '../../src/shared/board-model';
import { createConnector, setConnectorEndpoint, type Endpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function trackUpdates(doc: Y.Doc): { count: () => number; cleanup: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    count: () => count,
    cleanup: () => doc.off('update', handler),
  };
}

describe('connector.model (TC-07 to TC-14, TC-29)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-07: attached A→B 300 apart → stored endpoints with fallbacks; 1 update', () => {
    // Create two shapes 300 units apart
    const aId = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
    const bId = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'u1')!;

    const tracker = trackUpdates(doc);
    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: bId, fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, from, to, 'u1');

    expect(id).not.toBeNull();
    expect(tracker.count()).toBe(1);

    const snap = objectSnapshot(doc);
    const conn = snap.find((s) => s.id === id)!;
    expect(conn.type).toBe('connector');
    tracker.cleanup();
  });

  it('TC-08: A→A → null, 0 updates (self-connection rejected)', () => {
    const aId = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;

    const tracker = trackUpdates(doc);
    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 50, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 50, y: 50 } };
    const id = createConnector(doc, from, to, 'u1');

    expect(id).toBeNull();
    expect(tracker.count()).toBe(0);
    tracker.cleanup();
  });

  it('TC-09: free→free length 7.9 → null; 8 → created (boundary)', () => {
    // Too short (7.9)
    const tracker1 = trackUpdates(doc);
    const id1 = createConnector(doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 7.9, y: 0 },
      'u1'
    );
    expect(id1).toBeNull();
    expect(tracker1.count()).toBe(0);
    tracker1.cleanup();

    // Exactly minimum (8)
    const tracker2 = trackUpdates(doc);
    const id2 = createConnector(doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
      'u1'
    );
    expect(id2).not.toBeNull();
    expect(tracker2.count()).toBe(1);
    tracker2.cleanup();
  });

  it('TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50, cy = 50;

    // 0°: directly to the right
    expect(nearestSide(rect, { x: cx + 100, y: cy })).toBe('right');
    // 44°: slightly above the diagonal (still right)
    expect(nearestSide(rect, { x: cx + 100, y: cy - 90 })).toBe('right');
    // 46°: past the diagonal (top)
    expect(nearestSide(rect, { x: cx + 90, y: cy - 100 })).toBe('top');
    // 90°: directly above
    expect(nearestSide(rect, { x: cx, y: cy - 100 })).toBe('top');
  });

  it('TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw', () => {
    const from = { kind: 'attached' as const, objectId: 'A', fallback: { x: 100, y: 50 } };
    const to = { kind: 'attached' as const, objectId: 'B', fallback: { x: 400, y: 50 } };

    // Only A is in the rects map; B is missing (orphaned)
    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });

    const result = resolveEndpoints({ from, to }, rects);
    expect(result.from).toBeDefined();
    expect(result.to).toEqual({ x: 400, y: 50 }); // fallback
  });

  it('TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite → false', () => {
    const aId = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
    const bId = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u1')!;
    const cId = createShape(doc, { kind: 'rect', rect: { x: 0, y: 300, width: 100, height: 100 }, at: { x: 0, y: 300 } }, 'u1')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: bId, fallback: { x: 300, y: 50 } },
      'u1'
    )!;

    // Set to free
    const tracker1 = trackUpdates(doc);
    const ok1 = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 500 });
    expect(ok1).toBe(true);
    expect(tracker1.count()).toBe(1);
    tracker1.cleanup();

    // Set to attached C
    const tracker2 = trackUpdates(doc);
    const ok2 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: cId, fallback: { x: 50, y: 300 } });
    expect(ok2).toBe(true);
    expect(tracker2.count()).toBe(1);
    tracker2.cleanup();

    // Set to the opposite end's object (A) → rejected
    const tracker3 = trackUpdates(doc);
    const ok3 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: aId, fallback: { x: 50, y: 50 } });
    expect(ok3).toBe(false);
    expect(tracker3.count()).toBe(0);
    tracker3.cleanup();
  });

  it('TC-13: deleteObjects([A]) with a connector attached to A → connector from becomes free', () => {
    const aId = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
    const bId = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u1')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: bId, fallback: { x: 300, y: 50 } },
      'u1'
    )!;

    const tracker = trackUpdates(doc);
    const removed = deleteObjects(doc, [aId]);
    expect(removed).toBe(1);
    expect(tracker.count()).toBe(1); // exactly one update

    const snap = objectSnapshot(doc);
    const conn = snap.find((s) => s.id === connId)!;
    expect(conn).toBeDefined(); // connector still exists
    const connSnap = conn as unknown as { from: { kind: string; x?: number; y?: number } };
    expect(connSnap.from.kind).toBe('free');
    expect(connSnap.from.x).toBeDefined();
    expect(connSnap.from.y).toBeDefined();

    // A is removed
    expect(snap.find((s) => s.id === aId)).toBeUndefined();
    tracker.cleanup();
  });

  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // On the line
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBe(0);
    // 5.99 units away
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 2);
    // 6.01 units away
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  it('TC-29: setConnectorEndpoint on a deleted connector id → false', () => {
    const aId = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u1')!;
    const bId = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u1')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: bId, fallback: { x: 300, y: 50 } },
      'u1'
    )!;

    // Delete the connector
    deleteObjects(doc, [connId]);

    // Try to set endpoint on the deleted connector
    const result = setConnectorEndpoint(doc, connId, 'from', { kind: 'free', x: 0, y: 0 });
    expect(result).toBe(false);
  });
});

describe('connector geometry', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 45 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 70 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 45 });
  });

  it('connectorBBox computes correct bounding box', () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});
