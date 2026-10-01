import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, deleteObjects, objectBounds, objects } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
  type Endpoint,
  type ConnectorSnap,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function withUpdateCount(doc: Y.Doc, fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const handler = () => { updates += 1; };
  doc.on('update', handler);
  let result: unknown;
  try { result = fn(); } finally { doc.off('update', handler); }
  return { result, updates };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Create a shape and return its id. */
function makeShape(doc: Y.Doc, x: number, y: number, w: number, h: number, kind: 'rect' | 'ellipse' | 'diamond' = 'rect'): string {
  const id = createShape(doc, {
    kind,
    rect: { x, y, width: w, height: h },
    at: { x, y },
  }, 'test');
  expect(id).not.toBeNull();
  return id!;
}

/** Get the rect of an object from the doc. */
function getRect(doc: Y.Doc, id: string): Rect {
  const snap = objects(doc).find((o) => o.id === id)!;
  return objectBounds(snap);
}

describe('connector.model (Yjs connector model + geometry)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks; 1 update
  it('TC-07: createConnector A→B 300 apart → attached endpoints with fallbacks, 1 update', () => {
    const a = makeShape(doc, 0, 0, 100, 100);
    const b = makeShape(doc, 400, 0, 100, 100);

    const aRect = getRect(doc, a);
    const bRect = getRect(doc, b);

    // A's right side faces B's left side
    const aAnchor = sideAnchor(aRect, 'right');
    const bAnchor = sideAnchor(bRect, 'left');

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: aAnchor };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: bAnchor };

    const { result, updates } = withUpdateCount(doc, () => createConnector(doc, from, to, 'user1'));
    expect(updates).toBe(1);
    expect(typeof result).toBe('string');

    // Verify stored endpoints
    const m = doc.getMap('objects').get(result as string)! as Y.Map<unknown>;
    const storedFrom = m.get('from') as Record<string, unknown>;
    const storedTo = m.get('to') as Record<string, unknown>;
    expect(storedFrom.kind).toBe('attached');
    expect(storedFrom.objectId).toBe(a);
    expect(storedTo.kind).toBe('attached');
    expect(storedTo.objectId).toBe(b);
  });

  // TC-08: A→A → null, 0 updates
  it('TC-08: createConnector A→A (self) → null, 0 updates', () => {
    const a = makeShape(doc, 0, 0, 100, 100);
    const anchor = { x: 50, y: 0 };
    const from: Endpoint = { kind: 'attached', objectId: a, fallback: anchor };
    const to: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } };
    const { result, updates } = withUpdateCount(doc, () => createConnector(doc, from, to, 'user1'));
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  // TC-09: free→free length 7.9 → null; 8 → created
  it('TC-09: free→free length 7.9 → null; 8 → created (boundary)', () => {
    // 7.9 units (below minimum)
    const fromShort: Endpoint = { kind: 'free', x: 0, y: 0 };
    const toShort: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const { result: r1, updates: u1 } = withUpdateCount(doc, () => createConnector(doc, fromShort, toShort, 'user1'));
    expect(r1).toBeNull();
    expect(u1).toBe(0);

    // Exactly 8 units (minimum)
    const fromOk: Endpoint = { kind: 'free', x: 0, y: 0 };
    const toOk: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };
    const { result: r2, updates: u2 } = withUpdateCount(doc, () => createConnector(doc, fromOk, toOk, 'user1'));
    expect(r2).not.toBeNull();
    expect(u2).toBe(1);
  });

  // TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90°
  it('TC-10: nearestSide switches at the 45° diagonal', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50, cy = 50;

    // 0°: directly right → 'right'
    expect(nearestSide(r, { x: cx + 200, y: cy })).toBe('right');
    // 44°: slightly above the diagonal → 'right'
    const rad44 = (44 * Math.PI) / 180;
    expect(nearestSide(r, { x: cx + 200 * Math.cos(rad44), y: cy - 200 * Math.sin(rad44) })).toBe('right');
    // 46°: slightly past the diagonal → 'top'
    const rad46 = (46 * Math.PI) / 180;
    expect(nearestSide(r, { x: cx + 200 * Math.cos(rad46), y: cy - 200 * Math.sin(rad46) })).toBe('top');
    // 90°: directly above → 'top'
    expect(nearestSide(r, { x: cx, y: cy - 200 })).toBe('top');
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback
  it('TC-11: resolveEndpoints with missing target → fallback, no throw', () => {
    const c: ConnectorSnap = {
      id: 'conn1',
      type: 'connector',
      x: 0, y: 0, z: 1, width: 0, height: 0,
      from: { kind: 'free', x: 10, y: 10 },
      to: { kind: 'attached', objectId: 'missing', fallback: { x: 200, y: 200 } },
    };
    const rects = new Map<string, Rect>();
    const { from, to } = resolveEndpoints(c, rects);
    expect(from).toEqual({ x: 10, y: 10 });
    expect(to).toEqual({ x: 200, y: 200 });
  });

  // TC-12: setConnectorEndpoint to free → updated; to attached → updated; to opposite → false
  it('TC-12: setConnectorEndpoint free/attached/opposite', () => {
    const a = makeShape(doc, 0, 0, 100, 100);
    const b = makeShape(doc, 300, 0, 100, 100);
    const c = makeShape(doc, 300, 300, 100, 100);

    const aRect = getRect(doc, a);
    const bRect = getRect(doc, b);
    const aAnchor = sideAnchor(aRect, 'right');
    const bAnchor = sideAnchor(bRect, 'left');

    const { result: connId } = withUpdateCount(doc, () =>
      createConnector(doc,
        { kind: 'attached', objectId: a, fallback: aAnchor },
        { kind: 'attached', objectId: b, fallback: bAnchor },
        'user1',
      ),
    );
    const id = connId as string;

    // Set to free
    const { result: r1, updates: u1 } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 500 }),
    );
    expect(r1).toBe(true);
    expect(u1).toBe(1);

    // Set to attached C
    const cRect = getRect(doc, c);
    const cAnchor = sideAnchor(cRect, 'top');
    const { result: r2, updates: u2 } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: cAnchor }),
    );
    expect(r2).toBe(true);
    expect(u2).toBe(1);

    // Set to the object at the opposite end (a) → rejected
    const { result: r3, updates: u3 } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: aAnchor }),
    );
    expect(r3).toBe(false);
    expect(u3).toBe(0);
  });

  // TC-13: deleteObjects([A]) with connector attached to A → A removed, connector end free
  it('TC-13: deleteObjects([A]) → connector from becomes free at A anchor, 1 update', () => {
    const a = makeShape(doc, 0, 0, 100, 100);
    const b = makeShape(doc, 300, 0, 100, 100);

    const aRect = getRect(doc, a);
    const bRect = getRect(doc, b);
    const aAnchor = sideAnchor(aRect, 'right');
    const bAnchor = sideAnchor(bRect, 'left');

    const { result: connId } = withUpdateCount(doc, () =>
      createConnector(doc,
        { kind: 'attached', objectId: a, fallback: aAnchor },
        { kind: 'attached', objectId: b, fallback: bAnchor },
        'user1',
      ),
    );
    const id = connId as string;

    // Delete A
    const { updates } = withUpdateCount(doc, () => deleteObjects(doc, [a]));
    expect(updates).toBe(1);

    // A is gone
    expect(doc.getMap('objects').get(a)).toBeUndefined();
    // Connector still exists
    expect(doc.getMap('objects').get(id)).toBeDefined();
    // The from endpoint is now free at A's anchor
    const m = doc.getMap('objects').get(id)! as Y.Map<unknown>;
    const fromEp = m.get('from') as Record<string, unknown>;
    expect(fromEp.kind).toBe('free');
    expect(fromEp.x).toBe(aAnchor.x);
    expect(fromEp.y).toBe(aAnchor.y);
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units
  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment', () => {
    const a: Point = { x: 0, y: 0 };
    const b: Point = { x: 100, y: 0 };

    // On the line
    expect(distanceToPolyline([a, b], { x: 50, y: 0 })).toBe(0);
    // 5.99 units away
    expect(distanceToPolyline([a, b], { x: 50, y: 5.99 })).toBeCloseTo(5.99, 2);
    // 6.01 units away
    expect(distanceToPolyline([a, b], { x: 50, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  // TC-29: setConnectorEndpoint on a deleted connector id → false
  it('TC-29: setConnectorEndpoint on deleted connector → false', () => {
    const a = makeShape(doc, 0, 0, 100, 100);
    const b = makeShape(doc, 300, 0, 100, 100);
    const aRect = getRect(doc, a);
    const bRect = getRect(doc, b);
    const { result: connId } = withUpdateCount(doc, () =>
      createConnector(doc,
        { kind: 'attached', objectId: a, fallback: sideAnchor(aRect, 'right') },
        { kind: 'attached', objectId: b, fallback: sideAnchor(bRect, 'left') },
        'user1',
      ),
    );
    // Delete the connector
    deleteObjects(doc, [connId as string]);
    // Now try to set an endpoint
    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, connId as string, 'to', { kind: 'free', x: 0, y: 0 }),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  // Extra: sideAnchor correctness
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 80 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 60 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 100 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 60 });
  });

  // Extra: connectorBBox
  it('connectorBBox computes correct bounding box', () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  // Extra: nearestSide for all four directions
  it('nearestSide: all four cardinal directions', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(nearestSide(r, { x: 200, y: 50 })).toBe('right');
    expect(nearestSide(r, { x: 50, y: -200 })).toBe('top');
    expect(nearestSide(r, { x: 50, y: 200 })).toBe('bottom');
    expect(nearestSide(r, { x: -200, y: 50 })).toBe('left');
  });
});
