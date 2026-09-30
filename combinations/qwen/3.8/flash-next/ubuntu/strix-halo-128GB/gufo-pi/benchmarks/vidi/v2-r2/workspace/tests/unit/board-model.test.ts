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
  type StickySnapshot,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@shared/config';

describe('board-model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  describe('initDoc', () => {
    it('sets meta.schemaVersion to 1', () => {
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

  describe('createSticky', () => {
    // TC-01
    it('TC-01: creates first note on empty doc with correct defaults, z=1', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const id = createSticky(doc, { x: 100, y: 200 });
      expect(id).toBeTruthy();
      const snap = snapshot(doc);
      expect(snap.length).toBe(1);
      expect(snap[0].id).toBe(id);
      expect(snap[0].type).toBe('sticky');
      expect((snap[0] as StickySnapshot).color).toBe(DEFAULT_STICKY_COLOR);
      expect(snap[0].text).toBe('');
      expect(snap[0].z).toBe(1);
      // centred: top-left = point - STICKY_SIZE_WORLD/2
      expect(snap[0].x).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2, 9);
      expect(snap[0].y).toBeCloseTo(200 - STICKY_SIZE_WORLD / 2, 9);
      expect(updateCount).toBe(1);
    });

    // TC-02
    it('TC-02: creates note with z = maxZ + 1 when notes exist', () => {
      createSticky(doc, { x: 0, y: 0 }); // z=1
      createSticky(doc, { x: 300, y: 300 }); // z=2
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const id3 = createSticky(doc, { x: 500, y: 500 }); // z=3
      const snap = snapshot(doc);
      expect(snap.length).toBe(3);
      const note3 = snap.find((n) => n.id === id3)!;
      expect(note3.z).toBe(3);
      expect(updateCount).toBe(1);
    });

    // TC-39 (createSticky part)
    it('TC-39: createSticky with NaN coordinates returns empty string, 0 updates', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const id = createSticky(doc, { x: NaN, y: 100 });
      expect(id).toBe('');
      expect(updateCount).toBe(0);
      const id2 = createSticky(doc, { x: 100, y: Infinity });
      expect(id2).toBe('');
      expect(updateCount).toBe(0);
    });
  });

  describe('moveObject', () => {
    let id: string;
    beforeEach(() => {
      id = createSticky(doc, { x: 100, y: 100 });
    });

    // TC-03
    it('TC-03: moves note to new position, other fields unchanged', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = moveObject(doc, id, 10, -20);
      expect(result).toBe(true);
      const snap = snapshot(doc);
      expect(snap[0].x).toBe(10);
      expect(snap[0].y).toBe(-20);
      expect((snap[0] as StickySnapshot).color).toBe(DEFAULT_STICKY_COLOR);
      expect(snap[0].text).toBe('');
      expect(snap[0].z).toBe(1);
      expect(updateCount).toBe(1);
    });

    // TC-04
    it('TC-04: moveObject on stale id returns false, 0 updates', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = moveObject(doc, 'nonexistent-id', 50, 50);
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    });

    // TC-39 (moveObject part)
    it('TC-39: moveObject with NaN/Infinity returns false, 0 updates', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      expect(moveObject(doc, id, NaN, 0)).toBe(false);
      expect(moveObject(doc, id, 0, Infinity)).toBe(false);
      expect(moveObject(doc, id, -Infinity, 0)).toBe(false);
      expect(updateCount).toBe(0);
    });
  });

  describe('setStickyColor', () => {
    let id: string;
    beforeEach(() => {
      id = createSticky(doc, { x: 0, y: 0 });
    });

    // TC-05
    it('TC-05: changes colour, text/x/y/z unchanged', () => {
      moveObject(doc, id, 10, 20);
      const ytext = getStickyText(doc, id)!;
      ytext.insert(0, 'hello');
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = setStickyColor(doc, id, 'green');
      expect(result).toBe(true);
      const snap = snapshot(doc);
      expect((snap[0] as StickySnapshot).color).toBe('green');
      expect(snap[0].x).toBe(10);
      expect(snap[0].y).toBe(20);
      expect(snap[0].text).toBe('hello');
      expect(snap[0].z).toBe(1);
      expect(updateCount).toBe(1);
    });

    // TC-06
    it('TC-06: unknown colour returns false, 0 updates, colour unchanged', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = setStickyColor(doc, id, 'teal');
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
      const snap = snapshot(doc);
      expect((snap[0] as StickySnapshot).color).toBe(DEFAULT_STICKY_COLOR);
    });
  });

  describe('deleteObject', () => {
    // TC-07
    it('TC-07: deletes existing note', () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = deleteObject(doc, id);
      expect(result).toBe(true);
      expect(snapshot(doc).length).toBe(0);
      expect(updateCount).toBe(1);
    });

    // TC-08
    it('TC-08: deleteObject on stale id returns false, 0 updates', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = deleteObject(doc, 'nonexistent-id');
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    });
  });

  describe('bringToFront', () => {
    // TC-09
    it('TC-09: bringToFront z=1 of 3 → z=4', () => {
      const id1 = createSticky(doc, { x: 0, y: 0 }); // z=1
      createSticky(doc, { x: 300, y: 0 }); // z=2
      createSticky(doc, { x: 600, y: 0 }); // z=3
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = bringToFront(doc, id1);
      expect(result).toBe(true);
      const snap = snapshot(doc);
      const note1 = snap.find((n) => n.id === id1)!;
      expect(note1.z).toBe(4);
      expect(updateCount).toBe(1);
    });

    // TC-10
    it('TC-10: bringToFront on already topmost returns false, 0 updates', () => {
      createSticky(doc, { x: 0, y: 0 }); // z=1
      const id2 = createSticky(doc, { x: 300, y: 0 }); // z=2
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = bringToFront(doc, id2);
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    });
  });

  describe('snapshot', () => {
    // TC-11
    it('TC-11: equal z sorted by id tie-break, stable', () => {
      // Manually create two objects with the same z
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const idA = 'aaa';
      const idB = 'bbb';
      doc.transact(() => {
        const noteA = new Y.Map<unknown>();
        noteA.set('type', 'sticky');
        noteA.set('x', 0);
        noteA.set('y', 0);
        noteA.set('color', 'yellow');
        noteA.set('text', new Y.Text('A'));
        noteA.set('z', 1);
        noteA.set('createdAt', 1);
        objects.set(idA, noteA);

        const noteB = new Y.Map<unknown>();
        noteB.set('type', 'sticky');
        noteB.set('x', 100);
        noteB.set('y', 100);
        noteB.set('color', 'green');
        noteB.set('text', new Y.Text('B'));
        noteB.set('z', 1);
        noteB.set('createdAt', 2);
        objects.set(idB, noteB);
      });
      const snap = snapshot(doc);
      expect(snap.length).toBe(2);
      // idA ('aaa') < idB ('bbb') so A comes first
      expect(snap[0].id).toBe(idA);
      expect(snap[1].id).toBe(idB);
      // Stable across calls
      const snap2 = snapshot(doc);
      expect(snap2[0].id).toBe(idA);
      expect(snap2[1].id).toBe(idB);
    });

    // TC-12
    it('TC-12: unknown type objects are skipped, no throw', () => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      doc.transact(() => {
        const shape = new Y.Map<unknown>();
        shape.set('type', 'shape');
        shape.set('x', 0);
        shape.set('y', 0);
        objects.set('shape-1', shape);
      });
      const id = createSticky(doc, { x: 50, y: 50 });
      const snap = snapshot(doc);
      expect(snap.length).toBe(1);
      expect(snap[0].id).toBe(id);
    });
  });
});
