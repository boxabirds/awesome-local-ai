// Unit tests for the board model (board.model contract) using a real Y.Doc.
// TC-01 to TC-12, TC-39.

import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  bringToFront,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count `update` events emitted on the doc during `fn`. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

describe('board.model', () => {
  // TC-01: create on empty doc
  test('TC-01 createSticky on empty doc: 1 object, type sticky, default colour, empty text, z 1', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 200 });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
    });
    // Creation is centred: top-left = point - SIZE/2
    expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(200 - STICKY_SIZE_WORLD / 2);
  });

  // TC-02: create with existing z 1,2 → new z 3
  test('TC-02 createSticky with existing notes: new z = maxZ + 1', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 });
    const id3 = createSticky(doc, { x: 20, y: 20 });

    const snap = snapshot(doc);
    const note3 = snap.find((s) => s.id === id3)!;
    expect(note3.z).toBe(3);
  });

  // TC-03: moveObject updates x,y, other fields unchanged
  test('TC-03 moveObject updates position, other fields unchanged', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];

    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, id, 10, -20);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
  });

  // TC-04: moveObject on stale id → false, 0 updates
  test('TC-04 moveObject on stale id returns false, 0 updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, 'nonexistent-id', 10, 20);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-05: setStickyColor green → applied, text/x/y/z unchanged
  test('TC-05 setStickyColor to green: applied, other fields unchanged', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 50, y: 60 });
    const before = snapshot(doc)[0];

    const updates = countUpdates(doc, () => {
      const ok = setStickyColor(doc, id, 'green');
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  // TC-06: setStickyColor 'teal' → false, unchanged, 0 updates
  test('TC-06 setStickyColor with unknown colour returns false, 0 updates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const updates = countUpdates(doc, () => {
      const ok = setStickyColor(doc, id, 'teal');
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);

    const snap = snapshot(doc)[0];
    expect(snap.color).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-07: deleteObject removes the note
  test('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const updates = countUpdates(doc, () => {
      const ok = deleteObject(doc, id);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08: deleteObject on stale id → false, 0 updates
  test('TC-08 deleteObject on stale id returns false, 0 updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const ok = deleteObject(doc, 'nonexistent-id');
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-09: bringToFront z1 of 3 → z 4
  test('TC-09 bringToFront on bottom note of 3: z becomes 4', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 }); // z=1
    createSticky(doc, { x: 10, y: 10 });           // z=2
    createSticky(doc, { x: 20, y: 20 });           // z=3

    const updates = countUpdates(doc, () => {
      const ok = bringToFront(doc, id1);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);

    const snap = snapshot(doc);
    const note1 = snap.find((s) => s.id === id1)!;
    expect(note1.z).toBe(4);
  });

  // TC-10: bringToFront on topmost → no update
  test('TC-10 bringToFront on topmost note: returns false, 0 updates', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 }); // z=1
    const id2 = createSticky(doc, { x: 10, y: 10 }); // z=2 (topmost)

    const updates = countUpdates(doc, () => {
      const ok = bringToFront(doc, id2);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  test('TC-11 equal z: snapshot sorted by id as tie-break, stable across calls', () => {
    const doc = newDoc();
    // Create two notes, then manually set them to the same z
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 });

    // Force equal z
    doc.transact(() => {
      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      (objects.get(id1) as Y.Map<unknown>).set('z', 5);
      (objects.get(id2) as Y.Map<unknown>).set('z', 5);
    });

    const snap1 = snapshot(doc);
    const snap2 = snapshot(doc);

    // Both sorted by (z, id) — with equal z, by id
    expect(snap1.length).toBe(2);
    expect(snap1[0].z).toBe(5);
    expect(snap1[1].z).toBe(5);
    // id tie-break: the one with lexicographically smaller id comes first
    expect(snap1[0].id < snap1[1].id).toBe(true);
    // Stable across calls
    expect(snap1.map((s) => s.id)).toEqual(snap2.map((s) => s.id));
  });

  // TC-12: unknown object type in doc → skipped by snapshot, no throw
  test('TC-12 unknown object type is skipped by snapshot, no throw', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });

    // Inject an unknown type directly
    doc.transact(() => {
      const objects = doc.getMap('objects');
      const fake = new Y.Map();
      fake.set('type', 'shape');
      fake.set('x', 0);
      fake.set('y', 0);
      objects.set('fake-shape-id', fake);
    });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].type).toBe('sticky');
  });

  // TC-39: moveObject and createSticky with NaN/Infinity → false, 0 updates
  test('TC-39a createSticky with NaN coordinates returns false-ish (no valid note)', () => {
    const doc = newDoc();
    const before = snapshot(doc).length;
    const updates = countUpdates(doc, () => {
      // createSticky with NaN should not create a valid note
      // The contract says non-finite coords → false, 0 updates
      // createSticky returns a string (id), so we check it didn't add
      const id = createSticky(doc, { x: NaN, y: 0 });
      // If it returns an empty string or the snapshot didn't change, that's the rejection
      expect(snapshot(doc).length).toBe(before);
    });
    expect(updates).toBe(0);
  });

  test('TC-39b createSticky with Infinity coordinates rejected', () => {
    const doc = newDoc();
    const before = snapshot(doc).length;
    const updates = countUpdates(doc, () => {
      createSticky(doc, { x: Infinity, y: 0 });
      expect(snapshot(doc).length).toBe(before);
    });
    expect(updates).toBe(0);
  });

  test('TC-39c moveObject with NaN coordinates returns false, 0 updates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, id, NaN, 0);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  test('TC-39d moveObject with Infinity coordinates returns false, 0 updates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, id, 0, -Infinity);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // Extra: initDoc sets meta.schemaVersion once
  test('initDoc sets meta.schemaVersion to 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);

    // Calling again should not throw and should keep it at 1
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  // getStickyText returns the Y.Text for a valid id
  test('getStickyText returns Y.Text for valid id, undefined for stale id', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');

    expect(getStickyText(doc, 'nonexistent')).toBeUndefined();
  });
});
