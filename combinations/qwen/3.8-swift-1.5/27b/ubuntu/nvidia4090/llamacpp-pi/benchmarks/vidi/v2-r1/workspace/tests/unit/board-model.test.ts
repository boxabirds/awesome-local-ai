import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc, createSticky, moveObject, bringToFront, setStickyColor,
  deleteObject, snapshot, LOCAL_ORIGIN,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): { count: number; stop: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    get count() { return count; },
    stop: () => doc.off('update', handler),
  };
}

describe('board.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-01: create on empty doc
  it('TC-01: createSticky on empty doc creates 1 object with correct defaults', () => {
    const updates = countUpdates(doc);
    const id = createSticky(doc, { x: 100, y: 200 });
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].type).toBe('sticky');
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
    // centred: top-left = point - STICKY_SIZE_WORLD/2
    expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(200 - STICKY_SIZE_WORLD / 2);
    expect(updates.count).toBe(1);
    updates.stop();
  });

  // TC-02: create with existing z 1,2 → new z 3
  it('TC-02: createSticky with existing notes assigns z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 50 });
    const id3 = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const note3 = snap.find(s => s.id === id3)!;
    expect(note3.z).toBe(3);
  });

  // TC-03: moveObject updates x,y, other fields unchanged
  it('TC-03: moveObject updates position, other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc).find(s => s.id === id)!;
    const updates = countUpdates(doc);
    const result = moveObject(doc, id, 10, -20);
    expect(result).toBe(true);
    const after = snapshot(doc).find(s => s.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates.count).toBe(1);
    updates.stop();
  });

  // TC-04: moveObject on stale id → false, 0 updates
  it('TC-04: moveObject on stale id returns false with 0 updates', () => {
    const updates = countUpdates(doc);
    const result = moveObject(doc, 'nonexistent-id', 10, 20);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  // TC-05: setStickyColor green → applied, other fields unchanged
  it('TC-05: setStickyColor changes colour, other fields unchanged', () => {
    const id = createSticky(doc, { x: 10, y: 20 });
    const before = snapshot(doc).find(s => s.id === id)!;
    const updates = countUpdates(doc);
    const result = setStickyColor(doc, id, 'green');
    expect(result).toBe(true);
    const after = snapshot(doc).find(s => s.id === id)!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(updates.count).toBe(1);
    updates.stop();
  });

  // TC-06: setStickyColor 'teal' → false, unchanged, 0 updates
  it('TC-06: setStickyColor with unknown colour returns false', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc).find(s => s.id === id)!;
    const updates = countUpdates(doc);
    const result = setStickyColor(doc, id, 'teal');
    expect(result).toBe(false);
    const after = snapshot(doc).find(s => s.id === id)!;
    expect(after.color).toBe(before.color);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  // TC-07: deleteObject removes the note
  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const updates = countUpdates(doc);
    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates.count).toBe(1);
    updates.stop();
  });

  // TC-08: deleteObject on stale id → false, 0 updates
  it('TC-08: deleteObject on stale id returns false with 0 updates', () => {
    const updates = countUpdates(doc);
    const result = deleteObject(doc, 'nonexistent-id');
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  // TC-09: bringToFront z1 of 3 → z 4
  it('TC-09: bringToFront on bottom note gives it the highest z', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    createSticky(doc, { x: 100, y: 0 });
    const updates = countUpdates(doc);
    const result = bringToFront(doc, id1);
    expect(result).toBe(true);
    const note = snapshot(doc).find(s => s.id === id1)!;
    expect(note.z).toBe(4);
    expect(updates.count).toBe(1);
    updates.stop();
  });

  // TC-10: bringToFront on topmost → no update
  it('TC-10: bringToFront on topmost note returns false with 0 updates', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    const id3 = createSticky(doc, { x: 100, y: 0 });
    // id3 is topmost (z=3)
    const updates = countUpdates(doc);
    const result = bringToFront(doc, id3);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  it('TC-11: snapshot sorts by (z, id) with id as tie-break', () => {
    // Create two notes, then manually set them to the same z
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 0 });
    // Force same z
    const objects = doc.getMap('objects');
    const obj1 = objects.get(id1) as Y.Map<unknown>;
    const obj2 = objects.get(id2) as Y.Map<unknown>;
    doc.transact(() => {
      obj1.set('z', 5);
      obj2.set('z', 5);
    }, LOCAL_ORIGIN);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(2);
    // Sorted by id as tie-break
    const [first, second] = snap;
    expect(first.id < second.id).toBe(true);
    // Stable across calls
    const snap2 = snapshot(doc);
    expect(snap2[0].id).toBe(snap[0].id);
    expect(snap2[1].id).toBe(snap[1].id);
  });

  // TC-12: unknown object type → skipped by snapshot, no throw
  it('TC-12: snapshot skips unknown object types without throwing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    // Add an unknown type object
    const objects = doc.getMap('objects');
    const unknownObj = new Y.Map();
    unknownObj.set('type', 'shape');
    unknownObj.set('x', 0);
    unknownObj.set('y', 0);
    doc.transact(() => {
      objects.set('unknown-1', unknownObj);
    }, LOCAL_ORIGIN);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
  });

  // TC-39: moveObject and createSticky with NaN/Infinity → false, 0 updates
  it('TC-39a: moveObject with NaN coordinates returns false', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    const result = moveObject(doc, id, NaN, 0);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-39b: moveObject with Infinity coordinates returns false', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    const result = moveObject(doc, id, Infinity, 0);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-39c: createSticky with NaN coordinates returns empty string or throws', () => {
    const updates = countUpdates(doc);
    // createSticky with non-finite coords should not create
    expect(() => {
      const result = createSticky(doc, { x: NaN, y: 0 });
      // Should return empty string or not create
      if (result) {
        expect(snapshot(doc)).toHaveLength(0);
      }
    }).not.toThrow();
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-39d: createSticky with Infinity coordinates returns empty string', () => {
    const updates = countUpdates(doc);
    expect(() => {
      const result = createSticky(doc, { x: Infinity, y: 0 });
      if (result) {
        expect(snapshot(doc)).toHaveLength(0);
      }
    }).not.toThrow();
    expect(updates.count).toBe(0);
    updates.stop();
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('initDoc sets meta.schemaVersion to 1', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('initDoc does not overwrite existing schemaVersion', () => {
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 2);
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(2);
  });
});
