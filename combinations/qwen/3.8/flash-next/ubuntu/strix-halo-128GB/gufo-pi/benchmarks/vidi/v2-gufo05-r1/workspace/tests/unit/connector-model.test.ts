/**
 * The connector model and its geometry (`connector.model`): endpoints, side anchors, the
 * nearest side, resolving ends from live rectangles, detaching on delete, and the distance
 * that decides a click on an arrow.
 *
 * A real `Y.Doc` again, and `update` counting, because the two things that matter most —
 * an arrow surviving the delete of what it pointed at as *one* change, and a rejected
 * creation writing *nothing* — are only visible in the update stream.
 *
 * TC-07  attached to attached: both ends stored with their side-anchor fallbacks, one update
 * TC-08  an object to itself creates nothing (negative)
 * TC-09  a drag shorter than the minimum creates nothing; exactly the minimum does (boundary)
 * TC-10  the nearest side switches across the 45° diagonal
 * TC-11  resolving an end whose object has vanished draws at its fallback and never throws
 * TC-12  re-attach an end to free / to another object / refused onto the opposite object
 * TC-13  deleting the object an arrow points at frees that end in exactly one update
 * TC-14  `distanceToPolyline` at 0, 5.99 and 6.01 units from a segment
 * TC-29  re-attaching an arrow that has been deleted returns false
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  deleteObjects,
  initDoc,
  objectSnapshots,
} from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Rect } from '../../src/shared/geometry';
import {
  createConnector,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
} from '../../src/shared/objects/connector';
import { createShape, type ShapeSnapshot } from '../../src/shared/objects/shape';

function countUpdates(doc: Y.Doc, run: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    run();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

/** A shape at a known rectangle, so its side midpoints are known too. */
function box(doc: Y.Doc, x: number, y: number, size = 100): ShapeSnapshot {
  const id = createShape(doc, { kind: 'rect', rect: { x, y, width: size, height: size }, at: { x, y } }, 'alex')!;
  return objectSnapshots(doc).find((o) => o.id === id) as ShapeSnapshot;
}

function theConnector(doc: Y.Doc): ConnectorSnapshot {
  const connector = objectSnapshots(doc).find((o) => o.type === 'connector');
  if (!connector) throw new Error('no connector on the board');
  return connector as ConnectorSnapshot;
}

const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

describe('connector.model create', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-07
  it('TC-07 stores both ends attached, each with the side anchor facing the other', () => {
    const a = box(doc, 0, 0); // centre (50,50), right midpoint (100,50)
    const b = box(doc, 400, 0); // centre (450,50), left midpoint (400,50)

    let id = '';
    const updates = countUpdates(doc, () => {
      id = createConnector(doc, attached(a.id), attached(b.id), 'alex') ?? '';
    });
    expect(id).not.toBe('');
    expect(updates).toBe(1);

    const connector = theConnector(doc);
    expect(connector.from.kind).toBe('attached');
    expect(connector.to.kind).toBe('attached');
    if (connector.from.kind === 'attached') {
      expect(connector.from.objectId).toBe(a.id);
      expect(connector.from.fallback.x).toBeCloseTo(100, 6);
      expect(connector.from.fallback.y).toBeCloseTo(50, 6);
    }
    if (connector.to.kind === 'attached') {
      expect(connector.to.objectId).toBe(b.id);
      expect(connector.to.fallback.x).toBeCloseTo(400, 6);
      expect(connector.to.fallback.y).toBeCloseTo(50, 6);
    }
    // The box the arrow occupies is derived from those two anchors.
    expect(connector.x).toBeCloseTo(100, 6);
    expect(connector.width).toBeCloseTo(300, 6);
    expect(connector.y).toBeCloseTo(50, 6);
    expect(connector.height).toBeCloseTo(0, 6);
  });

  // TC-08
  it('TC-08 an arrow from an object to itself is refused and writes nothing', () => {
    const a = box(doc, 0, 0);
    let updates = 0;
    let result: string | null = 'x';
    updates = countUpdates(doc, () => {
      result = createConnector(doc, attached(a.id), attached(a.id), 'alex');
    });
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(objectSnapshots(doc).some((o) => o.type === 'connector')).toBe(false);
  });

  // TC-09
  it('TC-09 a too-short arrow is refused; exactly the minimum is created', () => {
    let short: string | null = 'x';
    let updatesShort = 0;
    updatesShort = countUpdates(doc, () => {
      short = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'alex');
    });
    expect(short).toBeNull();
    expect(updatesShort).toBe(0);

    const long = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'alex');
    expect(long).not.toBeNull();
  });

  it('a self-connection check runs before the length check', () => {
    // Same object and short: still refused, and the reason does not matter — nothing is
    // written either way.
    const a = box(doc, 0, 0);
    expect(createConnector(doc, attached(a.id), attached(a.id), 'alex')).toBeNull();
  });
});

