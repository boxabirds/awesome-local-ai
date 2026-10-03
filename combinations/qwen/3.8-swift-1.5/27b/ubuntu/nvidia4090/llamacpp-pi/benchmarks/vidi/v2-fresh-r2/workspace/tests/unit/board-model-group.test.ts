/**
 * Unit tests for the story 7 generic group operations in board-model
 * (sel.geometry_ops). Uses a real Y.Doc — no mocks.
 * TC-05 to TC-10.
 *
 * Importing the client registry registers the `sticky` type so that
 * `allObjectIds` / `objectsInRect` treat stickies as registered.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  objects,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
} from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import '../../src/client/objects/registry';

/** Count `update` events on a doc for the duration of a callback. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

/** Insert an object of an arbitrary (unregistered) type directly. */
function insertUnknown(doc: Y.Doc, id: string): void {
  const obj = new Y.Map();
  // 'freehand' is not a registered type (story 10 registers shape/connector).
  obj.set('type', 'freehand');
  obj.set('x', 0);
  obj.set('y', 0);
  obj.set('z', 1);
  obj.set('createdAt', 1);
  doc.transact(() => {
    doc.getMap('objects').set(id, obj);
  });
}

describe('sel.geometry_ops: group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-05: moveObjects with 3 ids, 1 deleted remotely → returns 2;
  // exactly one update event (missing id skipped).
  it('TC-05: moveObjects skips missing ids and returns the count applied', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });
    deleteObjects(doc, [b]); // "deleted remotely"

    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 10 }],
      [b, { x: 110, y: 10 }],
      [c, { x: 210, y: 10 }],
    ]);

    const updates = countUpdates(doc, () => {
      expect(moveObjects(doc, positions)).toBe(2);
    });
    expect(updates).toBe(1);

    const snap = objects(doc);
    expect(snap.find((o) => o.id === a)?.x).toBe(10);
    expect(snap.find((o) => o.id === c)?.x).toBe(210);
  });

  // TC-06: bringObjectsToFront: 3 selected overlapping over 2 unselected →
  // all selected z above unselected, relative order kept.
  it('TC-06: bringObjectsToFront raises the group above unselected, keeping relative order', () => {
    // Unselected notes get the top z's by being created first and re-stacked.
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 10, y: 10 });
    const s3 = createSticky(doc, { x: 20, y: 20 });
    const u1 = createSticky(doc, { x: 400, y: 0 });
    const u2 = createSticky(doc, { x: 420, y: 20 });
    // Unselected are now on top (z 4, 5); selected are z 1, 2, 3.
    expect(countUpdates(doc, () => {
      expect(bringObjectsToFront(doc, [s1, s2, s3])).toBe(3);
    })).toBe(1);

    const snap = new Map(objects(doc).map((o) => [o.id, o.z]));
    // Selected are above both unselected…
    expect(snap.get(s1)!).toBeGreaterThan(snap.get(u1)!);
    expect(snap.get(s2)!).toBeGreaterThan(snap.get(u2)!);
    expect(snap.get(s3)!).toBeGreaterThan(snap.get(u2)!);
    // …and their relative order is preserved (s1 below s2 below s3).
    expect(snap.get(s1)!).toBeLessThan(snap.get(s2)!);
    expect(snap.get(s2)!).toBeLessThan(snap.get(s3)!);
    // Unselected are untouched.
    expect(snap.get(u1)!).toBe(4);
    expect(snap.get(u2)!).toBe(5);
  });

  // TC-07: objectsInRect — A fully inside, B partly, C outside → [A].
  it('TC-07: objectsInRect returns only fully-contained objects', () => {
    const a = createSticky(doc, { x: 150, y: 150 }); // 100×… sticky: [50,50]-[250,250]
    const b = createSticky(doc, { x: 400, y: 150 }); // [300,50]-[500,250]: partly in
    const c = createSticky(doc, { x: 800, y: 150 }); // outside
    const rect = { x: 0, y: 0, width: 400, height: 400 };

    expect(objectsInRect(objects(doc), rect)).toEqual([a]);
  });

  // TC-08: allObjectIds skips unknown types.
  it('TC-08: allObjectIds excludes unregistered types', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    insertUnknown(doc, 'unknown-1');

    const snap = objects(doc);
    expect(snap).toHaveLength(3); // objects() includes the unknown entry
    expect(allObjectIds(snap).sort()).toEqual([a, b].sort());
  });

  // TC-09: NaN/Infinity positions and empty id list → 0, no transaction.
  it('TC-09: non-finite positions and empty lists are rejected without a transaction', () => {
    // createSticky centres on the point: {100,100} → top-left {0,0}
    const a = createSticky(doc, { x: 100, y: 100 });

    expect(countUpdates(doc, () => {
      expect(moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]))).toBe(0);
    })).toBe(0);
    expect(countUpdates(doc, () => {
      expect(moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]]))).toBe(0);
    })).toBe(0);
    expect(countUpdates(doc, () => {
      expect(moveObjects(doc, new Map())).toBe(0);
    })).toBe(0);
    expect(countUpdates(doc, () => {
      expect(resizeObjects(doc, new Map([[a, { x: NaN, y: 0, width: 100, height: 100 }]]))).toBe(0);
    })).toBe(0);
    expect(countUpdates(doc, () => {
      expect(resizeObjects(doc, new Map())).toBe(0);
    })).toBe(0);
    expect(countUpdates(doc, () => {
      expect(bringObjectsToFront(doc, [])).toBe(0);
    })).toBe(0);
    expect(countUpdates(doc, () => {
      expect(deleteObjects(doc, [])).toBe(0);
    })).toBe(0);

    // The object is untouched.
    const snap = objects(doc)[0];
    expect(snap.x).toBe(0);
    expect(snap.y).toBe(0);
  });

  // TC-10: sticky without width/height → objectBounds uses STICKY_SIZE_WORLD;
  // the first resizeObjects writes both fields.
  it('TC-10: implicit-size sticky bounds fall back to STICKY_SIZE_WORLD; resize makes it explicit', () => {
    // createSticky centres on the point: {105,106} → top-left {5,6}
    const a = createSticky(doc, { x: 105, y: 106 });
    const snap = objects(doc)[0] as ObjectSnapshot;
    expect(snap.width).toBeUndefined();
    expect(snap.height).toBeUndefined();
    expect(objectBounds(snap)).toEqual({ x: 5, y: 6, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const applied = resizeObjects(doc, new Map([[a, { x: 7, y: 8, width: 120, height: 90 }]]));
    expect(applied).toBe(1);

    const after = objects(doc)[0];
    expect(after.width).toBe(120);
    expect(after.height).toBe(90);
    expect(objectBounds(after)).toEqual({ x: 7, y: 8, width: 120, height: 90 });
  });
});
