import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc, objectSnapshot, registerModelObjectType } from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

registerModelObjectType('shape');
registerModelObjectType('connector');

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const on = () => n++;
  doc.on('update', on);
  try {
    fn();
  } finally {
    doc.off('update', on);
  }
  return n;
}

function raw(doc: Y.Doc, id: string) {
  return doc.getMap<Y.Map<unknown>>('objects').get(id);
}

function addShape(doc: Y.Doc, r: Rect): string {
  return createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'g')!;
}

function connector(doc: Y.Doc, id: string): ConnectorSnap {
  return objectSnapshot(doc).find((o) => o.id === id) as ConnectorSnap;
}

const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

// A (0,0)-(100,100) and B 300 to its right.
const A_RECT = { x: 0, y: 0, width: 100, height: 100 };
const B_RECT = { x: 400, y: 0, width: 100, height: 100 };

describe('connector model (connector.model)', () => {
  it('TC-07 an attached A to B connector stores both ends with fallbacks at the facing sides, in one update', () => {
    const doc = freshDoc();
    const a = addShape(doc, A_RECT);
    const b = addShape(doc, B_RECT);
    let id: string | null = null;
    expect(countUpdates(doc, () => (id = createConnector(doc, attached(a), attached(b), 'g_test')))).toBe(1);
    expect(id).toBeTruthy();
    const map = raw(doc, id!)!;
    expect(map.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: sideAnchor(A_RECT, 'right') });
    expect(map.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: sideAnchor(B_RECT, 'left') });
    expect(map.get('createdBy')).toBe('g_test');
    const c = connector(doc, id!);
    expect(c.ends).toEqual([{ x: 100, y: 50 }, { x: 400, y: 50 }]);
    expect(c).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
    expect(c.z).toBeGreaterThan(2);
  });

  it('TC-08 a connector from an object to itself is not created', () => {
    const doc = freshDoc();
    const a = addShape(doc, A_RECT);
    let id: string | null = 'x';
    expect(countUpdates(doc, () => (id = createConnector(doc, attached(a), attached(a), 'g')))).toBe(0);
    expect(id).toBeNull();
  });

  it('TC-09 a free connector shorter than the minimum is not created; exactly the minimum is', () => {
    const doc = freshDoc();
    let id: string | null = 'x';
    expect(countUpdates(doc, () => (id = createConnector(doc, free(0, 0), free(7.9, 0), 'g')))).toBe(0);
    expect(id).toBeNull();
    id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'g');
    expect(id).toBeTruthy();
    expect(connector(doc, id!).ends).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }]);
  });

  it('TC-10 the nearest side switches exactly at the diagonal as B orbits A', () => {
    const a = { x: -50, y: -50, width: 100, height: 100 };
    const at = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      // Screen y points down, so "up" (top) is negative y.
      return { x: 300 * Math.cos(rad), y: -300 * Math.sin(rad) };
    };
    expect([0, 44, 46, 90].map((d) => nearestSide(a, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect([180, 270].map((d) => nearestSide(a, at(d)))).toEqual(['left', 'bottom']);
    // A wide rect's diagonal is flatter.
    expect(nearestSide({ x: -200, y: -50, width: 400, height: 100 }, { x: 150, y: -60 })).toBe('top');
  });

  it('TC-11 an end whose object is missing resolves to its fallback without throwing', () => {
    const c = {
      from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } } as Endpoint,
      to: { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } } as Endpoint,
    };
    const rects = new Map<string, Rect>([['A', A_RECT]]);
    expect(resolveEndpoints(c, rects)).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(resolveEndpoints(c, new Map())).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(connectorBBox({ x: 400, y: 50 }, { x: 100, y: 0 })).toEqual({ x: 100, y: 0, width: 300, height: 50 });
  });

  it('TC-12 an end can be made free and attached to another object, but not to the object at the other end', () => {
    const doc = freshDoc();
    const a = addShape(doc, A_RECT);
    const b = addShape(doc, B_RECT);
    const c = addShape(doc, { x: 0, y: 400, width: 100, height: 100 });
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    let ok = false;
    expect(countUpdates(doc, () => (ok = setConnectorEndpoint(doc, id, 'to', free(600, 300))))).toBe(1);
    expect(ok).toBe(true);
    expect(raw(doc, id)!.get('to')).toEqual({ kind: 'free', x: 600, y: 300 });
    expect(countUpdates(doc, () => (ok = setConnectorEndpoint(doc, id, 'to', attached(c))))).toBe(1);
    expect(ok).toBe(true);
    expect(raw(doc, id)!.get('to')).toMatchObject({ kind: 'attached', objectId: c });
    expect(connector(doc, id).ends).toEqual([{ x: 50, y: 100 }, { x: 50, y: 400 }]);
    // The object at the other end: rejected, nothing written.
    expect(countUpdates(doc, () => (ok = setConnectorEndpoint(doc, id, 'to', attached(a))))).toBe(0);
    expect(ok).toBe(false);
    expect(countUpdates(doc, () => (ok = setConnectorEndpoint(doc, id, 'from', attached(c))))).toBe(0);
    expect(ok).toBe(false);
    expect(countUpdates(doc, () => (ok = setConnectorEndpoint(doc, id, 'to', free(NaN, 0))))).toBe(0);
    expect(ok).toBe(false);
  });

  it('TC-13 deleting an attached object frees the end where it was drawn, in the same single update', () => {
    const doc = freshDoc();
    const a = addShape(doc, A_RECT);
    const b = addShape(doc, B_RECT);
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    // Move A below B first so the anchor is the current one, not the one at creation.
    doc.transact(() => {
      raw(doc, a)!.set('x', 350);
      raw(doc, a)!.set('y', 300);
    });
    const before = connector(doc, id).ends;
    expect(before[0]).toEqual({ x: 400, y: 300 });
    let n = 0;
    expect(countUpdates(doc, () => (n = deleteObjects(doc, [a])))).toBe(1);
    expect(n).toBe(1);
    expect(raw(doc, a)).toBeUndefined();
    expect(raw(doc, id)!.get('from')).toEqual({ kind: 'free', x: 400, y: 300 });
    expect(raw(doc, id)!.get('to')).toMatchObject({ kind: 'attached', objectId: b });
    expect(connector(doc, id).ends).toEqual(before);
  });

  it('TC-14 distanceToPolyline gives the exact distance around the hit tolerance', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 }) <= CONNECTOR_HIT_TOLERANCE_PX).toBe(true);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 }) <= CONNECTOR_HIT_TOLERANCE_PX).toBe(false);
    // Beyond an end the distance is to the end point.
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBeCloseTo(5, 10);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector returns false', () => {
    const doc = freshDoc();
    const id = createConnector(doc, free(0, 0), free(100, 0), 'g')!;
    deleteObjects(doc, [id]);
    let ok = true;
    expect(countUpdates(doc, () => (ok = setConnectorEndpoint(doc, id, 'to', free(50, 50))))).toBe(0);
    expect(ok).toBe(false);
  });

  it('moving a connector moves its free ends only; attached ends stay on their objects', async () => {
    const { moveObjects } = await import('../../src/shared/board-model');
    const doc = freshDoc();
    const a = addShape(doc, A_RECT);
    const id = createConnector(doc, attached(a), free(400, 50), 'g')!;
    const c = connector(doc, id);
    expect(moveObjects(doc, new Map([[id, { x: c.x + 10, y: c.y + 20 }]]))).toBe(1);
    expect(raw(doc, id)!.get('to')).toEqual({ kind: 'free', x: 410, y: 70 });
    expect(raw(doc, id)!.get('from')).toMatchObject({ kind: 'attached', objectId: a });
  });
});
