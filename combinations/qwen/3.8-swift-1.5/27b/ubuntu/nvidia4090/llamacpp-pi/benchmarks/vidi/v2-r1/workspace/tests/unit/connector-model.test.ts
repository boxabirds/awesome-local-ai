/**
 * Story 10: connector model and geometry unit tests (TC-07 to TC-14, TC-29).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector, setConnectorEndpoint,
  resolveEndpoints, connectorBBox, type Endpoint,
} from '@shared/objects/connector';
import { sideAnchor, nearestSide } from '@shared/geometry/connector-geometry';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { deleteObjects } from '@shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@shared/config';
import type { Point, Rect } from '@shared/geometry';

function makeDoc(): Y.Doc {
  return new Y.Doc();
}

function trackUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const handler = () => count++;
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return count;
  };
}

/** Create a simple rect object in the doc for testing. */
function createTestRect(doc: Y.Doc, x: number, y: number, w: number, h: number): string {
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', w);
  obj.set('height', h);
  obj.set('z', 1);
  obj.set('createdAt', Date.now());
  obj.set('color', 'yellow');
  const text = new Y.Text();
  obj.set('text', text);
  doc.transact(() => {
    doc.getMap('objects').set(id, obj);
  });
  return id;
}

describe('connector.model', () => {
  it('TC-07: attached A→B 300 apart → stored with fallbacks, 1 update', () => {
    const doc = makeDoc();
    const aId = createTestRect(doc, 0, 0, 100, 100);
    const bId = createTestRect(doc, 400, 0, 100, 100);

    const stopTracking = trackUpdates(doc);

    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: bId, fallback: { x: 400, y: 50 } };

    const id = createConnector(doc, from, to, 'user1');

    expect(id).not.toBeNull();
    expect(stopTracking()).toBe(1);

    // Verify stored endpoints
    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    const storedFrom = obj.get('from') as any;
    const storedTo = obj.get('to') as any;
    expect(storedFrom.kind).toBe('attached');
    expect(storedFrom.objectId).toBe(aId);
    expect(storedTo.kind).toBe('attached');
    expect(storedTo.objectId).toBe(bId);
    // Fallbacks should be side anchors
    expect(storedFrom.fallback).toEqual({ x: 100, y: 50 });
    expect(storedTo.fallback).toEqual({ x: 400, y: 50 });
  });

  it('TC-08: A→A → null, 0 updates (self-connection rejected)', () => {
    const doc = makeDoc();
    const aId = createTestRect(doc, 0, 0, 100, 100);

    const stopTracking = trackUpdates(doc);
    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 50, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 50, y: 100 } };

    const id = createConnector(doc, from, to, 'user1');
    expect(id).toBeNull();
    expect(stopTracking()).toBe(0);
  });

  it('TC-09: free→free length 7.9 → null; length 8 → created (boundary)', () => {
    const doc = makeDoc();

    // Length 7.9: too short
    const stopTracking1 = trackUpdates(doc);
    const from1: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to1: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    const id1 = createConnector(doc, from1, to1, 'user1');
    expect(id1).toBeNull();
    expect(stopTracking1()).toBe(0);

    // Length 8: exactly minimum
    const stopTracking2 = trackUpdates(doc);
    const from2: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to2: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };
    const id2 = createConnector(doc, from2, to2, 'user1');
    expect(id2).not.toBeNull();
    expect(stopTracking2()).toBe(1);
  });

  it('TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90°', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const center = { x: 50, y: 50 };

    // 0°: directly right
    const p0: Point = { x: center.x + 200, y: center.y };
    expect(nearestSide(a, p0)).toBe('right');

    // 44°: slightly above the diagonal → still right
    const angle44 = (44 * Math.PI) / 180;
    const p44: Point = {
      x: center.x + 200 * Math.cos(angle44),
      y: center.y - 200 * Math.sin(angle44),
    };
    expect(nearestSide(a, p44)).toBe('right');

    // 46°: slightly past the diagonal → top
    const angle46 = (46 * Math.PI) / 180;
    const p46: Point = {
      x: center.x + 200 * Math.cos(angle46),
      y: center.y - 200 * Math.sin(angle46),
    };
    expect(nearestSide(a, p46)).toBe('top');

    // 90°: directly above
    const p90: Point = { x: center.x, y: center.y - 200 };
    expect(nearestSide(a, p90)).toBe('top');
  });

  it('TC-11: resolveEndpoints with B missing → end at fallback, no throw', () => {
    const from: Endpoint = { kind: 'attached', objectId: 'a', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'b', fallback: { x: 400, y: 50 } };

    const rects = new Map<string, Rect>();
    // Only A is present
    rects.set('a', { x: 0, y: 0, width: 100, height: 100 });
    // B is missing (orphaned)

    const result = resolveEndpoints({ from, to }, rects);
    expect(result.from).toEqual({ x: 100, y: 50 });
    // B is missing → fallback
    expect(result.to).toEqual({ x: 400, y: 50 });
  });

  it('TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite → false', () => {
    const doc = makeDoc();
    const aId = createTestRect(doc, 0, 0, 100, 100);
    const bId = createTestRect(doc, 400, 0, 100, 100);
    const cId = createTestRect(doc, 400, 400, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: bId, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user1')!;

    // Change to free
    const stopTracking1 = trackUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 300 })).toBe(true);
    expect(stopTracking1()).toBe(1);

    // Change to attached C
    const stopTracking2 = trackUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: cId, fallback: { x: 400, y: 400 } })).toBe(true);
    expect(stopTracking2()).toBe(1);

    // Try to attach to the opposite end's object (A)
    const stopTracking3 = trackUpdates(doc);
    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: aId, fallback: { x: 0, y: 50 } })).toBe(false);
    expect(stopTracking3()).toBe(0);
  });

  it('TC-13: deleteObjects([A]) with connector attached to A → A removed, connector from becomes free', () => {
    const doc = makeDoc();
    const aId = createTestRect(doc, 0, 0, 100, 100);
    const bId = createTestRect(doc, 400, 0, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: bId, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user1')!;

    // Delete A
    const stopTracking = trackUpdates(doc);
    const deleted = deleteObjects(doc, [aId]);
    expect(deleted).toBe(1);
    expect(stopTracking()).toBe(1);

    // A is gone
    expect(doc.getMap('objects').get(aId)).toBeUndefined();

    // Connector still exists, from is now free at A's anchor
    const connObj = doc.getMap('objects').get(connId) as Y.Map<unknown> | undefined;
    expect(connObj).toBeDefined();
    const newFrom = connObj!.get('from') as any;
    expect(newFrom.kind).toBe('free');
    expect(newFrom.x).toBe(100);
    expect(newFrom.y).toBe(50);
  });

  it('TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment', () => {
    // Segment from (0,0) to (100,0)
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // Point on the segment
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBe(0);

    // Point 5.99 units away
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 2);

    // Point 6.01 units away
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  it('TC-29: setConnectorEndpoint on deleted connector → false', () => {
    const doc = makeDoc();
    const aId = createTestRect(doc, 0, 0, 100, 100);
    const bId = createTestRect(doc, 400, 0, 100, 100);

    const from: Endpoint = { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: bId, fallback: { x: 400, y: 50 } };
    const connId = createConnector(doc, from, to, 'user1')!;

    // Delete the connector
    deleteObjects(doc, [connId]);

    // Try to set endpoint on deleted connector
    expect(setConnectorEndpoint(doc, connId, 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
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

  it('connectorBBox of two points', () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({
      x: 0, y: 0, width: 100, height: 50,
    });
    expect(connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({
      x: 0, y: 0, width: 100, height: 50,
    });
  });
});
