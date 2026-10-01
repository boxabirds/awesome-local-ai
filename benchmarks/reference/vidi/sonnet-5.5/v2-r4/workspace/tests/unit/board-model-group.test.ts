import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function setup() {
  const doc = new Y.Doc();
  let updates = 0;
  doc.on('update', () => updates++);
  return { doc, updates: () => updates };
}

const at = (doc: Y.Doc, x: number, y: number) => createSticky(doc, { x: x + 100, y: y + 100 });
const byId = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id)!;

describe('group operations', () => {
  it('TC-05 moveObjects skips a deleted id, returns the count and emits one update', () => {
    const { doc, updates } = setup();
    const [a, b, c] = [at(doc, 0, 0), at(doc, 300, 0), at(doc, 600, 0)];
    deleteObjects(doc, [b]);
    const base = updates();
    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 10, y: 10 }],
        [b, { x: 50, y: 50 }],
        [c, { x: 20, y: 20 }],
      ]),
    );
    expect(n).toBe(2);
    expect(updates() - base).toBe(1);
    expect(byId(doc, a)).toMatchObject({ x: 10, y: 10 });
    expect(byId(doc, c)).toMatchObject({ x: 20, y: 20 });
  });

  it('TC-06 bringObjectsToFront puts 3 overlapping notes above the rest, keeping their order', () => {
    const { doc } = setup();
    const [s1, o1, s2, o2, s3] = [at(doc, 0, 0), at(doc, 0, 0), at(doc, 0, 0), at(doc, 0, 0), at(doc, 0, 0)];
    expect(bringObjectsToFront(doc, [s3, s1, s2])).toBe(3);
    const z = (id: string) => byId(doc, id).z;
    expect(Math.min(z(s1), z(s2), z(s3))).toBeGreaterThan(Math.max(z(o1), z(o2)));
    expect(z(s1)).toBeLessThan(z(s2));
    expect(z(s2)).toBeLessThan(z(s3));
  });

  it('bringObjectsToFront is a no-op (no update) when the group is already on top', () => {
    const { doc, updates } = setup();
    at(doc, 0, 0);
    const top = at(doc, 0, 0);
    const base = updates();
    expect(bringObjectsToFront(doc, [top])).toBe(0);
    expect(updates()).toBe(base);
  });

  it('TC-07 objectsInRect: fully inside -> selected; partly or outside -> not', () => {
    const { doc } = setup();
    const a = at(doc, 10, 10); // 10..210
    at(doc, 150, 10); // half inside
    at(doc, 900, 900);
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 300, height: 300 })).toEqual([a]);
    // touching but not enclosing
    expect(objectsInRect(snapshot(doc), { x: 11, y: 0, width: 300, height: 300 })).toEqual([]);
  });

  it('TC-08 allObjectIds skips an unknown type', () => {
    const { doc } = setup();
    const a = at(doc, 0, 0);
    const mystery: ObjectSnapshot = { id: 'm', type: 'mystery', x: 0, y: 0, width: 1, height: 1, z: 1, createdAt: 0 };
    expect(allObjectIds([...snapshot(doc), mystery])).toEqual([a]);
    expect(objectsInRect([mystery], { x: -5, y: -5, width: 10, height: 10 })).toEqual([]);
  });

  it('TC-09 non-finite values and empty id lists write nothing', () => {
    const { doc, updates } = setup();
    const a = at(doc, 0, 0);
    const base = updates();
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates()).toBe(base);
  });

  it('TC-10 a sticky without width/height reads 200x200; the first resize writes both fields', () => {
    const { doc } = setup();
    const a = at(doc, 0, 0);
    const objs = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    expect(objs.get(a)!.get('width')).toBeUndefined();
    expect(objectBounds(byId(doc, a))).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(resizeObjects(doc, new Map([[a, { x: 5, y: 6, width: 300, height: 300 }]]))).toBe(1);
    expect(objs.get(a)!.get('width')).toBe(300);
    expect(objs.get(a)!.get('height')).toBe(300);
    expect(objectBounds(byId(doc, a))).toEqual({ x: 5, y: 6, width: 300, height: 300 });
  });

  it('deleteObjects removes present ids in one update and ignores missing ones', () => {
    const { doc, updates } = setup();
    const [a, b] = [at(doc, 0, 0), at(doc, 300, 0)];
    const base = updates();
    expect(deleteObjects(doc, [a, b, 'ghost'])).toBe(2);
    expect(updates() - base).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
