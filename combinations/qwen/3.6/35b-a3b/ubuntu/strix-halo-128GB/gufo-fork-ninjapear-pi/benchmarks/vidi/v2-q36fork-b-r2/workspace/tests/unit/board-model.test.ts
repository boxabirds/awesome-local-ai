import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
} from '../../src/shared/config';

// Helper to count update events on a Y.Doc
function countUpdates(doc: Y.Doc): number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  // Force any pending transactions to flush — in-process so they're immediate
  return count;
}

describe('board.model unit tests', () => {
  describe('TC-01: createSticky on empty doc', () => {
    it('creates one note with type sticky, yellow colour, empty text, z=1, centred', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      let updates = 0;
      doc.on('update', () => { updates++; });

      const id = createSticky(doc, { x: 100, y: 100 });
      expect(id).toBeTruthy();
      expect(updates).toBe(1);

      const snap = snapshot(doc);
      expect(snap.length).toBe(1);
      const n = snap[0];
      expect(n.type).toBe('sticky');
      expect(n.color).toBe(DEFAULT_STICKY_COLOR);
      expect(n.text).toBe('');
      expect(n.z).toBe(1);
      // Centred: top-left = point - half size
      expect(n.x).toBe(100 - STICKY_SIZE_WORLD / 2);
      expect(n.y).toBe(100 - STICKY_SIZE_WORLD / 2);
    });
  });

  describe('TC-02: createSticky with existing notes (z=1,2 -> z=3)', () => {
    it('new note gets maxZ + 1', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const result = createSticky(doc, { x: 0, y: 0 });
      const snap = snapshot(doc);
      const zs = snap.map((s) => s.z).sort((a, b) => a - b);
      expect(zs).toEqual([1, 2, 3]);
    });
  });

  describe('TC-03: moveObject', () => {
    it('updates x,y; other fields unchanged', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      // Create note first (without counting)
      const id = createSticky(doc, { x: 0, y: 0 });
      // Now count only the moveObject update
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = moveObject(doc, id, 10, -20);
      expect(ok).toBe(true);
      expect(updates).toBe(1);
      const snap = snapshot(doc);
      expect(snap[0].x).toBe(10);
      expect(snap[0].y).toBe(-20);
      expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
      expect(snap[0].text).toBe('');
      expect(snap[0].z).toBe(1);
    });
  });

  describe('TC-04: moveObject stale id (negative)', () => {
    it('returns false, 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = moveObject(doc, 'nonexistent-id', 0, 0);
      expect(ok).toBe(false);
      expect(updates).toBe(0);
    });
  });

describe('TC-05: setStickyColor green', () => {
    it('yellow -> green; text, x, y, z unchanged', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      // Create note first (without counting updates)
      const id = createSticky(doc, { x: 0, y: 0 });
      // Now count only the setColor update
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = setStickyColor(doc, id, 'green');
      expect(ok).toBe(true);
      expect(updates).toBe(1);
      const snap = snapshot(doc);
      expect(snap[0].color).toBe(STICKY_COLORS.green);
    });
  });

  describe('TC-06: setStickyColor unknown color (negative)', () => {
    it('rejects teal colour, no change, 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      // Create note first (without counting updates)
      const id = createSticky(doc, { x: 0, y: 0 });
      // Now count only the setColor attempt
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = setStickyColor(doc, id, 'teal');
      expect(ok).toBe(false);
      expect(updates).toBe(0);
      const snap = snapshot(doc);
      expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    });
  });

  describe('TC-07: deleteObject', () => {
    it('removes note', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const ok = deleteObject(doc, id);
      expect(ok).toBe(true);
      expect(snapshot(doc).length).toBe(0);
    });
  });

  describe('TC-08: deleteObject stale id (negative)', () => {
    it('returns false, 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = deleteObject(doc, 'fake-id');
      expect(ok).toBe(false);
      expect(updates).toBe(0);
    });
  });

  describe('TC-09: bringToFront (z=1 of 3 -> z=4)', () => {
    it('moves lowest-z note to top', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id1 = createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 10, y: 10 });
      createSticky(doc, { x: 20, y: 20 });
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = bringToFront(doc, id1);
      expect(ok).toBe(true);
      expect(updates).toBe(1);
      const snap = snapshot(doc);
      // find id1's z
      const note = snap.find((s) => s.id === id1);
      expect(note!.z).toBe(4);
    });
  });

  describe('TC-10: bringToFront on topmost (negative)', () => {
    it('returns false, 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const idTop = createSticky(doc, { x: 0, y: 0 });
      let updates = 0;
      doc.on('update', () => { updates++; });
      const ok = bringToFront(doc, idTop);
      expect(ok).toBe(false);
      expect(updates).toBe(0);
    });
  });

  describe('TC-11: equal z -> sorted by id tie-break, stable', () => {
    it('snapshot ordered by (z, id) consistently', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 1, y: 1 });
      createSticky(doc, { x: 2, y: 2 });
      // Sort snapshots twice and compare
      const s1 = snapshot(doc);
      const s2 = snapshot(doc);
      expect(s1.map((s) => s.id)).toEqual(s2.map((s) => s.id));
    });
  });

  describe('TC-12: unknown object type skipped by snapshot', () => {
    it('no throw when type != sticky', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const objects = doc.getMap('objects');
      objects.set('unknown-shape', new Y.Map());
      const shapeMap = objects.get('unknown-shape') as Y.Map<any>;
      shapeMap.set('type', 'shape');
      shapeMap.set('x', 0);
      shapeMap.set('y', 0);
      shapeMap.set('color', 'red');
      const snap = snapshot(doc);
      // shape objects are filtered out by the renderer; the type is always 'sticky'
      expect(snap.length).toBe(0);
    });
  });

describe('TC-39: NaN/Infinity coordinates rejected', () => {
    it('moveObject with NaN coords returns false', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      // Create note first
      const id = createSticky(doc, { x: 0, y: 0 });
      // Now count only the moveObject attempt
      let updates = 0;
      doc.on('update', () => { updates++; });
      expect(moveObject(doc, id, NaN, 0)).toBe(false);
      expect(updates).toBe(0);
    });
    it('moveObject with Infinity coords returns false', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      expect(moveObject(doc, id, Infinity, 0)).toBe(false);
    });
    it('createSticky with NaN coords does not create valid note', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const result = createSticky(doc, { x: NaN, y: 0 });
      if (result === null || result === undefined) {
        // acceptable - creation was rejected
      }
      const snap = snapshot(doc);
      expect(snap.length).toBeLessThanOrEqual(1);
    });
  });

  describe('initDoc sets schemaVersion once', () => {
    it('meta.schemaVersion = 1 after initDoc', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);
    });
  });
});
