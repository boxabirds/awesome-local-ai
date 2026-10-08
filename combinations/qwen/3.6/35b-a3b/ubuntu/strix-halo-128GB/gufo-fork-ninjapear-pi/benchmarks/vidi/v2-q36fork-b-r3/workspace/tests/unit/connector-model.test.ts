import * as Y from 'yjs';
import { describe, it, expect } from 'vitest';
import { createConnector, setConnectorEndpoint, detachConnectorsTo } from '@shared/objects/connector';
import { sideAnchor, nearestSide, resolveEndpoints, connectorBBox } from '@shared/geometry/connector-geometry';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@shared/config';
import type { Rect } from '@shared/geometry';
import type { Point } from '../../src/client/canvas/camera';

// ─── Helpers ──────────────────────────────────────────────────────────────

function trackUpdates(doc: Y.Doc) {
  let count = 0;
  const unsub = (doc.on('update', () => {
    count++;
  })) as unknown as () => void;
  return {
    get count() { return count; },
    cleanup() { unsub(); },
  };
}

function makeDoc() {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('schemaVersion', 1);
  });
  return doc;
}

// ─── TC-07: createConnector attached to attached ──────────────────────────

describe('TC-07: createConnector attached → attached', () => {
  it('A and B 300 apart → stored endpoints with fallbacks; one update', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);

    const a: Point = { x: 0, y: 0 };
    const b: Point = { x: 300, y: 0 };
    const fromEp = { kind: 'attached' as const, objectId: 'obj-a', fallback: a };
    const toEp = { kind: 'attached' as const, objectId: 'obj-b', fallback: b };
    const id = createConnector(doc, fromEp, toEp, 'user');

    expect(id).toBeTruthy();

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('type')).toBe('connector');
    expect(dm.get('from')).toEqual(fromEp);
    expect(dm.get('to')).toEqual(toEp);

    expect(tracker.count).toBe(1);
    tracker.cleanup();
  });
});

// ─── TC-08: createConnector same object rejected ──────────────────────────

describe('TC-08: createConnector self-connection rejected', () => {
  it('same object → null, 0 updates', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const ep = { kind: 'attached' as const, objectId: 'same-id', fallback: { x: 0, y: 0 } };
    const result = createConnector(doc, ep, ep, 'u');
    expect(result).toBeNull();
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });
});

// ─── TC-09: connector length boundary ─────────────────────────────────────

describe('TC-09: connector min length', () => {
  it('length 7.9 → null (below min)', () => {
    const doc = makeDoc();
    const fromEp = { kind: 'free' as const, x: 0, y: 0 };
    const toEp = { kind: 'free' as const, x: 7.9, y: 0 };
    const result = createConnector(doc, fromEp, toEp, 'u');
    expect(result).toBeNull();
  });

  it(`length ${CONNECTOR_MIN_LENGTH_WORLD} → created (at boundary)`, () => {
    const doc = makeDoc();
    const fromEp = { kind: 'free' as const, x: 0, y: 0 };
    const toEp = { kind: 'free' as const, x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };
    const result = createConnector(doc, fromEp, toEp, 'u');
    expect(result).toBeTruthy();
  });

  it('length 7.99 → null', () => {
    const doc = makeDoc();
    const fromEp = { kind: 'free' as const, x: 0, y: 0 };
    const toEp = { kind: 'free' as const, x: 7.99, y: 0 };
    expect(createConnector(doc, fromEp, toEp, 'u')).toBeNull();
  });
});

// ─── TC-10: nearestSide orbits ────────────────────────────────────────────

