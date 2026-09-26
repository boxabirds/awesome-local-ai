import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import { initDoc, snapshot, deleteObjects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createConnector, setConnectorEndpoint, detachConnectorsTo } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry';
import type { ConnectorSnap } from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

/**
 * Unit tests for the connector model and geometry (TC-07 to TC-14, TC-29).
 */

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` while counting the `update` events it emits on the doc. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => { count += 1; };
  doc.on('update', listener);
  try { fn(); } finally { doc.off('update', listener); }
  return count;
}

describe('connector geometry', () => {
  // TC-10: nearestSide orbit test.
  it('TC-10 nearestSide switches at 45° diagonal for a square rect', () => {
    // A 100x100 rect at origin.
    const r = { x: 0, y: 0, width: 100, height: 100 };
    // Center is at (50, 50).
    // 0°: target directly to the right of center.
    expect(nearestSide(r, { x: 200, y: 50 })).toBe('right');
    // 44°: just under diagonal → right (dx=cos(44°), dy=sin(44°), dx>dy for square)
    const angle44 = 44 * Math.PI / 180;
    const r44 = 100;
    const p44 = { x: 50 + r44 * Math.cos(angle44), y: 50 - r44 * Math.sin(angle44) };
    expect(nearestSide(r, p44)).toBe('right');
    // 46°: just over diagonal → top
    const angle46 = 46 * Math.PI / 180;
    const p46 = { x: 50 + r44 * Math.cos(angle46), y: 50 - r44 * Math.sin(angle46) };
    expect(nearestSide(r, p46)).toBe('top');
    // 90°: directly above → top
    expect(nearestSide(r, { x: 50, y: -50 })).toBe('top');
  });

  // TC-14: distanceToPolyline boundary values.
  it('TC-14 distanceToPolyline at 0, 5.99, 6.01 units from segment', () => {
    // Segment from (0,0) to (10,0).
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    // At (5,0): on the line → distance 0.
    expect(distanceToPolyline(pts, { x: 5, y: 0 })).toBeCloseTo(0);
    // At (5, 5.99): distance ≈ 5.99.
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 2);
    // At (5, 6.01): distance ≈ 6.01.
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 2);
  });

  // connectorBBox
  it('connectorBBox produces correct bbox', () => {
    const bbox = connectorBBox({ x: 10, y: 20 }, { x: 50, y: 80 });
    expect(bbox).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });

  // sideAnchor
  it('sideAnchor returns side midpoints', () => {
    const r = { x: 100, y: 100, width: 200, height: 100 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 300, y: 150 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 200, y: 200 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 100, y: 150 });
  });
});

describe('connector model', () => {
  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks.
  it('TC-07 createConnector A→B 300 apart → 1 update', () => {
    const doc = createDoc();
    // Create two shapes to connect.
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 100, width: 100, height: 100 }, at: { x: 50, y: 150 } }, 'u');
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 100, width: 100, height: 100 }, at: { x: 450, y: 150 } }, 'u');
    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      const id = createConnector(doc,
        { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 150 } },
        { kind: 'attached', objectId: idB!, fallback: { x: 400, y: 150 } },
        'u',
      );
      expect(id).not.toBeNull();
    });
    expect(count).toBe(1);

    const snap = snapshot(doc);
    const conn = snap.find((s) => s.type === 'connector');
    expect(conn).toBeDefined();
    expect((conn as any).from.kind).toBe('attached');
    expect((conn as any).to.kind).toBe('attached');
  });

  // TC-08: self-connection → null, 0 updates.
  it('TC-08 self-connection → null, 0 updates', () => {
    const doc = createDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u');
    expect(idA).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      const result = createConnector(doc,
        { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: idA!, fallback: { x: 0, y: 50 } },
        'u',
      );
      expect(result).toBeNull();
    });
    expect(count).toBe(0);
  });

  // TC-09: free→free length < 8 → null; length = 8 → created.
  it('TC-09 length 7.9 → null', () => {
    const doc = createDoc();
    const count = withUpdateCount(doc, () => {
      const result = createConnector(doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: 7.9, y: 0 },
        'u',
      );
      expect(result).toBeNull();
    });
    expect(count).toBe(0);
  });

  it('TC-09b length exactly 8 → created', () => {
    const doc = createDoc();
    const count = withUpdateCount(doc, () => {
      const result = createConnector(doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: 8, y: 0 },
        'u',
      );
      expect(result).not.toBeNull();
    });
    expect(count).toBe(1);
  });

  // TC-11: resolveEndpoints with missing target → fallback, no throw.
  it('TC-11 resolveEndpoints with missing target → fallback', () => {
    const conn: ConnectorSnap = {
      id: 'conn1',
      type: 'connector',
      x: 0, y: 0, width: 100, height: 0,
      z: 1,
      createdAt: Date.now(),
      createdBy: 'u',
      from: { kind: 'free', x: 0, y: 0 },
      to: { kind: 'attached', objectId: 'gone', fallback: { x: 100, y: 0 } },
    };
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
    const result = resolveEndpoints(conn, rects);
    expect(result.to).toEqual({ x: 100, y: 0 });
    expect(result.from).toEqual({ x: 0, y: 0 });
  });

  // TC-12: setConnectorEndpoint validation.
  it('TC-12 setConnectorEndpoint to free → updated', () => {
    const doc = createDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u');
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 450, y: 50 } }, 'u');
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB!, fallback: { x: 400, y: 50 } },
      'u',
    );
    expect(connId).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      const result = setConnectorEndpoint(doc, connId!, 'to', { kind: 'free', x: 300, y: 200 });
      expect(result).toBe(true);
    });
    expect(count).toBe(1);
  });

  it('TC-12b setConnectorEndpoint to attached C → updated', () => {
    const doc = createDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u');
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 450, y: 50 } }, 'u');
    const idC = createShape(doc, { kind: 'rect', rect: { x: 200, y: 300, width: 100, height: 100 }, at: { x: 250, y: 350 } }, 'u');
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB!, fallback: { x: 400, y: 50 } },
      'u',
    );
    expect(connId).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      const result = setConnectorEndpoint(doc, connId!, 'to', { kind: 'attached', objectId: idC!, fallback: { x: 250, y: 350 } });
      expect(result).toBe(true);
    });
    expect(count).toBe(1);
  });

  it('TC-12c setConnectorEndpoint to opposite end object → false, 0 updates', () => {
    const doc = createDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'u');
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 450, y: 50 } }, 'u');
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB!, fallback: { x: 400, y: 50 } },
      'u',
    );
    expect(connId).not.toBeNull();

    const count = withUpdateCount(doc, () => {
      // Try to set 'to' to idA, which is the 'from' object.
      const result = setConnectorEndpoint(doc, connId!, 'to', { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 50 } });
      expect(result).toBe(false);
    });
    expect(count).toBe(0);
  });

  // TC-13: deleteObjects([A]) with connector → detach.
  it('TC-13 deleteObjects([A]) → connector detached, 1 update', () => {
    const doc = createDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 100, width: 100, height: 100 }, at: { x: 50, y: 150 } }, 'u');
    const idB = createShape(doc, { kind: 'rect', rect: { x: 400, y: 100, width: 100, height: 100 }, at: { x: 450, y: 150 } }, 'u');
    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA!, fallback: { x: 100, y: 150 } },
      { kind: 'attached', objectId: idB!, fallback: { x: 400, y: 150 } },
      'u',
    );
    expect(connId).not.toBeNull();

    // deleteObjects should remove A and detach the connector's 'from' in one update.
    const count = withUpdateCount(doc, () => {
      deleteObjects(doc, [idA!]);
    });
    // One transaction = one update event.
    expect(count).toBe(1);

    const snap = snapshot(doc);
    // A should be gone.
    expect(snap.find((s) => s.id === idA)).toBeUndefined();
    // Connector should remain with 'from' as free.
    const conn = snap.find((s) => s.id === connId);
    expect(conn).toBeDefined();
    expect((conn as any).from.kind).toBe('free');
  });

  // TC-29: setConnectorEndpoint on deleted connector → false.
  it('TC-29 setConnectorEndpoint on deleted id → false', () => {
    const doc = createDoc();
    const result = setConnectorEndpoint(doc, 'nonexistent-id', 'from', { kind: 'free', x: 0, y: 0 });
    expect(result).toBe(false);
  });
});
