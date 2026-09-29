// Story 10 `connector.model` unit cases (TC-07 to TC-14, TC-29): the arrow schema,
// the side geometry that makes an arrow follow the objects it joins, and the detach
// that keeps arrows when their target is deleted. Everything runs against a real
// Y.Doc; every rejection is checked to write *nothing* (the update counter).
//
// The fixtures are 200x200 sticky notes (STICKY_SIZE_WORLD) centred on their point:
//   A centre (100,100) -> rect 0,0 200x200     right anchor  (200,100)
//   B centre (400,100) -> rect 300,0 200x200   left anchor   (300,100)
//   C centre (100,400) -> rect 0,300 200x200   top anchor    (100,300)

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  connectorSnapshot,
  connectorsOf,
  objectRectsOf,
  decodeEndpoint,
  encodeEndpoint,
} from '../../src/shared/objects/connector.ts';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../../src/shared/geometry/connector-geometry.ts';
import { distanceToPolyline } from '../../src/shared/geometry/polyline.ts';
import {
  initDoc,
  createSticky,
  deleteObjects,
  moveObject,
  objectSnapshots,
  objectBounds,
} from '../../src/shared/board-model.ts';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config.ts';
import type { Endpoint } from '../../src/shared/objects/connector.ts';
import type { Rect } from '../../src/shared/geometry.ts';

function updatesOf(doc: Y.Doc, fn: () => unknown): number {
  let updates = 0;
  const h = () => updates++;
  doc.on('update', h);
  fn();
  doc.off('update', h);
  return updates;
}

