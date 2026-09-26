import { describe, it, expect } from 'vitest';
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
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
} from '../../src/shared/config';

/**
 * Helper: create a doc with an update counter.
 */
function setup() {
  const doc = new Y.Doc();
  const state = { count: 0 };
  doc.on('update', () => {
    state.count += 1;
  });
  return { doc, state };
}

describe('board-model', () => {
  describe('initDoc', () => {
    it('sets meta.schemaVersion to 1', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);
    });

    it('does not overwrite existing schemaVersion', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const meta = doc.getMap('meta');
      meta.set('schemaVersion', 99);
      initDoc(doc);
      expect(meta.get('schemaVersion')).toBe(99);
    });
  });

  describe('createSticky', () => {
    it('TC-01: creates a note on an empty doc', () => {
      const { doc, state } = setup();
      initDoc(doc);
      state.count = 0;
      const id = createSticky(doc, { x: 100, y: 100 });
      expect(typeof id).toBe('string');
      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      expect(snap[0]!.id).toBe(id);
      expect(snap[0]!.type).toBe('sticky');
      expect(snap[0]!.color).toBe(DEFAULT_STICKY_COLOR);
      expect(snap[0]!.text).toBe('');
      expect(snap[0]!.z).toBe(1);
      // Centred: top-left = point - SIZE/2
      expect(snap[0]!.x).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2);
      expect(snap[0]!.y).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2);
      expect(state.count).toBe(1);
    });

    it('TC-02: creates a note with z = maxZ + 1', () => {
      const { doc } = setup();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const id = createSticky(doc, { x: 0, y: 0 });
      const snap = snapshot(doc);
      const note = snap.find((n) => n.id === id)!;
      expect(note.z).toBe(3);
    });

    it('accepts a custom color', () => {
      const { doc } = setup();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 }, 'green');
      const snap = snapshot(doc);
      expect(snap[0]!.color).toBe('green');
    });
  });

  describe('moveObject', () => {
    it('TC-03: moves a note to new coordinates', () => {
      const { doc } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 100, y: 100 });
      const result = moveObject(doc, id, 10, -20);
      expect(result).toBe(true);
      const snap = snapshot(doc);
      expect(snap[0]!.x).toBe(10);
      expect(snap[0]!.y).toBe(-20);
    });

    it('TC-03: does not change other fields', () => {
      const { doc } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 100, y: 100 }, 'blue');
      moveObject(doc, id, 10, -20);
      const snap = snapshot(doc);
      expect(snap[0]!.color).toBe('blue');
      expect(snap[0]!.z).toBe(1);
    });

    it('TC-04: returns false for stale id, 0 updates', () => {
      const { doc, state } = setup();
      initDoc(doc);
      state.count = 0;
      const result = moveObject(doc, 'nonexistent', 0, 0);
      expect(result).toBe(false);
      expect(state.count).toBe(0);
    });

    it('rejects non-finite coordinates with 0 updates', () => {
      const { doc, state } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      state.count = 0;
      expect(moveObject(doc, id, Infinity, 0)).toBe(false);
      expect(moveObject(doc, id, 0, NaN)).toBe(false);
      expect(state.count).toBe(0);
    });
  });

  describe('setStickyColor', () => {
    it('TC-05: changes colour to green', () => {
      const { doc } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const result = setStickyColor(doc, id, 'green');
      expect(result).toBe(true);
      expect(snapshot(doc)[0]!.color).toBe('green');
    });

    it('TC-06: rejects invalid colour, 0 updates', () => {
      const { doc, state } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      state.count = 0;
      const result = setStickyColor(doc, id, 'teal');
      expect(result).toBe(false);
      expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
      expect(state.count).toBe(0);
    });

    it('returns false for stale id, 0 updates', () => {
      const { doc, state } = setup();
      initDoc(doc);
      state.count = 0;
      expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
      expect(state.count).toBe(0);
    });
  });

  describe('deleteObject', () => {
    it('TC-07: removes the note', () => {
      const { doc } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      expect(snapshot(doc)).toHaveLength(1);
      const result = deleteObject(doc, id);
      expect(result).toBe(true);
      expect(snapshot(doc)).toHaveLength(0);
    });

    it('TC-08: returns false for stale id, 0 updates', () => {
      const { doc, state } = setup();
      initDoc(doc);
      state.count = 0;
      const result = deleteObject(doc, 'nonexistent');
      expect(result).toBe(false);
      expect(state.count).toBe(0);
    });
  });

  describe('bringToFront', () => {
    it('TC-09: brings z=1 of 3 notes to top (z=4)', () => {
      const { doc } = setup();
      initDoc(doc);
      const id1 = createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const result = bringToFront(doc, id1);
      expect(result).toBe(true);
      const snap = snapshot(doc);
      const note = snap.find((n) => n.id === id1)!;
      expect(note.z).toBe(4);
    });

    it('TC-10: already topmost returns false, 0 updates', () => {
      const { doc, state } = setup();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      const idTop = createSticky(doc, { x: 0, y: 0 });
      state.count = 0;
      const result = bringToFront(doc, idTop);
      expect(result).toBe(false);
      expect(state.count).toBe(0);
    });

    it('returns false for stale id', () => {
      const { doc, state } = setup();
      initDoc(doc);
      state.count = 0;
      expect(bringToFront(doc, 'missing')).toBe(false);
      expect(state.count).toBe(0);
    });
  });

  describe('snapshot ordering', () => {
    it('TC-11: equal z sorted by id tie-break', () => {
      const { doc } = setup();
      initDoc(doc);
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const idA = 'aaa';
      const idB = 'bbb';
      doc.transact(() => {
        const mapA = new Y.Map<unknown>();
        mapA.set('type', 'sticky');
        mapA.set('x', 0);
        mapA.set('y', 0);
        mapA.set('color', 'yellow');
        mapA.set('text', new Y.Text(''));
        mapA.set('z', 1);
        mapA.set('createdAt', Date.now());
        objects.set(idA, mapA);

        const mapB = new Y.Map<unknown>();
        mapB.set('type', 'sticky');
        mapB.set('x', 10);
        mapB.set('y', 10);
        mapB.set('color', 'blue');
        mapB.set('text', new Y.Text(''));
        mapB.set('z', 1);
        mapB.set('createdAt', Date.now());
        objects.set(idB, mapB);
      });
      const snap = snapshot(doc);
      expect(snap[0]!.id).toBe(idA);
      expect(snap[1]!.id).toBe(idB);
      // Stable across calls
      const snap2 = snapshot(doc);
      expect(snap2[0]!.id).toBe(idA);
      expect(snap2[1]!.id).toBe(idB);
    });
  });

  describe('snapshot forward compatibility', () => {
    it('TC-12: unknown type is skipped', () => {
      const { doc } = setup();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      // Add an unknown type manually
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      doc.transact(() => {
        const shape = new Y.Map<unknown>();
        shape.set('type', 'shape');
        shape.set('x', 5);
        objects.set('shape-1', shape);
      });
      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      expect(snap[0]!.type).toBe('sticky');
    });
  });

  describe('getStickyText', () => {
    it('returns Y.Text for existing note', () => {
      const { doc } = setup();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const ytext = getStickyText(doc, id);
      expect(ytext).toBeInstanceOf(Y.Text);
      expect(ytext!.toString()).toBe('');
    });

    it('returns undefined for missing id', () => {
      const { doc } = setup();
      initDoc(doc);
      expect(getStickyText(doc, 'missing')).toBeUndefined();
    });
  });
});
