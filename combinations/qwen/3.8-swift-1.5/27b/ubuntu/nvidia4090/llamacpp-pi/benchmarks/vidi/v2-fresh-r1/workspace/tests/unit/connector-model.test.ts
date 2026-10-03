// Unit tests for the connector model and geometry (connector.model contract)
// using a real Y.Doc. TC-07 to TC-14, TC-29.

import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../../src/shared/config';
import { initDoc, snapshot, deleteObjects } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
  type ConnectorSnap,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Rect } from '../../src/shared/geometry';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

/** Create two shapes 300 units apart and return their ids and rects. */
function twoShapes(doc: Y.Doc) {
  const idA = createShape(doc, {
    kind: 'rect',
    rect: { x: 0, y: 0, width: 100, height: 100 },
    at: { x: 0, y: 0 },
  }, 'local')!;
  const idB = createShape(doc, {
    kind: 'rect',
    rect: { x: 400, y: 0, width: 100, height: 100 },
    at: { x: 400, y: 0 },
  }, 'local')!;
  return { idA, idB };
}

describe('connector.model', () => {
  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks; 1 update
  test('TC-07 createConnector A→B 300 apart: stored with fallbacks, 1 update', () => {
    const doc = newDoc();
    const { idA, idB } = twoShapes(doc);

    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } };

    const updates = countUpdates(doc, () => {
      const id = createConnector(doc, from, to, 'local');
      expect(id).not.toBeNull();
    });
    expect(updates).toBe(1);

    const snap = snapshot(doc);
    const conn = snap.find((s) => s.type === 'connector');
    expect(conn).toBeDefined();
    expect((conn as any).from.objectId).toBe(idA);
    expect((conn as any).to.objectId).toBe(idB);
  });

  // TC-08: A→A → null, 0 updates
  test('TC-08 createConnector A→A (same object): null, 0 updates', () => {
    const doc = newDoc();
    const { idA } = twoShapes(doc);

    const from: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 50, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: idA, fallback: { x: 50, y: 0 } };

    const updates = countUpdates(doc, () => {
      const id = createConnector(doc, from, to, 'local');
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
  });

  // TC-09: free→free length 7.9 → null; 8 → created (boundary)
  test('TC-09a free→free length 7.9: null', () => {
    const doc = newDoc();
    const from: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to: Endpoint = { kind: 'free', x: 7.9, y: 0 };

    const updates = countUpdates(doc, () => {
      const id = createConnector(doc, from, to, 'local');
      expect(id).toBeNull();
    });
    expect(updates).toBe(0);
  });

  test('TC-09b free→free length 8 (CONNECTOR_MIN_LENGTH_WORLD): created', () => {
    const doc = newDoc();
    const from: Endpoint = { kind: 'free', x: 0, y: 0 };
    const to: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };

    const updates = countUpdates(doc, () => {
      const id = createConnector(doc, from, to, 'local');
      expect(id).not.toBeNull();
    });
    expect(updates).toBe(1);
  });

  // TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90°
  test('TC-10 nearestSide: right, right, top, top (diagonal switch)', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const cx = 50, cy = 50;

    // 0°: directly right → right
    expect(nearestSide(r, { x: cx + 100, y: cy })).toBe('right');
    // 44°: slightly above the diagonal → right (|dx| >= |dy|)
    const d44 = 100 * Math.cos(Math.PI / 4); // ~70.7
    expect(nearestSide(r, { x: cx + d44 * Math.cos(44 * Math.PI / 180) * 1.414, y: cy - d44 * Math.sin(44 * Math.PI / 180) * 1.414 })).toBe('right');
    // 46°: slightly past the diagonal → top
    expect(nearestSide(r, { x: cx + 70, y: cy - 72 })).toBe('top');
    // 90°: directly above → top
    expect(nearestSide(r, { x: cx, y: cy - 100 })).toBe('top');
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw
  test('TC-11 resolveEndpoints with missing target: end at fallback, no throw', () => {
    const c: ConnectorSnap = {
      id: 'test',
      from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } },
    };
    const rects = new Map<string, Rect>();
    rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
    // B is missing

    const result = resolveEndpoints(c, rects);
    // From: A is present, side nearest to B's fallback (400,50) → right side of A
    expect(result.from).toEqual({ x: 100, y: 50 });
    // To: B is missing, use fallback
    expect(result.to).toEqual({ x: 400, y: 50 });
  });

  // TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite → false
  test('TC-12a setConnectorEndpoint to free: updated', () => {
    const doc = newDoc();
    const { idA, idB } = twoShapes(doc);
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'free', x: 500, y: 50 },
      'local',
    )!;

    const updates = countUpdates(doc, () => {
      const ok = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 600, y: 200 });
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);
  });

  test('TC-12b setConnectorEndpoint to attached C: updated', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'local')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'local')!;
    const idC = createShape(doc, { kind: 'rect', rect: { x: 0, y: 400, width: 100, height: 100 }, at: { x: 0, y: 400 } }, 'local')!;
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'local',
    )!;

    const updates = countUpdates(doc, () => {
      const ok = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 50, y: 400 } });
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);
  });

  test('TC-12c setConnectorEndpoint to the object at the opposite end: false, 0 updates', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'local')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'local')!;
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'local',
    )!;

    const updates = countUpdates(doc, () => {
      const ok = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idA, fallback: { x: 50, y: 100 } });
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-13: deleteObjects([A]) with a connector attached to A → connector's from becomes free
  test('TC-13 deleteObjects([A]): connector from becomes free at A\'s anchor, 1 update', () => {
    const doc = newDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'local')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'local')!;
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'local',
    )!;

    const updates = countUpdates(doc, () => {
      const n = deleteObjects(doc, [idA]);
      expect(n).toBe(1);
    });
    expect(updates).toBe(1);

    // A is removed
    const snap = snapshot(doc);
    expect(snap.find((s) => s.id === idA)).toBeUndefined();
    // Connector remains with from now free
    const conn = snap.find((s) => s.id === connId)!;
    expect((conn as any).from.kind).toBe('free');
    expect((conn as any).from.x).toBe(100);
    expect((conn as any).from.y).toBe(50);
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment
  test('TC-14 distanceToPolyline: 0, 5.99, 6.01 units from a segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    // Point on the line
    expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBe(0);
    // 5.99 units away
    expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 2);
    // 6.01 units away
    expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  // TC-29: setConnectorEndpoint on a deleted connector id → false
  test('TC-29 setConnectorEndpoint on deleted connector: false', () => {
    const doc = newDoc();
    const { idA, idB } = twoShapes(doc);
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'local',
    )!;

    // Delete the connector
    deleteObjects(doc, [connId]);

    const ok = setConnectorEndpoint(doc, connId, 'from', { kind: 'free', x: 0, y: 0 });
    expect(ok).toBe(false);
  });

  // Extra: sideAnchor tests
  test('sideAnchor returns correct midpoints', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 45 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 70 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 45 });
  });

  // Extra: connectorBBox
  test('connectorBBox computes correct bounding box', () => {
    const bb = connectorBBox({ x: 10, y: 20 }, { x: 50, y: 80 });
    expect(bb).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });
});
