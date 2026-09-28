// Unit tests for the generic group operations (story 7, sel.geometry_ops):
// TC-05 to TC-10 against a real Y.Doc. Each successful mutation must emit
// exactly one update event (one LOCAL_ORIGIN transaction).

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  objectsSnapshot,
  resizeObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function spyUpdates(doc: Y.Doc): { count: number; off(): void } {
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

function byId(doc: Y.Doc): Map<string, ObjectSnapshot> {
  return new Map(objectsSnapshot(doc).map((o) => [o.id, o]));
}

describe('sel.geometry_ops: group operations (real Y.Doc)', () => {
  it('TC-05: moveObjects with one id deleted remotely → returns 2, exactly 1 update event', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const updates = spyUpdates(doc);

    const applied = moveObjects(
      doc,
      new Map([
        [a, { x: 5, y: 5 }],
        [b, { x: 15, y: 15 }],
        ['deleted-remotely', { x: 99, y: 99 }], // missing id skipped
      ]),
    );

    expect(applied).toBe(2);
    expect(updates.count).toBe(1);
    const by = byId(doc);
    expect([by.get(a)!.x, by.get(a)!.y]).toEqual([5, 5]);
    expect([by.get(b)!.x, by.get(b)!.y]).toEqual([15, 15]);
    updates.off();
  });

  it('TC-06: bringObjectsToFront: selected above unselected, relative z preserved', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1 (selected)
    const b = createSticky(doc, { x: 1, y: 1 }); // z 2 (unselected)
    const c = createSticky(doc, { x: 2, y: 2 }); // z 3 (selected)
    const d = createSticky(doc, { x: 3, y: 3 }); // z 4 (unselected)
    const e = createSticky(doc, { x: 4, y: 4 }); // z 5 (selected)
    const updates = spyUpdates(doc);

    const applied = bringObjectsToFront(doc, [a, c, e]);

    expect(applied).toBe(3);
    expect(updates.count).toBe(1);
    const by = byId(doc);
    // All selected z are above every unselected z.
    expect(by.get(a)!.z).toBe(5);
    expect(by.get(c)!.z).toBe(6);
    expect(by.get(e)!.z).toBe(7);
    expect(by.get(b)!.z).toBe(2);
    expect(by.get(d)!.z).toBe(4);
    // Relative stacking of the selection is unchanged (a below c below e).
    expect(by.get(a)!.z).toBeLessThan(by.get(c)!.z);
    expect(by.get(c)!.z).toBeLessThan(by.get(e)!.z);
    updates.off();
  });

  it('TC-07: objectsInRect: A fully inside, B half inside, C outside → [A] (B negative)', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 100, y: 100 }); // box (0,0)-(200,200): fully inside
    const b = createSticky(doc, { x: 300, y: 100 }); // box (200,0)-(400,200): half inside
    const c = createSticky(doc, { x: 600, y: 100 }); // box (500,0)-(700,200): outside

    const ids = objectsInRect(objectsSnapshot(doc), { x: 0, y: 0, width: 300, height: 300 });

    expect(ids).toEqual([a]);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
  });

  it('TC-08: allObjectIds excludes unknown types present in the doc', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 5, y: 5 });
    doc.getMap('objects').set(
      'future-1',
      new Y.Map([
        ['type', 'future-type'],
        ['x', 0],
        ['y', 0],
        ['z', 1],
        ['createdAt', 0],
      ]),
    );

    const ids = allObjectIds(objectsSnapshot(doc));

    expect(ids).toHaveLength(2);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain('future-1');
  });

  it('TC-09: non-finite values and empty id lists → 0 applied, no transaction (error path)', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const updates = spyUpdates(doc);

    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: Number.NaN, y: 0, width: 100, height: 100 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 100, height: Number.NaN }]]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['missing'])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);

    expect(updates.count).toBe(0);
    expect(objectsSnapshot(doc)).toHaveLength(1);
    const by = byId(doc);
    expect([by.get(a)!.x, by.get(a)!.y]).toEqual([-100, -100]); // untouched
    updates.off();
  });

  it('TC-10: implicit-size sticky reads STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = objectsSnapshot(doc)[0];

    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const updates = spyUpdates(doc);
    const applied = resizeObjects(
      doc,
      new Map([[a, { x: -STICKY_MIN_SIZE_WORLD, y: -STICKY_MIN_SIZE_WORLD, width: 150, height: 150 }]]),
    );
    expect(applied).toBe(1);
    expect(updates.count).toBe(1);

    const after = objectsSnapshot(doc)[0];
    expect(after.width).toBe(150);
    expect(after.height).toBe(150);
    expect(objectBounds(after)).toEqual({ x: -50, y: -50, width: 150, height: 150 });
    updates.off();
  });

  it('extra: group no-ops are 0 with no transaction; deleteObjects removes only present ids', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const by0 = byId(doc);
    const updates = spyUpdates(doc);

    // Exact no-op move.
    expect(moveObjects(doc, new Map([[a, { x: by0.get(a)!.x, y: by0.get(a)!.y }]]))).toBe(0);
    expect(updates.count).toBe(0);

    // Partial delete: one present, one missing.
    expect(deleteObjects(doc, [a, 'missing'])).toBe(1);
    expect(updates.count).toBe(1);
    expect(objectsSnapshot(doc)).toHaveLength(1);
    expect(objectsSnapshot(doc)[0].id).toBe(b);
    updates.off();
  });
});