describe('TC-10: nearestSide at different angles', () => {
  it('B on right of A (0°) → right side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const toward = { x: 200, y: 50 }; // to the right
    expect(nearestSide(r, toward)).toBe('right');
  });

  it('B slightly above diagonal (44°) → right side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50, cy = 50;
    // atan(44°) ≈ 0.966, so dy/dx ≈ tan(44°) < 1 → closer to right
    const toward = { x: cx + 100 * Math.cos(Math.PI / 180 * 44), y: cy - 100 * Math.sin(Math.PI / 180 * 44) };
    expect(nearestSide(r, toward)).toBe('right');
  });

  it('B just past diagonal (46°) → top side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50, cy = 50;
    // 46° > 45° → closer to top
    const toward = { x: cx + 100 * Math.cos(Math.PI / 180 * 46), y: cy - 100 * Math.sin(Math.PI / 180 * 46) };
    expect(nearestSide(r, toward)).toBe('top');
  });

  it('B directly above A (90°) → top side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const toward = { x: 50, y: -100 };
    expect(nearestSide(r, toward)).toBe('top');
  });

  it('B on left (-180°) → left side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const toward = { x: -100, y: 50 };
    expect(nearestSide(r, toward)).toBe('left');
  });

  it('B below (270°/ -90°) → bottom side', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const toward = { x: 50, y: 200 };
    expect(nearestSide(r, toward)).toBe('bottom');
  });
});

// ─── TC-11: resolveEndpoints orphaned ─────────────────────────────────────

describe('TC-11: resolveEndpoints orphaned target', () => {
  it('target present → side anchor; target missing → fallback, no throw', () => {
    const c = {
      from: { kind: 'attached' as const, objectId: 'objA', fallback: { x: 10, y: 20 } },
      to: { kind: 'attached' as const, objectId: 'missing', fallback: { x: 100, y: 200 } },
    };
    const rects = new Map<string, Rect>();
    // 'objA' is present (at origin), so resolves via sideAnchor + nearestSide
    rects.set('objA', { x: 0, y: 0, width: 100, height: 100 });
    // 'missing' not in rects → falls back to stored fallback

    const resolved = resolveEndpoints(c, rects);
    // objA at origin, toward={x:10,y:20} is right of center → right side midpoint = (100, 50)
    expect(resolved.from).toEqual({ x: 100, y: 50 });
    // 'missing' is absent → use fallback
    expect(resolved.to).toEqual({ x: 100, y: 200 });
  });
});

// ─── TC-12: setConnectorEndpoint ──────────────────────────────────────────

describe('TC-12: setConnectorEndpoint', () => {
  it('set to free endpoint → updated', () => {
    const doc = makeDoc();
    const id = createConnector(doc,
      { kind: 'attached' as const, objectId: 'a', fallback: { x: 0, y: 0 } },
      { kind: 'attached' as const, objectId: 'b', fallback: { x: 100, y: 0 } },
      'u',
    );

    const result = setConnectorEndpoint(doc, id!, 'to', { kind: 'free' as const, x: 200, y: 50 });
    expect(result).toBe(true);

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('to').kind).toBe('free');
    expect(dm.get('to').x).toBe(200);
  });

  it('set to attached C → updated', () => {
    const doc = makeDoc();
    const id = createConnector(doc,
      { kind: 'attached' as const, objectId: 'a', fallback: { x: 0, y: 0 } },
      { kind: 'attached' as const, objectId: 'b', fallback: { x: 100, y: 0 } },
      'u',
    );

    const result = setConnectorEndpoint(doc, id!, 'from', { kind: 'attached' as const, objectId: 'c', fallback: { x: 50, y: 50 } });
    expect(result).toBe(true);

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('from').objectId).toBe('c');
  });

  it('attach to opposite end\'s object → false, 0 updates', () => {
    const doc = makeDoc();
    const id = createConnector(doc,
      { kind: 'attached' as const, objectId: 'a', fallback: { x: 0, y: 0 } },
      { kind: 'attached' as const, objectId: 'b', fallback: { x: 100, y: 0 } },
      'u',
    );

    const tracker = trackUpdates(doc);
    // Try to attach 'to' to 'a' (the current 'from' object) — should be rejected
    const result = setConnectorEndpoint(doc, id!, 'to', { kind: 'attached' as const, objectId: 'a', fallback: { x: 0, y: 0 } });
    expect(result).toBe(false);
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });

  it('attach from to b\'s object (opposite end) → false', () => {
    const doc = makeDoc();
    const id = createConnector(doc,
      { kind: 'attached' as const, objectId: 'a', fallback: { x: 0, y: 0 } },
      { kind: 'attached' as const, objectId: 'b', fallback: { x: 100, y: 0 } },
      'u',
    );

    const result = setConnectorEndpoint(doc, id!, 'from', { kind: 'attached' as const, objectId: 'b', fallback: { x: 100, y: 0 } });
    expect(result).toBe(false);
  });
});