describe('connector.geometry', () => {
  const square: Rect = { x: 0, y: 0, width: 100, height: 100 };

  // TC-10
  it('TC-10 the nearest side switches across the 45° diagonal', () => {
    const cx = 50;
    const cy = 50;
    const R = 300;
    // Screen y grows downward, so a positive angle points "up" (toward smaller y).
    const toward = (degrees: number) => ({
      x: cx + R * Math.cos((degrees * Math.PI) / 180),
      y: cy - R * Math.sin((degrees * Math.PI) / 180),
    });
    expect(nearestSide(square, toward(0))).toBe('right');
    expect(nearestSide(square, toward(44))).toBe('right');
    expect(nearestSide(square, toward(46))).toBe('top');
    expect(nearestSide(square, toward(90))).toBe('top');
  });

  it('sideAnchor is the midpoint of the named side', () => {
    expect(sideAnchor(square, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(square, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(square, 'bottom')).toEqual({ x: 50, y: 100 });
    expect(sideAnchor(square, 'left')).toEqual({ x: 0, y: 50 });
  });

  // TC-11
  it('TC-11 resolving an end whose object is gone draws at its fallback and does not throw', () => {
    const present: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const fallback = { x: 500, y: 250 };
    const rects = new Map<string, Rect>([['a', present]]);
    const from: Endpoint = { kind: 'attached', objectId: 'a', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'gone', fallback };
    const resolved = resolveEndpoints({ from, to }, rects);
    // The vanished end sits where it was left; the surviving one still faces it.
    expect(resolved.to).toEqual(fallback);
    expect(resolved.from).toEqual({ x: 100, y: 50 });
  });

  it('connectorBBox covers the two points, however they are ordered', () => {
    expect(connectorBBox({ x: 30, y: 40 }, { x: 10, y: 90 })).toEqual({
      x: 10,
      y: 40,
      width: 20,
      height: 50,
    });
  });

  // TC-14
  it('TC-14 distanceToPolyline measures the gap from a segment', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(line, { x: 5, y: 0 })).toBeCloseTo(0, 6);
    expect(distanceToPolyline(line, { x: 5, y: 5.99 })).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(line, { x: 5, y: 6.01 })).toBeCloseTo(6.01, 6);
    // Beyond an end, it measures to that end, not to the infinite line.
    expect(distanceToPolyline(line, { x: 13, y: 4 })).toBeCloseTo(5, 6);
  });
});

describe('connector.model re-attach', () => {
  let doc: Y.Doc;
  let id: string;
  let cId: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    const a = box(doc, 0, 0);
    const b = box(doc, 400, 0);
    const c = box(doc, 0, 400);
    cId = c.id;
    id = createConnector(doc, attached(a.id), attached(b.id), 'alex')!;
  });

  // TC-12
  it('TC-12 an end moves to empty space and to another object, but not onto the object at the far end', () => {
    // from attached a → free.
    expect(setConnectorEndpoint(doc, id, 'from', free(7, 9))).toBe(true);
    let connector = theConnector(doc);
    expect(connector.from).toEqual({ kind: 'free', x: 7, y: 9 });

    // to attached b → attached c: a different object, allowed.
    expect(setConnectorEndpoint(doc, id, 'to', attached(cId))).toBe(true);
    connector = theConnector(doc);
    if (connector.to.kind !== 'attached') throw new Error('expected an attached end');
    expect(connector.to.objectId).toBe(cId);

    // The far end is now attached to c; the near end may not join it.
    let updates = 0;
    let applied = true;
    updates = countUpdates(doc, () => {
      applied = setConnectorEndpoint(doc, id, 'from', attached(cId));
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });

  // TC-29
  it('TC-29 re-attaching an arrow that no longer exists is refused', () => {
    deleteObjects(doc, [id]);
    expect(setConnectorEndpoint(doc, id, 'from', free(0, 0))).toBe(false);
  });
});

describe('connector.model detach on delete', () => {
  // TC-13
  it('TC-13 deleting the object an arrow points at frees that end in exactly one update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = box(doc, 0, 0); // right midpoint (100,50)
    const b = box(doc, 400, 0);
    createConnector(doc, attached(a.id), attached(b.id), 'alex')!;

    let updates = 0;
    updates = countUpdates(doc, () => {
      deleteObjects(doc, [a.id]);
    });

    // One update for the delete and the detach together (`connector.target_deleted`).
    expect(updates).toBe(1);
    expect(objectSnapshots(doc).some((o) => o.id === a.id)).toBe(false);

    const connector = theConnector(doc);
    expect(connector.from.kind).toBe('free');
    if (connector.from.kind === 'free') {
      // Freed at the anchor it was drawn from — A's side facing B.
      expect(connector.from.x).toBeCloseTo(100, 6);
      expect(connector.from.y).toBeCloseTo(50, 6);
    }
    // The other end still follows B.
    expect(connector.to.kind).toBe('attached');
  });
});
