/**
 * connector.model (story 10): model and geometry on a real Y.Doc. TC-07 to TC-14 and TC-29.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc, moveObjects, objectSnapshot } from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createConnector,
  isConnector,
  setConnectorEndpoint,
  type ConnectorSnap,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';

const AUTHOR = 'g_test';
const SIZE = 100;
/** Shape A at the origin; B 300 units to its right (edge to edge 200). */
const RECT_A = { x: 0, y: 0, width: SIZE, height: SIZE };
const RECT_B = { x: 300, y: 0, width: SIZE, height: SIZE };
const RECT_C = { x: 0, y: 400, width: SIZE, height: SIZE };

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { doc, updates: () => updates };
}

function shapeAt(doc: Y.Doc, rect: typeof RECT_A): string {
  return createShape(doc, { kind: 'rect', rect, at: { x: rect.x, y: rect.y } }, AUTHOR)!;
}

function attached(objectId: string): Endpoint {
  return { kind: 'attached', objectId, fallback: { x: 0, y: 0 } };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

function connectors(doc: Y.Doc): ConnectorSnap[] {
  return objectSnapshot(doc).filter(isConnector);
}

function only(doc: Y.Doc): ConnectorSnap {
  const all = connectors(doc);
  expect(all).toHaveLength(1);
  return all[0]!;
}

const DEG = Math.PI / 180;
const ORBIT_RADIUS = 500;

describe('connector.model', () => {
  it('TC-07 A to B 300 apart: both ends stored attached with fallbacks at the facing side anchors, one update', () => {
    const { doc, updates } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const b = shapeAt(doc, RECT_B);
    const before = updates();
    const id = createConnector(doc, attached(a), attached(b), AUTHOR);
    expect(id).toBeTruthy();
    expect(updates() - before).toBe(1);
    const c = only(doc);
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: sideAnchor(RECT_A, 'right') });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: sideAnchor(RECT_B, 'left') });
    expect(c.fromPoint).toEqual({ x: 100, y: 50 });
    expect(c.toPoint).toEqual({ x: 300, y: 50 });
    // The derived box spans the drawn ends (a flat arrow has zero height).
    expect(c).toMatchObject({ x: 100, y: 50, width: 200, height: 0, createdBy: AUTHOR });
  });

  it('TC-08 A to A: null, no update (negative)', () => {
    const { doc, updates } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const before = updates();
    expect(createConnector(doc, attached(a), attached(a), AUTHOR)).toBeNull();
    expect(updates()).toBe(before);
    expect(connectors(doc)).toHaveLength(0);
  });

  it('TC-09 free to free: 7.9 units long is rejected, CONNECTOR_MIN_LENGTH_WORLD is created (boundary)', () => {
    const { doc, updates } = newDoc();
    const before = updates();
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), AUTHOR)).toBeNull();
    expect(updates()).toBe(before);
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), AUTHOR)).toBeTruthy();
    expect(updates() - before).toBe(1);
    expect(only(doc)).toMatchObject({ fromPoint: { x: 0, y: 0 }, toPoint: { x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 } });
  });

  it('TC-10 nearestSide as B orbits A at 0, 44, 46 and 90 degrees: right, right, top, top', () => {
    const centre = { x: RECT_A.x + SIZE / 2, y: RECT_A.y + SIZE / 2 };
    const at = (deg: number) => ({
      // Counter-clockwise from east; screen y grows downwards.
      x: centre.x + ORBIT_RADIUS * Math.cos(deg * DEG),
      y: centre.y - ORBIT_RADIUS * Math.sin(deg * DEG),
    });
    expect([0, 44, 46, 90].map((deg) => nearestSide(RECT_A, at(deg)))).toEqual(['right', 'right', 'top', 'top']);
    expect([180, 270].map((deg) => nearestSide(RECT_A, at(deg)))).toEqual(['left', 'bottom']);

    // Follow: moving B around A in the document switches the drawn sides, with no connector write.
    const { doc } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const b = shapeAt(doc, RECT_B);
    const id = createConnector(doc, attached(a), attached(b), AUTHOR)!;
    const stored = only(doc);
    moveObjects(doc, new Map([[b, { x: 0, y: -400 }]]));
    const moved = only(doc);
    expect(moved.id).toBe(id);
    expect(moved.from).toEqual(stored.from);
    expect(moved.fromPoint).toEqual(sideAnchor(RECT_A, 'top'));
    expect(moved.toPoint).toEqual(sideAnchor({ ...RECT_B, x: 0, y: -400 }, 'bottom'));
  });

  it('TC-11 resolveEndpoints with B missing: that end is drawn at its fallback, no throw (orphaned)', () => {
    const fallback = { x: 300, y: 50 };
    const c = {
      from: { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } } as Endpoint,
      to: { kind: 'attached', objectId: 'B', fallback } as Endpoint,
    };
    const rects = new Map([['A', RECT_A]]);
    const pts = resolveEndpoints(c, rects);
    expect(pts.to).toEqual(fallback);
    expect(pts.from).toEqual(sideAnchor(RECT_A, 'right'));
    // Both missing: both fallbacks.
    expect(resolveEndpoints(c, new Map())).toEqual({ from: { x: 100, y: 50 }, to: fallback });
    expect(connectorBBox(pts.from, pts.to)).toEqual({ x: 100, y: 50, width: 200, height: 0 });
  });

  it('TC-12 setConnectorEndpoint: to free, to attached C, to the object at the other end (rejected)', () => {
    const { doc, updates } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const b = shapeAt(doc, RECT_B);
    const c = shapeAt(doc, RECT_C);
    const id = createConnector(doc, attached(a), attached(b), AUTHOR)!;

    let before = updates();
    expect(setConnectorEndpoint(doc, id, 'to', free(600, 600))).toBe(true);
    expect(updates() - before).toBe(1);
    expect(only(doc).to).toEqual(free(600, 600));

    before = updates();
    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    expect(updates() - before).toBe(1);
    expect(only(doc).to).toEqual({ kind: 'attached', objectId: c, fallback: sideAnchor(RECT_C, 'top') });
    expect(only(doc).toPoint).toEqual(sideAnchor(RECT_C, 'top'));

    before = updates();
    expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(false); // no-op
    expect(setConnectorEndpoint(doc, id, 'from', free(Number.NaN, 0))).toBe(false);
    expect(updates()).toBe(before);
    expect(only(doc).to).toMatchObject({ objectId: c });
  });

  it('TC-13 deleteObjects([A]): A removed and the arrow end becomes free where it was, in one update', () => {
    const { doc, updates } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const b = shapeAt(doc, RECT_B);
    const id = createConnector(doc, attached(a), attached(b), AUTHOR)!;
    const anchor = only(doc).fromPoint;
    const before = updates();
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates() - before).toBe(1);
    expect(objectSnapshot(doc).some((o) => o.id === a)).toBe(false);
    const c = only(doc);
    expect(c.id).toBe(id);
    expect(c.from).toEqual(free(anchor.x, anchor.y));
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('TC-14 distanceToPolyline at 0, 5.99 and 6.01 units from a segment', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 }) <= CONNECTOR_HIT_TOLERANCE_PX).toBe(true);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 }) <= CONNECTOR_HIT_TOLERANCE_PX).toBe(false);
    // Beyond an end the distance is to that end.
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBeCloseTo(5, 10);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector id: false, no update', () => {
    const { doc, updates } = newDoc();
    const id = createConnector(doc, free(0, 0), free(100, 0), AUTHOR)!;
    deleteObjects(doc, [id]);
    const before = updates();
    expect(setConnectorEndpoint(doc, id, 'to', free(50, 50))).toBe(false);
    expect(updates()).toBe(before);
  });

  it('an arrow whose target was deleted concurrently is created attached and drawn at the fallback', () => {
    const { doc } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const fallback = { x: 300, y: 50 };
    const id = createConnector(doc, attached(a), { kind: 'attached', objectId: 'gone', fallback }, AUTHOR);
    expect(id).toBeTruthy();
    const c = only(doc);
    expect(c.to).toEqual({ kind: 'attached', objectId: 'gone', fallback });
    expect(c.toPoint).toEqual(fallback);
    expect(c.fromPoint).toEqual(sideAnchor(RECT_A, 'right'));
    // The next local write normalises the orphaned end to a free end at its fallback.
    expect(setConnectorEndpoint(doc, id!, 'from', free(-200, 50))).toBe(true);
    expect(only(doc).to).toEqual(free(fallback.x, fallback.y));
  });

  it('moving an arrow moves its free ends only; deleting the arrow itself leaves nothing behind', () => {
    const { doc } = newDoc();
    const a = shapeAt(doc, RECT_A);
    const id = createConnector(doc, attached(a), free(400, 50), AUTHOR)!;
    const box = only(doc);
    expect(moveObjects(doc, new Map([[id, { x: box.x + 10, y: box.y + 20 }]]))).toBe(1);
    expect(only(doc).to).toEqual(free(410, 70));
    expect(only(doc).from).toMatchObject({ kind: 'attached', objectId: a });
    expect(deleteObjects(doc, [id, a])).toBe(2);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });
});
