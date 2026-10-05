import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { createConnector, setConnectorEndpoint, getConnectorEndpoints } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { deleteObjects, snapshotObjects } from '../../src/shared/board-model';
import { nearestSide, resolveEndpoints, type Endpoint, type AttachedEndpoint, type FreeEndpoint } from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => count++);
  return () => count;
}

function makeAttached(objectId: string, fallback: Point): AttachedEndpoint {
  return { kind: 'attached', objectId, fallback };
}

function makeFree(x: number, y: number): FreeEndpoint {
  return { kind: 'free', x, y };
}

describe('connector.model (unit)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-07: attached A→B 300 apart → stored endpoints with fallbacks; 1 update', () => {
    // Create two shapes 300 units apart
    const idA = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'user1')!;
    const idB = createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 100 } }, 'user1')!;

    const getUpdates = countUpdates(doc);
    const fallbackA: Point = { x: 180, y: 100 }; // right side of A
    const fallbackB: Point = { x: 320, y: 100 }; // left side of B
    const from = makeAttached(idA, fallbackA);
    const to = makeAttached(idB, fallbackB);

    const id = createConnector(doc, from, to, 'user1');
    expect(id).toBeTruthy();
    expect(getUpdates()).toBe(1);

    const ep = getConnectorEndpoints(doc, id!);
    expect(ep).not.toBeNull();
    expect(ep!.from).toEqual(from);
    expect(ep!.to).toEqual(to);
  });

  it('TC-08: A→A → null, 0 updates', () => {
    const idA = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'user1')!;
    const getUpdates = countUpdates(doc);

    const from = makeAttached(idA, { x: 180, y: 100 });
    const to = makeAttached(idA, { x: 20, y: 100 });
    const id = createConnector(doc, from, to, 'user1');
    expect(id).toBeNull();
    expect(getUpdates()).toBe(0);
  });

  it('TC-09: free→free length 7.9 → null; 8 (CONNECTOR_MIN_LENGTH_WORLD) → created', () => {
    // 7.9 units
    const from1 = makeFree(0, 0);
    const to1 = makeFree(7.9, 0);
    const getUpdates1 = countUpdates(doc);
    expect(createConnector(doc, from1, to1, 'user1')).toBeNull();
    expect(getUpdates1()).toBe(0);

    // 8 units (boundary)
    const from2 = makeFree(0, 0);
    const to2 = makeFree(CONNECTOR_MIN_LENGTH_WORLD, 0);
    const getUpdates2 = countUpdates(doc);
    const id = createConnector(doc, from2, to2, 'user1');
    expect(id).toBeTruthy();
    expect(getUpdates2()).toBe(1);
  });

  it('TC-10: nearestSide as B orbits A at 0, 44, 46, 90 degrees', () => {
    // A is a 100x100 rect at origin
    const rectA: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const centre: Point = { x: 50, y: 50 };

    // 0° (directly right) → right
    const p0: Point = { x: 200, y: 50 };
    expect(nearestSide(rectA, p0)).toBe('right');

    // 44° (slightly above the diagonal → still right)
    // 44° means the point is at angle 44° from the positive x-axis
    // tan(44°) ≈ 0.966 < 1, so |dx| > |dy| → right
    const r = 200;
    const p44: Point = {
      x: centre.x + r * Math.cos((44 * Math.PI) / 180),
      y: centre.y - r * Math.sin((44 * Math.PI) / 180),
    };
    expect(nearestSide(rectA, p44)).toBe('right');

    // 46° (slightly past the diagonal → top)
    const p46: Point = {
      x: centre.x + r * Math.cos((46 * Math.PI) / 180),
      y: centre.y - r * Math.sin((46 * Math.PI) / 180),
    };
    expect(nearestSide(rectA, p46)).toBe('top');

    // 90° (directly above) → top
    const p90: Point = { x: 50, y: -150 };
    expect(nearestSide(rectA, p90)).toBe('top');
  });

  it('TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw', () => {
    const from: Endpoint = makeAttached('A', { x: 100, y: 100 });
    const to: Endpoint = makeAttached('B', { x: 300, y: 100 });

    // Only A is in the rects map; B is missing (orphaned)
    const rects = new Map<string, Rect>([
      ['A', { x: 50, y: 50, width: 100, height: 100 }],
    ]);

    let result!: { from: Point; to: Point };
    expect(() => {
      result = resolveEndpoints(from, to, rects);
    }).not.toThrow();

    // B is missing → to should be at B's fallback
    expect(result.to).toEqual({ x: 300, y: 100 });
  });

  it('TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite end → false', () => {
    // Create shapes A, B, C
    const idA = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'u')!;
    const idB = createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 100 } }, 'u')!;
    const idC = createShape(doc, { kind: 'rect', rect: null, at: { x: 700, y: 100 } }, 'u')!;

    const from = makeAttached(idA, { x: 180, y: 100 });
    const to = makeAttached(idB, { x: 320, y: 100 });
    const connId = createConnector(doc, from, to, 'u')!;

    // Change 'to' to a free point
    const getUpdates1 = countUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'to', makeFree(500, 200))).toBe(true);
    expect(getUpdates1()).toBe(1);

    // Change 'to' to attached C
    const getUpdates2 = countUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'to', makeAttached(idC, { x: 620, y: 100 }))).toBe(true);
    expect(getUpdates2()).toBe(1);

    // Try to attach 'to' to A (the object at the opposite end) → rejected
    const getUpdates3 = countUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'to', makeAttached(idA, { x: 100, y: 100 }))).toBe(false);
    expect(getUpdates3()).toBe(0);
  });

  it('TC-13: deleteObjects([A]) with connector attached to A → A removed, connector from becomes free', () => {
    const idA = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'u')!;
    const idB = createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 100 } }, 'u')!;

    const from = makeAttached(idA, { x: 180, y: 100 });
    const to = makeAttached(idB, { x: 320, y: 100 });
    const connId = createConnector(doc, from, to, 'u')!;

    const getUpdates = countUpdates(doc);
    const removed = deleteObjects(doc, [idA]);
    expect(removed).toBe(1);
    expect(getUpdates()).toBe(1); // one transaction total

    // A is gone
    const snaps = snapshotObjects(doc);
    expect(snaps.find((s) => s.id === idA)).toBeUndefined();

    // Connector still exists, its 'from' is now free at A's anchor
    const ep = getConnectorEndpoints(doc, connId);
    expect(ep).not.toBeNull();
    expect(ep!.from).toEqual({ kind: 'free', x: 180, y: 100 });
    expect(ep!.to).toEqual(to);
  });

  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment', () => {
    // Segment from (0,0) to (100,0)
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // Point on the segment
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBe(0);

    // 5.99 units above
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 2);

    // 6.01 units above
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  it('TC-29: setConnectorEndpoint on a deleted connector id → false', () => {
    const idA = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'u')!;
    const idB = createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 100 } }, 'u')!;
    const connId = createConnector(doc, makeAttached(idA, { x: 180, y: 100 }), makeAttached(idB, { x: 320, y: 100 }), 'u')!;

    deleteObjects(doc, [connId]);

    const getUpdates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'from', makeFree(0, 0))).toBe(false);
    expect(getUpdates()).toBe(0);
  });
});
