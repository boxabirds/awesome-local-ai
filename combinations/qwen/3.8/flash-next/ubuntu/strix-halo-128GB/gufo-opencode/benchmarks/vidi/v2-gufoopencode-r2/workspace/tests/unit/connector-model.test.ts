// TC-07 to TC-14, TC-29: the connector model and geometry. Creation rules
// (self / too-short rejection), endpoint fallbacks, nearest-side switching,
// orphaned resolution, handle re-attach, detach-on-delete (one update) and
// polyline hit distance.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, deleteObjects } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';

function countUpdates(doc: Y.Doc, fn: () => unknown): { updates: number; result: unknown } {
  let updates = 0;
  const listener = () => updates++;
  doc.on('update', listener);
  try {
    const result = fn();
    return { updates, result };
  } finally {
    doc.off('update', listener);
  }
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function addShape(doc: Y.Doc, x: number, y: number, w: number, h: number): string {
  const id = createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'g_test');
  if (typeof id !== 'string') throw new Error('shape creation failed');
  return id;
}

function endpoint(doc: Y.Doc, id: string, key: 'from' | 'to'): Endpoint {
  return objectsMap(doc).get(id)!.get(key) as Endpoint;
}

describe('connector model', () => {
  it('TC-07: attached A->B stores both ends with side-anchor fallbacks in one update', () => {
    const doc = freshDoc();
    const a = addShape(doc, 0, 0, 100, 100); // centre 50,50
    const b = addShape(doc, 300, 0, 100, 100); // centre 350,50 (300 apart)

    const seen = countUpdates(doc, () =>
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
        'g_test',
      ),
    );
    expect(seen.updates).toBe(1);
    const id = seen.result as string;
    expect(typeof id).toBe('string');

    const from = endpoint(doc, id, 'from');
    const to = endpoint(doc, id, 'to');
    expect(from.kind).toBe('attached');
    expect(from.kind === 'attached' && from.objectId).toBe(a);
    expect(from.kind === 'attached' && from.fallback).toEqual({ x: 100, y: 50 }); // A right edge
    expect(to.kind).toBe('attached');
    expect(to.kind === 'attached' && to.objectId).toBe(b);
    expect(to.kind === 'attached' && to.fallback).toEqual({ x: 300, y: 50 }); // B left edge
  });

  it('TC-08: a self-connection is rejected with zero updates', () => {
    const doc = freshDoc();
    const a = addShape(doc, 0, 0, 100, 100);
    const seen = countUpdates(doc, () =>
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        'g_test',
      ),
    );
    expect(seen.result).toBeNull();
    expect(seen.updates).toBe(0);
  });

  it('TC-09: a too-short free->free is rejected, exactly the minimum is created', () => {
    const doc = freshDoc();
    const short = countUpdates(doc, () =>
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, 'g_test'),
    );
    expect(short.result).toBeNull();
    expect(short.updates).toBe(0);

    const ok = countUpdates(doc, () =>
      createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 }, 'g_test'),
    );
    expect(typeof ok.result).toBe('string');
    expect(ok.updates).toBe(1);
  });

  it('TC-10: nearestSide switches left/right to top/bottom at the 45-degree diagonal', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 }; // centre 50,50
    const cx = 50;
    const cy = 50;
    const R = 200;
    const toward = (deg: number) => ({ x: cx + R * Math.cos((deg * Math.PI) / 180), y: cy - R * Math.sin((deg * Math.PI) / 180) });
    expect(nearestSide(rect, toward(0))).toBe('right');
    expect(nearestSide(rect, toward(44))).toBe('right');
    expect(nearestSide(rect, toward(46))).toBe('top');
    expect(nearestSide(rect, toward(90))).toBe('top');
  });

  it('TC-11: resolveEndpoints draws a missing target end at its fallback', () => {
    const c = {
      from: { kind: 'attached', objectId: 'A', fallback: { x: 10, y: 10 } } as Endpoint,
      to: { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } } as Endpoint,
    };
    const rects = new Map([['A', { x: 0, y: 0, width: 100, height: 100 }]]);
    const ends = resolveEndpoints(c, rects);
    expect(ends.to).toEqual({ x: 300, y: 50 }); // orphaned: fallback
    expect(ends.from).toEqual({ x: 100, y: 50 }); // A right edge, aimed at fallback
  });

  it('TC-12: re-attach to free/other object works; attaching to the opposite object is rejected', () => {
    const doc = freshDoc();
    const a = addShape(doc, 0, 0, 100, 100);
    const b = addShape(doc, 300, 0, 100, 100);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;

    // attach to the object at the opposite end (from === a) -> rejected.
    const neg = countUpdates(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } }),
    );
    expect(neg.result).toBe(false);
    expect(neg.updates).toBe(0);

    // detach 'to' to a free point -> updated.
    const free = countUpdates(doc, () => setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 500, y: 500 }));
    expect(free.result).toBe(true);
    expect(free.updates).toBe(1);
    expect(endpoint(doc, id, 'to')).toEqual({ kind: 'free', x: 500, y: 500 });

    // re-attach 'to' onto a third object -> updated.
    const c = addShape(doc, 600, 0, 100, 100);
    const re = countUpdates(doc, () =>
      setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } }),
    );
    expect(re.result).toBe(true);
    expect(re.updates).toBe(1);
    const to = endpoint(doc, id, 'to');
    expect(to.kind === 'attached' && to.objectId).toBe(c);
  });

  it('TC-13: deleting an attached object frees its end in exactly one update', () => {
    const doc = freshDoc();
    const a = addShape(doc, 0, 0, 100, 100);
    const b = addShape(doc, 300, 0, 100, 100);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;

    const del = countUpdates(doc, () => deleteObjects(doc, [a]));
    expect(del.result).toBe(1);
    expect(del.updates).toBe(1);
    expect(objectsMap(doc).has(a)).toBe(false);
    const from = endpoint(doc, id, 'from');
    expect(from.kind).toBe('free');
    expect(from.kind === 'free' && from.x).toBe(100); // A right edge where it was
    expect(from.kind === 'free' && from.y).toBe(50);
    expect(endpoint(doc, id, 'to').kind).toBe('attached'); // B survives
  });

  it('TC-14: distanceToPolyline reports exact perpendicular distance to a segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(pts, { x: 5, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(pts, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(pts, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
  });

  it('TC-29: setConnectorEndpoint on a stale id returns false with zero updates', () => {
    const doc = freshDoc();
    const a = addShape(doc, 0, 0, 100, 100);
    const b = addShape(doc, 300, 0, 100, 100);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    deleteObjects(doc, [id]);
    const seen = countUpdates(doc, () => setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 1, y: 1 }));
    expect(seen.result).toBe(false);
    expect(seen.updates).toBe(0);
  });

  it('sideAnchor returns the four side midpoints', () => {
    const r = { x: 0, y: 0, width: 100, height: 60 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 60 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 30 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 30 });
  });
});
