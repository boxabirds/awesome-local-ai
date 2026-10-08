import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { Map as YJSMap } from 'yjs';
import { createConnector, setConnectorEndpoint, detachConnectorsTo } from '../../src/shared/objects/connector';
import { sideAnchor, nearestSide, resolveEndpoints, connectorBBox, distanceToPolyline } from '../../src/shared/geometry/connector-geometry';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { initDoc, deleteObjects } from '../../src/shared/board-model';

// Helper to count updates
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  doc.on('update', () => { updates++; });
  fn();
  return updates;
}

function makeShape(id: string, x: number, y: number, w: number, h: number, z: number): YJSMap {
  const m = new (Y as any).Map() as YJSMap;
  m.set('type', 'shape');
  m.set('kind', 'rect');
  m.set('fill', '#FFFFFF');
  m.set('stroke', '#263238');
  m.set('label', new Y.Text());
  m.set('x', x);
  m.set('y', y);
  m.set('width', w);
  m.set('height', h);
  m.set('z', z);
  m.set('createdBy', 'user1');
  m.set('createdAt', Date.now());
  return m;
}

function getObjMap(doc: Y.Doc): YJSMap {
  return doc.getMap('objects') as unknown as YJSMap;
}

describe('TC-07: createConnector attached→attached', () => {
  it('A and B 300 apart → stored endpoints with fallbacks; 1 update', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const aId = crypto.randomUUID();
    const bId = crypto.randomUUID();
    const objects = getObjMap(doc);

    objects.set(aId, makeShape(aId, 0, 0, 200, 200, 1));
    objects.set(bId, makeShape(bId, 300, 0, 200, 200, 2));

    const fromFallback = sideAnchor({ x: 0, y: 0, width: 200, height: 200 }, 'right');
    const toFallback = sideAnchor({ x: 300, y: 0, width: 200, height: 200 }, 'left');

    let updates = 0;
    doc.on('update', () => { updates++; });

    const id = createConnector(
      doc,
      { kind: 'attached' as const, objectId: aId, fallback: fromFallback },
      { kind: 'attached' as const, objectId: bId, fallback: toFallback },
      'user1',
    );

    expect(id).toBeTruthy();
    expect(updates).toBe(1);

    const connMap = objects.get(id!) as YJSMap;
    expect(connMap.get('type')).toBe('connector');
    expect(connMap.get('from').kind).toBe('attached');
    expect(connMap.get('from').objectId).toBe(aId);
    expect(connMap.get('to').kind).toBe('attached');
    expect(connMap.get('to').objectId).toBe(bId);
  });
});

describe('TC-08: createConnector same object (negative)', () => {
  it('A→A returns null, 0 updates', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ep = { kind: 'attached' as const, objectId: 'same-id', fallback: { x: 0, y: 0 } };
    let updates = 0;
    doc.on('update', () => { updates++; });
    const result = createConnector(doc, ep, ep, 'user1');
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });
});

describe('TC-09: createConnector free→free length boundary', () => {
  it('length 7.9 < CONNECTOR_MIN_LENGTH_WORLD → null', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    doc.on('update', () => { updates++; });
    const result = createConnector(
      doc,
      { kind: 'free' as const, x: 0, y: 0 },
      { kind: 'free' as const, x: 7.9, y: 0 },
      'user1',
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('length 8 === CONNECTOR_MIN_LENGTH_WORLD → created', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    doc.on('update', () => { updates++; });
    const result = createConnector(
      doc,
      { kind: 'free' as const, x: 0, y: 0 },
      { kind: 'free' as const, x: 8, y: 0 },
      'user1',
    );
    expect(result).toBeTruthy();
    expect(updates).toBe(1);
  });
});

describe('TC-10: nearestSide diagonal switch', () => {
  it('as B orbits A at 0°, 44°, 46°, 90° → right, right, top, top', () => {
    const r = { x: -100, y: -100, width: 200, height: 200 };
    expect(nearestSide(r, { x: 200, y: 0 })).toBe('right');
    expect(nearestSide(r, { x: 140, y: -135 })).toBe('right');
    expect(nearestSide(r, { x: 140, y: -145 })).toBe('top');
    expect(nearestSide(r, { x: 0, y: -200 })).toBe('top');
  });
});

describe('TC-11: resolveEndpoints orphaned', () => {
  it('target missing from rects → end at fallback; no throw', () => {
    const c = {
      from: { kind: 'attached' as const, objectId: 'a', fallback: { x: 0, y: 0 } },
      to: { kind: 'attached' as const, objectId: 'missing', fallback: { x: 100, y: 100 } },
    };
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ]);
    const result = resolveEndpoints(c as any, rects);
    expect(result.from).toEqual({ x: 50, y: 50 });
    expect(result.to).toEqual({ x: 100, y: 100 });
  });
});

