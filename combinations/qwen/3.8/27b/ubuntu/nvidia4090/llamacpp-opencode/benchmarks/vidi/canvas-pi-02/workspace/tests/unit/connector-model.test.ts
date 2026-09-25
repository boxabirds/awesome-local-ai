/**
 * Story 10 connector model and geometry unit tests (TC-07 to TC-14, TC-29).
 *
 * Tests createConnector, setConnectorEndpoint, detachConnectorsTo,
 * sideAnchor, nearestSide, resolveEndpoints, connectorBBox,
 * distanceToPolyline against a real Y.Doc.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObjects } from '../../src/shared/board-model';
import {
  createConnector,
  setConnectorEndpoint,
  type Endpoint,
} from '../../src/shared/objects/connector';
import { createSticky } from '../../src/shared/board-model';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import type { Point } from '../../src/client/canvas/camera';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => { count += 1; });
  return () => count;
}

/** Create a sticky note and return its id (for use as a connector target). */
function makeNote(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x, y });
}

/** Get a sticky note's rect from the doc. */
function noteRect(doc: Y.Doc, id: string): Rect {
  const snap = snapshot(doc).find((o) => o.id === id)!;
  return { x: snap.x, y: snap.y, width: snap.width ?? 200, height: snap.height ?? 200 };
}

/** Get a connector's from/to from the doc's raw map. */
function connectorEndpoints(doc: Y.Doc, id: string): { from: Endpoint; to: Endpoint } {
  const obj = doc.getMap('objects').get(id) as Y.Map<any>;
  const from = obj.get('from');
  const to = obj.get('to');
  return {
    from: from as Endpoint,
    to: to as Endpoint,
  };
}

describe('connector.model: createConnector', () => {
  it('TC-07 attached A→B 300 apart → stored endpoints with fallbacks = side anchors; 1 update', () => {
    const doc = freshDoc();

    // Create two notes 300 apart.
    const a = makeNote(doc, 0, 0);     // centre (0,0), rect (-100,-100,200,200)
    const b = makeNote(doc, 400, 0);   // centre (400,0), rect (300,-100,200,200)

    const updates = countUpdates(doc);

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 300, y: 0 } };

    const id = createConnector(doc, from, to);
    expect(id).not.toBeNull();
    expect(updates()).toBe(1);

    // Verify stored endpoints.
    const { from: storedFrom, to: storedTo } = connectorEndpoints(doc, id!);
    expect(storedFrom.kind).toBe('attached');
    expect((storedFrom as any).objectId).toBe(a);
    expect(storedTo.kind).toBe('attached');
    expect((storedTo as any).objectId).toBe(b);

    // Fallbacks should be the side anchors.
    // A's right side midpoint: (100, 0)
    // B's left side midpoint: (300, 0)
    expect((storedFrom as any).fallback).toEqual({ x: 100, y: 0 });
    expect((storedTo as any).fallback).toEqual({ x: 300, y: 0 });
  });

  it('TC-08 A→A → null, 0 updates (self-connection rejected)', () => {
    const doc = freshDoc();
    const a = makeNote(doc, 0, 0);
    const updates = countUpdates(doc);

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: a, fallback: { x: -100, y: 0 } };

    expect(createConnector(doc, from, to)).toBeNull();
    expect(updates()).toBe(0);
  });

  it('TC-09 free→free length 7.9 → null; 8 → created (boundary)', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    // Length 7.9: below CONNECTOR_MIN_LENGTH_WORLD (8)
    const shortFrom: Endpoint = { kind: 'free', x: 0, y: 0 };
    const shortTo: Endpoint = { kind: 'free', x: 7.9, y: 0 };
    expect(createConnector(doc, shortFrom, shortTo)).toBeNull();
    expect(updates()).toBe(0);

    // Length exactly 8: boundary
    const okFrom: Endpoint = { kind: 'free', x: 0, y: 0 };
    const okTo: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };
    expect(createConnector(doc, okFrom, okTo)).not.toBeNull();
    expect(updates()).toBe(1);
  });
});

