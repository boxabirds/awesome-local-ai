import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;
let updates: number;

function make(x: number, y: number): string {
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 }) as string;
}
const get = (id: string) => snapshot(doc).find((o) => o.id === id)!;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => updates++);
});

describe('group operations', () => {
  it('TC-05 moveObjects skips a deleted id, returns 2, one update event', () => {
    const [a, b, c] = [make(0, 0), make(300, 0), make(600, 0)];
    deleteObject(doc, b);
    updates = 0;
    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 10, y: 10 }],
        [b, { x: 20, y: 20 }],
        [c, { x: 30, y: 30 }],
      ]),
    );
    expect(n).toBe(2);
    expect(updates).toBe(1);
    expect(get(a)).toMatchObject({ x: 10, y: 10 });
    expect(get(c)).toMatchObject({ x: 30, y: 30 });
  });

  it('moveObjects writes nothing when positions are unchanged', () => {
    const a = make(5, 5);
    updates = 0;
    expect(moveObjects(doc, new Map([[a, { x: 5, y: 5 }]]))).toBe(0);
    expect(updates).toBe(0);
  });

  it('TC-06 bringObjectsToFront puts 3 overlapping notes above unselected, keeping their order', () => {
    const [a, b, c, d, e] = [make(0, 0), make(10, 10), make(20, 20), make(30, 30), make(40, 40)];
    // selected: a, c, e (z 1, 3, 5); unselected: b, d (z 2, 4)
    expect(bringObjectsToFront(doc, [e, a, c])).toBeGreaterThan(0);
    const z = (id: string) => get(id).z;
    expect(Math.min(z(a), z(c), z(e))).toBeGreaterThan(Math.max(z(b), z(d)));
    expect(z(a)).toBeLessThan(z(c));
    expect(z(c)).toBeLessThan(z(e));
    updates = 0;
    expect(bringObjectsToFront(doc, [a, c, e])).toBe(0);
    expect(updates).toBe(0);
  });

  it('TC-07 objectsInRect: fully inside, half inside, outside -> only the first', () => {
    const [a, b, c] = [make(100, 100), make(450, 100), make(2000, 2000)];
    const rect = { x: 50, y: 50, width: 500, height: 400 };
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    expect(objectsInRect(snapshot(doc), rect)).not.toContain(b);
    expect(objectsInRect(snapshot(doc), rect)).not.toContain(c);
  });

  it('TC-08 allObjectIds skips an unknown type', () => {
    const a = make(0, 0);
    const shape = new Y.Map<unknown>();
    (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).set('shape-1', shape);
    shape.set('type', 'hologram'); // story 10 made 'shape' a known type
    shape.set('x', 1);
    shape.set('y', 1);
    shape.set('z', 99);
    expect(allObjectIds(snapshot(doc))).toEqual([a]);
  });

  it('TC-09 non-finite values and empty id lists apply nothing and open no transaction', () => {
    const a = make(0, 0);
    const b = make(300, 0);
    updates = 0;
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 1, y: 1 }], [b, { x: Infinity, y: 0 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates).toBe(0);
    expect(get(a)).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-10 a sticky without width/height reads STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const a = make(10, 20);
    expect(get(a).width).toBeUndefined();
    expect(objectBounds(get(a))).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(resizeObjects(doc, new Map([[a, { x: 10, y: 20, width: 300, height: 300 }]]))).toBe(1);
    expect(get(a)).toMatchObject({ width: 300, height: 300 });
    expect(objectBounds(get(a))).toEqual({ x: 10, y: 20, width: 300, height: 300 });
  });

  it('deleteObjects removes all present ids in one update and skips missing ones', () => {
    const [a, b] = [make(0, 0), make(300, 0)];
    updates = 0;
    expect(deleteObjects(doc, [a, b, 'missing'])).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
