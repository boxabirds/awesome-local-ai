import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

interface UpdateCounter {
  count: number;
  off(): void;
}

function countUpdates(doc: Y.Doc): UpdateCounter {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    get count() { return count; },
    off: () => doc.off('update', handler),
  };
}

describe('board-model group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05
  describe('moveObjects', () => {
    it('TC-05: 3 ids with 1 deleted → returns 2; exactly 1 update event', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const id3 = createSticky(doc, { x: 200, y: 0 });

      // Delete one
      deleteObjects(doc, [id2]);
      expect(snapshot(doc)).toHaveLength(2);

      const updates = countUpdates(doc);
      const positions = new Map<string, Point>([
        [id1, { x: 10, y: 20 }],
        [id2, { x: 30, y: 40 }], // deleted - should be skipped
        [id3, { x: 50, y: 60 }],
      ]);
      const result = moveObjects(doc, positions);
      updates.off();

      expect(result).toBe(2);
      expect(updates.count).toBe(1);

      const snaps = snapshot(doc);
      expect(snaps.find((s) => s.id === id1)!.x).toBe(10);
      expect(snaps.find((s) => s.id === id1)!.y).toBe(20);
      expect(snaps.find((s) => s.id === id3)!.x).toBe(50);
      expect(snaps.find((s) => s.id === id3)!.y).toBe(60);
    });
  });

  // TC-06
  describe('bringObjectsToFront', () => {
    it('TC-06: 3 overlapping selected over 2 unselected → all selected z above unselected, relative order kept', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });     // z=1
      const id2 = createSticky(doc, { x: 0, y: 0 });     // z=2
      const id3 = createSticky(doc, { x: 0, y: 0 });     // z=3
      const id4 = createSticky(doc, { x: 500, y: 500 }); // z=4
      const id5 = createSticky(doc, { x: 600, y: 500 }); // z=5

      // Select id1, id2, id3 (the lower z ones)
      bringObjectsToFront(doc, [id1, id2, id3]);

      const snaps = snapshot(doc);
      const z1 = snaps.find((s) => s.id === id1)!.z;
      const z2 = snaps.find((s) => s.id === id2)!.z;
      const z3 = snaps.find((s) => s.id === id3)!.z;
      const z4 = snaps.find((s) => s.id === id4)!.z;
      const z5 = snaps.find((s) => s.id === id5)!.z;

      // All selected should be above unselected
      expect(z1).toBeGreaterThan(z4);
      expect(z1).toBeGreaterThan(z5);
      expect(z2).toBeGreaterThan(z4);
      expect(z2).toBeGreaterThan(z5);
      expect(z3).toBeGreaterThan(z4);
      expect(z3).toBeGreaterThan(z5);

      // Relative order preserved: id1 < id2 < id3
      expect(z1).toBeLessThan(z2);
      expect(z2).toBeLessThan(z3);
    });
  });

  // TC-07
  describe('objectsInRect', () => {
    it('TC-07: A fully inside, B partly, C outside → [A]', () => {
      const idA = createSticky(doc, { x: 150, y: 150 }); // at (50,50) size 200 → bounds (50,50,200,200)
      createSticky(doc, { x: 350, y: 150 }); // at (250,50) → bounds (250,50,200,200) - partly in
      createSticky(doc, { x: 600, y: 600 }); // at (500,500) → completely outside

      // Marquee rect: (0, 0, 300, 300)
      // A: (50,50) to (250,250) → fully inside ✓
      // B: (250,50) to (450,250) → partly inside (right edge at 450 > 300) ✗
      // C: (500,500) to (700,700) → completely outside ✗
      const rect: Rect = { x: 0, y: 0, width: 300, height: 300 };
      const snaps = snapshot(doc);
      const result = objectsInRect(snaps, rect);

      expect(result).toEqual([idA]);
    });
  });

  // TC-08
  describe('allObjectIds', () => {
    it('TC-08: skips an unknown type', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });

      // Add an unknown type
      const objects = doc.getMap('objects');
      const fakeObj = new Y.Map<unknown>();
      fakeObj.set('type', 'mystery_shape');
      fakeObj.set('x', 0);
      fakeObj.set('y', 0);
      fakeObj.set('z', 99);
      fakeObj.set('createdAt', 0);
      doc.transact(() => {
        objects.set('fake-123', fakeObj);
      }, LOCAL_ORIGIN);

      const snaps = snapshot(doc);
      // Unknown types are filtered out of snapshot
      expect(snaps).toHaveLength(1);
      expect(allObjectIds(snaps)).toEqual([id1]);
    });
  });

  // TC-09
  describe('error paths', () => {
    it('TC-09: NaN/Infinity positions → 0, no transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });

      const updates = countUpdates(doc);

      // NaN
      const positions1 = new Map<string, Point>([[id1, { x: NaN, y: 0 }]]);
      expect(moveObjects(doc, positions1)).toBe(0);

      // Infinity
      const positions2 = new Map<string, Point>([[id1, { x: 0, y: Infinity }]]);
      expect(moveObjects(doc, positions2)).toBe(0);

      // Empty map
      expect(moveObjects(doc, new Map())).toBe(0);

      updates.off();
      expect(updates.count).toBe(0);
    });

    it('TC-09: NaN/Infinity rects → 0, no transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });

      const updates = countUpdates(doc);

      const rects1 = new Map<string, Rect>([[id1, { x: NaN, y: 0, width: 100, height: 100 }]]);
      expect(resizeObjects(doc, rects1)).toBe(0);

      const rects2 = new Map<string, Rect>([[id1, { x: 0, y: 0, width: Infinity, height: 100 }]]);
      expect(resizeObjects(doc, rects2)).toBe(0);

      expect(resizeObjects(doc, new Map())).toBe(0);

      updates.off();
      expect(updates.count).toBe(0);
    });
  });

  // TC-10
  describe('objectBounds and resize with implicit size', () => {
    it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD; first resize writes both fields', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const snaps = snapshot(doc);
      const obj = snaps.find((s) => s.id === id)!;

      // No explicit width/height
      expect(obj.width).toBeUndefined();
      expect(obj.height).toBeUndefined();

      // objectBounds uses STICKY_SIZE_WORLD
      const bounds = objectBounds(obj);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);

      // Resize writes both fields
      const newRect: Rect = { x: 50, y: 50, width: 300, height: 300 };
      resizeObjects(doc, new Map([[id, newRect]]));

      const snaps2 = snapshot(doc);
      const obj2 = snaps2.find((s) => s.id === id)!;
      expect(obj2.width).toBe(300);
      expect(obj2.height).toBe(300);
      expect(obj2.x).toBe(50);
      expect(obj2.y).toBe(50);
    });
  });

  describe('deleteObjects', () => {
    it('deletes multiple objects', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const id3 = createSticky(doc, { x: 200, y: 0 });

      const count = deleteObjects(doc, [id1, id2]);
      expect(count).toBe(2);
      expect(snapshot(doc)).toHaveLength(1);
      expect(snapshot(doc)[0].id).toBe(id3);
    });

    it('empty list → 0, no transaction', () => {
      createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdates(doc);
      expect(deleteObjects(doc, [])).toBe(0);
      updates.off();
      expect(updates.count).toBe(0);
    });
  });
});
