import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  getObjectsMap,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => { n += 1; };
  doc.on('update', handler);
  return () => { doc.off('update', handler); return n; };
}

describe('board-model group — moveObjects (TC-05, TC-09)', () => {
  it('TC-05: moveObjects with 3 ids, 1 deleted remotely → returns 2, 1 update event', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });

    // Delete b externally
    deleteObjects(doc, [b]);

    const stop = updateCounter(doc);
    const positions = new Map([
      [a, { x: 10, y: 10 }],
      [b, { x: 20, y: 20 }],
      [c, { x: 30, y: 30 }],
    ]);
    const result = moveObjects(doc, positions);
    expect(result).toBe(2);
    expect(stop()).toBe(1);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(2);
    expect(snap.find((n) => n.id === a)?.x).toBe(10);
    expect(snap.find((n) => n.id === c)?.x).toBe(30);
  });

  it('TC-09: NaN positions → returns 0, no transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    const result = moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]));
    expect(result).toBe(0);
    expect(stop()).toBe(0);
  });

  it('TC-09: Infinity positions → returns 0, no transaction', () => {
    const doc = Y.Doc;
    const docInst = new doc();
    const a = createSticky(docInst, { x: 0, y: 0 });
    const stop = updateCounter(docInst);

    const result = moveObjects(docInst, new Map([[a, { x: Infinity, y: 0 }]]));
    expect(result).toBe(0);
    expect(stop()).toBe(0);
  });

  it('TC-09: empty id list → returns 0, no transaction', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(stop()).toBe(0);
  });

  it('moveObjects uses LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const origins: unknown[] = [];
    doc.on('update', (_u: unknown, origin: unknown) => origins.push(origin));
    moveObjects(doc, new Map([[a, { x: 5, y: 5 }]]));
    expect(origins).toContain(LOCAL_ORIGIN);
  });
});

describe('board-model group — resizeObjects (TC-10)', () => {
  it('TC-10: sticky without width/height reads STICKY_SIZE_WORLD in objectBounds', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc);
    const bounds = objectBounds(snap[0]);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
  });

  it('TC-10: first resizeObjects writes both width and height fields', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const objects = getObjectsMap(doc);
    const m = objects.get(id)!;
    expect(m.get('width')).toBeUndefined();
    expect(m.get('height')).toBeUndefined();

    resizeObjects(doc, new Map([[id, { x: 10, y: 20, width: 300, height: 300 }]]));

    expect(m.get('width')).toBe(300);
    expect(m.get('height')).toBe(300);
    expect(m.get('x')).toBe(10);
    expect(m.get('y')).toBe(20);
  });

  it('TC-09: non-finite rect → returns 0, no transaction', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    expect(resizeObjects(doc, new Map([[id, { x: NaN, y: 0, width: 100, height: 100 }]]))).toBe(0);
    expect(stop()).toBe(0);
  });

  it('empty list → 0', () => {
    const doc = new Y.Doc();
    expect(resizeObjects(doc, new Map())).toBe(0);
  });
});

describe('board-model group — bringObjectsToFront (TC-06)', () => {
  it('TC-06: 3 selected above 2 unselected, relative z preserved', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });   // z=1
    const u1 = createSticky(doc, { x: 10, y: 0 });  // z=2
    const b = createSticky(doc, { x: 20, y: 0 });   // z=3
    const u2 = createSticky(doc, { x: 30, y: 0 });  // z=4
    const c = createSticky(doc, { x: 40, y: 0 });   // z=5

    // Select a, b, c → they should be above u1 (z=2) and u2 (z=4)
    // max unselected z = 4, so a→5, b→6, c→7
    const result = bringObjectsToFront(doc, [a, b, c]);
    expect(result).toBe(3); // all changed (a was 1, b was 3, c was 5→new 7)

    const snap = snapshot(doc);
    const zMap = new Map(snap.map((n) => [n.id, n.z]));
    // Selected objects are all above unselected
    expect(zMap.get(a)!).toBeGreaterThan(zMap.get(u1)!);
    expect(zMap.get(a)!).toBeGreaterThan(zMap.get(u2)!);
    expect(zMap.get(b)!).toBeGreaterThan(zMap.get(u1)!);
    expect(zMap.get(b)!).toBeGreaterThan(zMap.get(u2)!);
    expect(zMap.get(c)!).toBeGreaterThan(zMap.get(u1)!);
    expect(zMap.get(c)!).toBeGreaterThan(zMap.get(u2)!);

    // Relative order of selected preserved: a < b < c
    expect(zMap.get(a)!).toBeLessThan(zMap.get(b)!);
    expect(zMap.get(b)!).toBeLessThan(zMap.get(c)!);
  });

  it('empty ids → 0', () => {
    const doc = new Y.Doc();
    expect(bringObjectsToFront(doc, [])).toBe(0);
  });
});

describe('board-model group — deleteObjects', () => {
  it('deletes multiple objects', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    createSticky(doc, { x: 200, y: 0 });

    const result = deleteObjects(doc, [a, b]);
    expect(result).toBe(2);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('skips missing ids', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const result = deleteObjects(doc, [a, 'nonexistent']);
    expect(result).toBe(1);
  });

  it('empty list → 0', () => {
    const doc = new Y.Doc();
    expect(deleteObjects(doc, [])).toBe(0);
  });
});

describe('board-model group — objectsInRect (TC-07)', () => {
  it('TC-07: A fully inside, B partly inside, C outside → [A]', () => {
    const doc = new Y.Doc();
    // Note A: top-left (10, 10), size 200 → fits inside (0, 0, 300, 300)
    const a = createSticky(doc, { x: 110, y: 110 }); // centered at 110, so top-left is 10,10
    // Note B: top-left (250, 250), size 200 → bottom-right at 450 > 300, so partly outside
    const b = createSticky(doc, { x: 350, y: 350 }); // top-left is 250,250
    // Note C: top-left (500, 500), size 200 → fully outside
    const c = createSticky(doc, { x: 600, y: 600 }); // top-left is 500,500

    const snap = snapshot(doc);
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const inside = objectsInRect(snap, rect);
    expect(inside).toEqual([a]);
    expect(inside).not.toContain(b);
    expect(inside).not.toContain(c);
  });
});

describe('board-model group — allObjectIds (TC-08)', () => {
  it('TC-08: allObjectIds returns ids from snapshot (unknown types are skipped by snapshot)', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });

    // Insert an unknown type directly
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 50);
      shape.set('y', 50);
      shape.set('z', 99);
      getObjectsMap(doc).set('shape-1', shape);
    });

    const snap = snapshot(doc);
    const ids = allObjectIds(snap);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain('shape-1');
    expect(ids).toHaveLength(2);
  });
});
