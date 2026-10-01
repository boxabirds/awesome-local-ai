// tests/unit/board-model.test.ts
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
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '../../src/shared/config';

function countUpdatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return count;
}

describe('board.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: create on empty doc
  describe('TC-01: createSticky on empty doc', () => {
    it('creates 1 object with type sticky, default colour, empty text, z 1', () => {
      const id = createSticky(doc, { x: 100, y: 100 });
      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      expect(snap[0].id).toBe(id);
      expect(snap[0].type).toBe('sticky');
      expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
      expect(snap[0].text).toBe('');
      expect(snap[0].z).toBe(1);
      // Centred: top-left = point - STICKY_SIZE_WORLD/2
      expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
      expect(snap[0].y).toBe(100 - STICKY_SIZE_WORLD / 2);
    });

    it('emits exactly 1 update event', () => {
      const updates = countUpdatesDuring(doc, () => {
        createSticky(doc, { x: 0, y: 0 });
      });
      expect(updates).toBe(1);
    });
  });

  // TC-02: create with existing z 1,2 → new z 3
  describe('TC-02: createSticky stacking', () => {
    it('new note gets z = maxZ + 1', () => {
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 10, y: 10 });
      const id3 = createSticky(doc, { x: 20, y: 20 });
      const snap = snapshot(doc);
      const note3 = snap.find(s => s.id === id3)!;
      expect(note3.z).toBe(3);
    });
  });

  // TC-03: moveObject
  describe('TC-03: moveObject', () => {
    it('updates x,y and leaves other fields unchanged', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const before = snapshot(doc).find(s => s.id === id)!;
      
      const result = moveObject(doc, id, 10, -20);
      expect(result).toBe(true);

      const after = snapshot(doc).find(s => s.id === id)!;
      expect(after.x).toBe(10);
      expect(after.y).toBe(-20);
      expect(after.color).toBe(before.color);
      expect(after.text).toBe(before.text);
      expect(after.z).toBe(before.z);
      expect(after.createdAt).toBe(before.createdAt);
    });

    it('emits exactly 1 update event', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdatesDuring(doc, () => {
        moveObject(doc, id, 5, 5);
      });
      expect(updates).toBe(1);
    });
  });

  // TC-04: moveObject stale id (negative)
  describe('TC-04: moveObject stale id', () => {
    it('returns false and emits 0 updates', () => {
      const updates = countUpdatesDuring(doc, () => {
        const result = moveObject(doc, 'nonexistent-id', 10, 20);
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  // TC-05: setStickyColor
  describe('TC-05: setStickyColor', () => {
    it('changes colour and leaves text, x, y, z unchanged', () => {
      const id = createSticky(doc, { x: 50, y: 60 });
      const before = snapshot(doc).find(s => s.id === id)!;

      const result = setStickyColor(doc, id, 'green');
      expect(result).toBe(true);

      const after = snapshot(doc).find(s => s.id === id)!;
      expect(after.color).toBe('green');
      expect(after.text).toBe(before.text);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.z).toBe(before.z);
    });

    it('emits exactly 1 update event', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdatesDuring(doc, () => {
        setStickyColor(doc, id, 'blue');
      });
      expect(updates).toBe(1);
    });
  });

  // TC-06: setStickyColor unknown colour (negative)
  describe('TC-06: setStickyColor unknown colour', () => {
    it('returns false, colour unchanged, 0 updates', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const before = snapshot(doc).find(s => s.id === id)!;

      const updates = countUpdatesDuring(doc, () => {
        const result = setStickyColor(doc, id, 'teal');
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);

      const after = snapshot(doc).find(s => s.id === id)!;
      expect(after.color).toBe(before.color);
    });
  });

  // TC-07: deleteObject
  describe('TC-07: deleteObject', () => {
    it('removes the note', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      expect(snapshot(doc)).toHaveLength(1);

      const result = deleteObject(doc, id);
      expect(result).toBe(true);
      expect(snapshot(doc)).toHaveLength(0);
    });

    it('emits exactly 1 update event', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdatesDuring(doc, () => {
        deleteObject(doc, id);
      });
      expect(updates).toBe(1);
    });
  });

  // TC-08: deleteObject stale id (negative)
  describe('TC-08: deleteObject stale id', () => {
    it('returns false and emits 0 updates', () => {
      const updates = countUpdatesDuring(doc, () => {
        const result = deleteObject(doc, 'nonexistent-id');
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  // TC-09: bringToFront
  describe('TC-09: bringToFront', () => {
    it('brings z=1 of 3 notes to z=4', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 10, y: 10 });
      createSticky(doc, { x: 20, y: 20 });
      // id1 has z=1

      const result = bringToFront(doc, id1);
      expect(result).toBe(true);

      const snap = snapshot(doc);
      const note1 = snap.find(s => s.id === id1)!;
      expect(note1.z).toBe(4);
    });

    it('emits exactly 1 update event', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 10, y: 10 });
      const updates = countUpdatesDuring(doc, () => {
        bringToFront(doc, id1);
      });
      expect(updates).toBe(1);
    });
  });

  // TC-10: bringToFront on topmost (negative)
  describe('TC-10: bringToFront on topmost', () => {
    it('returns false and emits 0 updates', () => {
      createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 10, y: 10 });
      // id2 is topmost (z=2)

      const updates = countUpdatesDuring(doc, () => {
        const result = bringToFront(doc, id2);
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });
  });

  // TC-11: equal z → snapshot sorted by id tie-break
  describe('TC-11: snapshot ordering with equal z', () => {
    it('sorts by id when z values are equal, stable across calls', () => {
      // Create two notes, then set them to the same z
      const id1 = createSticky(doc, { x: 0, y: 0 });
      const id2 = createSticky(doc, { x: 10, y: 10 });

      // Force equal z
      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      (objects.get(id1) as Y.Map<unknown>).set('z', 5);
      (objects.get(id2) as Y.Map<unknown>).set('z', 5);

      const snap1 = snapshot(doc);
      const snap2 = snapshot(doc);
      expect(snap1).toHaveLength(2);
      // Sorted by id (localeCompare)
      expect(snap1[0].id.localeCompare(snap1[1].id)).toBeLessThan(0);
      // Stable across calls
      expect(snap1[0].id).toBe(snap2[0].id);
      expect(snap1[1].id).toBe(snap2[1].id);
    });
  });

  // TC-12: unknown object type skipped
  describe('TC-12: unknown type skipped by snapshot', () => {
    it('does not include objects with type != sticky, no throw', () => {
      const id = createSticky(doc, { x: 0, y: 0 });

      // Add an unknown type directly
      const objects = doc.getMap('objects');
      const unknown = new Y.Map<unknown>();
      unknown.set('type', 'unknown-type');
      unknown.set('x', 0);
      unknown.set('y', 0);
      objects.set('unknown-1', unknown);

      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      expect(snap[0].id).toBe(id);
    });
  });

  // TC-39: NaN / Infinity coordinates (negative)
  describe('TC-39: non-finite coordinates', () => {
    it('moveObject with NaN returns false, 0 updates', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdatesDuring(doc, () => {
        const result = moveObject(doc, id, NaN, 0);
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });

    it('moveObject with Infinity returns false, 0 updates', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = countUpdatesDuring(doc, () => {
        const result = moveObject(doc, id, Infinity, 0);
        expect(result).toBe(false);
      });
      expect(updates).toBe(0);
    });

    it('createSticky with NaN returns empty string, 0 updates', () => {
      const updates = countUpdatesDuring(doc, () => {
        const id = createSticky(doc, { x: NaN, y: 0 });
        expect(id).toBe('');
      });
      expect(updates).toBe(0);
    });

    it('createSticky with -Infinity returns empty string, 0 updates', () => {
      const updates = countUpdatesDuring(doc, () => {
        const id = createSticky(doc, { x: 0, y: -Infinity });
        expect(id).toBe('');
      });
      expect(updates).toBe(0);
    });
  });

  // Extra: initDoc sets meta.schemaVersion once
  describe('initDoc', () => {
    it('sets schemaVersion to 1', () => {
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);
    });

    it('does not overwrite existing schemaVersion', () => {
      const meta = doc.getMap('meta');
      meta.set('schemaVersion', 99);
      initDoc(doc);
      expect(meta.get('schemaVersion')).toBe(99);
    });
  });

  // getStickyText
  describe('getStickyText', () => {
    it('returns the Y.Text for a valid id', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      const text = getStickyText(doc, id);
      expect(text).toBeInstanceOf(Y.Text);
    });

    it('returns undefined for a stale id', () => {
      const text = getStickyText(doc, 'nonexistent');
      expect(text).toBeUndefined();
    });
  });
});
