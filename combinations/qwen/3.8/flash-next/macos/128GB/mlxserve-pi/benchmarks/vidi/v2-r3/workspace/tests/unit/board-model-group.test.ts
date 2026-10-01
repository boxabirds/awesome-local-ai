import { describe, expect, it, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  moveObjects,
  resizeObjects,
  deleteObjects,
  bringObjectsToFront,
  objectsInRect,
  allObjectIds,
  objectBounds,
  createSticky,
  snapshot,
  getObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

describe('board-model group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-05: moveObjects with one deleted id → returns 2, exactly 1 update event
  describe('TC-05 moveObjects with missing id', () => {
    it('skips missing ids and returns count of moved', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 300, y: 0 });
      const id3 = createSticky(doc, { x: 600, y: 0 });

      // Delete id2 before moving
      deleteObjects(doc, [id2]);

      let updateCount = 0;
      doc.on('update', () => { updateCount++; });

      const positions = new Map([
        [id1, { x: 10, y: 10 }],
        [id2, { x: 310, y: 10 }],  // this one is gone
        [id3, { x: 610, y: 10 }],
      ]);

      const count = moveObjects(doc, positions);
      expect(count).toBe(2);
      expect(updateCount).toBe(1); // exactly one transaction = one update event
    });
  });

  // TC-06: bringObjectsToFront 3 selected over 2 unselected → all selected z above unselected, relative order kept
  describe('TC-06 bringObjectsToFront', () => {
    it('selected objects get z above unselected, relative order preserved', () => {
      // Create 5 objects with specific z values
      const a = createSticky(doc, { x: 0, y: 0 });   // z=1
      const b = createSticky(doc, { x: 0, y: 0 });   // z=2
      const c = createSticky(doc, { x: 0, y: 0 });   // z=3
      const d = createSticky(doc, { x: 0, y: 0 });   // z=4
      const e = createSticky(doc, { x: 0, y: 0 });   // z=5

      // Select a, c, e (z=1,3,5); unselected b, d (z=2,4)
      // Max unselected z = 4 (object d)
      // Selected should get z = 5,6,7 in their current relative order (a z=1 < c z=3 < e z=5)
      bringObjectsToFront(doc, [a, c, e]);

      const snap = snapshot(doc);
      const zA = snap.find(s => s.id === a)!.z;
      const zB = snap.find(s => s.id === b)!.z;
      const zC = snap.find(s => s.id === c)!.z;
      const zD = snap.find(s => s.id === d)!.z;
      const zE = snap.find(s => s.id === e)!.z;

      // All selected should be above all unselected
      expect(Math.min(zA, zC, zE)).toBeGreaterThan(Math.max(zB, zD));
      // Relative order preserved
      expect(zA).toBeLessThan(zC);
      expect(zC).toBeLessThan(zE);
    });
  });

  // TC-07: objectsInRect - A fully inside, B partly, C outside → [A]
  describe('TC-07 objectsInRect', () => {
    it('only returns objects fully inside the rect', () => {
      // Create objects at known positions (createSticky centres, so top-left is at-100 for 200-size)
      const idA = createSticky(doc, { x: 50 + STICKY_SIZE_WORLD / 2, y: 50 + STICKY_SIZE_WORLD / 2 });   // top-left at (50,50)
      const idB = createSticky(doc, { x: 150 + STICKY_SIZE_WORLD / 2, y: 50 + STICKY_SIZE_WORLD / 2 });   // top-left at (150,50)
      const idC = createSticky(doc, { x: 500 + STICKY_SIZE_WORLD / 2, y: 500 + STICKY_SIZE_WORLD / 2 }); // top-left at (500,500)

      const snap = snapshot(doc);
      // Marquee rect from (0,0) to (200,200) — A at (50,50) size 200 → right=250 bottom=250, NOT inside!
      // Let me recalculate: A's top-left = (50,50), bottom-right = (250,250)
      // For A to be fully inside, need outer to contain (50,50) to (250,250)
      // Let rect = (40,40,220,220) → contains A(50,50→250,250): x>=40,y>=40,250<=260,250<=260 ✓
      // B at (150,50→350,250): 150>=40, 50>=40, 350<=260? NO → partly inside
      // C at (500,500→700,700): NOT inside
      const rect: Rect = { x: 40, y: 40, width: 220, height: 220 };
      const result = objectsInRect(snap, rect);
      expect(result).toContain(idA);
      expect(result).not.toContain(idB);
      expect(result).not.toContain(idC);
      expect(result).toEqual([idA]);
    });
  });

  // TC-08: allObjectIds skips unknown type
  describe('TC-08 allObjectIds', () => {
    it('excludes objects with unknown type', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 300, y: 0 });
      // Insert an unknown type directly
      const objects = getObjects(doc);
      const map = new Y.Map<unknown>();
      map.set('type', 'unknown_shape');
      map.set('x', 500);
      map.set('y', 0);
      map.set('z', 10);
      objects.set('unknown-id', map);

      const snap = snapshot(doc);
      const ids = allObjectIds(snap);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).not.toContain('unknown-id');
    });
  });

  // TC-09: NaN/Infinity → 0, no transaction
  describe('TC-09 moveObjects rejects non-finite', () => {
    it('NaN position returns 0 and no transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      let updateCount = 0;
      doc.on('update', () => { updateCount++; });

      const positions = new Map([[id1, { x: NaN, y: 0 }]]);
      const count = moveObjects(doc, positions);
      expect(count).toBe(0);
      expect(updateCount).toBe(0);
    });

    it('Infinity position returns 0 and no transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      let updateCount = 0;
      doc.on('update', () => { updateCount++; });

      const positions = new Map([[id1, { x: Infinity, y: 0 }]]);
      const count = moveObjects(doc, positions);
      expect(count).toBe(0);
      expect(updateCount).toBe(0);
    });

    it('empty id list returns 0', () => {
      let updateCount = 0;
      doc.on('update', () => { updateCount++; });
      const count = moveObjects(doc, new Map());
      expect(count).toBe(0);
      expect(updateCount).toBe(0);
    });
  });

  // TC-10: sticky without width/height: objectBounds uses STICKY_SIZE_WORLD; first resizeObjects writes both fields
  describe('TC-10 objectBounds and resizeObjects width/height', () => {
    it('objectBounds uses STICKY_SIZE_WORLD when no explicit size', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const snap = snapshot(doc);
      const obj = snap.find(s => s.id === id)!;
      const bounds = objectBounds(obj);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    });

    it('first resizeObjects writes both width and height fields', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      // Before resize, no width/height in snapshot
      let snap = snapshot(doc);
      const obj = snap.find(s => s.id === id)!;
      expect(obj.width).toBeUndefined();
      expect(obj.height).toBeUndefined();

      // Resize
      resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 300, height: 300 }]]));

      snap = snapshot(doc);
      const obj2 = snap.find(s => s.id === id)!;
      expect(obj2.width).toBe(300);
      expect(obj2.height).toBe(300);
      const bounds2 = objectBounds(obj2);
      expect(bounds2.width).toBe(300);
      expect(bounds2.height).toBe(300);
    });
  });

  // Additional: deleteObjects
  describe('deleteObjects', () => {
    it('returns count of deleted, skips missing', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 0, y: 0 });
      const count = deleteObjects(doc, [id1, id2, 'nonexistent']);
      expect(count).toBe(2);
      expect(snapshot(doc).length).toBe(0);
    });

    it('empty list returns 0', () => {
      const count = deleteObjects(doc, []);
      expect(count).toBe(0);
    });
  });

  // Additional: resizeObjects validation
  describe('resizeObjects validation', () => {
    it('rejects non-finite rects', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      let updateCount = 0;
      doc.on('update', () => { updateCount++; });
      const count = resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: NaN, height: 100 }]]));
      expect(count).toBe(0);
      expect(updateCount).toBe(0);
    });
  });
});
