import { describe, it, expect, beforeEach } from 'vitest';
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
  OBJECTS_MAP,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board-model group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  describe('objectBounds', () => {
    // TC-10: sticky without width/height: objectBounds uses STICKY_SIZE_WORLD
    it('TC-10: falls back to STICKY_SIZE_WORLD for implicit-size stickies', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const snap = snapshot(doc);
      const obj = snap.find((s) => s.id === id)!;
      const bounds = objectBounds(obj);
      expect(bounds.width).toBe(STICKY_SIZE_WORLD);
      expect(bounds.height).toBe(STICKY_SIZE_WORLD);
      // The x,y stored by createSticky is centred: at.x - half
      expect(bounds.x).toBe(100 - STICKY_SIZE_WORLD / 2);
      expect(bounds.y).toBe(100 - STICKY_SIZE_WORLD / 2);
    });

    it('uses explicit width/height when present', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      resizeObjects(doc, new Map([[id, { x: 50, y: 50, width: 300, height: 300 }]]));
      const snap = snapshot(doc);
      const obj = snap.find((s) => s.id === id)!;
      const bounds = objectBounds(obj);
      expect(bounds.width).toBe(300);
      expect(bounds.height).toBe(300);
    });
  });

  describe('objectsInRect', () => {
    // TC-07: A fully inside, B partly, C outside → [A]
    it('TC-07: selects only fully-inside objects', () => {
      // Create three stickies at known positions
      const objs: ObjectSnapshot[] = [
        { id: 'a', type: 'sticky', x: 10, y: 10, z: 1, width: 200, height: 200 },  // fully inside 0,0,400,400
        { id: 'b', type: 'sticky', x: 300, y: 300, z: 2, width: 200, height: 200 }, // partly outside (right=500 > 400, bottom=500 > 400)
        { id: 'c', type: 'sticky', x: 500, y: 500, z: 3, width: 200, height: 200 }, // fully outside
      ];
      const rect: Rect = { x: 0, y: 0, width: 400, height: 400 };
      const result = objectsInRect(objs, rect);
      expect(result).toEqual(['a']);
    });

    it('TC-07 negative: object touching edge from outside is NOT selected', () => {
      const objs: ObjectSnapshot[] = [
        { id: 'a', type: 'sticky', x: -10, y: -10, z: 1, width: 200, height: 200 },
      ];
      const rect: Rect = { x: 0, y: 0, width: 400, height: 400 };
      expect(objectsInRect(objs, rect)).toEqual([]);
    });
  });

  describe('allObjectIds', () => {
    // TC-08: allObjectIds excludes unknown type
    it('TC-08: skips unknown types', () => {
      const objs: ObjectSnapshot[] = [
        { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 },
        { id: 'b', type: 'unknown', x: 0, y: 0, z: 2 },
        { id: 'c', type: 'sticky', x: 0, y: 0, z: 3 },
      ];
      expect(allObjectIds(objs)).toEqual(['a', 'c']);
    });
  });

  describe('moveObjects', () => {
    // TC-05: moveObjects 3 ids with 1 deleted remotely → returns 2; exactly 1 update event
    it('TC-05: skips missing ids, returns count of actually moved', () => {
      const id1 = createSticky(doc, { x: 100, y: 100 });
      const id2 = createSticky(doc, { x: 200, y: 200 });
      const id3 = createSticky(doc, { x: 300, y: 300 });
      // Delete id2 from doc to simulate remote deletion
      const objs = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
      objs.delete(id2);

      const positions = new Map([
        [id1, { x: 400, y: 400 }],
        [id2, { x: 500, y: 500 }], // missing - should be skipped
        [id3, { x: 600, y: 600 }],
      ]);

      let eventCount = 0;
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) eventCount++;
      });

      const moved = moveObjects(doc, positions);
      expect(moved).toBe(2);
      expect(eventCount).toBe(1); // exactly one transaction
    });

    // TC-09: NaN/Infinity positions → 0 applied, no transaction
    it('TC-09: rejects NaN positions with 0 and no transaction', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      let eventCount = 0;
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) eventCount++;
      });

      const positions = new Map([[id, { x: NaN, y: 200 }]]);
      expect(moveObjects(doc, positions)).toBe(0);
      expect(eventCount).toBe(0);
    });

    it('TC-09: rejects Infinity positions', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const positions = new Map([[id, { x: Infinity, y: 200 }]]);
      expect(moveObjects(doc, positions)).toBe(0);
    });

    it('returns 0 for empty map without transaction', () => {
      let eventCount = 0;
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) eventCount++;
      });
      expect(moveObjects(doc, new Map())).toBe(0);
      expect(eventCount).toBe(0);
    });
  });

  describe('resizeObjects', () => {
    // TC-10: first resize writes both width and height fields
    it('TC-10: resize writes width and height on implicit-size sticky', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const m = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id)!;
      expect(m.get('width')).toBeUndefined();
      expect(m.get('height')).toBeUndefined();

      resizeObjects(doc, new Map([[id, { x: 50, y: 50, width: 300, height: 300 }]]));
      expect(m.get('width')).toBe(300);
      expect(m.get('height')).toBe(300);
    });

    it('rejects non-finite rects', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: NaN, height: 100 }]]))).toBe(0);
    });
  });

  describe('bringObjectsToFront', () => {
    // TC-06: 3 overlapping selected, 2 unselected → all selected z above unselected, relative order kept
    it('TC-06: brings selected above unselected, preserves relative z', () => {
      const id1 = createSticky(doc, { x: 100, y: 100 }); // z=1
      const id2 = createSticky(doc, { x: 200, y: 200 }); // z=2
      const id3 = createSticky(doc, { x: 300, y: 300 }); // z=3
      createSticky(doc, { x: 400, y: 400 }); // z=4 (unselected)
      const id5 = createSticky(doc, { x: 500, y: 500 }); // z=5 (unselected)

      const objs = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
      // Verify initial z values
      expect(objs.get(id1)!.get('z')).toBe(1);
      expect(objs.get(id5)!.get('z')).toBe(5);

      // Bring id1, id2, id3 to front (they should end up above id5)
      bringObjectsToFront(doc, [id1, id2, id3]);

      const z1 = objs.get(id1)!.get('z') as number;
      const z2 = objs.get(id2)!.get('z') as number;
      const z3 = objs.get(id3)!.get('z') as number;
      const z5 = objs.get(id5)!.get('z') as number;

      // All selected z > max unselected z
      expect(z1).toBeGreaterThan(z5);
      expect(z2).toBeGreaterThan(z5);
      expect(z3).toBeGreaterThan(z5);
      // Relative order among selected preserved
      expect(z1).toBeLessThan(z2);
      expect(z2).toBeLessThan(z3);
    });

    it('returns 0 for empty id list', () => {
      expect(bringObjectsToFront(doc, [])).toBe(0);
    });
  });

  describe('deleteObjects', () => {
    it('deletes multiple objects, skips missing, returns count', () => {
      const id1 = createSticky(doc, { x: 100, y: 100 });
      const id2 = createSticky(doc, { x: 200, y: 200 });
      const objs = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);

      expect(deleteObjects(doc, [id1, id2, 'nonexistent'])).toBe(2);
      expect(objs.get(id1)).toBeUndefined();
      expect(objs.get(id2)).toBeUndefined();
    });

    it('returns 0 for empty list without transaction', () => {
      let eventCount = 0;
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) eventCount++;
      });
      expect(deleteObjects(doc, [])).toBe(0);
      expect(eventCount).toBe(0);
    });
  });
});
