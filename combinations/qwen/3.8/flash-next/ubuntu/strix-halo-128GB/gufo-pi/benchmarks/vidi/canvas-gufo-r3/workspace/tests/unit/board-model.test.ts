import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  LOCAL_ORIGIN,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS } from '@shared/config';

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return count;
}

describe('board-model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  describe('initDoc', () => {
    it('sets meta.schemaVersion once', () => {
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);
      const updates = countUpdates(doc, () => initDoc(doc));
      expect(updates).toBe(0);
      expect(meta.get('schemaVersion')).toBe(1);
    });
  });

  describe('TC-01: createSticky on empty doc', () => {
    it('creates one sticky centred on the point with z 1', () => {
      let id = '';
      const updates = countUpdates(doc, () => { id = createSticky(doc, { x: 100, y: 100 }); });
      expect(updates).toBe(1);
      const objs = snapshot(doc);
      expect(objs.length).toBe(1);
      const s = objs[0];
      expect(s.id).toBe(id);
      expect(s.type).toBe('sticky');
      expect(s.color).toBe(DEFAULT_STICKY_COLOR);
      expect(s.text).toBe('');
      expect(s.z).toBe(1);
      expect(s.x).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2);
      expect(s.y).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2);
      expect(typeof s.createdAt).toBe('number');
      expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
    });
  });

  describe('TC-02: createSticky with existing notes', () => {
    it('new z = maxZ + 1', () => {
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const before = snapshot(doc).map((s) => s.z).sort((a, b) => a - b);
      expect(before).toEqual([1, 2]);
      const updates = countUpdates(doc, () => createSticky(doc, { x: 0, y: 0 }));
      expect(updates).toBe(1);
      const after = snapshot(doc);
      expect(after.length).toBe(3);
      const top = after.reduce((m, s) => Math.max(m, s.z), 0);
      expect(top).toBe(3);
    });
  });

  describe('TC-03: moveObject', () => {
    it('updates x,y; other fields unchanged', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const before = snapshot(doc).find((s) => s.id === id)!;
      const updates = countUpdates(doc, () => {
        expect(moveObject(doc, id, 10, -20)).toBe(true);
      });
      expect(updates).toBe(1);
      const after = snapshot(doc).find((s) => s.id === id)!;
      expect(after.x).toBe(10);
      expect(after.y).toBe(-20);
      expect(after.color).toBe(before.color);
      expect(after.text).toBe(before.text);
      expect(after.z).toBe(before.z);
      expect(after.createdAt).toBe(before.createdAt);
    });
  });

  describe('TC-04: moveObject stale id', () => {
    it('returns false and emits no update', () => {
      const updates = countUpdates(doc, () => {
        expect(moveObject(doc, 'missing', 5, 5)).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  describe('TC-05: setStickyColor', () => {
    it('applies a valid colour', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdates(doc, () => {
        expect(setStickyColor(doc, id, 'green')).toBe(true);
      });
      expect(updates).toBe(1);
      expect(snapshot(doc)[0].color).toBe('green');
    });
  });

  describe('TC-06: setStickyColor invalid colour', () => {
    it('returns false, unchanged, no update', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdates(doc, () => {
        expect(setStickyColor(doc, id, 'teal')).toBe(false);
      });
      expect(updates).toBe(0);
      expect(snapshot(doc)[0].color).toBe('yellow');
    });
  });

  describe('TC-07: deleteObject', () => {
    it('removes the note', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdates(doc, () => {
        expect(deleteObject(doc, id)).toBe(true);
      });
      expect(updates).toBe(1);
      expect(snapshot(doc).length).toBe(0);
    });
  });

  describe('TC-08: deleteObject stale id', () => {
    it('returns false and emits no update', () => {
      const updates = countUpdates(doc, () => {
        expect(deleteObject(doc, 'missing')).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  describe('TC-09: bringToFront', () => {
    it('raises bottom note z from 1 to 4', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      expect(snapshot(doc).find((s) => s.id === id1)!.z).toBe(1);
      const updates = countUpdates(doc, () => {
        expect(bringToFront(doc, id1)).toBe(true);
      });
      expect(updates).toBe(1);
      expect(snapshot(doc).find((s) => s.id === id1)!.z).toBe(4);
    });
  });

  describe('TC-10: bringToFront on topmost', () => {
    it('returns false and emits no update', () => {
      createSticky(doc, { x: 0, y: 0 });
      const top = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdates(doc, () => {
        expect(bringToFront(doc, top)).toBe(false);
      });
      expect(updates).toBe(0);
      expect(snapshot(doc).find((s) => s.id === top)!.z).toBe(2);
    });
  });

  describe('TC-11: equal z tie-break', () => {
    it('snapshot sorted by id, stable across calls', () => {
      const idA = createSticky(doc, { x: 0, y: 0 });
      const idB = createSticky(doc, { x: 0, y: 0 });
      // Force equal z by direct manipulation
      const m1 = doc.getMap('objects').get(idA) as Y.Map<unknown>;
      m1.set('z', 5);
      const m2 = doc.getMap('objects').get(idB) as Y.Map<unknown>;
      m2.set('z', 5);
      const ids1 = snapshot(doc).map((s) => s.id);
      const ids2 = snapshot(doc).map((s) => s.id);
      expect(ids1).toEqual(ids2);
      const sorted = [...[idA, idB]].sort();
      expect(ids1).toEqual(sorted);
    });
  });

  describe('TC-12: unknown object type', () => {
    it('snapshot skips unknown types without throwing', () => {
      createSticky(doc, { x: 0, y: 0 });
      const objects = doc.getMap('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 9);
      objects.set('shape-1', shape);
      const objs = snapshot(doc);
      expect(objs.length).toBe(1);
      expect(objs[0].type).toBe('sticky');
    });
  });

  describe('non-finite coordinates', () => {
    it('moveObject rejects NaN/Infinity with no update', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdates(doc, () => {
        expect(moveObject(doc, id, NaN, 0)).toBe(false);
        expect(moveObject(doc, id, 0, Infinity)).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });
});
