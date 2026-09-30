import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  initDoc,
  moveObjects,
  objectsMap,
  objectsSnapshot,
  resizeObjects,
  translateObjects,
} from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import {
  type ConnectorSnap,
  createConnector,
  isConnector,
  scaleConnector,
  setConnectorEndpoint,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import type { Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('update', () => counter.count++);
  return counter;
}

function box(doc: Y.Doc, r: Rect): string {
  return createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'g')!;
}

function arrow(doc: Y.Doc, id: string): ConnectorSnap {
  const c = objectsSnapshot(doc).find((o) => o.id === id);
  if (!c || !isConnector(c)) throw new Error('no connector');
  return c;
}

const attached = (objectId: string) => ({ kind: 'attached' as const, objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number) => ({ kind: 'free' as const, x, y });

/** A (0,0 100x100) and B 300 units to the right of it. */
function twoBoxes() {
  const doc = newDoc();
  const a = box(doc, { x: 0, y: 0, width: 100, height: 100 });
  const b = box(doc, { x: 400, y: 0, width: 100, height: 100 });
  return { doc, a, b };
}

describe('connector.model', () => {
  it('TC-07 attached A → B stores both ends with fallbacks at the facing side anchors, in one update', () => {
    const { doc, a, b } = twoBoxes();
    const updates = countUpdates(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_dana');
    expect(id).toEqual(expect.any(String));
    expect(updates.count).toBe(1);
    const m = objectsMap(doc).get(id!)!;
    expect(m.get('type')).toBe('connector');
    expect(m.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(m.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    expect(m.get('createdBy')).toBe('g_dana');
    const c = arrow(doc, id!);
    expect(c.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(c).toMatchObject({ x: 100, y: 50, width: 300, height: 0 });
    expect(c.z).toBeGreaterThan(Math.max(...objectsSnapshot(doc).filter((o) => o.id !== id).map((o) => o.z)));
  });

  it('TC-08 A → A is not created', () => {
    const { doc, a } = twoBoxes();
    const updates = countUpdates(doc);
    expect(createConnector(doc, attached(a), attached(a), 'g')).toBeNull();
    expect(updates.count).toBe(0);
  });

  it('TC-09 free → free shorter than the minimum is not created; exactly the minimum is', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'g')).toBeNull();
    expect(updates.count).toBe(0);
    const id = createConnector(doc, free(0, 0), free(0, CONNECTOR_MIN_LENGTH_WORLD), 'g');
    expect(id).toEqual(expect.any(String));
    expect(updates.count).toBe(1);
    expect(arrow(doc, id!).ends).toEqual({ from: { x: 0, y: 0 }, to: { x: 0, y: CONNECTOR_MIN_LENGTH_WORLD } });
  });

  it('TC-10 nearestSide switches at the diagonal as B orbits A (0°, 44°, 46°, 90°)', () => {
    const a: Rect = { x: -50, y: -50, width: 100, height: 100 };
    const at = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      // Board y grows downwards; angles are counter-clockwise on screen.
      return { x: 300 * Math.cos(rad), y: -300 * Math.sin(rad) };
    };
    expect([0, 44, 46, 90].map((d) => nearestSide(a, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect(nearestSide(a, at(180))).toBe('left');
    expect(nearestSide(a, at(270))).toBe('bottom');
    expect(sideAnchor(a, 'top')).toEqual({ x: 0, y: -50 });
    expect(sideAnchor(a, 'left')).toEqual({ x: -50, y: 0 });
  });

  it('attached ends follow a moved object and switch sides (no writes)', () => {
    const { doc, a, b } = twoBoxes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);
    // B moves below A: both ends switch to the facing sides.
    resizeObjects(doc, new Map([[b, { x: 0, y: 400, width: 100, height: 100 }]]));
    expect(updates.count).toBe(1);
    expect(arrow(doc, id).ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
  });

  it('TC-11 resolveEndpoints with the target missing draws that end at its fallback, without throwing', () => {
    const rects = new Map<string, Rect>([['A', { x: 0, y: 0, width: 100, height: 100 }]]);
    const c = {
      from: { kind: 'attached' as const, objectId: 'A', fallback: { x: 100, y: 50 } },
      to: { kind: 'attached' as const, objectId: 'B', fallback: { x: 400, y: 50 } },
    };
    expect(() => resolveEndpoints(c, rects)).not.toThrow();
    expect(resolveEndpoints(c, rects)).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(resolveEndpoints(c, new Map())).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(connectorBBox({ x: 400, y: 50 }, { x: 100, y: 10 })).toEqual({ x: 100, y: 10, width: 300, height: 40 });
  });

  it('a connector to an object deleted concurrently is still created and drawn at the fallback', () => {
    const { doc, a } = twoBoxes();
    const id = createConnector(doc, attached(a), { kind: 'attached', objectId: 'gone', fallback: { x: 400, y: 50 } }, 'g');
    expect(id).toEqual(expect.any(String));
    expect(arrow(doc, id!).ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
  });

  it('TC-12 setConnectorEndpoint: to free, to attached C, to the opposite end object (rejected)', () => {
    const { doc, a, b } = twoBoxes();
    const c = box(doc, { x: 0, y: 400, width: 100, height: 100 });
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(600, 300))).toBe(true);
    expect(objectsMap(doc).get(id)!.get('to')).toEqual(free(600, 300));
    expect(updates.count).toBe(1);
    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    expect(objectsMap(doc).get(id)!.get('to')).toEqual({ kind: 'attached', objectId: c, fallback: { x: 50, y: 400 } });
    expect(arrow(doc, id).ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });
    expect(updates.count).toBe(2);
    expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(c))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(id))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', free(NaN, 0))).toBe(false);
    expect(updates.count).toBe(2);
  });

  it('TC-13 deleteObjects([A]) frees the arrow end at A’s anchor and removes A in exactly one update', () => {
    const { doc, a, b } = twoBoxes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    // A moved since the arrow was drawn: the end is freed where it is attached now.
    resizeObjects(doc, new Map([[a, { x: 0, y: -300, width: 100, height: 100 }]]));
    const anchor = arrow(doc, id).ends.from;
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates.count).toBe(1);
    expect(objectsMap(doc).has(a)).toBe(false);
    expect(objectsMap(doc).get(id)!.get('from')).toEqual(free(anchor.x, anchor.y));
    expect(arrow(doc, id).ends.from).toEqual(anchor);
    expect(objectsMap(doc).get(id)!.get('to')).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('TC-14 distanceToPolyline returns exact distances around the hit tolerance', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 }) <= CONNECTOR_HIT_TOLERANCE_PX).toBe(true);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 }) <= CONNECTOR_HIT_TOLERANCE_PX).toBe(false);
    // Beyond the ends the distance is to the end point.
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBe(5);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector → false', () => {
    const { doc, a, b } = twoBoxes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(10, 10))).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('moving arrows: free ends move from the start state, attached ends stay with their objects', () => {
    const { doc, a } = twoBoxes();
    const id = createConnector(doc, attached(a), free(300, 250), 'g')!;
    const start = arrow(doc, id);
    // Repeated absolute writes during a drag never accumulate.
    translateObjects(doc, [start], { x: 10, y: 20 });
    translateObjects(doc, [start], { x: 30, y: 40 });
    expect(objectsMap(doc).get(id)!.get('to')).toEqual(free(330, 290));
    expect(objectsMap(doc).get(id)!.get('from')).toMatchObject({ kind: 'attached', objectId: a });
    // A one-shot move (nudge) by the difference to the current box.
    const now = arrow(doc, id);
    expect(moveObjects(doc, new Map([[id, { x: now.x + 1, y: now.y }]]))).toBe(1);
    expect(objectsMap(doc).get(id)!.get('to')).toEqual(free(331, 290));
    // Group resize maps free ends into the scaled box.
    const free2 = createConnector(doc, free(0, 0), free(100, 50), 'g')!;
    const s0 = arrow(doc, free2);
    expect(scaleConnector(doc, s0, { x: 0, y: 0, width: 200, height: 100 })).toBe(true);
    expect(arrow(doc, free2).ends).toEqual({ from: { x: 0, y: 0 }, to: { x: 200, y: 100 } });
  });

  it('undoing a delete brings the object back with its arrow attached again (one step)', () => {
    const { doc, a, b } = twoBoxes();
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const undo = new Y.UndoManager(objectsMap(doc), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    deleteObjects(doc, [b]);
    expect(objectsMap(doc).get(id)!.get('to')).toMatchObject({ kind: 'free' });
    undo.undo();
    expect(objectsMap(doc).has(b)).toBe(true);
    expect(objectsMap(doc).get(id)!.get('to')).toMatchObject({ kind: 'attached', objectId: b });
  });
});