describe('TC-12: setConnectorEndpoint re-attach', () => {
  it('end to free → updated; to attached C → updated; opposite end\'s object → false', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const connId = createConnector(
      doc,
      { kind: 'free' as const, x: 0, y: 0 },
      { kind: 'free' as const, x: 100, y: 100 },
      'user1',
    );
    expect(connId).toBeTruthy();

    const objects = getObjMap(doc);
    const ok1 = setConnectorEndpoint(doc, connId!, 'from', {
      kind: 'attached' as const,
      objectId: 'obj-a',
      fallback: { x: 10, y: 10 },
    });
    expect(ok1).toBe(true);

    const connMap = objects.get(connId!) as YJSMap;
    expect(connMap.get('from').kind).toBe('attached');
    expect(connMap.get('from').objectId).toBe('obj-a');

    const ok2 = setConnectorEndpoint(doc, connId!, 'to', {
      kind: 'attached' as const,
      objectId: 'obj-c',
      fallback: { x: 50, y: 50 },
    });
    expect(ok2).toBe(true);
    expect(connMap.get('to').objectId).toBe('obj-c');

    const ok3 = setConnectorEndpoint(doc, connId!, 'from', {
      kind: 'attached' as const,
      objectId: 'obj-c',
      fallback: { x: 0, y: 0 },
    });
    expect(ok3).toBe(false);
    expect(connMap.get('from').objectId).toBe('obj-a');
  });
});

describe('TC-13: detachConnectorsTo on delete', () => {
  it('deleteObjects [A] → connector from becomes free; A removed', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const aId = crypto.randomUUID();
    const objects = getObjMap(doc);
    objects.set(aId, makeShape(aId, 0, 0, 100, 100, 1));

    const bId = crypto.randomUUID();
    objects.set(bId, makeShape(bId, 200, 0, 100, 100, 2));

    const connId = createConnector(
      doc,
      { kind: 'attached' as const, objectId: aId, fallback: { x: 100, y: 50 } },
      { kind: 'attached' as const, objectId: bId, fallback: { x: 200, y: 50 } },
      'user1',
    );
    expect(connId).toBeTruthy();

    let updates = 0;
    doc.on('update', () => { updates++; });

    const beforeConn = objects.get(connId!) as YJSMap;
    expect(beforeConn.get('from').kind).toBe('attached');
    expect(beforeConn.get('from').objectId).toBe(aId);

    deleteObjects(doc, [aId]);

    expect(objects.has(aId)).toBe(false);
    const afterConn = objects.get(connId!) as YJSMap;
    expect(afterConn.get('from').kind).toBe('free');
    expect(afterConn.get('from').x).toBe(100);
    expect(afterConn.get('from').y).toBe(50);
    expect(updates).toBe(1);
  });
});

describe('TC-14: distanceToPolyline hit test boundaries', () => {
  it('at 0, 5.99, 6.01 units from segment → exact distances', () => {
    const seg = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBe(5.99);
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 5);
  });
});

describe('TC-29: setConnectorEndpoint stale id', () => {
  it('setConnectorEndpoint on deleted connector id → false', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = setConnectorEndpoint(doc, 'nonexistent-id', 'from', {
      kind: 'free' as const,
      x: 0,
      y: 0,
    });
    expect(result).toBe(false);
  });
});
