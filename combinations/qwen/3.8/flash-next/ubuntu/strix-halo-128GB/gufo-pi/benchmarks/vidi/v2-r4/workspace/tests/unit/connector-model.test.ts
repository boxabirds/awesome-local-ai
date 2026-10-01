import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN, deleteObjects } from '../../src/shared/board-model';
import {
  createConnector,
  setConnectorEndpoint,
  readConnector,
} from '../../src/shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Helper to add a rect-shaped object to the doc for testing */
function addObject(doc: Y.Doc, id: string, x: number, y: number, w: number, h: number): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'rect');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', w);
    obj.set('height', h);
    obj.set('z', 1);
    objects.set(id, obj);
  });
}

describe('connector.model — createConnector', () => {
  it('TC-07 attached A→B 300 apart → stored endpoints with fallbacks = side anchors; 1 update', () => {
    const doc = makeDoc();
    // A at (0,0) 100x100, B at (400,0) 100x100 — 300 apart (centre to centre)
    addObject(doc, 'A', 0, 0, 100, 100);
    addObject(doc, 'B', 400, 0, 100, 100);

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
      'user1',
    );
    expect(id).toBeTruthy();
    expect(updateCount).toBe(1);

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const connObj = objects.get(id!);
    expect(connObj).toBeDefined();
    expect(connObj!.get('type')).toBe('connector');

    // Verify it can be read back
    const snap = readConnector(id!, connObj!);
    expect(snap).not.toBeNull();
    expect(snap!.from.kind).toBe('attached');
    expect(snap!.to.kind).toBe('attached');
    if (snap!.from.kind === 'attached') {
      expect(snap!.from.objectId).toBe('A');
    }
    if (snap!.to.kind === 'attached') {
      expect(snap!.to.objectId).toBe('B');
    }
  });

  it('TC-08 A→A → null, 0 updates (negative: self-connection)', () => {
    const doc = makeDoc();
    addObject(doc, 'A', 0, 0, 100, 100);

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 50, y: 50 } },
      { kind: 'attached', objectId: 'A', fallback: { x: 50, y: 50 } },
      'user1',
    );
    expect(id).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('TC-09 free→free length 7.9 → null; 8 → created (boundary)', () => {
    const doc = makeDoc();

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    // 7.9 < CONNECTOR_MIN_LENGTH_WORLD (8) → null
    const r1 = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 7.9, y: 0 },
      'user1',
    );
    expect(r1).toBeNull();

    // exactly 8 → created
    const r2 = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
      'user1',
    );
    expect(r2).toBeTruthy();
    expect(updateCount).toBe(1);
  });
});

describe('connector.model — nearestSide', () => {
  it('TC-10 nearestSide as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50;
    const cy = 50;
    const dist = 200;

    // 0° → to the right (dx=200, dy=0)
    const p0 = { x: cx + dist, y: cy };
    expect(nearestSide(r, p0)).toBe('right');

    // 44° → still right (dy slightly less than dx)
    const rad44 = (44 * Math.PI) / 180;
    const p44 = { x: cx + dist * Math.cos(rad44), y: cy - dist * Math.sin(rad44) };
    expect(nearestSide(r, p44)).toBe('right');

    // 46° → top (dy > dx)
    const rad46 = (46 * Math.PI) / 180;
    const p46 = { x: cx + dist * Math.cos(rad46), y: cy - dist * Math.sin(rad46) };
    expect(nearestSide(r, p46)).toBe('top');

    // 90° → directly above → top
    const p90 = { x: cx, y: cy - dist };
    expect(nearestSide(r, p90)).toBe('top');
  });
});

describe('connector.model — resolveEndpoints', () => {
  it('TC-11 resolveEndpoints with B missing from rects → end at fallback, no throw', () => {
    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    // B is not in rects

    const result = resolveEndpoints(
      {
        from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
        to: { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
      },
      rects,
    );
    expect(result.from).toBeDefined();
    expect(result.to).toEqual({ x: 400, y: 50 });
  });
});

describe('connector.model — setConnectorEndpoint', () => {
  it('TC-12 setConnectorEndpoint to free → updated; to attached C → updated; to opposite object → false, 0 updates', () => {
    const doc = makeDoc();
    addObject(doc, 'A', 0, 0, 100, 100);
    addObject(doc, 'B', 400, 0, 100, 100);
    addObject(doc, 'C', 200, 200, 100, 100);

    const connId = createConnector(
      doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
      'user1',
    );
    expect(connId).toBeTruthy();

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    // Change 'to' end to free
    const ok1 = setConnectorEndpoint(doc, connId!, 'to', { kind: 'free', x: 500, y: 500 });
    expect(ok1).toBe(true);
    expect(updateCount).toBe(1);

    // Change 'to' end to attached C
    const ok2 = setConnectorEndpoint(doc, connId!, 'to', { kind: 'attached', objectId: 'C', fallback: { x: 250, y: 200 } });
    expect(ok2).toBe(true);
    expect(updateCount).toBe(2);

    // Try to change 'to' end to attached A (same as from end) → false
    const fail = setConnectorEndpoint(doc, connId!, 'to', { kind: 'attached', objectId: 'A', fallback: { x: 50, y: 50 } });
    expect(fail).toBe(false);
    expect(updateCount).toBe(2);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector id → false (stale id)', () => {
    const doc = makeDoc();
    addObject(doc, 'A', 0, 0, 100, 100);
    addObject(doc, 'B', 400, 0, 100, 100);

    const connId = createConnector(
      doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
      'user1',
    );
    expect(connId).toBeTruthy();

    // Delete the connector
    deleteObjects(doc, [connId!]);

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const result = setConnectorEndpoint(doc, connId!, 'to', { kind: 'free', x: 100, y: 100 });
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });
});

describe('connector.model — detachConnectorsTo', () => {
  it('TC-13 deleteObjects([A]) with connector attached to A → A removed, connector from becomes free at A anchor, 1 update', () => {
    const doc = makeDoc();
    addObject(doc, 'A', 0, 0, 100, 100);
    addObject(doc, 'B', 400, 0, 100, 100);

    const connId = createConnector(
      doc,
      { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
      'user1',
    );
    expect(connId).toBeTruthy();

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const deleted = deleteObjects(doc, ['A']);
    expect(deleted).toBe(1);
    expect(updateCount).toBe(1); // one LOCAL_ORIGIN transaction

    // Verify connector is still there and its from is now free
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const connObj = objects.get(connId!);
    expect(connObj).toBeDefined();
    const snap = readConnector(connId!, connObj!);
    expect(snap).not.toBeNull();
    expect(snap!.from.kind).toBe('free');
  });
});

describe('connector.model — distanceToPolyline', () => {
  it('TC-14 distance at 0, 5.99, 6.01 units from a segment → exact distances', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // Point exactly on the line → distance 0
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0);

    // 5.99 units away → 5.99
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99);

    // 6.01 units away → 6.01
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01);
  });
});

describe('connector.model — sideAnchor', () => {
  it('returns midpoints of the four sides', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 200 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 120 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 220 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 120 });
  });
});

describe('connector.model — connectorBBox', () => {
  it('returns bounding box of a line', () => {
    const bbox = connectorBBox({ x: 10, y: 50 }, { x: 100, y: 20 });
    expect(bbox).toEqual({ x: 10, y: 20, width: 90, height: 30 });
  });
});
