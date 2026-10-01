import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc, moveObjects, snapshot, type ConnectorSnapshot } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox, nearestSide, resolveEndpoints, sideAnchor, type Side,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  const state = { updates: 0 };
  doc.on('update', () => { state.updates += 1; });
  return { doc, state };
}
const box = (doc: Y.Doc, x: number, y: number, w = 100, h = 100) =>
  createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'g') as string;
const conn = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as ConnectorSnapshot;
const attached = (objectId: string) => ({ kind: 'attached' as const, objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number) => ({ kind: 'free' as const, x, y });

describe('connector model', () => {
  it('TC-07 attached ends are stored with their anchors as fallbacks in one update', () => {
    const { doc, state } = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    state.updates = 0;
    const id = createConnector(doc, attached(a), attached(b), 'g') as string;
    expect(state.updates).toBe(1);
    const c = conn(doc, id);
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    expect(c).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
  });

  it('TC-08 a self-connection is not created', () => {
    const { doc, state } = newDoc();
    const a = box(doc, 0, 0);
    state.updates = 0;
    expect(createConnector(doc, attached(a), attached(a), 'g')).toBeNull();
    expect(state.updates).toBe(0);
  });

  it('TC-09 length 7.9 is rejected, 8 is created', () => {
    const { doc } = newDoc();
    expect(createConnector(doc, free(0, 0), free(7.9, 0), 'g')).toBeNull();
    expect(createConnector(doc, free(0, 0), free(8, 0), 'g')).not.toBeNull();
  });

  it('TC-10 nearestSide switches at the diagonal', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const orbit = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return nearestSide(r, { x: 50 + 300 * Math.cos(a), y: 50 - 300 * Math.sin(a) });
    };
    expect([0, 44, 46, 90].map(orbit)).toEqual(['right', 'right', 'top', 'top'] satisfies Side[]);
    expect(orbit(180)).toBe('left');
    expect(orbit(270)).toBe('bottom');
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 100 });
  });

  it('TC-11 a missing target is drawn at its fallback without throwing', () => {
    const rects = new Map<string, Rect>([['a', { x: 0, y: 0, width: 100, height: 100 }]]);
    const ends = resolveEndpoints({
      from: { kind: 'attached', objectId: 'a', fallback: { x: 1, y: 1 } },
      to: { kind: 'attached', objectId: 'gone', fallback: { x: 700, y: 60 } },
    }, rects);
    expect(ends.to).toEqual({ x: 700, y: 60 });
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(connectorBBox(ends.from, ends.to)).toEqual({ x: 100, y: 50, width: 600, height: 10 });
  });

  it('TC-12 setConnectorEndpoint frees, re-attaches and refuses the opposite end object', () => {
    const { doc, state } = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const c = box(doc, 0, 400);
    const id = createConnector(doc, attached(a), attached(b), 'g') as string;
    state.updates = 0;
    expect(setConnectorEndpoint(doc, id, 'to', free(900, 900))).toBe(true);
    expect(conn(doc, id).to).toEqual({ kind: 'free', x: 900, y: 900 });
    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    expect(conn(doc, id).to).toMatchObject({ kind: 'attached', objectId: c });
    expect(state.updates).toBe(2);
    state.updates = 0;
    expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    expect(state.updates).toBe(0);
  });

  it('TC-13 deleting an attached object frees the arrow end at its anchor in one update', () => {
    const { doc, state } = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const id = createConnector(doc, attached(a), attached(b), 'g') as string;
    state.updates = 0;
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(state.updates).toBe(1);
    const c = conn(doc, id);
    expect(c.from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(snapshot(doc).some((o) => o.id === a)).toBe(false);
  });

  it('TC-14 distanceToPolyline is exact', () => {
    const seg = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(seg, { x: 103, y: 4 })).toBeCloseTo(5, 10);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector returns false', () => {
    const { doc, state } = newDoc();
    const a = box(doc, 0, 0);
    const id = createConnector(doc, attached(a), free(500, 50), 'g') as string;
    deleteObjects(doc, [id]);
    state.updates = 0;
    expect(setConnectorEndpoint(doc, id, 'to', free(1, 1))).toBe(false);
    expect(state.updates).toBe(0);
  });

  it('keeps an attached end whose target vanished concurrently, drawn at its fallback', () => {
    const { doc } = newDoc();
    const a = box(doc, 0, 0);
    const id = createConnector(doc, attached(a), { kind: 'attached', objectId: 'gone', fallback: { x: 600, y: 50 } }, 'g') as string;
    expect(conn(doc, id)).toMatchObject({ x: 100, y: 50, width: 500 });
  });

  it('moves an arrow with both ends free, but not one tied to an object', () => {
    const { doc } = newDoc();
    const a = box(doc, 0, 0);
    const f = createConnector(doc, free(0, 300), free(100, 300), 'g') as string;
    const t = createConnector(doc, attached(a), free(500, 50), 'g') as string;
    moveObjects(doc, new Map([[f, { x: 10, y: 320 }], [t, { x: 0, y: 0 }]]));
    expect(conn(doc, f)).toMatchObject({ x: 10, y: 320 });
    expect(conn(doc, t).from.kind).toBe('attached');
  });
});
