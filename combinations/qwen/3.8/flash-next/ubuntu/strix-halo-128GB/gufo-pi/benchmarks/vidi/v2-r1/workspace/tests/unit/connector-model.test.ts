import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

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
import { LOCAL_ORIGIN, deleteObjects } from '../../src/shared/board-model';
import type { ConnectorSnap } from '../../src/shared/objects/connector';
import type { Rect as GeoRect } from '../../src/shared/geometry';

/**
 * Unit tests for connector.model contract (TC-07 to TC-14, TC-29).
 */

function harness(): {
  doc: Y.Doc;
  updates: number;
  origins: unknown[];
} {
  const doc = new Y.Doc();
  let updates = 0;
  const origins: unknown[] = [];
  doc.on('update', (_u: unknown, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  });
  return { doc, get updates() { return updates; }, origins };
}

/** Helper to create a sticky at a given rect for testing */
function addSticky(doc: Y.Doc, id: string, x: number, y: number, w = 100, h = 100): void {
  const objects = doc.getMap('objects');
  const entry = new Y.Map<unknown>();
  entry.set('type', 'sticky');
  entry.set('x', x);
  entry.set('y', y);
  entry.set('width', w);
  entry.set('height', h);
  entry.set('z', 1);
  entry.set('color', 'yellow');
  entry.set('text', new Y.Text());
  entry.set('createdAt', Date.now());
  objects.set(id, entry);
}

describe('connector.model createConnector (TC-07)', () => {
  it('TC-07 attached A→B 300 apart → stored endpoints with fallbacks; 1 update', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);
    addSticky(h.doc, 'B', 300, 0, 100, 100);

    const before = h.updates;
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const id = createConnector(h.doc, from, to, 'user1');

    expect(id).not.toBeNull();
    expect(h.updates).toBe(before + 1);
    expect(h.origins[h.origins.length - 1]).toBe(LOCAL_ORIGIN);

    const objects = h.doc.getMap('objects');
    const entry = objects.get(id!) as Y.Map<unknown>;
    expect(entry.get('type')).toBe('connector');
    const storedFrom = entry.get('from') as any;
    const storedTo = entry.get('to') as any;
    expect(storedFrom.kind).toBe('attached');
    expect(storedFrom.objectId).toBe('A');
    expect(storedTo.kind).toBe('attached');
    expect(storedTo.objectId).toBe('B');
  });
});

describe('connector.model createConnector same object (TC-08)', () => {
  it('TC-08 A→A → null, 0 updates', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);

    const before = h.updates;
    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 50, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 50, y: 50 } };
    const id = createConnector(h.doc, from, to, 'user1');

    expect(id).toBeNull();
    expect(h.updates).toBe(before);
  });
});

describe('connector.model createConnector min length (TC-09)', () => {
  it('TC-09 free→free length 7.9 → null', () => {
    const h = harness();
    const before = h.updates;
    const from: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const id = createConnector(h.doc, from, to, 'user1');
    expect(id).toBeNull();
    expect(h.updates).toBe(before);
  });

  it('TC-09 free→free length 8 → created (boundary)', () => {
    const h = harness();
    const before = h.updates;
    const from: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to: Endpoint = { kind: 'free', x: 8, y: 0 };
    const id = createConnector(h.doc, from, to, 'user1');
    expect(id).not.toBeNull();
    expect(h.updates).toBe(before + 1);
  });
});

describe('connector.model nearestSide (TC-10)', () => {
  // A is at (0, 0) with size 100x100 (centre at 50, 50)
  const rectA: GeoRect = { x: 0, y: 0, width: 100, height: 100 };

  it('TC-10 B at 0° (directly right) → right', () => {
    expect(nearestSide(rectA, { x: 300, y: 50 })).toBe('right');
  });

  it('TC-10 B at 44° (below diagonal) → right', () => {
    // 44° from centre of A (50, 50): dx = cos(44°)*r, dy = -sin(44°)*r (screen coords go down)
    const angle = (44 * Math.PI) / 180;
    const dx = Math.cos(angle) * 200;
    const dy = -Math.sin(angle) * 200;
    const point = { x: 50 + dx, y: 50 + dy };
    expect(nearestSide(rectA, point)).toBe('right');
  });

  it('TC-10 B at 46° (above diagonal) → top', () => {
    const angle = (46 * Math.PI) / 180;
    const dx = Math.cos(angle) * 200;
    const dy = -Math.sin(angle) * 200;
    const point = { x: 50 + dx, y: 50 + dy };
    expect(nearestSide(rectA, point)).toBe('top');
  });

  it('TC-10 B at 90° (directly above) → top', () => {
    expect(nearestSide(rectA, { x: 50, y: -200 })).toBe('top');
  });
});

