import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function updatesDuring<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const onUpdate = () => { updates++; };
  doc.on('update', onUpdate);
  try { return { result: fn(), updates }; }
  finally { doc.off('update', onUpdate); }
}

describe('board-model group operations', () => {
  describe('objectBounds', () => {
    it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD', () => {
      const snap: ObjectSnapshot = { id: 'a', type: 'sticky', x: 10, y: 20, z: 1 };
      expect(objectBounds(snap)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    });

    it('uses persisted width and height when present', () => {
      const snap: ObjectSnapshot = { id: 'a', type: 'sticky', x: 10, y: 20, z: 1, width: 300, height: 400 };
      expect(objectBounds(snap)).toEqual({ x: 10, y: 20, width: 300, height: 400 });
    });
  });

  describe('objectsInRect', () => {
    it('TC-07: A fully inside, B partly, C outside → [A]', () => {
      const objects: ObjectSnapshot[] = [
        { id: 'A', type: 'sticky', x: 10, y: 10, z: 1, width: 50, height: 50 },
        { id: 'B', type: 'sticky', x: 90, y: 50, z: 2, width: 50, height: 50 },
        { id: 'C', type: 'sticky', x: 500, y: 500, z: 3, width: 50, height: 50 },
      ];
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
      const result = objectsInRect(objects, rect);
      expect(result).toEqual(['A']);
    });
  });

  describe('allObjectIds', () => {
    it('TC-08: returns all ids', () => {
      const objects: ObjectSnapshot[] = [
        { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 },
        { id: 'b', type: 'sticky', x: 10, y: 10, z: 2 },
      ];
      expect(allObjectIds(objects).sort()).toEqual(['a', 'b']);
    });

    it('includes unknown types from the snapshot', () => {
      const objects: ObjectSnapshot[] = [
        { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 },
        { id: 'b', type: 'unknown', x: 10, y: 10, z: 2 },
      ];
      expect(allObjectIds(objects).sort()).toEqual(['a', 'b']);
    });
  });

  describe('moveObjects', () => {
    it('TC-05: moves 3 ids, one is deleted, returns 2; one update event', () => {
      const doc = newDoc();
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const id3 = createSticky(doc, { x: 200, y: 0 });
      deleteObject(doc, id2);

      const positions = new Map([
        [id1, { x: 50, y: 50 }],
        [id2, { x: 150, y: 50 }],
        [id3, { x: 250, y: 50 }],
      ]);

      const { result, updates } = updatesDuring(doc, () => moveObjects(doc, positions));
      expect(result).toBe(2);
      expect(updates).toBe(1);
      const snap = snapshot(doc);
      expect(snap.find((s) => s.id === id1)).toMatchObject({ x: 50, y: 50 });
      expect(snap.find((s) => s.id === id3)).toMatchObject({ x: 250, y: 50 });
    });

    it('TC-09: non-finite positions produce 0 and no transaction', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const positions = new Map([[id, { x: NaN, y: 0 }]]);
      const { result, updates } = updatesDuring(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });

    it('empty positions map returns 0 with no transaction', () => {
      const doc = newDoc();
      const { result, updates } = updatesDuring(doc, () => moveObjects(doc, new Map()));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });

  describe('resizeObjects', () => {
    it('writes width and height fields', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const rects = new Map([[id, { x: 10, y: 10, width: 300, height: 400 }]]);
      const { result, updates } = updatesDuring(doc, () => resizeObjects(doc, rects));
      expect(result).toBe(1);
      expect(updates).toBe(1);
      const obj = objectsMap(doc).get(id)!;
      expect(obj.get('x')).toBe(10);
      expect(obj.get('y')).toBe(10);
      expect(obj.get('width')).toBe(300);
      expect(obj.get('height')).toBe(400);
    });

    it('TC-10: first resize on a note without width/height writes both fields', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const snap = snapshot(doc).find((s) => s.id === id)!;
      expect(snap.width).toBeUndefined();
      expect(snap.height).toBeUndefined();

      resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 300, height: 300 }]]));
      const after = snapshot(doc).find((s) => s.id === id)!;
      expect(after.width).toBe(300);
      expect(after.height).toBe(300);
    });

    it('non-finite rect values are rejected', () => {
      const doc = newDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const rects = new Map([[id, { x: NaN, y: 0, width: 100, height: 100 }]]);
      const { result, updates } = updatesDuring(doc, () => resizeObjects(doc, rects));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });

    it('empty rects returns 0 with no transaction', () => {
      const doc = newDoc();
      const { result, updates } = updatesDuring(doc, () => resizeObjects(doc, new Map()));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });

  describe('bringObjectsToFront', () => {
    it('TC-06: 3 overlapping selected over 2 unselected → all selected z above unselected, relative order kept', () => {
      const doc = newDoc();
      const u1 = createSticky(doc, { x: 0, y: 0 }); // z=1
      const s1 = createSticky(doc, { x: 0, y: 0 }); // z=2
      const u2 = createSticky(doc, { x: 0, y: 0 }); // z=3
      const s2 = createSticky(doc, { x: 0, y: 0 }); // z=4
      const s3 = createSticky(doc, { x: 0, y: 0 }); // z=5

      // Set unselected to z=1,3; selected to z=2,4,5
      updatesDuring(doc, () => bringObjectsToFront(doc, [s1, s2, s3]));
      // After: unselected max is 3, so selected get z 4, 5, 6
      const snap = snapshot(doc);
      const zOf = (id: string) => snap.find((s) => s.id === id)!.z;

      expect(zOf(s1)).toBeGreaterThan(zOf(u1));
      expect(zOf(s1)).toBeGreaterThan(zOf(u2));
      expect(zOf(s2)).toBeGreaterThan(zOf(u1));
      expect(zOf(s3)).toBeGreaterThan(zOf(u2));
      // Relative order among selected preserved
      expect(zOf(s1)).toBeLessThan(zOf(s2));
      expect(zOf(s2)).toBeLessThan(zOf(s3));
    });

    it('empty ids list returns 0 with no transaction', () => {
      const doc = newDoc();
      const { result, updates } = updatesDuring(doc, () => bringObjectsToFront(doc, []));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });

  describe('deleteObjects', () => {
    it('deletes multiple objects in one transaction', () => {
      const doc = newDoc();
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 100, y: 0 });
      const { result, updates } = updatesDuring(doc, () => deleteObjects(doc, [id1, id2]));
      expect(result).toBe(2);
      expect(updates).toBe(1);
      expect(snapshot(doc)).toHaveLength(0);
    });

    it('missing ids are skipped', () => {
      const doc = newDoc();
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const { result } = updatesDuring(doc, () => deleteObjects(doc, [id1, 'missing']));
      expect(result).toBe(1);
    });

    it('empty ids list returns 0 with no transaction', () => {
      const doc = newDoc();
      const { result, updates } = updatesDuring(doc, () => deleteObjects(doc, []));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    });
  });
});
