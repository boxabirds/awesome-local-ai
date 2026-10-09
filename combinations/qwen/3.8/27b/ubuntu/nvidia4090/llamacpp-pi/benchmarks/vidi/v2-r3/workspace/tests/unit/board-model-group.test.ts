/**
 * TC-06 to TC-10 (group half): generic group operations in the shared board
 * model (sel.geometry_ops). All writes must happen in one LOCAL_ORIGIN
 * transaction per operation.
 */
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  isKnownObjectType,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  objectsInRect,
  registerKnownObjectType,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
});

/** Insert an object of an arbitrary (unregistered) type, as a hostile sync might deliver. */
function rawObject(type: string, x: number, y: number, z: number): string {
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const item = new Y.Map<unknown>();
      item.set('type', type);
      item.set('x', x);
      item.set('y', y);
      item.set('z', z);
      item.set('createdAt', Date.now());
      doc.getMap('objects').set(id, item);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

const zOf = (snap: readonly ObjectSnapshot[], id: string): number => {
  const obj = snap.find((o) => o.id === id);
  if (!obj) throw new Error(`missing object ${id}`);
  return obj.z;
};

describe('objectBounds', () => {
  it('falls back to STICKY_SIZE_WORLD for legacy stickies without size fields', () => {
    createSticky(doc, { x: 5, y: 6 });
    expect(objectBounds(snapshot(doc)[0])).toEqual({
      x: 5,
      y: 6,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('uses explicit width/height when present', () => {
    const obj = { id: 'x', type: 'testbox', x: 1, y: 2, width: 33, height: 44, z: 1, createdAt: 0 };
    expect(objectBounds(obj)).toEqual({ x: 1, y: 2, width: 33, height: 44 });
  });

  it('unknown types without size fields have zero bounds', () => {
    const obj = { id: 'x', type: 'mystery', x: 1, y: 2, z: 1, createdAt: 0 };
    expect(objectBounds(obj)).toEqual({ x: 1, y: 2, width: 0, height: 0 });
  });
});

describe('objectsInRect (marquee containment)', () => {
  it('returns the ids of objects fully inside the rect (inclusive edges)', () => {
    const a = createSticky(doc, { x: 0, y: 0 }); // 0..200
    createSticky(doc, { x: 150, y: 0 }); // 150..350: partially inside 0..300
    createSticky(doc, { x: 300, y: 300 }); // fully outside
    const ids = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 300, height: 300 });
    expect(ids).toEqual([a]);
  });

  it('ignores objects of unregistered types', () => {
    const a = createSticky(doc, { x: 10, y: 10 });
    rawObject('mystery', 10, 10, 5);
    const ids = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 1000, height: 1000 });
    expect(ids).toEqual([a]);
  });

  it('selects nothing for a zero-size rect (a click, not a drag)', () => {
    createSticky(doc, { x: 0, y: 0 });
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });
});

describe('allObjectIds (select all)', () => {
  it('returns every registered-type object and excludes unknown types', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const m = rawObject('mystery', 0, 0, 5);
    const ids = allObjectIds(snapshot(doc));
    expect(new Set(ids)).toEqual(new Set([a, b]));
    expect(ids).not.toContain(m);
  });

  it('is empty for an empty board (TC-28 no-crash core)', () => {
    expect(allObjectIds(snapshot(doc))).toEqual([]);
  });

  it('includes newly registered types (registry hook)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    registerKnownObjectType('widget');
    expect(isKnownObjectType('widget')).toBe(true);
    const w = rawObject('widget', 10, 10, 5);
    const ids = allObjectIds(snapshot(doc));
    expect(new Set(ids)).toEqual(new Set([a, w]));
    expect(isKnownObjectType('mystery')).toBe(false);
  });
});

describe('moveObjects (TC-06, TC-10)', () => {
  it('writes absolute positions for the group in one LOCAL_ORIGIN transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const origins: string[] = [];
    doc.on('update', (_u, origin) => origins.push(String(origin)));
    const n = moveObjects(doc, new Map([[a, { x: 10, y: 20 }], [b, { x: 30, y: 40 }]]));
    expect(n).toBe(2);
    const snap = snapshot(doc);
    expect(snap.find((o) => o.id === a)).toMatchObject({ x: 10, y: 20 });
    expect(snap.find((o) => o.id === b)).toMatchObject({ x: 30, y: 40 });
    expect(origins).toEqual([String(LOCAL_ORIGIN)]);
  });

  it('skips missing ids and counts only the objects it changed', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const n = moveObjects(doc, new Map([[a, { x: 5, y: 5 }], ['nope', { x: 1, y: 1 }]]));
    expect(n).toBe(1);
  });

  it('returns 0 and writes nothing for an empty list (no-op)', () => {
    createSticky(doc, { x: 0, y: 0 });
    const before = Y.encodeStateAsUpdate(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('rejects non-finite values without writing (TC-10)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = Y.encodeStateAsUpdate(doc);
    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});

describe('resizeObjects (TC-07, TC-10)', () => {
  it('writes x, y, width, height in one LOCAL_ORIGIN transaction and makes implicit sizes explicit', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const n = resizeObjects(doc, new Map([[a, { x: 10, y: 20, width: 300, height: 300 }]]));
    expect(n).toBe(1);
    expect((doc.getMap('objects').get(a) as Y.Map<unknown> | undefined)?.get('width')).toBe(300);
    expect(snapshot(doc).find((o) => o.id === a)).toMatchObject({ x: 10, y: 20, width: 300, height: 300 });
  });

  it('returns 0 and writes nothing for non-finite or non-positive results (TC-10)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = Y.encodeStateAsUpdate(doc);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 100 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: Number.NaN, y: 0, width: 100, height: 100 }]]))).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});

describe('bringObjectsToFront (TC-08, TC-09)', () => {
  it('raises the group above every unselected object, preserving relative order', () => {
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 100, y: 0 }); // z 2
    const c = createSticky(doc, { x: 200, y: 0 }); // z 3 (unselected)
    const n = bringObjectsToFront(doc, [a, b]);
    expect(n).toBe(2);
    const snap = snapshot(doc);
    expect(zOf(snap, c)).toBe(3);
    expect(zOf(snap, a)).toBe(4); // a kept its lower relative position
    expect(zOf(snap, b)).toBe(5);
    expect(snap.map((o) => o.id)).toEqual([c, a, b]); // render (top-most last) order
  });

  it('is a no-op when the group is already entirely on top (TC-09)', () => {
    createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 100, y: 0 }); // z 2: already top
    const before = Y.encodeStateAsUpdate(doc);
    expect(bringObjectsToFront(doc, [b])).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('skips missing ids', () => {
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 100, y: 0 }); // z 2
    expect(bringObjectsToFront(doc, ['nope', a])).toBe(1);
    expect(zOf(snapshot(doc), a)).toBe(3);
    expect(zOf(snapshot(doc), b)).toBe(2);
  });
});

describe('deleteObjects (TC-35 core)', () => {
  it('deletes every existing id in one LOCAL_ORIGIN transaction and returns the count', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });
    const origins: string[] = [];
    doc.on('update', (_u, origin) => origins.push(String(origin)));
    expect(deleteObjects(doc, [a, b, 'nope'])).toBe(2);
    expect(snapshot(doc).map((o) => o.id)).toEqual([c]);
    expect(origins).toEqual([String(LOCAL_ORIGIN)]);
  });

  it('returns 0 for an empty list without writing', () => {
    createSticky(doc, { x: 0, y: 0 });
    const before = Y.encodeStateAsUpdate(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