describe('connector.model: nearestSide', () => {
  const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };

  it('TC-10 B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    // At 0°: directly right
    expect(nearestSide(rect, { x: 200, y: 50 })).toBe('right');

    // At 44°: slightly above the 45° diagonal
    const angle44 = 44 * Math.PI / 180;
    expect(nearestSide(rect, { x: 50 + 100 * Math.cos(angle44), y: 50 - 100 * Math.sin(angle44) })).toBe('right');

    // At 46°: slightly past the diagonal
    const angle46 = 46 * Math.PI / 180;
    expect(nearestSide(rect, { x: 50 + 100 * Math.cos(angle46), y: 50 - 100 * Math.sin(angle46) })).toBe('top');

    // At 90°: directly above
    expect(nearestSide(rect, { x: 50, y: -200 })).toBe('top');
  });
});

describe('connector.model: resolveEndpoints', () => {
  it('TC-11 B missing from rects → end at fallback, no throw', () => {
    const from: Endpoint = { kind: 'attached', objectId: 'a', fallback: { x: 100, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: 'b', fallback: { x: 300, y: 0 } };

    // Only A is in the rects map; B is missing (concurrent delete).
    const rects = new Map<string, Rect>([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ]);

    const resolved = resolveEndpoints({ from, to }, rects);
    // B is missing → to should be at fallback
    expect(resolved.to).toEqual({ x: 300, y: 0 });
    // A is present → from should be at the side anchor facing B's fallback
    // A's centre is (50, 50), B's fallback is (300, 0). Direction is right-ish.
    // nearestSide of A toward (300, 0): right side midpoint = (100, 50)
    expect(resolved.from).toEqual({ x: 100, y: 50 });
  });
});

describe('connector.model: setConnectorEndpoint', () => {
  it('TC-12 to free → updated; to attached C → updated; to opposite end object → false', () => {
    const doc = freshDoc();
    const a = makeNote(doc, 0, 0);
    const b = makeNote(doc, 400, 0);
    const c = makeNote(doc, 800, 0);

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 300, y: 0 } };
    const id = createConnector(doc, from, to)!;

    const updates = countUpdates(doc);

    // Set to a free point
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 200 })).toBe(true);
    expect(updates()).toBe(1);

    // Set to attached C
    expect(setConnectorEndpoint(doc, id, 'to', {
      kind: 'attached', objectId: c, fallback: { x: 700, y: 0 },
    })).toBe(true);
    expect(updates()).toBe(2);

    // Try to attach to the object at the other end (A) → rejected
    expect(setConnectorEndpoint(doc, id, 'to', {
      kind: 'attached', objectId: a, fallback: { x: -100, y: 0 },
    })).toBe(false);
    expect(updates()).toBe(2); // no additional update
  });

  it('TC-29 setConnectorEndpoint on a deleted connector id → false', () => {
    const doc = freshDoc();
    const a = makeNote(doc, 0, 0);
    const b = makeNote(doc, 400, 0);
    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 300, y: 0 } };
    const id = createConnector(doc, from, to)!;

    // Delete the connector.
    deleteObjects(doc, [id]);

    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);
  });
});

describe('connector.model: detachConnectorsTo (via deleteObjects)', () => {
  it('TC-13 deleteObjects([A]) with connector attached to A → A removed, connector from becomes free at A anchor; exactly 1 update', () => {
    const doc = freshDoc();
    const a = makeNote(doc, 0, 0);
    const b = makeNote(doc, 400, 0);

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 300, y: 0 } };
    const connId = createConnector(doc, from, to)!;

    const updates = countUpdates(doc);
    deleteObjects(doc, [a]);
    expect(updates()).toBe(1);

    // A is gone.
    expect(snapshot(doc).find((o) => o.id === a)).toBeUndefined();

    // Connector still exists.
    const conn = snapshot(doc).find((o) => o.id === connId);
    expect(conn).toBeDefined();

    // The connector's from end is now free at A's right side midpoint (100, 0).
    const { from: newFrom } = connectorEndpoints(doc, connId);
    expect(newFrom.kind).toBe('free');
    expect(newFrom).toMatchObject({ x: 100, y: 0 });
  });
});

describe('connector.model: distanceToPolyline', () => {
  it('TC-14 at 0, 5.99, 6.01 units from a segment → exact distances', () => {
    const a: Point = { x: 0, y: 0 };
    const b: Point = { x: 100, y: 0 };
    const pts = [a, b];

    // On the segment
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0, 10);

    // 5.99 units above the segment
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);

    // 6.01 units above the segment
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });
});

describe('connector.model: sideAnchor and connectorBBox', () => {
  it('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 80 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 60 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 100 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 60 });
  });

  it('connectorBBox spans both endpoints', () => {
    expect(connectorBBox({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({
      x: 0, y: 0, width: 100, height: 50,
    });
  });
});
