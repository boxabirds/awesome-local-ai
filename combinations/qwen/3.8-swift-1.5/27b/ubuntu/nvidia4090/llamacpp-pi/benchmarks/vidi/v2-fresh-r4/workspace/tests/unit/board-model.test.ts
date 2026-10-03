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
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

interface UpdateCounter {
  count: number;
  off(): void;
}

function countUpdates(doc: Y.Doc): UpdateCounter {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    get count() { return count; },
    off: () => doc.off('update', handler),
  };
}

describe('board-model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  describe('initDoc', () => {
    it('sets meta.schemaVersion once', () => {
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);
      // Calling again should not throw
      initDoc(doc);
      expect(meta.get('schemaVersion')).toBe(1);
    });
  });

  // TC-01
  it('TC-01: create on empty doc creates 1 sticky with correct defaults', () => {
    const updates = countUpdates(doc);
    const id = createSticky(doc, { x: 100, y: 200 });
    updates.off();

    expect(id).toBeTypeOf('string');
    expect(id.length).toBeGreaterThan(0);

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].type).toBe('sticky');
    expect(snaps[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snaps[0].text).toBe('');
    expect(snaps[0].z).toBe(1);
    // Centred: x = 100 - 100 = 0, y = 200 - 100 = 100
    expect(snaps[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snaps[0].y).toBe(200 - STICKY_SIZE_WORLD / 2);
    expect(updates.count).toBe(1);
  });

  // TC-02
  it('TC-02: create with existing z 1,2 → new z 3', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 50 });
    expect(snapshot(doc).find((s) => s.id === id1)!.z).toBe(1);
    expect(snapshot(doc).find((s) => s.id === id2)!.z).toBe(2);

    const id3 = createSticky(doc, { x: 100, y: 100 });
    expect(snapshot(doc).find((s) => s.id === id3)!.z).toBe(3);
  });

  // TC-03
  it('TC-03: moveObject updates x,y, other fields unchanged', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc).find((s) => s.id === id)!;
    expect(before.x).toBe(0);
    expect(before.y).toBe(0);

    const updates = countUpdates(doc);
    const result = moveObject(doc, id, 10, -20);
    updates.off();

    expect(result).toBe(true);
    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(updates.count).toBe(1);
  });

  // TC-04 (negative)
  it('TC-04: moveObject on stale id returns false, 0 updates', () => {
    const updates = countUpdates(doc);
    const result = moveObject(doc, 'nonexistent-id', 10, 20);
    updates.off();
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // TC-05
  it('TC-05: setStickyColor green → applied, text/x/y/z unchanged', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc).find((s) => s.id === id)!;

    const updates = countUpdates(doc);
    const result = setStickyColor(doc, id, 'green');
    updates.off();

    expect(result).toBe(true);
    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(updates.count).toBe(1);
  });

  // TC-06 (negative)
  it('TC-06: setStickyColor with unknown colour returns false, 0 updates', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const updates = countUpdates(doc);
    const result = setStickyColor(doc, id, 'teal');
    updates.off();
    expect(result).toBe(false);
    expect(snapshot(doc).find((s) => s.id === id)!.color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates.count).toBe(0);
  });

  // TC-07
  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const updates = countUpdates(doc);
    const result = deleteObject(doc, id);
    updates.off();

    expect(result).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates.count).toBe(1);
  });

  // TC-08 (negative)
  it('TC-08: deleteObject on stale id returns false, 0 updates', () => {
    const updates = countUpdates(doc);
    const result = deleteObject(doc, 'nonexistent-id');
    updates.off();
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // TC-09
  it('TC-09: bringToFront z1 of 3 → z 4', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    createSticky(doc, { x: 100, y: 0 });
    expect(snapshot(doc).find((s) => s.id === id1)!.z).toBe(1);

    const updates = countUpdates(doc);
    const result = bringToFront(doc, id1);
    updates.off();

    expect(result).toBe(true);
    expect(snapshot(doc).find((s) => s.id === id1)!.z).toBe(4);
    expect(updates.count).toBe(1);
  });

  // TC-10 (negative)
  it('TC-10: bringToFront on topmost → no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 0 });
    // id2 is topmost (z=2)
    const updates = countUpdates(doc);
    const result = bringToFront(doc, id2);
    updates.off();
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // TC-11
  it('TC-11: equal z → snapshot sorted by id tie-break, stable', () => {
    // Create two notes, then manually set them to the same z
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 0 });

    // Set both to z=1 to create a tie
    const objects = doc.getMap('objects');
    doc.transact(() => {
      (objects.get(id1) as Y.Map<unknown>).set('z', 1);
      (objects.get(id2) as Y.Map<unknown>).set('z', 1);
    }, LOCAL_ORIGIN);

    const snaps1 = snapshot(doc);
    const snaps2 = snapshot(doc);
    // Both have z=1, so sorted by id
    expect(snaps1[0].id).toBe(snaps2[0].id);
    expect(snaps1[1].id).toBe(snaps2[1].id);
    // The one with smaller id string comes first
    expect(snaps1[0].id.localeCompare(snaps1[1].id)).toBeLessThan(0);
  });

  // TC-12
  it('TC-12: unknown object type in doc → skipped by snapshot, no throw', () => {
    createSticky(doc, { x: 0, y: 0 });
    // Manually add an unknown type
    const objects = doc.getMap('objects');
    const fakeObj = new Y.Map<unknown>();
    fakeObj.set('type', 'shape');
    fakeObj.set('x', 0);
    fakeObj.set('y', 0);
    doc.transact(() => {
      objects.set('fake-id-123', fakeObj);
    }, LOCAL_ORIGIN);

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].type).toBe('sticky');
  });

  // TC-39 (negative)
  it('TC-39: moveObject and createSticky with NaN/Infinity → false/empty, 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    // NaN
    let updates = countUpdates(doc);
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Infinity)).toBe(false);
    updates.off();
    expect(updates.count).toBe(0);

    // createSticky with NaN
    updates = countUpdates(doc);
    const newId = createSticky(doc, { x: NaN, y: 0 });
    updates.off();
    expect(newId).toBe('');
    expect(updates.count).toBe(0);

    // createSticky with Infinity
    updates = countUpdates(doc);
    const newId2 = createSticky(doc, { x: 0, y: Infinity });
    updates.off();
    expect(newId2).toBe('');
    expect(updates.count).toBe(0);
  });

  // Extra: getStickyText
  it('getStickyText returns Y.Text for existing note, undefined for stale id', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');

    expect(getStickyText(doc, 'nonexistent')).toBeUndefined();
  });
});
