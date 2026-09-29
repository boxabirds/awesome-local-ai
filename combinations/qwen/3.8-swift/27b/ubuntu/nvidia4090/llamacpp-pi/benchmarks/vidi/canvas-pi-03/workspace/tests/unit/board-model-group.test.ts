/**
 * Story 7, sel.geometry_ops — generic group operations on a real Y.Doc
 * (TC-05 to TC-10).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  objectBounds,
  snapshot,
  LOCAL_ORIGIN,
} from 'src/shared/board-model';
import { STICKY_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from 'src/shared/config';

/** Counts `update` events emitted on the doc. */
function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board-model group operations', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = newDoc();
  });

  it('TC-05: moveObjects with 3 ids, one deleted remotely → returns 2; exactly 1 update event', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    const b = createSticky(doc, { x: 100, y: 0 }, 'orange', 'b')!;
    const c = createSticky(doc, { x: 200, y: 0 }, 'green', 'c')!;
    deleteObjects(doc, [b]); // someone else removed b mid-gesture

    const updates = countUpdates(doc);
    const applied = moveObjects(doc, new Map([[a, { x: 10, y: 20 }], [b, { x: 110, y: 20 }], [c, { x: 210, y: 20 }]]));
    expect(applied).toBe(2); // missing id skipped
    expect(updates()).toBe(1); // one LOCAL_ORIGIN transaction

    const notes = snapshot(doc);
    expect(notes.find((n) => n.id === a)).toMatchObject({ x: 10, y: 20 });
    expect(notes.find((n) => n.id === c)).toMatchObject({ x: 210, y: 20 });
    expect(notes.find((n) => n.id === b)).toBeUndefined();
  });

  it('TC-06: bringObjectsToFront: 3 overlapping selected over 2 unselected → all selected above unselected, relative z preserved', () => {
    // Unselected z 1 and 5; selected z 2, 3, 4 (all overlapping in space).
    const u1 = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'u1')!;
    const s1 = createSticky(doc, { x: 0, y: 0 }, 'orange', 's1')!;
    const s2 = createSticky(doc, { x: 0, y: 0 }, 'green', 's2')!;
    const s3 = createSticky(doc, { x: 0, y: 0 }, 'blue', 's3')!;
    const u2 = createSticky(doc, { x: 0, y: 0 }, 'pink', 'u2')!;
    expect(u1 && s1 && s2 && s3 && u2).toBeTruthy();

    const updates = countUpdates(doc);
    const applied = bringObjectsToFront(doc, [s1, s2, s3]);
    expect(applied).toBe(3);
    expect(updates()).toBe(1);

    const z = (id: string) => snapshot(doc).find((n) => n.id === id)!.z;
    // Selected strictly above every unselected note…
    expect(z(s1)).toBeGreaterThan(z(u1));
    expect(z(s2)).toBeGreaterThan(z(u1));
    expect(z(s3)).toBeGreaterThan(z(u1));
    expect(z(s1)).toBeGreaterThan(z(u2));
    expect(z(s2)).toBeGreaterThan(z(u2));
    expect(z(s3)).toBeGreaterThan(z(u2));
    // …and their relative stacking order is preserved (s1 < s2 < s3).
    expect(z(s1)).toBeLessThan(z(s2));
    expect(z(s2)).toBeLessThan(z(s3));

    // Re-applying with the selection already on top is a no-op (no update).
    const updates2 = countUpdates(doc);
    expect(bringObjectsToFront(doc, [s1, s2, s3])).toBe(0);
    expect(updates2()).toBe(0);
  });

  it('TC-07: objectsInRect: A fully inside, B partly, C outside → [A] (partly-inside must not be selected)', () => {
    const a = createSticky(doc, { x: 100, y: 100 }, 'yellow', 'a')!; // [0,0]–[200,200]
    const b = createSticky(doc, { x: 300, y: 100 }, 'orange', 'b')!; // [200,0]–[400,200]
    createSticky(doc, { x: 700, y: 100 }, 'green', 'c'); // [600,0]–[800,200] — outside
    const rect = { x: -10, y: -10, width: 320, height: 220 }; // [−10,−10]–[310,210]

    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    // B is enclosed in x only → not fully inside.
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 500, height: 200 })).toEqual([a, b]);
    // Empty board → empty list.
    expect(objectsInRect([], rect)).toEqual([]);
  });

  it('TC-08: allObjectIds includes registered types and excludes unknown types', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const shape: Y.Map<unknown> = new Y.Map();
      shape.set('type', 'shape'); // unregistered type (a story 9–12 kind)
      shape.set('x', 5);
      shape.set('y', 5);
      objects.set('shape-1', shape);
    });

    expect(allObjectIds(snapshot(doc))).toEqual([a]);
    expect(allObjectIds([])).toEqual([]);
  });

  it('TC-09: NaN/Infinity positions and an empty id list → 0 applied, no transaction (error path)', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    const b = createSticky(doc, { x: 100, y: 0 }, 'orange', 'b')!;

    const updates = countUpdates(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 0 }], [b, { x: 1, y: 2 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 1, y: Infinity }]]))).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 200 }]])),
    ).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['nope'])).toBe(0);
    expect(updates()).toBe(0);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === a)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
  });

  it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD; first resizeObjects writes both fields', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    const before = snapshot(doc).find((n) => n.id === a)!;
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({ x: -100, y: -100, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const updates = countUpdates(doc);
    const applied = resizeObjects(doc, new Map([[a, { x: 10, y: 20, width: 300, height: 300 }]]));
    expect(applied).toBe(1);
    expect(updates()).toBe(1);

    const after = snapshot(doc).find((n) => n.id === a)!;
    expect(after).toMatchObject({ x: 10, y: 20, width: 300, height: 300 });
    expect(objectBounds(after)).toEqual({ x: 10, y: 20, width: 300, height: 300 });
    // The raw Y.Map now carries explicit size fields.
    const raw = doc.getMap('objects').get('a') as Y.Map<unknown>;
    expect(raw.get('width')).toBe(300);
    expect(raw.get('height')).toBe(300);
  });

  it('group operations use LOCAL_ORIGIN as the transaction origin', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    const b = createSticky(doc, { x: 100, y: 0 }, 'orange', 'b')!;
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));

    moveObjects(doc, new Map([[a, { x: 5, y: 5 }]]));
    resizeObjects(doc, new Map([[a, { x: 5, y: 5, width: 150, height: 150 }]]));
    bringObjectsToFront(doc, [a]);
    deleteObjects(doc, [a, b]);

    expect(origins).toHaveLength(4);
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });

  it('MAX_OBJECT_SIZE_WORLD boundary: resizeObjects accepts exactly the max', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'a')!;
    const ok = resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: MAX_OBJECT_SIZE_WORLD, height: MAX_OBJECT_SIZE_WORLD }]]));
    expect(ok).toBe(1);
    const raw = doc.getMap('objects').get('a') as Y.Map<unknown>;
    expect(raw.get('width')).toBe(MAX_OBJECT_SIZE_WORLD);
  });
});
