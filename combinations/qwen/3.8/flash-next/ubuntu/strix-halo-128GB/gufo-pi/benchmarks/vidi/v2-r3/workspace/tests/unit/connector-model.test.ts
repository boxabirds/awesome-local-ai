import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, deleteObjects, snapshot, getObjectsMap } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
} from '../../src/shared/objects/connector';
import type { Endpoint } from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => { n += 1; };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

describe('connector.model', () => {
  it('TC-07: attached A→B 300 apart → stored endpoints with fallbacks, 1 update', () => {
    const doc = freshDoc();

    // Create two shapes 300 apart horizontally
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 100, width: 100, height: 100 }, at: { x: 0, y: 100 } }, 'u')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 100, width: 100, height: 100 }, at: { x: 400, y: 100 } }, 'u')!;

    const stop = updateCounter(doc);
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: idB, fallback: { x: 0, y: 0 } },
      'u',
    );
    const count = stop();

    expect(connId).not.toBeNull();
    expect(count).toBe(1);

    // Verify stored endpoints
    const snap = snapshot(doc);
    const conn = snap.find((o) => o.id === connId) as any;
    expect(conn).toBeDefined();
    expect(conn.type).toBe('connector');
    expect(conn.from.kind).toBe('attached');
    expect(conn.from.objectId).toBe(idA);
    expect(conn.to.kind).toBe('attached');
    expect(conn.to.objectId).toBe(idB);

    // Fallbacks should be the side anchors:
    // A's right side midpoint: (100, 150) — nearest side toward B (center 450,150)
    expect(conn.from.fallback.x).toBe(100);
    expect(conn.from.fallback.y).toBe(150);
    // B's left side midpoint: (400, 150)
    expect(conn.to.fallback.x).toBe(400);
    expect(conn.to.fallback.y).toBe(150);
  });

  it('TC-08: attached A→A → null, 0 updates (negative)', () => {
    const doc = freshDoc();

    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u')!;

    const stop = updateCounter(doc);
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } },
      'u',
    );
    const count = stop();

    expect(connId).toBeNull();
    expect(count).toBe(0);
  });

  it('TC-09: free→free length 7.9 → null; length 8 (CONNECTOR_MIN_LENGTH_WORLD) → created', () => {
    const doc = freshDoc();

    // Length 7.9 → null
    const stop1 = updateCounter(doc);
    const c1 = createConnector(doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 7.9, y: 0 },
      'u',
    );
    const count1 = stop1();
    expect(c1).toBeNull();
    expect(count1).toBe(0);

    // Length 8 → created
    const stop2 = updateCounter(doc);
    const c2 = createConnector(doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 8, y: 0 },
      'u',
    );
    const count2 = stop2();
    expect(c2).not.toBeNull();
    expect(count2).toBe(1);
  });

  it('TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // Center of r is (50, 50)
    // 0° = right: toward (200, 50) → dx=150, dy=0 → angle=0 → right
    expect(nearestSide(r, { x: 200, y: 50 })).toBe('right');
    // 44° above center: toward (50 + 150*cos(-44°), 50 + 150*sin(-44°)) → above-right
    // Note: screen coords: negative dy = up, so top = -90°. Let's use standard math angle from positive x-axis
    // 44° from horizontal: toward center + 150*(cos(-44°), sin(-44°)) because screen y is inverted
    // Actually atan2(dy, dx) where dy is screen y (down positive)
    // -44° means toward upper-right: atan2(-sin(44°)*150, cos(44°)*150) ≈ -44°
    // -44° falls in (-135, -45] → wait no, -44 > -45, so it's in (-45, 45] → right
    const angle44 = -44 * Math.PI / 180; // 44° above horizontal (negative dy in screen)
    const p44: Point = { x: 50 + 150 * Math.cos(angle44), y: 50 + 150 * Math.sin(angle44) };
    expect(nearestSide(r, p44)).toBe('right'); // -44° is in (-45, 45] → right

    // 46° above: atan2(-sin(46°)*150, cos(46°)*150) ≈ -46°
    // -46° is NOT in (-45, 45], it IS in (-135, -45] → top
    const angle46 = -46 * Math.PI / 180;
    const p46: Point = { x: 50 + 150 * Math.cos(angle46), y: 50 + 150 * Math.sin(angle46) };
    expect(nearestSide(r, p46)).toBe('top');

    // 90° above (straight up): atan2(-150, 0) = -PI/2 = -90° → in (-135, -45] → top
    expect(nearestSide(r, { x: 50, y: -100 })).toBe('top');
  });

  it('TC-11: resolveEndpoints with B missing → end at fallback, no throw', () => {
    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    // B is NOT in rects (deleted)

    const result = resolveEndpoints(
      {
        from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
        to: { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
      },
      rects,
    );

    // 'to' should be at its fallback since B is missing
    expect(result.to.x).toBe(400);
    expect(result.to.y).toBe(50);

    // 'from' should resolve to A's side nearest to B's fallback
    // A rect is (0,0,100,100), center (50,50). Other endpoint resolved to (400,50)
    // Direction from center of A to (400,50): dx=350, dy=0 → angle=0 → right
    // A's right side anchor: (100, 50)
    expect(result.from.x).toBe(100);
    expect(result.from.y).toBe(50);
  });

  it('TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite end object → false, 0 updates', () => {
    const doc = freshDoc();

    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'u')!;
    const idC = createShape(doc, { kind: 'rect', rect: { x: 200, y: 300, width: 100, height: 100 }, at: { x: 200, y: 300 } }, 'u')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'u',
    )!;

    // Set 'to' to free → updated
    const stop1 = updateCounter(doc);
    const r1 = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 200 });
    expect(r1).toBe(true);
    expect(stop1()).toBe(1);

    // Set 'to' back to attached idC → updated
    const stop2 = updateCounter(doc);
    const r2 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 250, y: 300 } });
    expect(r2).toBe(true);
    expect(stop2()).toBe(1);

    // Try attaching 'to' to idA (same as 'from') → false, 0 updates
    const stop3 = updateCounter(doc);
    const r3 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idA, fallback: { x: 0, y: 0 } });
    expect(r3).toBe(false);
    expect(stop3()).toBe(0);
  });

  it('TC-13: deleteObjects([A]) with connector attached to A → connector from becomes free at A anchor; one update', () => {
    const doc = freshDoc();

    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'u')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'u',
    )!;

    const stop = updateCounter(doc);
    deleteObjects(doc, [idA]);
    const count = stop();

    // Exactly 1 update (one transaction for delete + detach)
    expect(count).toBe(1);

    const snap = snapshot(doc);
    // A should be gone
    expect(snap.find((o) => o.id === idA)).toBeUndefined();
    // Connector should still exist
    const conn = snap.find((o) => o.id === connId) as any;
    expect(conn).toBeDefined();
    // 'from' should now be free at A's right anchor (100, 50)
    expect(conn.from.kind).toBe('free');
    expect(conn.from.x).toBe(100);
    expect(conn.from.y).toBe(50);
  });

  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment', () => {
    const segment: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // At 0: point on segment
    expect(distanceToPolyline(segment, { x: 50, y: 0 })).toBeCloseTo(0);
    // At 5.99: 5.99 units above the segment
    expect(distanceToPolyline(segment, { x: 50, y: 5.99 })).toBeCloseTo(5.99);
    // At 6.01
    expect(distanceToPolyline(segment, { x: 50, y: 6.01 })).toBeCloseTo(6.01);
  });

  it('TC-29: setConnectorEndpoint on deleted connector → false (stale id)', () => {
    const doc = freshDoc();

    const c = createConnector(doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 100, y: 0 },
      'u',
    )!;

    deleteObjects(doc, [c]);

    const stop = updateCounter(doc);
    const result = setConnectorEndpoint(doc, c, 'to', { kind: 'free', x: 200, y: 200 });
    expect(result).toBe(false);
    expect(stop()).toBe(0);
  });
});

describe('connector.geometry', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 80 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 60 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 100 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 60 });
  });

  it('connectorBBox returns correct bounding box', () => {
    const bbox = connectorBBox({ x: 10, y: 20 }, { x: 50, y: 80 });
    expect(bbox).toEqual({ x: 10, y: 20, width: 40, height: 60 });

    const bbox2 = connectorBBox({ x: 50, y: 80 }, { x: 10, y: 20 });
    expect(bbox2).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });
});