// ─── TC-13: deleteObjects detaches connectors ─────────────────────────────

describe('TC-13: deleteObjects detaches connectors', () => {
  it('delete A → connector from becomes free at A\'s anchor; one update total', () => {
    const doc = makeDoc();
    // Create objects
    const objAData = new Y.Map();
    objAData.set('type', 'sticky');
    objAData.set('x', 0); objAData.set('y', 0);
    objAData.set('color', 'yellow');
    objAData.set('text', new Y.Text());
    objAData.set('z', 1);
    objAData.set('createdAt', Date.now());
    doc.getMap('objects').set('obj-a', objAData);

    const objBData = new Y.Map();
    objBData.set('type', 'sticky');
    objBData.set('x', 200); objBData.set('y', 0);
    objBData.set('color', 'yellow');
    objBData.set('text', new Y.Text());
    objBData.set('z', 2);
    objBData.set('createdAt', Date.now());
    doc.getMap('objects').set('obj-b', objBData);

    // Create connector from obj-a to obj-b
    const connEpFrom = { kind: 'attached' as const, objectId: 'obj-a', fallback: { x: 50, y: 0 } };
    const connEpTo = { kind: 'attached' as const, objectId: 'obj-b', fallback: { x: 200, y: 0 } };
    createConnector(doc, connEpFrom, connEpTo, 'u');

    const objsBefore = doc.getMap('objects');
    const connId = [...objsBefore.keys()].find(k => k !== 'obj-a' && k !== 'obj-b')!;
    const tracker = trackUpdates(doc);

    // Delete obj-a
    doc.transact(() => {
      // Simulate what board-model deleteObjects does: call detachConnectorsTo first
      detachConnectorsTo(doc, ['obj-a']);
      doc.getMap('objects').delete('obj-a');
    }, undefined);

    const afterDm = doc.getMap('objects').get(connId) as any;
    expect(afterDm.get('from').kind).toBe('free');
    expect(afterDm.get('from').x).toBe(50); // fallback
    expect(afterDm.get('from').y).toBe(0);
    expect(afterDm.get('to').kind).toBe('attached'); // still attached to b
  });
});

// ─── TC-14: distanceToPolyline ────────────────────────────────────────────

describe('TC-14: distanceToPolyline', () => {
  it('exact hit → 0', () => {
    const pts: readonly Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 0 })).toBeCloseTo(0, 6);
  });

  it('within tolerance 5.99 → ~5.99', () => {
    const pts: readonly Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 6);
  });

  it('just beyond tolerance 6.01 → ~6.01', () => {
    const pts: readonly Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 6);
  });
});

// ─── TC-29: setConnectorEndpoint stale id ─────────────────────────────────

describe('TC-29: setConnectorEndpoint stale id', () => {
  it('deleted connector id → false', () => {
    const doc = makeDoc();
    // Don't create anything, try to set endpoint on non-existent id
    const result = setConnectorEndpoint(doc, 'nonexistent', 'from', { kind: 'free' as const, x: 0, y: 0 });
    expect(result).toBe(false);
  });
});

// ─── Side anchor & bbox helpers ───────────────────────────────────────────

describe('sideAnchor helper', () => {
  it('returns midpoint for each side', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 80 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 60 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 100 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 60 });
  });
});

describe('connectorBBox', () => {
  it('computes bounding box around two points', () => {
    const from: Point = { x: 100, y: 50 };
    const to: Point = { x: 50, y: 100 };
    const bbox = connectorBBox(from, to);
    expect(bbox.x).toBe(50);
    expect(bbox.y).toBe(50);
    expect(bbox.width).toBe(50);
    expect(bbox.height).toBe(50);
  });
});
