import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds, bringObjectsToFront, createSticky, deleteObjects, initDoc, moveObjects, objectBounds,
  objectsInRect, resizeObjects, snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const counter = { updates: 0 };
  doc.on('update', () => { counter.updates += 1; });
  const make = (x: number, y: number) => createSticky(doc, { x: x + 100, y: y + 100 }) as string;
  return { doc, counter, make };
}
const byId = (doc: Y.Doc, id: string) => snapshot(doc).find((n) => n.id === id)!;

describe('group operations', () => {
  it('TC-05 moveObjects skips a deleted id, returns 2, one update event', () => {
    const { doc, counter, make } = setup();
    const [a, b, c] = [make(0, 0), make(300, 0), make(600, 0)];
    deleteObjects(doc, [b]);
    counter.updates = 0;
    const n = moveObjects(doc, new Map([[a, { x: 5, y: 6 }], [b, { x: 1, y: 1 }], [c, { x: 7, y: 8 }]]));
    expect(n).toBe(2);
    expect(counter.updates).toBe(1);
    expect(byId(doc, a)).toMatchObject({ x: 5, y: 6 });
    expect(byId(doc, c)).toMatchObject({ x: 7, y: 8 });
  });

  it('TC-06 bringObjectsToFront puts 3 overlapping notes above unselected ones, keeping their order', () => {
    const { doc, make } = setup();
    const [s1, u1, s2, u2, s3] = [make(0, 0), make(10, 10), make(20, 20), make(30, 30), make(40, 40)];
    expect(bringObjectsToFront(doc, [s3, s1, s2])).toBe(3);
    const z = (id: string) => byId(doc, id).z;
    expect(Math.min(z(s1), z(s2), z(s3))).toBeGreaterThan(Math.max(z(u1), z(u2)));
    expect(z(s1)).toBeLessThan(z(s2));
    expect(z(s2)).toBeLessThan(z(s3));
    // already on top: nothing to write
    expect(bringObjectsToFront(doc, [s1, s2, s3])).toBe(0);
  });

  it('TC-07 objectsInRect: fully inside, partly inside, outside -> only the first', () => {
    const { doc, make } = setup();
    const a = make(100, 100);
    make(400, 100); // half inside: x 400..600 against a rect ending at 500
    make(2000, 2000);
    const rect = { x: 50, y: 50, width: 450, height: 400 };
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    // touching the edge from outside does not count either
    expect(objectsInRect(snapshot(doc), { x: 300, y: 100, width: 100, height: 100 })).toEqual([]);
  });

  it('TC-08 allObjectIds excludes an unknown type', () => {
    const { doc, make } = setup();
    const a = make(0, 0);
    const m = new Y.Map<unknown>();
    doc.getMap('objects').set('mystery', m);
    m.set('type', 'hologram');
    expect(allObjectIds(snapshot(doc))).toEqual([a]);
    expect(allObjectIds([{ ...byId(doc, a), id: 'x', type: 'hologram' } as never])).toEqual([]);
  });

  it('TC-09 non-finite values and empty id lists write nothing', () => {
    const { doc, counter, make } = setup();
    const a = make(0, 0);
    counter.updates = 0;
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 1 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 1, y: Infinity }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 5 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 5 }]]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(counter.updates).toBe(0);
  });

  it('TC-10 a note without width/height reads as 200 and its first resize writes both', () => {
    const { doc } = setup();
    const m = new Y.Map<unknown>();
    doc.getMap('objects').set('old', m);
    m.set('type', 'sticky');
    m.set('x', 10);
    m.set('y', 20);
    m.set('z', 1);
    const [n] = snapshot(doc);
    expect(objectBounds(n)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(m.get('width')).toBeUndefined();
    expect(resizeObjects(doc, new Map([['old', { x: 0, y: 0, width: 300, height: 300 }]]))).toBe(1);
    expect(m.get('width')).toBe(300);
    expect(m.get('height')).toBe(300);
  });

  it('new notes store their size', () => {
    const { doc, make } = setup();
    const a = make(0, 0);
    expect((doc.getMap('objects').get(a) as Y.Map<unknown>).get('width')).toBe(STICKY_SIZE_WORLD);
  });

  it('deleteObjects removes present ids in one transaction and counts them', () => {
    const { doc, counter, make } = setup();
    const [a, b] = [make(0, 0), make(300, 0)];
    counter.updates = 0;
    expect(deleteObjects(doc, [a, b, 'ghost'])).toBe(2);
    expect(counter.updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
