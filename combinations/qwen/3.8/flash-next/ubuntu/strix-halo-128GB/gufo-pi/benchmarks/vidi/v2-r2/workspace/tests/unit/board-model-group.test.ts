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
} from '@shared/board-model';
import { STICKY_SIZE_WORLD } from '@shared/config';
import type { Rect } from '@shared/geometry';

describe('board-model group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  describe('objectBounds', () => {
    // TC-10: sticky without width/height uses STICKY_SIZE_WORLD
    it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD', () => {
      createSticky(doc, { x: 100, y: 100 });
      const snap = snapshot(doc);
      const bounds = objectBounds(snap[0]);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);
      expect(bounds.x).toBe(100 - STICKY_SIZE_WORLD / 2);
      expect(bounds.y).toBe(100 - STICKY_SIZE_WORLD / 2);
    });

    it('first resizeObjects writes both fields', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const rects = new Map<string, Rect>([
        [id, { x: 0, y: 0, width: 300, height: 300 }],
      ]);
      resizeObjects(doc, rects);
      const snap = snapshot(doc);
      expect(snap[0].width).toBe(300);
      expect(snap[0].height).toBe(300);
    });
  });

  describe('objectsInRect', () => {
    // TC-07: A fully inside, B partly, C outside → [A]
    it('TC-07: fully inside selected, partly inside not, outside not', () => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');

      // A: fully inside (10,10,80,80)
      doc.transact(() => {
        const a = new Y.Map<unknown>();
        a.set('type', 'sticky');
        a.set('x', 10);
        a.set('y', 10);
        a.set('width', 80);
        a.set('height', 80);
        a.set('color', 'yellow');
        a.set('text', new Y.Text('A'));
        a.set('z', 1);
        a.set('createdAt', 1);
        objects.set('A', a);

        // B: partly inside (50,50,100,100) → extends beyond outer (0,0,100,100)
        const b = new Y.Map<unknown>();
        b.set('type', 'sticky');
        b.set('x', 50);
        b.set('y', 50);
        b.set('width', 100);
        b.set('height', 100);
        b.set('color', 'yellow');
        b.set('text', new Y.Text('B'));
        b.set('z', 2);
        b.set('createdAt', 2);
        objects.set('B', b);

        // C: completely outside (200,200,50,50)
        const c = new Y.Map<unknown>();
        c.set('type', 'sticky');
        c.set('x', 200);
        c.set('y', 200);
        c.set('width', 50);
        c.set('height', 50);
        c.set('color', 'yellow');
        c.set('text', new Y.Text('C'));
        c.set('z', 3);
        c.set('createdAt', 3);
        objects.set('C', c);
      });

      const snap = snapshot(doc);
      const result = objectsInRect(snap, { x: 0, y: 0, width: 100, height: 100 });
      expect(result).toEqual(['A']);
    });
  });

  describe('allObjectIds', () => {
    // TC-08: skips unknown type
    it('TC-08: allObjectIds excludes unknown types', () => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      doc.transact(() => {
        // Known sticky
        const sticky = new Y.Map<unknown>();
        sticky.set('type', 'sticky');
        sticky.set('x', 0);
        sticky.set('y', 0);
        sticky.set('color', 'yellow');
        sticky.set('text', new Y.Text());
        sticky.set('z', 1);
        sticky.set('createdAt', 1);
        objects.set('sticky-1', sticky);

        // Unknown type
        const shape = new Y.Map<unknown>();
        shape.set('type', 'shape');
        shape.set('x', 0);
        shape.set('y', 0);
        objects.set('shape-1', shape);
      });

      const snap = snapshot(doc);
      const ids = allObjectIds(snap);
      expect(ids).toEqual(['sticky-1']);
      expect(ids).not.toContain('shape-1');
    });
  });

  describe('moveObjects', () => {
    // TC-05: 3 ids with 1 deleted → returns 2; exactly 1 update event
    it('TC-05: 3 ids with 1 missing returns 2, exactly 1 transaction', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 100 });
      const id3 = createSticky(doc, { x: 200, y: 200 });

      // Delete id2 before moving
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      doc.transact(() => objects.delete(id2));

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const positions = new Map([
        [id1, { x: 10, y: 10 }],
        [id2, { x: 20, y: 20 }], // this one is missing
        [id3, { x: 30, y: 30 }],
      ]);
      const result = moveObjects(doc, positions);
      expect(result).toBe(2);
      expect(updateCount).toBe(1);
    });

    // TC-09: NaN/Infinity positions → 0 applied, no transaction
    it('TC-09: NaN position returns 0, no transaction', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const positions: Map<string, { x: number; y: number }> = new Map([
        [id, { x: NaN, y: 0 }],
      ]);
      expect(moveObjects(doc, positions)).toBe(0);
      expect(updateCount).toBe(0);

      const positions2: Map<string, { x: number; y: number }> = new Map([
        [id, { x: 0, y: Infinity }],
      ]);
      expect(moveObjects(doc, positions2)).toBe(0);
      expect(updateCount).toBe(0);
    });

    it('empty map returns 0, no transaction', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      expect(moveObjects(doc, new Map())).toBe(0);
      expect(updateCount).toBe(0);
    });
  });

  describe('resizeObjects', () => {
    it('TC-09: non-finite rect returns 0, no transaction', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const rects = new Map<string, Rect>([
        [id, { x: NaN, y: 0, width: 100, height: 100 }],
      ]);
      expect(resizeObjects(doc, rects)).toBe(0);
      expect(updateCount).toBe(0);
    });

    it('writes x, y, width, height', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const rects = new Map<string, Rect>([
        [id, { x: 50, y: 60, width: 300, height: 400 }],
      ]);
      const result = resizeObjects(doc, rects);
      expect(result).toBe(1);
      const snap = snapshot(doc);
      expect(snap[0].x).toBe(50);
      expect(snap[0].y).toBe(60);
      expect(snap[0].width).toBe(300);
      expect(snap[0].height).toBe(400);
    });
  });

  describe('bringObjectsToFront', () => {
    // TC-06: 3 overlapping selected over 2 unselected → all selected above unselected, relative order kept
    it('TC-06: selected objects go above unselected, relative order preserved', () => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');

      // Create 5 objects with z: s1=1, u1=2, s2=3, u2=4, s3=5
      const makeObj = (id: string, z: number) => {
        doc.transact(() => {
          const obj = new Y.Map<unknown>();
          obj.set('type', 'sticky');
          obj.set('x', z * 10);
          obj.set('y', 0);
          obj.set('color', 'yellow');
          obj.set('text', new Y.Text());
          obj.set('z', z);
          obj.set('createdAt', 1);
          objects.set(id, obj);
        });
      };

      makeObj('s1', 1);
      makeObj('u1', 2);
      makeObj('s2', 3);
      makeObj('u2', 4);
      makeObj('s3', 5);

      // Select s1, s2, s3 → they should go above u1 (z=2) and u2 (z=4)
      // max unselected z = 4
      // s1 gets z=5, s2 gets z=6, s3 gets z=7 (relative order s1<s2<s3 preserved)
      const result = bringObjectsToFront(doc, ['s1', 's2', 's3']);
      expect(result).toBe(3);

      const snap = snapshot(doc);
      const s1 = snap.find((n) => n.id === 's1')!;
      const s2 = snap.find((n) => n.id === 's2')!;
      const s3 = snap.find((n) => n.id === 's3')!;
      const u1 = snap.find((n) => n.id === 'u1')!;
      const u2 = snap.find((n) => n.id === 'u2')!;

      // All selected above all unselected
      expect(s1.z).toBeGreaterThan(u1.z);
      expect(s1.z).toBeGreaterThan(u2.z);
      expect(s2.z).toBeGreaterThan(u1.z);
      expect(s2.z).toBeGreaterThan(u2.z);
      expect(s3.z).toBeGreaterThan(u1.z);
      expect(s3.z).toBeGreaterThan(u2.z);
      // Relative order among selected preserved
      expect(s1.z).toBeLessThan(s2.z);
      expect(s2.z).toBeLessThan(s3.z);
    });

    it('empty ids returns 0', () => {
      expect(bringObjectsToFront(doc, [])).toBe(0);
    });
  });

  describe('deleteObjects', () => {
    it('deletes multiple objects, returns count', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const id3 = createSticky(doc, { x: 200, y: 0 });

      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = deleteObjects(doc, [id1, id2, id3]);
      expect(result).toBe(3);
      expect(snapshot(doc).length).toBe(0);
      expect(updateCount).toBe(1);
    });

    it('skips missing ids', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const result = deleteObjects(doc, [id1, 'nonexistent']);
      expect(result).toBe(1);
    });

    it('empty list returns 0, no transaction', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      expect(deleteObjects(doc, [])).toBe(0);
      expect(updateCount).toBe(0);
    });
  });
});
