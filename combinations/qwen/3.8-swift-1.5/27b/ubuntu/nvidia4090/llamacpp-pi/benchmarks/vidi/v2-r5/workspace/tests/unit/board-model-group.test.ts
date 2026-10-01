// tests/unit/board-model-group.test.ts
// TC-05 to TC-10: board-model group operations

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
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function countUpdatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return count;
}

describe('sel.geometry_ops - board-model group ops (unit)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-05: moveObjects 3 ids with 1 deleted → returns 2; exactly 1 update event
  describe('TC-05: moveObjects with missing id', () => {
    it('returns 2 when 1 of 3 ids is deleted; exactly 1 update event', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const id3 = createSticky(doc, { x: 200, y: 0 });

      // Delete id2
      deleteObjects(doc, [id2]);

      const positions = new Map([
        [id1, { x: 10, y: 20 }],
        [id2, { x: 110, y: 20 }], // deleted
        [id3, { x: 210, y: 20 }],
      ]);

      const updates = countUpdatesDuring(doc, () => {
        const result = moveObjects(doc, positions);
        expect(result).toBe(2);
      });
      expect(updates).toBe(1);

      // Verify positions
      const snap = snapshot(doc);
      expect(snap.find(s => s.id === id1)!.x).toBe(10);
      expect(snap.find(s => s.id === id3)!.x).toBe(210);
    });
  });

  // TC-06: bringObjectsToFront 3 overlapping → above unselected, relative z preserved
  describe('TC-06: bringObjectsToFront', () => {
    it('brings 3 selected above 2 unselected, preserving relative order', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });    // z=1
      const id2 = createSticky(doc, { x: 10, y: 10 });  // z=2
      const id3 = createSticky(doc, { x: 20, y: 20 });  // z=3
      const id4 = createSticky(doc, { x: 30, y: 30 });  // z=4
      const id5 = createSticky(doc, { x: 40, y: 40 });  // z=5

      // Bring id1, id3, id5 to front (they have z=1,3,5)
      bringObjectsToFront(doc, [id1, id3, id5]);

      const snap = snapshot(doc);
      const z1 = snap.find(s => s.id === id1)!.z;
      const z2 = snap.find(s => s.id === id2)!.z;
      const z3 = snap.find(s => s.id === id3)!.z;
      const z4 = snap.find(s => s.id === id4)!.z;
      const z5 = snap.find(s => s.id === id5)!.z;

      // Selected should be above unselected
      expect(z1).toBeGreaterThan(z2);
      expect(z1).toBeGreaterThan(z4);
      expect(z3).toBeGreaterThan(z2);
      expect(z3).toBeGreaterThan(z4);
      expect(z5).toBeGreaterThan(z2);
      expect(z5).toBeGreaterThan(z4);

      // Relative order preserved: id1 was z=1, id3 was z=3, id5 was z=5
      // So id1 < id3 < id5
      expect(z1).toBeLessThan(z3);
      expect(z3).toBeLessThan(z5);
    });
  });

  // TC-07: objectsInRect: A fully inside, B partly, C outside → [A]
  describe('TC-07: objectsInRect', () => {
    it('selects only fully-inside objects', () => {
      // Create 3 notes
      const idA = createSticky(doc, { x: 150, y: 150 }); // center at 150,150 → bounds 50,50 to 250,250
      const idB = createSticky(doc, { x: 350, y: 150 }); // center at 350,150 → bounds 250,50 to 450,250
      const idC = createSticky(doc, { x: 550, y: 150 }); // center at 550,150 → bounds 450,50 to 650,250

      const snap = snapshot(doc);
      // Marquee rect: x=0, y=0, width=300, height=300
      // A (50,50 to 250,250) → fully inside
      // B (250,50 to 450,250) → partly inside (right edge at 450 > 300)
      // C (450,50 to 650,250) → outside
      const rect: Rect = { x: 0, y: 0, width: 300, height: 300 };
      const ids = objectsInRect(snap, rect);
      expect(ids).toContain(idA);
      expect(ids).not.toContain(idB);
      expect(ids).not.toContain(idC);
      expect(ids).toHaveLength(1);
    });
  });

  // TC-08: allObjectIds skips unknown type
  describe('TC-08: allObjectIds', () => {
    it('returns ids of all registered objects', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });

      // Add an unknown type directly
      const objects = doc.getMap('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      objects.set('shape-1', shape);

      const snap = snapshot(doc);
      const ids = allObjectIds(snap);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).not.toContain('shape-1');
      expect(ids).toHaveLength(2);
    });
  });

  // TC-09: NaN/Infinity positions → 0, no transaction
  describe('TC-09: non-finite values rejected', () => {
    it('moveObjects with NaN position → 0, no transaction', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map([[id, { x: NaN, y: 0 }]]);
      const updates = countUpdatesDuring(doc, () => {
        const result = moveObjects(doc, positions);
        expect(result).toBe(0);
      });
      expect(updates).toBe(0);
    });

    it('moveObjects with Infinity position → 0, no transaction', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map([[id, { x: Infinity, y: 0 }]]);
      const updates = countUpdatesDuring(doc, () => {
        const result = moveObjects(doc, positions);
        expect(result).toBe(0);
      });
      expect(updates).toBe(0);
    });

    it('moveObjects with empty map → 0, no transaction', () => {
      const updates = countUpdatesDuring(doc, () => {
        const result = moveObjects(doc, new Map());
        expect(result).toBe(0);
      });
      expect(updates).toBe(0);
    });

    it('resizeObjects with NaN → 0, no transaction', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const rects = new Map([[id, { x: NaN, y: 0, width: 100, height: 100 }]]);
      const updates = countUpdatesDuring(doc, () => {
        const result = resizeObjects(doc, rects);
        expect(result).toBe(0);
      });
      expect(updates).toBe(0);
    });

    it('deleteObjects with empty list → 0, no transaction', () => {
      const updates = countUpdatesDuring(doc, () => {
        const result = deleteObjects(doc, []);
        expect(result).toBe(0);
      });
      expect(updates).toBe(0);
    });
  });

  // TC-10: sticky without width/height: objectBounds uses STICKY_SIZE_WORLD; first resizeObjects writes both
  describe('TC-10: implicit to explicit size', () => {
    it('objectBounds uses STICKY_SIZE_WORLD for sticky without width/height', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const snap = snapshot(doc);
      const obj = snap.find(s => s.id === id)!;
      expect(obj.width).toBeUndefined();
      expect(obj.height).toBeUndefined();

      const bounds = objectBounds(obj);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    });

    it('resizeObjects writes both width and height fields', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const rect: Rect = { x: 50, y: 50, width: 300, height: 300 };

      resizeObjects(doc, new Map([[id, rect]]));

      const snap = snapshot(doc);
      const obj = snap.find(s => s.id === id)!;
      expect(obj.width).toBe(300);
      expect(obj.height).toBe(300);
      expect(obj.x).toBe(50);
      expect(obj.y).toBe(50);
    });
  });

  // Additional: deleteObjects
  describe('deleteObjects', () => {
    it('deletes multiple objects', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const id3 = createSticky(doc, { x: 200, y: 0 });

      const count = deleteObjects(doc, [id1, id3]);
      expect(count).toBe(2);
      expect(snapshot(doc)).toHaveLength(1);
      expect(snapshot(doc)[0].id).toBe(id2);
    });

    it('skips missing ids', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const count = deleteObjects(doc, [id1, 'nonexistent']);
      expect(count).toBe(1);
    });
  });
});