describe('connector.model resolveEndpoints orphaned (TC-11)', () => {
  it('TC-11 resolveEndpoints with B missing from rects → end at fallback, no throw', () => {
    const conn: ConnectorSnap = {
      id: 'c1',
      type: 'connector',
      x: 0,
      y: 0,
      z: 0,
      from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } },
    };

    const rects = new Map<string, GeoRect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    // B is not in rects (deleted)

    const result = resolveEndpoints(conn, rects);
    // from resolves to A's right side anchor (nearest to B's fallback)
    expect(result.from).toBeDefined();
    expect(result.to).toEqual({ x: 300, y: 50 }); // fallback used
  });
});

describe('connector.model setConnectorEndpoint (TC-12)', () => {
  it('TC-12 setConnectorEndpoint to free → updated', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);
    addSticky(h.doc, 'B', 300, 0, 100, 100);
    const connId = createConnector(h.doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } },
      'user1',
    )!;

    const before = h.updates;
    const result = setConnectorEndpoint(h.doc, connId, 'to', { kind: 'free', x: 500, y: 500 });
    expect(result).toBe(true);
    expect(h.updates).toBe(before + 1);

    const objects = h.doc.getMap('objects');
    const entry = objects.get(connId) as Y.Map<unknown>;
    const storedTo = entry.get('to') as any;
    expect(storedTo.kind).toBe('free');
    expect(storedTo.x).toBe(500);
  });

  it('TC-12 setConnectorEndpoint to attached C → updated', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);
    addSticky(h.doc, 'B', 300, 0, 100, 100);
    addSticky(h.doc, 'C', 500, 500, 100, 100);
    const connId = createConnector(h.doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } },
      'user1',
    )!;

    const before = h.updates;
    const result = setConnectorEndpoint(h.doc, connId, 'to', { kind: 'attached', objectId: 'C', fallback: { x: 500, y: 500 } });
    expect(result).toBe(true);
    expect(h.updates).toBe(before + 1);
  });

  it('TC-12 setConnectorEndpoint to the object at the opposite end → false, 0 updates', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);
    addSticky(h.doc, 'B', 300, 0, 100, 100);
    const connId = createConnector(h.doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } },
      'user1',
    )!;

    const before = h.updates;
    // Attach 'to' to 'A' (which is the object at the from end)
    const result = setConnectorEndpoint(h.doc, connId, 'to', { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } });
    expect(result).toBe(false);
    expect(h.updates).toBe(before);
  });
});

describe('connector.model deleteObjects detaches connectors (TC-13)', () => {
  it('TC-13 deleteObjects([A]) → connector from becomes free at A anchor; 1 update', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);
    addSticky(h.doc, 'B', 300, 0, 100, 100);
    const connId = createConnector(h.doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } },
      'user1',
    )!;

    // Count updates up to now
    const before = h.updates;
    deleteObjects(h.doc, ['A']);

    // Exactly one update (includes the detach and the removal)
    expect(h.updates).toBe(before + 1);

    // A is gone
    const objects = h.doc.getMap('objects');
    expect(objects.get('A')).toBeUndefined();

    // Connector 'from' is now free
    const entry = objects.get(connId) as Y.Map<unknown>;
    const storedFrom = entry.get('from') as any;
    expect(storedFrom.kind).toBe('free');
    // The free point should be at A's right side anchor (nearest to B)
    expect(storedFrom.x).toBe(100);
    expect(storedFrom.y).toBe(50);
  });
});

describe('connector.model distanceToPolyline (TC-14)', () => {
  it('TC-14 distance to point on segment → 0', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 0 })).toBeCloseTo(0);
  });

  it('TC-14 distance 5.99 from segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 })).toBeCloseTo(5.99);
  });

  it('TC-14 distance 6.01 from segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 })).toBeCloseTo(6.01);
  });
});

describe('connector.model stale id (TC-29)', () => {
  it('TC-29 setConnectorEndpoint on deleted connector returns false', () => {
    const h = harness();
    addSticky(h.doc, 'A', 0, 0, 100, 100);
    addSticky(h.doc, 'B', 300, 0, 100, 100);
    const connId = createConnector(h.doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } },
      'user1',
    )!;

    // Delete the connector
    deleteObjects(h.doc, [connId]);

    const before = h.updates;
    const result = setConnectorEndpoint(h.doc, connId, 'from', { kind: 'free', x: 0, y: 0 });
    expect(result).toBe(false);
    expect(h.updates).toBe(before);
  });
});

describe('connector.model geometry helpers', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: GeoRect = { x: 0, y: 0, width: 100, height: 200 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 100 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 200 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 100 });
  });

  it('connectorBBox computes bounding box from two points', () => {
    const bbox = connectorBBox({ x: 10, y: 20 }, { x: 100, y: 200 });
    expect(bbox).toEqual({ x: 10, y: 20, width: 90, height: 180 });
  });
});
