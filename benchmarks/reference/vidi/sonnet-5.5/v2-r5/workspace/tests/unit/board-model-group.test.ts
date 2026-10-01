import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds, bringObjectsToFront, createSticky, deleteObjects, initDoc, moveObjects, objectBounds,
  objectsInRect, resizeObjects, snapshot, snapshotObjects, type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => { updates++; });
});

function mk(x = 0, y = 0): string {
  const id = createSticky(doc, { x, y });
  if (!id) throw new Error('create failed');
  updates = 0;
  return id;
}
const byId = (id: string) => snapshot(doc).find((n) => n.id === id)!;

describe('group operations (sel.geometry_ops)', () => {
  it('TC-05 moveObjects skips a deleted id, returns 2 and emits one update', () => {
    const [a, b, c] = [mk(), mk(), mk()];
    deleteObjects(doc, [b]);
    updates = 0;
    const n = moveObjects(doc, new Map([[a, { x: 5, y: 6 }], [b, { x: 1, y: 1 }], [c, { x: 7, y: 8 }]]));
    expect(n).toBe(2);
    expect(updates).toBe(1);
    expect(byId(a)).toMatchObject({ x: 5, y: 6 });
    expect(byId(c)).toMatchObject({ x: 7, y: 8 });
  });

  it('TC-06 bringObjectsToFront puts the selection above others, keeping its order', () => {
    const [a, b, c, u1, u2] = [mk(), mk(), mk(), mk(), mk()];
    // order among selected: c < a < b
    doc.transact(() => {
      const o = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      o.get(c)!.set('z', 1); o.get(a)!.set('z', 2); o.get(b)!.set('z', 3);
      o.get(u1)!.set('z', 10); o.get(u2)!.set('z', 11);
    });
    expect(bringObjectsToFront(doc, [a, b, c])).toBe(3);
    const z = (id: string) => byId(id).z;
    expect(Math.min(z(a), z(b), z(c))).toBeGreaterThan(Math.max(z(u1), z(u2)));
    expect(z(c)).toBeLessThan(z(a));
    expect(z(a)).toBeLessThan(z(b));
    updates = 0;
    expect(bringObjectsToFront(doc, [a, b, c])).toBe(0); // already on top
    expect(updates).toBe(0);
  });

  it('TC-07 objectsInRect selects only fully contained objects', () => {
    const [a, b, c] = [mk(100, 100), mk(400, 100), mk(900, 900)]; // centres; notes are 200 wide
    const rect = { x: 0, y: 0, width: 300, height: 300 }; // a: 0..200 inside; b: 300..500 outside
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    const half = { x: 0, y: 0, width: 400, height: 300 }; // b starts at 300, ends 500: partly in
    expect(objectsInRect(snapshot(doc), half)).toEqual([a]);
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 1200, height: 1200 }).sort()).toEqual([a, b, c].sort());
    // touching from outside is not inside
    expect(objectsInRect(snapshot(doc), { x: 200, y: 0, width: 50, height: 50 })).toEqual([]);
  });

  it('TC-08 allObjectIds skips an unknown type', () => {
    const a = mk();
    const objs: ObjectSnapshot[] = [...snapshotObjects(doc), { id: 'x', type: 'mystery', x: 0, y: 0, z: 0, createdAt: 0 }];
    expect(allObjectIds(objs)).toEqual([a]);
    expect(allObjectIds([])).toEqual([]);
  });

  it('TC-09 invalid values and empty id lists apply nothing and open no transaction', () => {
    const a = mk();
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates).toBe(0);
  });

  it('TC-10 a sticky without width/height reads STICKY_SIZE_WORLD; the first resize writes both', () => {
    const a = mk(0, 0);
    expect(byId(a).width).toBeUndefined();
    expect(objectBounds(byId(a))).toMatchObject({ width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(resizeObjects(doc, new Map([[a, { x: -100, y: -100, width: 300, height: 300 }]]))).toBe(1);
    expect(byId(a)).toMatchObject({ x: -100, y: -100, width: 300, height: 300 });
    // writing the implicit size explicitly is still a change; repeating it is not
    expect(resizeObjects(doc, new Map([[a, { x: -100, y: -100, width: 300, height: 300 }]]))).toBe(0);
    const legacy = mk(500, 500);
    const rect = { x: byId(legacy).x, y: byId(legacy).y, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    expect(resizeObjects(doc, new Map([[legacy, rect]]))).toBe(1);
    expect(byId(legacy).width).toBe(STICKY_SIZE_WORLD);
  });

  it('deleteObjects removes several objects in one transaction', () => {
    const [a, b, c] = [mk(), mk(), mk()];
    expect(deleteObjects(doc, [a, b, 'missing'])).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n) => n.id)).toEqual([c]);
  });
});
