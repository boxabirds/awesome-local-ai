import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { deleteObjects, initDoc, moveObjects, snapshot } from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import { nearestSide, resolveEndpoints, sideAnchor, connectorBBox } from '../../src/shared/geometry/connector-geometry';
import type { Side } from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import type { ConnectorSnap, Endpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function updates(doc: Y.Doc) {
  let n = 0;
  doc.on('update', () => n++);
  return () => n;
}

const box = (doc: Y.Doc, x: number, y: number, size = 100) =>
  createShape(doc, { kind: 'rect', rect: { x, y, width: size, height: size }, at: { x, y } }, 'u') as string;
const att = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });
const connectors = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'connector') as ConnectorSnap[];

describe('connector model', () => {
  it('TC-07 an attached arrow stores both ends with fallbacks at the side anchors, in one update', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const count = updates(doc);
    const id = createConnector(doc, att(a), att(b), 'u') as string;
    expect(count()).toBe(1);
    const [c] = connectors(doc);
    expect(c.id).toBe(id);
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    expect(c.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(c).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
  });

  it('TC-08 an arrow from an object to itself is not created', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const count = updates(doc);
    expect(createConnector(doc, att(a), att(a), 'u')).toBeNull();
    expect(count()).toBe(0);
  });

  it('TC-09 the minimum length is 8 world units', () => {
    const doc = newDoc();
    const count = updates(doc);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'u')).toBeNull();
    expect(count()).toBe(0);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'u')).not.toBeNull();
    expect(count()).toBe(1);
    expect(createConnector(doc, free(0, 0), { kind: 'free', x: NaN, y: 0 }, 'u')).toBeNull();
  });

  it('TC-10 nearestSide switches at the diagonal as another rect orbits (angle counter-clockwise, 0 = right)', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    const orbit = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return nearestSide(r, { x: 50 + 300 * Math.cos(rad), y: 50 - 300 * Math.sin(rad) });
    };
    const got: Side[] = [0, 44, 46, 90].map(orbit);
    expect(got).toEqual(['right', 'right', 'top', 'top']);
    expect(orbit(180)).toBe('left');
    expect(orbit(270)).toBe('bottom');
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('TC-10 follows non-square diagonals', () => {
    const wide = { x: 0, y: 0, width: 400, height: 100 };
    expect(nearestSide(wide, { x: 200 + 300, y: 50 - 60 })).toBe('right');
    expect(nearestSide(wide, { x: 200 + 50, y: 50 - 120 })).toBe('top');
  });

  it('TC-11 a missing target is drawn at its fallback without throwing', () => {
    const c = { from: free(0, 0), to: { kind: 'attached', objectId: 'gone', fallback: { x: 70, y: 80 } } } as const;
    expect(resolveEndpoints(c, new Map())).toEqual({ from: { x: 0, y: 0 }, to: { x: 70, y: 80 } });
    expect(connectorBBox({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 4, height: 7 });
  });

  it('TC-12 an end can be freed, re-attached, but not attached to the opposite end’s object', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const c = box(doc, 0, 400);
    const id = createConnector(doc, att(a), att(b), 'u') as string;
    const count = updates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(700, 20))).toBe(true);
    expect(connectors(doc)[0].to).toEqual(free(700, 20));
    expect(count()).toBe(1);
    expect(setConnectorEndpoint(doc, id, 'to', att(c))).toBe(true);
    expect(connectors(doc)[0].to).toMatchObject({ kind: 'attached', objectId: c });
    expect(count()).toBe(2);
    expect(setConnectorEndpoint(doc, id, 'to', att(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', att(c))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', free(NaN, 0))).toBe(false);
    expect(count()).toBe(2);
  });

  it('TC-13 deleting the target frees the end at its anchor in exactly one update', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    createConnector(doc, att(a), att(b), 'u');
    const count = updates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(count()).toBe(1);
    const [c] = connectors(doc);
    expect(c.from).toEqual(free(100, 50));
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(snapshot(doc).some((o) => o.id === a)).toBe(false);
  });

  it('follows moves of the target with no extra writes, and deleting both objects keeps the arrow', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    createConnector(doc, att(a), att(b), 'u');
    const count = updates(doc);
    moveObjects(doc, new Map([[b, { x: 0, y: 400 }]]));
    expect(count()).toBe(1);
    expect(connectors(doc)[0].ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
    deleteObjects(doc, [a, b]);
    expect(connectors(doc)[0].ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
  });

  it('moving an arrow shifts free ends and leaves attached ends on their objects', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const id = createConnector(doc, att(a), free(400, 50), 'u') as string;
    const before = connectors(doc)[0];
    moveObjects(doc, new Map([[id, { x: before.x + 10, y: before.y + 20 }]]));
    const after = connectors(doc)[0];
    expect(after.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(after.to).toEqual(free(410, 70));
  });

  it('TC-14 distanceToPolyline is exact at, inside and beyond the tolerance', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBe(5);
    expect(distanceToPolyline([{ x: 1, y: 1 }], { x: 4, y: 5 })).toBe(5);
  });

  it('TC-29 setConnectorEndpoint on a deleted arrow is false', () => {
    const doc = newDoc();
    const id = createConnector(doc, free(0, 0), free(100, 0), 'u') as string;
    deleteObjects(doc, [id]);
    const count = updates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(5, 5))).toBe(false);
    expect(count()).toBe(0);
  });

  it('an arrow to an object deleted concurrently is still created and drawn at its fallback', () => {
    const doc = newDoc();
    const a = box(doc, 0, 0);
    const id = createConnector(doc, att(a), { kind: 'attached', objectId: 'gone', fallback: { x: 300, y: 50 } }, 'u');
    expect(id).not.toBeNull();
    expect(connectors(doc)[0].ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
  });
});
