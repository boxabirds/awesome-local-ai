import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc } from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Side
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createConnector,
  detachConnectorsTo,
  setConnectorEndpoint,
  type Endpoint
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function entry(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

function addRect(doc: Y.Doc, x: number, y: number, width: number, height: number): string {
  return createShape(doc, { kind: 'rect', rect: { x, y, width, height }, at: { x, y } }, 'g_test') as string;
}

describe('connector.geometry', () => {
  test('TC-10 nearestSide switches side at the rect diagonal as B orbits A', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const centre = { x: 50, y: 50 };
    const cases: Array<[number, Side]> = [
      [0, 'right'],
      [44, 'right'],
      [46, 'top'],
      [90, 'top']
    ];
    for (const [deg, expected] of cases) {
      const rad = (deg * Math.PI) / 180;
      const toward = { x: centre.x + Math.cos(rad) * 300, y: centre.y - Math.sin(rad) * 300 };
      expect(nearestSide(a, toward)).toBe(expected);
    }
  });

  test('TC-11 resolveEndpoints keeps the fallback when the target is missing, and anchors the present end', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const rects = new Map<string, Rect>([['a', a]]);
    const conn = {
      from: { kind: 'attached', objectId: 'a', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached', objectId: 'gone', fallback: { x: 300, y: 50 } }
    } as const;
    const resolved = resolveEndpoints(conn, rects);
    expect(resolved).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
  });

  test('sideAnchor returns the side midpoint of the bounding box', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 100 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 });
  });

  test('connectorBBox is the axis-aligned box around two points', () => {
    expect(connectorBBox({ x: 10, y: 40 }, { x: 90, y: 10 })).toEqual({ x: 10, y: 10, width: 80, height: 30 });
  });

  test('TC-14 distanceToPolyline is the exact perpendicular distance to the nearest segment', () => {
    const segment = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(segment, { x: 5, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(segment, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(segment, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 10);
  });
});

describe('connector.model', () => {
  test('TC-07 an attached A→B connector stores endpoints with side-anchor fallbacks in one update', () => {
    const doc = makeDoc();
    const a = addRect(doc, 0, 0, 100, 100);
    const b = addRect(doc, 300, 0, 100, 100);
    const stop = countUpdates(doc);
    const id = createConnector(doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: b }, 'g_test');
    expect(stop()).toBe(1);
    expect(typeof id).toBe('string');
    const created = entry(doc, id as string);
    expect(created.get('type')).toBe('connector');
    expect(created.get('x')).toBe(0);
    expect(created.get('y')).toBe(0);
    expect(created.get('width')).toBe(0);
    expect(created.get('height')).toBe(0);
    expect(created.get('createdBy')).toBe('g_test');
    expect(created.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(created.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
  });

  test('TC-08 attaching both ends to the same object is rejected with no transaction', () => {
    const doc = makeDoc();
    const a = addRect(doc, 0, 0, 100, 100);
    const stop = countUpdates(doc);
    expect(createConnector(doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: a }, 'g_test')).toBeNull();
    expect(stop()).toBe(0);
    expect(doc.getMap('objects').size).toBe(1);
  });

  test('TC-09 a free→free connector shorter than CONNECTOR_MIN_LENGTH_WORLD is rejected, exactly 8 is kept', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    expect(createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, 'g_test')).toBeNull();
    expect(stop()).toBe(0);
    const stop2 = countUpdates(doc);
    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 }, 'g_test');
    expect(id).not.toBeNull();
    expect(stop2()).toBe(1);
  });

  test('TC-12 setConnectorEndpoint moves an end to free or to another object, rejecting the opposite end object', () => {
    const doc = makeDoc();
    const a = addRect(doc, 0, 0, 100, 100);
    const b = addRect(doc, 300, 0, 100, 100);
    const c = addRect(doc, 200, 200, 100, 100);
    const id = createConnector(doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: b }, 'g_test') as string;

    const stop1 = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 10, y: 0 })).toBe(true);
    expect(stop1()).toBe(1);
    expect(entry(doc, id).get('from')).toEqual({ kind: 'free', x: 10, y: 0 });

    const stop2 = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c })).toBe(true);
    expect(stop2()).toBe(1);
    expect(entry(doc, id).get('to')).toEqual({ kind: 'attached', objectId: c, fallback: { x: 250, y: 200 } });

    const stop3 = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: c })).toBe(false);
    expect(stop3()).toBe(0);
    expect(entry(doc, id).get('from')).toEqual({ kind: 'free', x: 10, y: 0 });
  });

  test('TC-13 deleteObjects detaches a connector end to free at its current anchor in one update', () => {
    const doc = makeDoc();
    const a = addRect(doc, 0, 0, 100, 100);
    const b = addRect(doc, 300, 0, 100, 100);
    const id = createConnector(doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: b }, 'g_test') as string;
    const stop = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(stop()).toBe(1);
    const objects = doc.getMap('objects');
    expect(objects.has(a)).toBe(false);
    const conn = objects.get(id) as Y.Map<unknown>;
    const from = conn.get('from') as Endpoint;
    expect(from).toEqual({ kind: 'free', x: 100, y: 50 });
    expect((conn.get('to') as Endpoint).kind).toBe('attached');
  });

  test('TC-29 setConnectorEndpoint on a deleted connector id is rejected with no transaction', () => {
    const doc = makeDoc();
    const a = addRect(doc, 0, 0, 100, 100);
    const b = addRect(doc, 300, 0, 100, 100);
    const id = createConnector(doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: b }, 'g_test') as string;
    deleteObjects(doc, [id]);
    const stop = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(stop()).toBe(0);
  });

  test('detachConnectorsTo frees only the ends pointing at deleted ids', () => {
    const doc = makeDoc();
    const a = addRect(doc, 0, 0, 100, 100);
    const b = addRect(doc, 300, 0, 100, 100);
    const id = createConnector(doc, { kind: 'attached', objectId: a }, { kind: 'attached', objectId: b }, 'g_test') as string;
    doc.transact(() => {
      detachConnectorsTo(doc, [a]);
    });
    const conn = entry(doc, id);
    expect(conn.get('from')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(conn.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
  });
});
