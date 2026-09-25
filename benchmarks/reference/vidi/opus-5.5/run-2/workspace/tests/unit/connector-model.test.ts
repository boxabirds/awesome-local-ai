/** Story 10 connector.model unit tests (TC-07 to TC-14, TC-29) on a real Y.Doc. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, LOCAL_ORIGIN, snapshotObjects } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  isConnectorSnap,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function countUpdates(doc: Y.Doc): { readonly count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function connector(doc: Y.Doc, id: string): ConnectorSnap {
  const c = snapshotObjects(doc).find((o) => o.id === id);
  if (c === undefined || !isConnectorSnap(c)) throw new Error('not a connector');
  return c;
}

function stored(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)?.get(key);
}

function box(doc: Y.Doc, r: Rect): string {
  return createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'g')!;
}

const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

// A at (0,0) 100x100; B 300 units to its right.
const RECT_A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const RECT_B: Rect = { x: 400, y: 0, width: 100, height: 100 };

describe('connector.model', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  beforeEach(() => {
    doc = new Y.Doc();
    a = box(doc, RECT_A);
    b = box(doc, RECT_B);
  });

  it('TC-07 A → B 300 apart: attached ends stored with fallbacks at the facing side anchors, one update', () => {
    const updates = countUpdates(doc);
    const id = createConnector(doc, attached(a), attached(b), 'g_dana');
    expect(id).not.toBeNull();
    expect(updates.count).toBe(1);
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
    expect(stored(doc, id!, 'from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(stored(doc, id!, 'to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });
    const c = connector(doc, id!);
    expect(c.fromPoint).toEqual({ x: 100, y: 50 });
    expect(c.toPoint).toEqual({ x: 400, y: 50 });
    expect({ x: c.x, y: c.y, width: c.width, height: c.height }).toEqual({ x: 100, y: 50, width: 300, height: 0 });
    expect(stored(doc, id!, 'createdBy')).toBe('g_dana');
    expect(c.z).toBeGreaterThan(Math.max(...snapshotObjects(doc).filter((o) => o.id !== id).map((o) => o.z)));
  });

  it('TC-08 A → A: null, nothing written', () => {
    const updates = countUpdates(doc);
    expect(createConnector(doc, attached(a), attached(a), 'g')).toBeNull();
    expect(updates.count).toBe(0);
  });

  it('TC-09 free → free: 7.9 units rejected, exactly CONNECTOR_MIN_LENGTH_WORLD created', () => {
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);
    const updates = countUpdates(doc);
    expect(createConnector(doc, free(1000, 1000), free(1007.9, 1000), 'g')).toBeNull();
    expect(updates.count).toBe(0);
    const id = createConnector(doc, free(1000, 1000), free(1000, 1000 + CONNECTOR_MIN_LENGTH_WORLD), 'g');
    expect(id).not.toBeNull();
    expect(updates.count).toBe(1);
    expect(connector(doc, id!).height).toBe(CONNECTOR_MIN_LENGTH_WORLD);
  });

  it('TC-10 nearestSide as B orbits A: 0° right, 44° right, 46° top, 90° top (switch at the diagonal)', () => {
    const centre = { x: 50, y: 50 };
    const at = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      // Screen y grows downwards: counter-clockwise on screen is -y.
      return { x: centre.x + 300 * Math.cos(rad), y: centre.y - 300 * Math.sin(rad) };
    };
    expect([0, 44, 46, 90].map((d) => nearestSide(RECT_A, at(d)))).toEqual(['right', 'right', 'top', 'top']);
    expect(nearestSide(RECT_A, at(180))).toBe('left');
    expect(nearestSide(RECT_A, at(270))).toBe('bottom');
    // Wide rect: its diagonals, not 45°, decide.
    const wide = { x: 0, y: 0, width: 400, height: 100 };
    expect(nearestSide(wide, { x: 200 + 150, y: 50 - 100 })).toBe('top');
    expect(sideAnchor(RECT_A, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(RECT_A, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('TC-10 arrows follow a move and switch sides without writes', () => {
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);
    doc.transact(() => {
      const bMap = doc.getMap<Y.Map<unknown>>('objects').get(b)!;
      bMap.set('x', 0);
      bMap.set('y', 400);
    }, LOCAL_ORIGIN);
    expect(updates.count).toBe(1); // only the move itself
    const c = connector(doc, id);
    expect(c.fromPoint).toEqual({ x: 50, y: 100 }); // A's bottom
    expect(c.toPoint).toEqual({ x: 50, y: 400 }); // B's top
  });

  it('TC-11 resolveEndpoints with B missing: end at its fallback, no throw', () => {
    const snap = {
      from: { kind: 'attached', objectId: 'A', fallback: { x: 1, y: 1 } } as Endpoint,
      to: { kind: 'attached', objectId: 'B', fallback: { x: 400, y: 50 } } as Endpoint,
    };
    const rects = new Map([['A', RECT_A]]);
    const ends = resolveEndpoints(snap, rects);
    expect(ends.to).toEqual({ x: 400, y: 50 });
    expect(ends.from).toEqual({ x: 100, y: 50 }); // A faces the fallback point
    expect(resolveEndpoints(snap, new Map())).toEqual({ from: { x: 1, y: 1 }, to: { x: 400, y: 50 } });
    expect(connectorBBox({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 4, height: 7 });
  });

  it('TC-12 setConnectorEndpoint: to free → updated; to C → updated; to the opposite end’s object → false', () => {
    const c = box(doc, { x: 400, y: 400, width: 100, height: 100 });
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    let updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(700, 50))).toBe(true);
    expect(updates.count).toBe(1);
    expect(stored(doc, id, 'to')).toEqual({ kind: 'free', x: 700, y: 50 });

    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    expect(updates.count).toBe(2);
    expect(stored(doc, id, 'to')).toMatchObject({ kind: 'attached', objectId: c });
    expect(connector(doc, id).toPoint).toEqual({ x: 400, y: 450 }); // C's left side faces A

    updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(c))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached(id))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', free(Number.NaN, 0))).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('TC-13 deleteObjects([A]): A removed, the arrow start becomes free at A’s anchor, one update', () => {
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a])).toBe(1);
    expect(updates.count).toBe(1);
    expect(snapshotObjects(doc).some((o) => o.id === a)).toBe(false);
    expect(stored(doc, id, 'from')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(stored(doc, id, 'to')).toMatchObject({ kind: 'attached', objectId: b });
    const c = connector(doc, id);
    expect(c.fromPoint).toEqual({ x: 100, y: 50 });
    expect(c.toPoint).toEqual({ x: 400, y: 50 });
  });

  it('TC-13 deleting the arrow together with its objects leaves nothing behind', () => {
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    expect(deleteObjects(doc, [a, id, b])).toBe(3);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-14 distanceToPolyline at 0, 5.99 and 6.01 units from a segment', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: -6.01 })).toBeCloseTo(6.01, 10);
    // Beyond an end the distance is to that end.
    expect(distanceToPolyline(line, { x: 103, y: 4 })).toBeCloseTo(5, 10);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('TC-29 setConnectorEndpoint on a deleted connector: false', () => {
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc);
    expect(setConnectorEndpoint(doc, id, 'to', free(700, 50))).toBe(false);
    expect(setConnectorEndpoint(doc, a, 'to', free(700, 50))).toBe(false); // not a connector
    expect(updates.count).toBe(0);
  });

  it('orphaned end (target gone on this replica) renders at the fallback and normalises on the next write', () => {
    const id = createConnector(doc, attached(a), attached(b), 'g')!;
    // Removed without the detach hook, as when a concurrent remote delete merges in.
    doc.transact(() => doc.getMap('objects').delete(b));
    expect(connector(doc, id).toPoint).toEqual({ x: 400, y: 50 });
    expect(setConnectorEndpoint(doc, id, 'from', free(-200, 50))).toBe(true);
    expect(stored(doc, id, 'to')).toEqual({ kind: 'free', x: 400, y: 50 });
  });
});

describe('checkout-flow fixture', () => {
  it('4 labelled shapes, 3 attached connectors and 1 with a free end, all resolved', async () => {
    const { buildCheckoutFlow } = await import('../fixtures/checkout-flow');
    const flow = buildCheckoutFlow();
    const all = snapshotObjects(flow.doc);
    expect(all.filter((o) => o.type === 'shape')).toHaveLength(4);
    const conns = all.filter(isConnectorSnap);
    expect(conns).toHaveLength(4);
    const attachedBoth = conns.filter((c) => c.from.kind === 'attached' && c.to.kind === 'attached');
    expect(attachedBoth).toHaveLength(3);
    const first = conns.find((c) => c.id === flow.connectors[0])!;
    expect(first.fromPoint).toEqual({ x: 300, y: 160 }); // Checkout's right side
    expect(first.toPoint).toEqual({ x: 420, y: 160 }); // Paid?'s left corner
  });
});
