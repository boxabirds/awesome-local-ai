import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import { connectorBBox, nearestSide, resolveEndpoints, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import type { Rect } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createConnector, setConnectorEndpoint, type ConnectorSnap } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

const updates = (doc: Y.Doc) => {
  const fn = vi.fn();
  doc.on('update', fn);
  return fn;
};
const box = (doc: Y.Doc, x: number, y: number, w = 100, h = 100) =>
  createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'g')!;
const att = (objectId: string) => ({ kind: 'attached' as const, objectId, fallback: { x: 0, y: 0 } });
const connOf = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as ConnectorSnap;

describe('connector.model', () => {
  it('TC-07 attached A to B 300 apart: both ends attached, fallbacks are the side anchors, one update', () => {
    const doc = new Y.Doc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const fn = updates(doc);
    const id = createConnector(doc, att(a), att(b), 'g')!;
    expect(fn).toHaveBeenCalledTimes(1);
    const c = connOf(doc, id);
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    expect(c).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
  });

  it('TC-08 a connector from an object to itself is not created', () => {
    const doc = new Y.Doc();
    const a = box(doc, 0, 0);
    const fn = updates(doc);
    expect(createConnector(doc, att(a), att(a), 'g')).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('TC-09 length 7.9 is rejected, 8 is created', () => {
    const doc = new Y.Doc();
    const free = (x: number) => ({ kind: 'free' as const, x, y: 0 });
    expect(createConnector(doc, free(0), free(7.9), 'g')).toBeNull();
    expect(createConnector(doc, free(0), free(8), 'g')).not.toBeNull();
  });

  it('TC-10 nearestSide switches at the diagonal as B orbits A', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const c = { x: 50, y: 50 };
    const at = (deg: number) => ({ x: c.x + 300 * Math.cos((deg * Math.PI) / 180), y: c.y - 300 * Math.sin((deg * Math.PI) / 180) });
    expect([0, 44, 46, 90].map((d) => nearestSide(r, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 100 });
  });

  it('TC-11 resolveEndpoints draws a missing target at its fallback without throwing', () => {
    const rects = new Map<string, Rect>([['a', { x: 0, y: 0, width: 100, height: 100 }]]);
    const ends = resolveEndpoints(
      { from: { kind: 'attached', objectId: 'a', fallback: { x: 1, y: 1 } }, to: { kind: 'attached', objectId: 'gone', fallback: { x: 700, y: 50 } } },
      rects,
    );
    expect(ends.to).toEqual({ x: 700, y: 50 });
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(connectorBBox(ends.from, ends.to)).toEqual({ x: 100, y: 50, width: 600, height: 0 });
  });

  it('TC-12 setConnectorEndpoint: to free, to attached C; never to the object at the opposite end', () => {
    const doc = new Y.Doc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const c = box(doc, 400, 400);
    const id = createConnector(doc, att(a), att(b), 'g')!;
    const fn = updates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 900, y: 10 })).toBe(true);
    expect(connOf(doc, id).to).toEqual({ kind: 'free', x: 900, y: 10 });
    expect(setConnectorEndpoint(doc, id, 'to', att(c))).toBe(true);
    expect(connOf(doc, id).to).toMatchObject({ kind: 'attached', objectId: c });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(setConnectorEndpoint(doc, id, 'to', att(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: NaN, y: 0 })).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('TC-13 deleting an attached object frees the end at its current anchor in exactly one update', () => {
    const doc = new Y.Doc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const id = createConnector(doc, att(a), att(b), 'g')!;
    const fn = updates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    const c = connOf(doc, id);
    expect(c.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(snapshot(doc).some((o) => o.id === a)).toBe(false);
  });

  it('TC-14 distanceToPolyline is exact at 0, 5.99 and 6.01 units', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(line, { x: 110, y: 0 })).toBe(10);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector is false', () => {
    const doc = new Y.Doc();
    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 100, y: 0 }, 'g')!;
    deleteObjects(doc, [id]);
    const fn = updates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 5, y: 5 })).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a connector survives its target vanishing concurrently (rendered at the fallback)', () => {
    const doc = new Y.Doc();
    const a = box(doc, 0, 0);
    const id = createConnector(doc, att(a), { kind: 'attached', objectId: 'vanished', fallback: { x: 500, y: 50 } }, 'g')!;
    expect(connOf(doc, id)).toMatchObject({ x: 100, y: 50, width: 400 });
  });
});
