import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObjects } from '../../src/shared/board-model';
import { createConnector, setConnectorEndpoint, type Endpoint } from '../../src/shared/objects/connector';
import { nearestSide, resolveEndpoints, type ConnectorSnap, type ConnectorEndpointSnap } from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createShape } from '../../src/shared/objects/shape';
import type { Rect, Point } from '../../src/shared/geometry';

function countUpdates(doc: Y.Doc): { count: () => number; off: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    count: () => count,
    off: () => { doc.off('update', handler); },
  };
}

function getConnectors(doc: Y.Doc): readonly ConnectorSnap[] {
  return snapshot(doc).filter((s) => s.type === 'connector') as ConnectorSnap[];
}

describe('connector.model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks; 1 update
  it('TC-07: createConnector attached A to B stores endpoints with fallbacks', () => {
    // Create two shapes 300 units apart
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'user1')!;

    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };

    const up = countUpdates(doc);
    const id = createConnector(doc, from, to, 'user1');
    expect(id).toBeTypeOf('string');
    expect(up.count()).toBe(1);

    const conns = getConnectors(doc);
    expect(conns).toHaveLength(1);
    expect(conns[0].from.kind).toBe('attached');
    expect((conns[0].from as any).objectId).toBe(idA);
    expect(conns[0].to.kind).toBe('attached');
    expect((conns[0].to as any).objectId).toBe(idB);
    up.off();
  });

  // TC-08: A→A → null, 0 updates
  it('TC-08: self-connection returns null with no updates', () => {
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1')!;

    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 0, y: 50 } };

    const up = countUpdates(doc);
    const id = createConnector(doc, from, to, 'user1');
    expect(id).toBeNull();
    expect(up.count()).toBe(0);
    up.off();
  });

  // TC-09: free→free length 7.9 → null; 8 → created
  it('TC-09: minimum length boundary (7.9 rejected, 8 accepted)', () => {
    // 7.9 units apart
    const from1: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to1: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const up1 = countUpdates(doc);
    const id1 = createConnector(doc, from1, to1, 'user1');
    expect(id1).toBeNull();
    expect(up1.count()).toBe(0);
    up1.off();

    // Exactly 8 units apart
    const from2: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to2: Endpoint = { kind: 'free', x: 8, y: 0 };
    const up2 = countUpdates(doc);
    const id2 = createConnector(doc, from2, to2, 'user1');
    expect(id2).toBeTypeOf('string');
    expect(up2.count()).toBe(1);
    up2.off();
  });

  // TC-10: nearestSide as B orbits A at 0, 44, 46, 90 degrees
  it('TC-10: nearestSide switches at the 45-degree diagonal', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };

    // 0 degrees (directly right) → right
    expect(nearestSide(rect, { x: 200, y: 50 })).toBe('right');

    // 44 degrees (slightly above horizontal) → right (still more horizontal)
    // At 44°, tan(44°) ≈ 0.966 < 1, so horizontal wins for a square
    expect(nearestSide(rect, { x: 200, y: 50 - 150 * Math.tan(44 * Math.PI / 180) })).toBe('right');

    // 46 degrees (slightly above vertical) → top (more vertical)
    expect(nearestSide(rect, { x: 200, y: 50 - 150 * Math.tan(46 * Math.PI / 180) })).toBe('top');

    // 90 degrees (directly above) → top
    expect(nearestSide(rect, { x: 50, y: -200 })).toBe('top');
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw
  it('TC-11: resolveEndpoints with missing target uses fallback', () => {
    const from: ConnectorEndpointSnap = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: ConnectorEndpointSnap = { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } };

    // Only A in rects, B is missing
    const rects = new Map<string, Rect>([
      ['A', { x: 0, y: 0, width: 100, height: 100 }],
    ]);

    // Should not throw
    const result = resolveEndpoints({ from, to }, rects);
    expect(result.from).toBeDefined();
    expect(result.to).toEqual({ x: 400, y: 50 }); // fallback
  });

  // TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite → false
  it('TC-12: setConnectorEndpoint updates, rejects opposite object', () => {
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'user1')!;
    const idC = createShape(doc, { kind: 'rect', rect: { x: 0, y: 400, width: 100, height: 100 }, at: { x: 0, y: 400 } }, 'user1')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'user1'
    )!;

    // Change to free
    const up1 = countUpdates(doc);
    const r1 = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 500 });
    expect(r1).toBe(true);
    expect(up1.count()).toBe(1);
    up1.off();

    // Change to attached C
    const up2 = countUpdates(doc);
    const r2 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 50, y: 400 } });
    expect(r2).toBe(true);
    expect(up2.count()).toBe(1);
    up2.off();

    // Try to attach to the opposite end's object (A)
    const up3 = countUpdates(doc);
    const r3 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idA, fallback: { x: 0, y: 50 } });
    expect(r3).toBe(false);
    expect(up3.count()).toBe(0);
    up3.off();
  });

  // TC-13: deleteObjects([A]) with connector attached to A → A removed, connector free at anchor
  it('TC-13: deleteObjects detaches connected arrows', () => {
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'user1')!;

    createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'user1'
    )!;

    const up = countUpdates(doc);
    const deleted = deleteObjects(doc, [idA]);
    expect(deleted).toBe(1);
    expect(up.count()).toBe(1); // one transaction

    // A is gone
    const snap = snapshot(doc);
    expect(snap.find((s) => s.id === idA)).toBeUndefined();

    // Connector still exists with from end now free
    const conns = getConnectors(doc);
    expect(conns).toHaveLength(1);
    expect(conns[0].from.kind).toBe('free');
    expect(conns[0].from).toMatchObject({ x: 100, y: 50 });
    up.off();
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment
  it('TC-14: distanceToPolyline returns exact distances', () => {
    const a: Point = { x: 0, y: 0 };
    const b: Point = { x: 100, y: 0 };
    const pts = [a, b];

    // On the line
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0, 10);

    // 5.99 units away
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);

    // 6.01 units away
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  // TC-29: setConnectorEndpoint on a deleted connector id → false
  it('TC-29: setConnectorEndpoint on deleted connector returns false', () => {
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user1')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'user1')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'user1'
    )!;

    // Delete the connector
    deleteObjects(doc, [connId!]);

    // Try to set endpoint on deleted connector
    const result = setConnectorEndpoint(doc, connId!, 'from', { kind: 'free', x: 0, y: 0 });
    expect(result).toBe(false);
  });
});