function attached(objectId: string): Endpoint {
  return { kind: 'attached', objectId, fallback: { x: 0, y: 0 } };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

/** Three notes in a row down and to the right, 300 board units between centres. */
function fixture(doc: Y.Doc) {
  const a = createSticky(doc, { x: 100, y: 100 });
  const b = createSticky(doc, { x: 400, y: 100 });
  const c = createSticky(doc, { x: 100, y: 400 });
  return { a, b, c };
}

function rectsOf(doc: Y.Doc): ReadonlyMap<string, Rect> {
  return objectRectsOf(objectSnapshots(doc));
}

function snap(doc: Y.Doc, id: string) {
  return connectorSnapshot(doc, id)!;
}

describe('connector.model', () => {
  it('TC-07 welds both ends to the sides that face each other, in one update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b } = fixture(doc);
    let id!: string;
    const updates = updatesOf(doc, () => {
      id = createConnector(doc, attached(a), attached(b), 'me')!;
    });
    expect(updates).toBe(1);
    const s = snap(doc, id);
    expect(s.type).toBe('connector');
    expect(s.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } });
    expect(s.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 100 } });
    // The points it draws between, and the box the selection machinery uses.
    expect(resolveEndpoints({ from: s.from, to: s.to }, rectsOf(doc))).toEqual({
      from: { x: 200, y: 100 },
      to: { x: 300, y: 100 },
    });
    expect(connectorBBox({ x: 200, y: 100 }, { x: 300, y: 100 })).toEqual({
      x: 200,
      y: 100,
      width: 100,
      height: 0,
    });
    // The generic snapshot carries the derived box, so selection needs no special case.
    const generic = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(generic.x).toBe(200);
    expect(generic.y).toBe(100);
    expect(generic.width).toBeCloseTo(100, 6);
    expect(objectBounds(generic).height).toBeLessThan(1);
    // and it stacks above the notes it joins
    expect(s.z).toBeGreaterThan(objectSnapshots(doc).find((o) => o.id === a)!.z);
  });

  it('TC-08 refuses to connect an object to itself, writing nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a } = fixture(doc);
    const before = objectSnapshots(doc).length;
    expect(updatesOf(doc, () => createConnector(doc, attached(a), attached(a), 'me'))).toBe(0);
    expect(createConnector(doc, attached(a), attached(a), 'me')).toBeNull();
    expect(objectSnapshots(doc).length).toBe(before);
  });

  it('TC-09 rejects an arrow shorter than the minimum, accepts exactly the minimum', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(updatesOf(doc, () => createConnector(doc, free(0, 0), free(7.9, 0), 'me'))).toBe(0);
    expect(createConnector(doc, free(0, 0), free(7.9, 0), 'me')).toBeNull();
    expect(objects.size).toBe(0);
    const id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'me')!;
    expect(objects.size).toBe(1);
    const s = snap(doc, id);
    expect(s.from).toEqual({ kind: 'free', x: 0, y: 0 });
    expect(s.to).toEqual({ kind: 'free', x: 8, y: 0 });
  });

  it('TC-10 picks the side that faces the other end, switching at the diagonal', () => {
    const r: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const centre = { x: 100, y: 100 };
    const R = 400;
    const at = (deg: number): { x: number; y: number } => ({
      x: centre.x + R * Math.cos((deg * Math.PI) / 180),
      y: centre.y - R * Math.sin((deg * Math.PI) / 180), // board y grows downwards
    });
    expect(nearestSide(r, at(0))).toBe('right');
    expect(nearestSide(r, at(44))).toBe('right');
    expect(nearestSide(r, at(46))).toBe('top');
    expect(nearestSide(r, at(90))).toBe('top');
    expect(nearestSide(r, at(180))).toBe('left');
    expect(nearestSide(r, at(270))).toBe('bottom');
    // The anchors are the side midpoints, on the boundary of every shape kind.
    expect(sideAnchor(r, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 100, y: 200 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 100 });
  });

  it('TC-10b an arrow switches sides as its target moves, without a single write', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b } = fixture(doc);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    expect(resolveEndpoints(snap(doc, id), rectsOf(doc))).toEqual({
      from: { x: 200, y: 100 },
      to: { x: 300, y: 100 },
    });
    const rawBefore = JSON.stringify(doc.getMap('objects').get(id));
    // Drag B straight above A: both ends change side, and the arrow itself was never
    // written — the live rectangles alone decided it (connector.follow).
    moveObject(doc, b, 100, -200); // moveObject sets the top-left: B's centre is now (200,-100)
    expect(resolveEndpoints(snap(doc, id), rectsOf(doc))).toEqual({
      from: { x: 100, y: 0 }, // A's top anchor
      to: { x: 200, y: 0 }, // B's bottom anchor
    });
    expect(JSON.stringify(doc.getMap('objects').get(id))).toBe(rawBefore);
  });

  it('TC-11 draws an end whose object vanished at its stored fallback, and does not throw', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b } = fixture(doc);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const s = snap(doc, id);
    const empty = new Map<string, Rect>();
    expect(resolveEndpoints({ from: s.from, to: s.to }, empty)).toEqual({
      from: { x: 200, y: 100 },
      to: { x: 300, y: 100 },
    });
    // Only B is gone: its end falls back, A's end still tracks the live rectangle.
    const partial = new Map<string, Rect>([[a, { x: 0, y: 0, width: 200, height: 200 }]]);
    expect(resolveEndpoints({ from: s.from, to: s.to }, partial)).toEqual({
      from: { x: 200, y: 100 },
      to: { x: 300, y: 100 },
    });
    // A connector snapshot is still handed back, so the arrow keeps drawing.
    expect(connectorSnapshot(doc, id, partial)).toBeTruthy();
  });

  it('TC-12 re-attaches an end to another object or to a point, never to the far end', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b, c } = fixture(doc);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', free(123, 45)))).toBe(1);
    expect(snap(doc, id).to).toEqual({ kind: 'free', x: 123, y: 45 });
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', attached(c)))).toBe(1);
    expect(snap(doc, id).to).toMatchObject({ kind: 'attached', objectId: c });
    // Welding the far end back onto A would be a zero-length arrow.
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', attached(a)))).toBe(0);
    expect(snap(doc, id).to).toMatchObject({ objectId: c });
    // A malformed end and a non-finite point write nothing.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'somewhere' } as unknown as Endpoint)).toBe(false);
    // The from end can be detached too.
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'from', free(7, 9)))).toBe(1);
    expect(snap(doc, id).from).toEqual({ kind: 'free', x: 7, y: 9 });
  });

  it('TC-13 keeps the arrow when its target is deleted, pinning the end where it was', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b } = fixture(doc);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    // The detach and the delete are ONE update (and so one undo step).
    expect(updatesOf(doc, () => deleteObjects(doc, [a]))).toBe(1);
    expect(objectSnapshots(doc).some((o) => o.id === a)).toBe(false);
    const s = snap(doc, id);
    expect(s.from).toEqual({ kind: 'free', x: 200, y: 100 }); // A's right anchor
    expect(s.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(resolveEndpoints(s, rectsOf(doc))).toEqual({
      from: { x: 200, y: 100 },
      to: { x: 300, y: 100 },
    });
  });

  it('TC-13b detaches every end of every arrow when several targets go at once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b, c } = fixture(doc);
    const ab = createConnector(doc, attached(a), attached(b), 'me')!;
    const bc = createConnector(doc, attached(b), attached(c), 'me')!;
    expect(updatesOf(doc, () => deleteObjects(doc, [b]))).toBe(1);
    expect(connectorSnapshot(doc, ab, rectsOf(doc))!.to).toEqual({ kind: 'free', x: 300, y: 100 });
    expect(connectorSnapshot(doc, bc, rectsOf(doc))!.from).toEqual({ kind: 'free', x: 300, y: 100 });
    // Deleting everything else detaches the other ends too, and a call about
    // ids that are already gone writes nothing at all.
    expect(updatesOf(doc, () => deleteObjects(doc, [a, c]))).toBe(1);
    expect(objectSnapshots(doc).length).toBe(2);
    expect(updatesOf(doc, () => detachConnectorsTo(doc, ['gone']))).toBe(0);
    // An arrow whose both ends were welded to deleted objects keeps two free ends.
    const doc2 = new Y.Doc();
    initDoc(doc2);
    const f = fixture(doc2);
    const only = createConnector(doc2, attached(f.a), attached(f.b), 'me')!;
    deleteObjects(doc2, [f.a, f.b]);
    expect(connectorSnapshot(doc2, only)).toMatchObject({
      from: { kind: 'free', x: 200, y: 100 },
      to: { kind: 'free', x: 300, y: 100 },
    });
  });

  it('TC-14 measures the distance to the arrow line, for the click tolerance', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBeCloseTo(0, 10);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // Beyond an end, the distance is to that end, not to the infinite line.
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBeCloseTo(10, 10);
    expect(distanceToPolyline([], { x: 1, y: 1 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBeCloseTo(5, 10);
    // A bent arrow measures to its nearest segment.
    const bent = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline(bent, { x: 101, y: 50 })).toBeCloseTo(1, 10);
  });

  it('TC-29 stops touching an arrow that was deleted meanwhile', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b } = fixture(doc);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    deleteObjects(doc, [id]);
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', free(1, 2)))).toBe(0);
    expect(connectorSnapshot(doc, id)).toBeUndefined();
    // A write aimed at another type's id is refused too.
    expect(setConnectorEndpoint(doc, a, 'to', free(1, 2))).toBe(false);
  });

  it('endpoints survive the round trip through the document, and junk is dropped', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a } = fixture(doc);
    const id = createConnector(doc, attached(a), free(1.5, 2.5), 'me')!;
    const raw = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(encodeEndpoint(decodeEndpoint(raw.get('from'))!)).toEqual({
      kind: 'attached',
      objectId: a,
      // the anchor facing (1.5, 2.5), i.e. the note's left side
      fallback: { x: 0, y: 100 },
    });
    expect(decodeEndpoint(raw.get('to'))).toEqual({ kind: 'free', x: 1.5, y: 2.5 });
    expect(decodeEndpoint(undefined)).toBeNull();
    expect(decodeEndpoint({ kind: 'attached' })).toBeNull();
    expect(decodeEndpoint({ kind: 'free', x: 'x', y: 1 })).toBeNull();
    // An arrow whose ends cannot be read is not rendered rather than guessed at.
    raw.set('from', { kind: 'nonsense' });
    expect(connectorSnapshot(doc, id)).toBeUndefined();
    expect(connectorsOf(objectSnapshots(doc))).toEqual([]);
  });

  it('the rect map ignores arrows, so a chain of arrows cannot feed on itself', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { a, b } = fixture(doc);
    createConnector(doc, attached(a), attached(b), 'me');
    expect([...objectRectsOf(objectSnapshots(doc)).values()]).toEqual([
      { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD },
      { x: 300, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD },
      { x: 0, y: 300, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD },
    ]);
  });
});
