import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  getObjectsMap,
  initDoc,
  objectsSnapshot,
} from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createConnector,
  getConnectorEnds,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector';
import { createShape, isShape } from '../../src/shared/objects/shape';
import { checkoutFlow } from '../fixtures/checkout-flow';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const handler = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', handler);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', handler);
  }
}

function shapeAt(doc: Y.Doc, rect: Rect): string {
  return createShape(doc, { kind: 'rect', rect, at: { x: rect.x, y: rect.y } }, 'c_1')!;
}

function connectorSnap(doc: Y.Doc, id: string): ConnectorSnap {
  const found = objectsSnapshot(doc).find((o) => o.id === id);
  if (!found) throw new Error('not found');
  return found as ConnectorSnap;
}

const A_RECT: Rect = { x: 0, y: 0, width: 100, height: 100 };
const B_RECT: Rect = { x: 400, y: 0, width: 100, height: 100 }; // 300 apart
const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

describe('connector.model', () => {
  it('TC-07 attached A→B stores both ends with fallbacks at the facing side anchors, in one update', () => {
    const doc = newDoc();
    const a = shapeAt(doc, A_RECT);
    const b = shapeAt(doc, B_RECT);
    const { result: id, updates, origins } = countUpdates(doc, () => createConnector(doc, attached(a), attached(b), 'c_1'));
    expect(id).toEqual(expect.any(String));
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(getConnectorEnds(doc, id!)).toEqual({
      from: { kind: 'attached', objectId: a, fallback: sideAnchor(A_RECT, 'right') },
      to: { kind: 'attached', objectId: b, fallback: sideAnchor(B_RECT, 'left') },
    });
    const snap = connectorSnap(doc, id!);
    expect(snap.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    // Snapshot geometry is derived from the resolved ends.
    expect(snap).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
    // Stored geometry stays 0.
    expect(getObjectsMap(doc).get(id!)!.get('x')).toBe(0);
  });

  it('TC-08 an arrow from an object to itself is not created', () => {
    const doc = newDoc();
    const a = shapeAt(doc, A_RECT);
    const { result, updates } = countUpdates(doc, () => createConnector(doc, attached(a), attached(a), 'c_1'));
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-09 free→free shorter than the minimum length is rejected; exactly the minimum is created', () => {
    const doc = newDoc();
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);
    const short = countUpdates(doc, () => createConnector(doc, free(0, 0), free(7.9, 0), 'c_1'));
    expect(short).toMatchObject({ result: null, updates: 0 });
    const ok = countUpdates(doc, () => createConnector(doc, free(0, 0), free(0, 8), 'c_1'));
    expect(ok.result).toEqual(expect.any(String));
    expect(ok.updates).toBe(1);
    expect(countUpdates(doc, () => createConnector(doc, free(0, 0), free(Infinity, 0), 'c_1')).result).toBeNull();
  });

  it('TC-10 nearestSide switches at the diagonal as B orbits A (0°, 44°, 46°, 90°)', () => {
    const a: Rect = { x: -50, y: -50, width: 100, height: 100 };
    const at = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return { x: 300 * Math.cos(rad), y: -300 * Math.sin(rad) }; // y grows downward on the board
    };
    expect([0, 44, 46, 90].map((d) => nearestSide(a, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect(nearestSide(a, { x: -300, y: 10 })).toBe('left');
    expect(nearestSide(a, { x: 10, y: 300 })).toBe('bottom');
    // Wide rect: the diagonal follows the rect's proportions.
    expect(nearestSide({ x: 0, y: 0, width: 400, height: 100 }, { x: 350, y: -40 })).toBe('top');
    expect(sideAnchor(a, 'top')).toEqual({ x: 0, y: -50 });
    expect(connectorBBox({ x: 10, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 10, height: 50 });
  });

  it('TC-10 resolveEndpoints follows a moved object and switches sides with no writes', () => {
    const doc = newDoc();
    const a = shapeAt(doc, A_RECT);
    const b = shapeAt(doc, B_RECT);
    const id = createConnector(doc, attached(a), attached(b), 'c_1')!;
    const c = connectorSnap(doc, id);
    const moved = new Map<string, Rect>([
      [a, A_RECT],
      [b, { x: 0, y: 400, width: 100, height: 100 }],
    ]);
    expect(resolveEndpoints(c, moved)).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
  });

  it('TC-11 an end whose object is missing resolves to its fallback without throwing', () => {
    const doc = newDoc();
    const a = shapeAt(doc, A_RECT);
    const b = shapeAt(doc, B_RECT);
    const id = createConnector(doc, attached(a), attached(b), 'c_1')!;
    const c = connectorSnap(doc, id);
    const onlyA = new Map<string, Rect>([[a, A_RECT]]);
    expect(resolveEndpoints(c, onlyA)).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(resolveEndpoints(c, new Map())).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    // Created while the target is already gone (concurrent delete): kept, drawn at the fallback.
    const orphan = createConnector(doc, attached(a), { kind: 'attached', objectId: 'gone', fallback: { x: 900, y: 50 } }, 'c_1');
    expect(orphan).toEqual(expect.any(String));
    expect(connectorSnap(doc, orphan!).ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 900, y: 50 } });
  });

  it('TC-12 setConnectorEndpoint detaches, re-attaches, and refuses the object at the other end', () => {
    const doc = newDoc();
    const a = shapeAt(doc, A_RECT);
    const b = shapeAt(doc, B_RECT);
    const c = shapeAt(doc, { x: 0, y: 400, width: 100, height: 100 });
    const id = createConnector(doc, attached(a), attached(b), 'c_1')!;
    const toFree = countUpdates(doc, () => setConnectorEndpoint(doc, id, 'to', free(600, 300)));
    expect(toFree).toMatchObject({ result: true, updates: 1 });
    expect(getConnectorEnds(doc, id)!.to).toEqual(free(600, 300));
    const toC = countUpdates(doc, () => setConnectorEndpoint(doc, id, 'to', attached(c)));
    expect(toC).toMatchObject({ result: true, updates: 1 });
    expect(getConnectorEnds(doc, id)!.to).toEqual({ kind: 'attached', objectId: c, fallback: { x: 50, y: 400 } });
    const opposite = countUpdates(doc, () => setConnectorEndpoint(doc, id, 'to', attached(a)));
    expect(opposite).toMatchObject({ result: false, updates: 0 });
    expect(countUpdates(doc, () => setConnectorEndpoint(doc, id, 'from', free(NaN, 0)))).toMatchObject({
      result: false,
      updates: 0,
    });
  });

  it('TC-13 deleting an attached object keeps the arrow with that end free at its anchor, in one update', () => {
    const doc = newDoc();
    const a = shapeAt(doc, A_RECT);
    const b = shapeAt(doc, B_RECT);
    const id = createConnector(doc, attached(a), attached(b), 'c_1')!;
    // A moved since the arrow was created: the end is fixed where it is drawn now.
    getObjectsMap(doc).get(a)!.set('y', 20);
    const { result, updates, origins } = countUpdates(doc, () => deleteObjects(doc, [a]));
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(objectsSnapshot(doc).some((o) => o.id === a)).toBe(false);
    expect(getConnectorEnds(doc, id)).toEqual({
      from: free(100, 70),
      to: { kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } },
    });
    // Deleting an id that is already gone is skipped without error.
    expect(countUpdates(doc, () => deleteObjects(doc, [a]))).toMatchObject({ result: 0, updates: 0 });
  });

  it('TC-14 distanceToPolyline gives exact distances around the hit tolerance', () => {
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 12);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 12);
    // Beyond the segment's end the distance is to the end point.
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBeCloseTo(5, 12);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector returns false', () => {
    const doc = newDoc();
    const id = createConnector(doc, free(0, 0), free(100, 0), 'c_1')!;
    deleteObjects(doc, [id]);
    const { result, updates } = countUpdates(doc, () => setConnectorEndpoint(doc, id, 'to', free(50, 50)));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('fixture: the checkout flow has 4 labelled shapes, 3 attached arrows and 1 free-ended arrow', () => {
    const { doc } = checkoutFlow();
    const all = objectsSnapshot(doc);
    const shapes = all.filter(isShape);
    expect(shapes.map((s) => s.kind)).toEqual(['rect', 'diamond', 'ellipse', 'rect']);
    expect(shapes.every((s) => s.label.length > 0)).toBe(true);
    const arrows = all.filter((o): o is ConnectorSnap => o.type === 'connector');
    expect(arrows.filter((a) => a.from.kind === 'attached' && a.to.kind === 'attached')).toHaveLength(3);
    expect(arrows.filter((a) => a.to.kind === 'free')).toHaveLength(1);
  });
});
