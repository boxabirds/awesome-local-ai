import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

describe('board-model group operations', () => {
  // TC-05: moveObjects 3 ids with 1 deleted remotely → returns 2; exactly 1 update event
  describe('TC-05 moveObjects skips missing ids', () => {
    it('returns 2 when 1 of 3 ids is missing; exactly 1 update event', () => {
      const doc = newDoc();
      const idA = createSticky(doc, { x: 0, y: 0 });
      const idB = createSticky(doc, { x: 300, y: 0 });
      const idC = createSticky(doc, { x: 600, y: 0 });

      // Delete idB directly from the map to simulate remote delete
      objectsMap(doc).delete(idB);

      const positions = new Map<string, { x: number; y: number }>([
        [idA, { x: 10, y: 10 }],
        [idB, { x: 20, y: 20 }],
        [idC, { x: 30, y: 30 }],
      ]);

      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const count = moveObjects(doc, positions);
      doc.off('update', listener);

      expect(count).toBe(2);
      expect(updates).toBe(1);
    });
  });

  // TC-06: bringObjectsToFront 3 overlapping selected over 2 unselected
  describe('TC-06 bringObjectsToFront', () => {
    it('places all selected above unselected, preserving relative z', () => {
      const doc = newDoc();
      // Create 5 notes
      const id1 = createSticky(doc, { x: 0, y: 0 });   // z=1
      const id2 = createSticky(doc, { x: 50, y: 50 }); // z=2
      const id3 = createSticky(doc, { x: 100, y: 0 }); // z=3 (unselected)
      const id4 = createSticky(doc, { x: 0, y: 100 }); // z=4 (unselected)
      const id5 = createSticky(doc, { x: 100, y: 100 }); // z=5 (unselected)

      // Select id1 and id2; bring them to front
      const count = bringObjectsToFront(doc, [id1, id2]);
      expect(count).toBe(2);

      const snaps = snapshot(doc);
      const s1 = snaps.find(s => s.id === id1)!;
      const s2 = snaps.find(s => s.id === id2)!;
      const s3 = snaps.find(s => s.id === id3)!;
      const s4 = snaps.find(s => s.id === id4)!;
      const s5 = snaps.find(s => s.id === id5)!;

      // Both selected should be above all unselected
      expect(s1.z).toBeGreaterThan(s5.z);
      expect(s2.z).toBeGreaterThan(s5.z);
      // Relative order preserved: id1 was z=1, id2 was z=2 -> id1 < id2
      expect(s1.z).toBeLessThan(s2.z);
      // Unselected z unchanged
      expect(s3.z).toBe(3);
      expect(s4.z).toBe(4);
    });
  });

  // TC-07: objectsInRect: A fully inside, B partly, C outside → [A]
  describe('TC-07 objectsInRect', () => {
    it('returns only fully-contained objects', () => {
      const doc = newDoc();
      const idA = createSticky(doc, { x: 100, y: 100 }); // centered at 100,100 → bounds (0,0,200,200)
      const idB = createSticky(doc, { x: 200, y: 100 }); // centered at 200,100 → bounds (100,0,200,200) - extends past right
      const idC = createSticky(doc, { x: 500, y: 500 }); // far outside

      // Selection rect from (0,0) to (150,150)
      const rect: Rect = { x: 0, y: 0, width: 150, height: 150 };

      const snaps = snapshot(doc);
      const insideResult = objectsInRect(snaps, rect);
      // A bounds: (0,0,200,200) - not fully inside (0,0,150,150) because extends to 200
      expect(insideResult).toEqual([]);
      // For A to be fully inside, rect needs to be at least 200x200 covering 0-200.
      // Let me use a larger rect
      const rect2: Rect = { x: -10, y: -10, width: 210, height: 210 };
      const result2 = objectsInRect(snaps, rect2);

      // A: bounds (0,0,200,200) → fully inside (-10,-10,210,210) → yes
      // B: bounds (100,0,200,200) → 100+200=300 > -10+210=200 → not fully inside → no
      // C: bounds (400,400,200,200) → way outside → no
      expect(result2).toContain(idA);
      expect(result2).not.toContain(idB);
      expect(result2).not.toContain(idC);
    });
  });

  // TC-08: allObjectIds skips unknown types
  describe('TC-08 allObjectIds', () => {
    it('excludes unknown object types', () => {
      const doc = newDoc();
      const stickyId = createSticky(doc, { x: 0, y: 0 });

      // Insert an unknown type directly
      const objects = objectsMap(doc);
      const unknown = new Y.Map<unknown>();
      unknown.set('type', 'shape');
      unknown.set('x', 100);
      unknown.set('y', 100);
      unknown.set('z', 10);
      doc.transact(() => {
        objects.set('shape-1', unknown);
      });

      // snapshot() filters to only sticky type
      const snaps = snapshot(doc);
      const ids = allObjectIds(snaps);

      expect(ids).toContain(stickyId);
      expect(ids).not.toContain('shape-1');
    });
  });

  // TC-09: NaN/Infinity positions → 0 applied, no transaction
  describe('TC-09 invalid values rejected', () => {
    it('NaN position returns 0, no transaction', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map<string, { x: number; y: number }>([[id, { x: NaN, y: 0 }]]);
      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const result = moveObjects(doc, positions);
      doc.off('update', listener);
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });

    it('Infinity position returns 0, no transaction', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map<string, { x: number; y: number }>([[id, { x: 0, y: Infinity }]]);
      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const result = moveObjects(doc, positions);
      doc.off('update', listener);
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });

    it('empty id list returns 0, no transaction', () => {
      const doc = newDoc();
      const positions = new Map<string, { x: number; y: number }>();
      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const result = moveObjects(doc, positions);
      doc.off('update', listener);
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });

  // TC-10: sticky without width/height → objectBounds uses STICKY_SIZE_WORLD; first resizeObjects writes both fields
  describe('TC-10 implicit size fallback', () => {
    it('objectBounds returns STICKY_SIZE_WORLD when width/height not set', () => {
      const doc = newDoc();
      createSticky(doc, { x: 100, y: 100 });
      const snaps = snapshot(doc);
      const bounds = objectBounds(snaps[0]);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    });

    it('resizeObjects writes both width and height fields', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 100, y: 100 });
      const rects = new Map<string, Rect>([[id, { x: 0, y: 0, width: 300, height: 300 }]]);
      const result = resizeObjects(doc, rects);
      expect(result).toBe(1);
      const snaps = snapshot(doc);
      expect(snaps[0].width).toBe(300);
      expect(snaps[0].height).toBe(300);
      expect(snaps[0].x).toBe(0);
      expect(snaps[0].y).toBe(0);
    });
  });

  describe('deleteObjects', () => {
    it('removes multiple objects in one transaction', () => {
      const doc = newDoc();
      const idA = createSticky(doc, { x: 0, y: 0 });
      const idB = createSticky(doc, { x: 300, y: 0 });
      createSticky(doc, { x: 600, y: 0 });

      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const result = deleteObjects(doc, [idA, idB]);
      doc.off('update', listener);

      expect(result).toBe(2);
      expect(updates).toBe(1);
      expect(snapshot(doc)).toHaveLength(1);
    });

    it('returns 0 for empty ids list', () => {
      const doc = newDoc();
      createSticky(doc, { x: 0, y: 0 });
      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const count = deleteObjects(doc, []);
      doc.off('update', listener);
      expect(count).toBe(0);
      expect(updates).toBe(0);
    });

    it('skips missing ids', () => {
      const doc = newDoc();
      createSticky(doc, { x: 0, y: 0 });
      const count = deleteObjects(doc, ['nonexistent-id-here', 'also-nonexistent']);
      expect(count).toBe(0);
    });
  });

  describe('resizeObjects validation', () => {
    it('non-finite rect values return 0, no transaction', () => {
      const doc = newDoc();
      const stickyId = createSticky(doc, { x: 0, y: 0 });
      const rects = new Map<string, Rect>([[stickyId, { x: NaN, y: 0, width: 100, height: 100 }]]);
      let updates = 0;
      const listener = () => { updates++; };
      doc.on('update', listener);
      const result = resizeObjects(doc, rects);
      doc.off('update', listener);
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });
});
