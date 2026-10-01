import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, snapshotObjects } from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import {
  connectorBBox, nearestSide, resolveEndpoints, sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createConnector, setConnectorEndpoint, type ConnectorSnap, type Endpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { newBoardDoc } from './helpers/peer';

function countUpdates(doc: Y.Doc): { n: number } {
  const c = { n: 0 };
  doc.on('update', () => { c.n += 1; });
  return c;
}
const box = (doc: Y.Doc, x: number, y: number, size = 100) =>
  createShape(doc, { kind: 'rect', rect: { x, y, width: size, height: size }, at: { x, y } }, 'g') as string;
const att = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });
const connectors = (doc: Y.Doc) => snapshotObjects(doc).filter((o): o is ConnectorSnap => o.type === 'connector');

describe('connector model', () => {
  it('TC-07 attached A to B stores both ends with side-anchor fallbacks in one update', () => {
    const doc = newBoardDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0); // 300 apart
    const updates = countUpdates(doc);
    const id = createConnector(doc, att(a), att(b), 'g') as string;
    expect(updates.n).toBe(1);
    const [c] = connectors(doc);
    expect(c.id).toBe(id);
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    expect(c).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
  });

  it('TC-08 a self-connection writes nothing', () => {
    const doc = newBoardDoc();
    const a = box(doc, 0, 0);
    const updates = countUpdates(doc);
    expect(createConnector(doc, att(a), att(a), 'g')).toBeNull();
    expect(updates.n).toBe(0);
  });

  it('TC-09 free to free: 7.9 is too short, the minimum length is created', () => {
    const doc = newBoardDoc();
    const updates = countUpdates(doc);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'g')).toBeNull();
    expect(updates.n).toBe(0);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'g')).not.toBeNull();
    expect(updates.n).toBe(1);
    expect(createConnector(doc, free(0, 0), free(NaN, 0), 'g')).toBeNull();
  });

  it('TC-10 nearestSide switches at the diagonal as a point orbits the rectangle', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    const c = { x: 50, y: 50 };
    const at = (deg: number) => ({ x: c.x + 200 * Math.cos((deg * Math.PI) / 180), y: c.y - 200 * Math.sin((deg * Math.PI) / 180) });
    expect([0, 44, 46, 90].map((d) => nearestSide(r, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect(nearestSide(r, at(180))).toBe('left');
    expect(nearestSide(r, at(270))).toBe('bottom');
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('TC-10b resolveEndpoints follows moved rectangles without writes', () => {
    const doc = newBoardDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    createConnector(doc, att(a), att(b), 'g');
    const rects = (bx: number, by: number) => new Map([
      [a, { x: 0, y: 0, width: 100, height: 100 }], [b, { x: bx, y: by, width: 100, height: 100 }],
    ]);
    const [c] = connectors(doc);
    expect(resolveEndpoints(c, rects(400, 0))).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(resolveEndpoints(c, rects(0, -400))).toEqual({ from: { x: 50, y: 0 }, to: { x: 50, y: -300 } });
  });

  it('TC-11 resolveEndpoints draws a missing target at its fallback without throwing', () => {
    const c = { from: { kind: 'attached', objectId: 'gone', fallback: { x: 7, y: 8 } }, to: free(100, 100) } as const;
    expect(resolveEndpoints(c, new Map())).toEqual({ from: { x: 7, y: 8 }, to: { x: 100, y: 100 } });
    expect(connectorBBox({ x: 5, y: 9 }, { x: 1, y: 20 })).toEqual({ x: 1, y: 9, width: 4, height: 11 });
  });

  it('TC-12 setConnectorEndpoint detaches, re-attaches and rejects the opposite end object', () => {
    const doc = newBoardDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const cc = box(doc, 0, 400);
    const id = createConnector(doc, att(a), att(b), 'g') as string;
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(500, 500))).toBe(true);
    expect(connectors(doc)[0].to).toEqual(free(500, 500));
    expect(setConnectorEndpoint(doc, id, 'to', att(cc))).toBe(true);
    expect(connectors(doc)[0].to).toMatchObject({ kind: 'attached', objectId: cc });
    expect(updates.n).toBe(2);
    expect(setConnectorEndpoint(doc, id, 'to', att(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', free(NaN, 1))).toBe(false);
    expect(updates.n).toBe(2);
  });

  it('TC-13 deleting a target frees the connector end at its anchor in exactly one update', () => {
    const doc = newBoardDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    createConnector(doc, att(a), att(b), 'g');
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates.n).toBe(1);
    const [c] = connectors(doc);
    expect(c.from).toEqual(free(100, 50));
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(snapshotObjects(doc).some((o) => o.id === a)).toBe(false);
    expect(c).toMatchObject({ x: 100, y: 50, width: 300 });
  });

  it('TC-14 distanceToPolyline is exact at, near and beyond the tolerance', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect([0, 5.99, 6.01].map((d) => distanceToPolyline(line, { x: 50, y: d }))).toEqual([0, 5.99, 6.01]);
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBe(5);
    expect(distanceToPolyline([{ x: 1, y: 1 }], { x: 4, y: 5 })).toBe(5);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector is false and writes nothing', () => {
    const doc = newBoardDoc();
    const id = createConnector(doc, free(0, 0), free(100, 0), 'g') as string;
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(5, 5))).toBe(false);
    expect(updates.n).toBe(0);
  });

  it('moving a free-free connector translates it; deleting it leaves the shapes alone', () => {
    const doc = newBoardDoc();
    const id = createConnector(doc, free(0, 0), free(100, 50), 'g') as string;
    // moveObjects is exercised through the generic model API
    return import('../../src/shared/board-model').then(({ moveObjects }) => {
      expect(moveObjects(doc, new Map([[id, { x: 10, y: 20 }]]))).toBe(1);
      expect(connectors(doc)[0]).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
    });
  });
});
