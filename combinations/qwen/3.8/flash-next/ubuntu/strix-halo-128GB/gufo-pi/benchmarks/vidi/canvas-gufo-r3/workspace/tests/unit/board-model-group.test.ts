import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  deleteObject,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  LOCAL_ORIGIN,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '@shared/config';
import { Rect } from '@shared/geometry';

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return count;
}

describe('board-model group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  describe('TC-05: moveObjects with 1 deleted id', () => {
    it('returns 2, emits 1 update event (missing id skipped)', () => {
      const id1 = createSticky(doc, { x: 100, y: 100 });
      const id2 = createSticky(doc, { x: 300, y: 300 });
      const id3 = createSticky(doc, { x: 500, y: 500 });
      // Delete id2
      deleteObject(doc, id2);

      const positions = new Map<string, { x: number; y: number }>([
        [id1, { x: 200, y: 200 }],
        [id2, { x: 400, y: 400 }],
        [id3, { x: 600, y: 600 }],
      ]);

      let result = 0;
      const updates = countUpdates(doc, () => {
        result = moveObjects(doc, positions);
      });
      expect(result).toBe(2);
      expect(updates).toBe(1);

      const snap = snapshot(doc);
      expect(snap.find((s) => s.id === id1)!.x).toBe(200);
      expect(snap.find((s) => s.id === id3)!.x).toBe(600);
      expect(snap.find((s) => s.id === id2)).toBeUndefined();
    });
  });

  describe('TC-06: bringObjectsToFront', () => {
    it('selected above unselected, relative z preserved', () => {
      const a = createSticky(doc, { x: 0, y: 0 });  // z=1
      const b = createSticky(doc, { x: 0, y: 0 });  // z=2
      const c = createSticky(doc, { x: 0, y: 0 });  // z=3
      const d = createSticky(doc, { x: 0, y: 0 });  // z=4 (unselected)
      const e = createSticky(doc, { x: 0, y: 0 });  // z=5 (unselected)

      bringObjectsToFront(doc, [a, b, c]);

      const snap = snapshot(doc);
      const za = snap.find((s) => s.id === a)!.z;
      const zb = snap.find((s) => s.id === b)!.z;
      const zc = snap.find((s) => s.id === c)!.z;
      const zd = snap.find((s) => s.id === d)!.z;
      const ze = snap.find((s) => s.id === e)!.z;

      // All selected above unselected
      expect(za).toBeGreaterThan(ze);
      expect(zb).toBeGreaterThan(ze);
      expect(zc).toBeGreaterThan(ze);
      // Relative order preserved
      expect(za).toBeLessThan(zb);
      expect(zb).toBeLessThan(zc);
    });
  });

  describe('TC-07: objectsInRect', () => {
    it('A fully inside, B partly, C outside → [A]', () => {
      // Create sticky notes at known positions
      // Sticky default is 200x200, stored at centre - STICKY_SIZE_WORLD/2
      const idA = createSticky(doc, { x: 200, y: 200 }); // top-left at (100, 100), bottom-right at (300, 300)
      const idB = createSticky(doc, { x: 350, y: 200 }); // top-left at (250, 100), bottom-right at (450, 300)
      const idC = createSticky(doc, { x: 600, y: 600 }); // top-left at (500, 500), bottom-right at (700, 700)

      // Selection rect that contains A fully but only part of B
      const rect: Rect = { x: 50, y: 50, width: 300, height: 300 };
      // A: 100..300 fully inside 50..350 ✓
      // B: 250..450 partially (extends past 350) ✗
      // C: 500..700 outside ✗

      const ids = objectsInRect(snapshot(doc), rect);
      expect(ids).toContain(idA);
      expect(ids).not.toContain(idB);
      expect(ids).not.toContain(idC);
    });
  });

  describe('TC-08: allObjectIds excludes unknown type', () => {
    it('unknown type not in allObjectIds', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      // Add unknown type directly to the Y.Map
      const objects = doc.getMap('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 9);
      objects.set('shape-1', shape);

      // snapshot() skips unknown types
      const ids = allObjectIds(snapshot(doc));
      expect(ids).toContain(id1);
      expect(ids).not.toContain('shape-1');
      expect(ids.length).toBe(1);
    });
  });

  describe('TC-09: non-finite positions → 0 applied, no transaction', () => {
    it('NaN position → 0, no transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map<string, { x: number; y: number }>([
        [id1, { x: NaN, y: 0 }],
      ]);
      let result = 0;
      const updates = countUpdates(doc, () => {
        result = moveObjects(doc, positions);
      });
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });

    it('Infinity position → 0, no transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map<string, { x: number; y: number }>([
        [id1, { x: 0, y: Infinity }],
      ]);
      let result = 0;
      const updates = countUpdates(doc, () => {
        result = moveObjects(doc, positions);
      });
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });

    it('empty id list → 0, no transaction', () => {
      const positions = new Map<string, { x: number; y: number }>();
      let result = 0;
      const updates = countUpdates(doc, () => {
        result = moveObjects(doc, positions);
      });
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });

  describe('TC-10: objectBounds fallback to STICKY_SIZE_WORLD', () => {
    it('objectBounds uses STICKY_SIZE_WORLD when width/height absent', () => {
      const id = createSticky(doc, { x: 200, y: 200 });
      const snap = snapshot(doc).find((s) => s.id === id)!;
      expect(snap.width).toBeUndefined();
      expect(snap.height).toBeUndefined();
      const bounds = objectBounds(snap);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    });

    it('resizeObjects writes both width and height fields', () => {
      const id = createSticky(doc, { x: 200, y: 200 });
      const snap = snapshot(doc).find((s) => s.id === id)!;
      expect(snap.width).toBeUndefined();

      const rects = new Map<string, Rect>([
        [id, { x: 100, y: 100, width: 300, height: 300 }],
      ]);
      resizeObjects(doc, rects);

      const after = snapshot(doc).find((s) => s.id === id)!;
      expect(after.width).toBe(300);
      expect(after.height).toBe(300);
      expect(after.x).toBe(100);
      expect(after.y).toBe(100);
    });
  });

  describe('deleteObjects', () => {
    it('removes multiple objects in one transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 0, y: 0 });
      const id3 = createSticky(doc, { x: 0, y: 0 });

      let result = 0;
      const updates = countUpdates(doc, () => {
        result = deleteObjects(doc, [id1, id2, id3]);
      });
      expect(result).toBe(3);
      expect(updates).toBe(1);
      expect(snapshot(doc).length).toBe(0);
    });

    it('skips missing ids', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      let result = 0;
      result = deleteObjects(doc, [id1, 'nonexistent']);
      expect(result).toBe(1);
    });

    it('empty list returns 0', () => {
      expect(deleteObjects(doc, [])).toBe(0);
    });
  });
});
