import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  deleteObject,
  objectSnapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Runs fn with the Y.Doc `update` event counted. */
function withUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: T;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

describe('sel.geometry_ops: group operations (unit)', () => {
  it('TC-05: moveObjects with one id deleted remotely → returns 2; exactly one update event', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 10, y: 10 }) as string;
    const c = createSticky(doc, { x: 20, y: 20 }) as string;
    expect(deleteObject(doc, b)).toBe(true);

    const { result, updates } = withUpdates(doc, () =>
      moveObjects(
        doc,
        new Map<string, { x: number; y: number }>([
          [a, { x: 100, y: 110 }],
          [b, { x: 200, y: 210 }], // deleted remotely: skipped
          [c, { x: 300, y: 310 }],
        ])
      )
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);

    const snap = objectSnapshot(doc);
    expect(snap.find((o) => o.id === a)!.x).toBe(100);
    expect(snap.find((o) => o.id === a)!.y).toBe(110);
    expect(snap.find((o) => o.id === c)!.x).toBe(300);
    expect(snap.find((o) => o.id === c)!.y).toBe(310);
    expect(snap.find((o) => o.id === b)).toBeUndefined();
  });

  it('TC-06: bringObjectsToFront raises the selection above unselected, relative z preserved', () => {
    const doc = makeDoc();
    const ids = [1, 2, 3, 4, 5].map((i) => createSticky(doc, { x: i, y: i }) as string);
    // ids[0]..ids[4] have z 1..5.
    const { result, updates } = withUpdates(doc, () => bringObjectsToFront(doc, [ids[0], ids[2], ids[4]]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const snap = objectSnapshot(doc);
    const z = (id: string) => snap.find((o) => o.id === id)!.z;
    // All selected are above every unselected object.
    for (const sel of [ids[0], ids[2], ids[4]]) {
      for (const un of [ids[1], ids[3]]) {
        expect(z(sel)).toBeGreaterThan(z(un));
      }
    }
    // Relative stacking order among the selected is preserved (z 1 < 3 < 5).
    expect(z(ids[0])).toBeLessThan(z(ids[2]));
    expect(z(ids[2])).toBeLessThan(z(ids[4]));
  });

  it('TC-07: objectsInRect selects only the fully-inside object (partly inside and outside excluded)', () => {
    const snap: ObjectSnapshot[] = [
      { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, width: 100, height: 100 }, // fully inside
      { id: 'b', type: 'sticky', x: 150, y: 0, z: 2, width: 100, height: 100 }, // sticks out of the right edge
      { id: 'c', type: 'sticky', x: 300, y: 0, z: 3, width: 100, height: 100 }, // outside
    ];
    const rect: Rect = { x: -50, y: -50, width: 200, height: 200 }; // covers (−50..150, −50..150)
    expect(objectsInRect(snap, rect)).toEqual(['a']);
  });

  it('TC-08: allObjectIds skips an unknown type', () => {
    const snap: ObjectSnapshot[] = [
      { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 },
      { id: 'b', type: 'mystery', x: 5, y: 5, z: 2 },
    ];
    expect(allObjectIds(snap)).toEqual(['a']);
  });

  it('TC-09: NaN / Infinity positions and empty id lists → 0 applied, no transaction', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const before = objectSnapshot(doc)[0];

    const { result: r1, updates: u1 } = withUpdates(doc, () => moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]])));
    expect(r1).toBe(0);
    expect(u1).toBe(0);

    const { result: r2, updates: u2 } = withUpdates(doc, () =>
      moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]]))
    );
    expect(r2).toBe(0);
    expect(u2).toBe(0);

    const { result: r3, updates: u3 } = withUpdates(doc, () => moveObjects(doc, new Map()));
    expect(r3).toBe(0);
    expect(u3).toBe(0);

    const { result: r4, updates: u4 } = withUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: Infinity, height: 100 }]]))
    );
    expect(r4).toBe(0);
    expect(u4).toBe(0);

    const { result: r5, updates: u5 } = withUpdates(doc, () => deleteObjects(doc, []));
    expect(r5).toBe(0);
    expect(u5).toBe(0);

    const { result: r6, updates: u6 } = withUpdates(doc, () => bringObjectsToFront(doc, []));
    expect(r6).toBe(0);
    expect(u6).toBe(0);

    // The doc is unchanged.
    expect(objectSnapshot(doc)[0]).toEqual(before);
  });

  it('TC-10: sticky without width/height reads STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;

    const obj = objectSnapshot(doc).find((o) => o.id === a)!;
    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();
    // createSticky centres on (0,0): top-left at −STICKY_SIZE_WORLD/2.
    expect(objectBounds(obj)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const { result, updates } = withUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, { x: -50, y: -50, width: 100, height: 100 }]]))
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);

    const after = objectSnapshot(doc).find((o) => o.id === a)!;
    expect(after.width).toBe(100);
    expect(after.height).toBe(100);
    expect(objectBounds(after)).toEqual({ x: -50, y: -50, width: 100, height: 100 });
  });

  it('deleteObjects removes the listed ids, skips missing ones, one transaction', () => {
    const doc = makeDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 10, y: 10 }) as string;
    createSticky(doc, { x: 20, y: 20 });

    const { result, updates } = withUpdates(doc, () => deleteObjects(doc, [a, 'ghost', b]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(objectSnapshot(doc)).toHaveLength(1);
  });
});
