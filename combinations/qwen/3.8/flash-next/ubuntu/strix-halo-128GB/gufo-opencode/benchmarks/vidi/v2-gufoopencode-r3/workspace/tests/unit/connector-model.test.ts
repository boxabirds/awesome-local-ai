import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createConnector,
  collectConnectorViews,
  setConnectorEndpoint,
  type ConnectorSnap
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function trackUpdates(doc: Y.Doc): { count(): number; stop(): void } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  return {
    count: () => updates,
    stop: () => doc.off('update', listener)
  };
}

function addRect(doc: Y.Doc, rect: Rect): string {
  return createShape(
    doc,
    { kind: 'rect', rect, at: { x: rect.x, y: rect.y } },
    'g_test'
  )!;
}

// A at (0,0,200x100) centre (100,50); B at (300,0,200x100) centre (400,50):
// 300 world units apart; A's right anchor (200,50), B's left anchor (300,50).
function twoShapes(doc: Y.Doc): { a: string; b: string } {
  return { a: addRect(doc, { x: 0, y: 0, width: 200, height: 100 }), b: addRect(doc, { x: 300, y: 0, width: 200, height: 100 }) };
}

describe('connector.model', () => {
  test('TC-07 attached-to-attached stores both ends with side-anchor fallbacks in one update', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const tracker = trackUpdates(doc);

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test'
    );
    expect(id).not.toBeNull();
    tracker.stop();
    expect(tracker.count()).toBe(1);

    const obj = objectsOf(doc).get(id!);
    const from = (obj!.get('from') as Y.Map<unknown>);
    const to = (obj!.get('to') as Y.Map<unknown>);
    expect(from.get('kind')).toBe('attached');
    expect(from.get('objectId')).toBe(a);
    expect(to.get('kind')).toBe('attached');
    expect(to.get('objectId')).toBe(b);
    // Fallbacks are the anchors at attach time (sides facing each other).
    const fallbackFrom = from.get('fallback') as Y.Map<number>;
    const fallbackTo = to.get('fallback') as Y.Map<number>;
    expect(fallbackFrom.get('x')).toBe(200);
    expect(fallbackFrom.get('y')).toBe(50);
    expect(fallbackTo.get('x')).toBe(300);
    expect(fallbackTo.get('y')).toBe(50);
  });

  test('TC-08 connecting an object to itself returns null with no transaction', () => {
    const doc = newDoc();
    const { a } = twoShapes(doc);
    const tracker = trackUpdates(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      'g_test'
    );
    expect(id).toBeNull();
    tracker.stop();
    expect(tracker.count()).toBe(0);
  });

  test('TC-09 free ends are rejected below the minimum length and kept at exactly 8', () => {
    const doc = newDoc();
    const tracker = trackUpdates(doc);
    expect(
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, 'g_test')
    ).toBeNull();
    const id = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: 8, y: 0 },
      'g_test'
    );
    expect(id).not.toBeNull();
    tracker.stop();
    expect(tracker.count()).toBe(1);

    // Invalid endpoint inputs never write.
    expect(
      createConnector(
        doc,
        { kind: 'free', x: Number.NaN, y: 0 },
        { kind: 'free', x: 100, y: 0 },
        'g_test'
      )
    ).toBeNull();
    expect(
      createConnector(
        doc,
        { kind: 'attached', objectId: '', fallback: { x: 0, y: 0 } },
        { kind: 'free', x: 100, y: 0 },
        'g_test'
      )
    ).toBeNull();
  });

  test('TC-10 nearestSide switches at the 45 degree diagonal as B orbits A', () => {
    const a: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const centre = { x: 100, y: 50 };
    const orbit = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      // Screen coordinates: y grows downward, so 90 degrees is above A.
      return { x: centre.x + Math.cos(rad) * 400, y: centre.y - Math.sin(rad) * 400 };
    };
    expect(nearestSide(a, orbit(0))).toBe('right');
    expect(nearestSide(a, orbit(44))).toBe('right');
    expect(nearestSide(a, orbit(46))).toBe('top');
    expect(nearestSide(a, orbit(90))).toBe('top');
    expect(sideAnchor(a, 'right')).toEqual({ x: 200, y: 50 });
    expect(sideAnchor(a, 'top')).toEqual({ x: 100, y: 0 });
  });

  test('TC-11 resolveEndpoints draws a missing target end at its fallback', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test'
    )!;
    // Remove B directly from the doc (a remote delete this client did not
    // make): the end must fall back without throwing.
    doc.transact(() => objectsOf(doc).delete(b));
    const views = collectConnectorViews(doc);
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe(id);
    expect(views[0].resolved.from).toEqual({ x: 200, y: 50 });
    expect(views[0].resolved.to).toEqual({ x: 300, y: 50 });
    expect(views[0].orphaned.from).toBe(false);
    expect(views[0].orphaned.to).toBe(true);

    // Direct call with an empty rects map also renders, never throws.
    const snap: ConnectorSnap = {
      id,
      type: 'connector',
      x: 0,
      y: 0,
      z: 0,
      from: { kind: 'free', x: 10, y: 10 },
      to: { kind: 'attached', objectId: 'gone', fallback: { x: 7, y: 8 } }
    };
    expect(resolveEndpoints(snap, new Map())).toEqual({
      from: { x: 10, y: 10 },
      to: { x: 7, y: 8 }
    });
  });

  test('TC-12 setConnectorEndpoint updates ends but never attaches both to one object', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test'
    )!;

    expect(
      setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 600 })
    ).toBe(true);
    let views = collectConnectorViews(doc);
    expect(views[0].to).toEqual({ kind: 'free', x: 500, y: 600 });
    expect(views[0].resolved.to).toEqual({ x: 500, y: 600 });

    expect(
      setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: b,
        fallback: { x: 300, y: 50 }
      })
    ).toBe(true);

    const tracker = trackUpdates(doc);
    // The start end is attached to A; pointing it at A's opposite-end object
    // B while 'to' is attached to B is rejected.
    expect(
      setConnectorEndpoint(doc, id, 'from', {
        kind: 'attached',
        objectId: b,
        fallback: { x: 0, y: 0 }
      })
    ).toBe(false);
    expect(
      setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 0 })
    ).toBe(false);
    tracker.stop();
    expect(tracker.count()).toBe(0);
  });

  test('TC-13 deleting the target frees the end at its drawn anchor in one update', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test'
    )!;
    const tracker = trackUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    tracker.stop();
    expect(tracker.count()).toBe(1);

    expect(objectsOf(doc).has(a)).toBe(false);
    const views = collectConnectorViews(doc);
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe(id);
    // 'from' was drawn at A's right anchor facing B: it stays there, free.
    expect(views[0].from).toEqual({ kind: 'free', x: 200, y: 50 });
    expect(views[0].resolved.to).toEqual({ x: 300, y: 50 });
    expect(views[0].orphaned).toEqual({ from: false, to: false });
  });

  test('TC-14 distanceToPolyline reports exact distances around the tolerance', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBeCloseTo(0, 6);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 6);
    // Past the end the distance is to the endpoint, not the infinite line.
    expect(distanceToPolyline(line, { x: 110, y: 0 })).toBeCloseTo(10, 6);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
  });

  test('TC-29 setConnectorEndpoint on a deleted connector returns false without a transaction', () => {
    const doc = newDoc();
    const { a, b } = twoShapes(doc);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test'
    )!;
    deleteObjects(doc, [id]);
    const tracker = trackUpdates(doc);
    expect(
      setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 1, y: 1 })
    ).toBe(false);
    tracker.stop();
    expect(tracker.count()).toBe(0);
  });
});
