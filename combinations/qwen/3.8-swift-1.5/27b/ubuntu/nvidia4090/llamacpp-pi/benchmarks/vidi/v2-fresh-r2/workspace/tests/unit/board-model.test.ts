/**
 * Unit tests for the Yjs board model (board.model contract).
 * Uses a real Y.Doc — no mocks.
 *
 * TC-01 to TC-12, TC-39.
 */
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
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '../../src/shared/config';

/** Count `update` events on a doc for the duration of a callback. */
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
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: create on empty doc
  it('TC-01: createSticky on empty doc creates 1 object with correct fields', () => {
    const updates = countUpdates(doc, () => {
      const id = createSticky(doc, { x: 100, y: 200 });
      expect(id).toBeTypeOf('string');
      expect(id.length).toBeGreaterThan(0);
    });
    expect(updates).toBe(1);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].type).toBe('sticky');
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
    // Centred: top-left = point - size/2
    expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(200 - STICKY_SIZE_WORLD / 2);
  });

  // TC-02: create with existing z 1,2 → new z 3
  it('TC-02: createSticky assigns z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 50 });
    const updates = countUpdates(doc, () => {
      createSticky(doc, { x: 100, y: 100 });
    });
    expect(updates).toBe(1);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(3);
    const zs = snap.map((s) => s.z).sort((a, b) => a - b);
    expect(zs).toEqual([1, 2, 3]);
  });

  // TC-03: moveObject updates x,y, other fields unchanged
  it('TC-03: moveObject updates position, other fields unchanged', () => {
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
    expect(after.createdAt).toBe(before.createdAt);
  });

  // TC-04: moveObject stale id → false, 0 updates
  it('TC-04: moveObject on stale id returns false, 0 updates', () => {
    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, 'nonexistent-id', 10, 20);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-05: setStickyColor green → applied; text, x, y, z unchanged
  it('TC-05: setStickyColor changes colour, other fields unchanged', () => {
    const id = createSticky(doc, { x: 10, y: 20 });
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
  it('TC-06: setStickyColor with unknown colour returns false, 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const updates = countUpdates(doc, () => {
      const ok = setStickyColor(doc, id, 'teal');
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
    const after = snapshot(doc)[0];
    expect(after.color).toBe(before.color);
  });

  // TC-07: deleteObject → removed
  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const updates = countUpdates(doc, () => {
      const ok = deleteObject(doc, id);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08: deleteObject stale id → false, 0 updates
  it('TC-08: deleteObject on stale id returns false, 0 updates', () => {
    const updates = countUpdates(doc, () => {
      const ok = deleteObject(doc, 'nonexistent-id');
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-09: bringToFront z1 of 3 → z 4
  it('TC-09: bringToFront sets z to maxZ + 1', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 50 });
    createSticky(doc, { x: 100, y: 100 });
    // id1 has z=1
    const updates = countUpdates(doc, () => {
      const ok = bringToFront(doc, id1);
      expect(ok).toBe(true);
    });
    expect(updates).toBe(1);
    const snap = snapshot(doc);
    const moved = snap.find((s) => s.id === id1)!;
    expect(moved.z).toBe(4);
  });

  // TC-10: bringToFront on topmost → no update
  it('TC-10: bringToFront on topmost note returns false, 0 updates', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 50 });
    // id2 is topmost (z=2)
    const updates = countUpdates(doc, () => {
      const ok = bringToFront(doc, id2);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  it('TC-11: snapshot with equal z is sorted by id as tie-break', () => {
    // Create notes and force equal z values
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 50 });
    const id3 = createSticky(doc, { x: 100, y: 100 });

    // Set all to the same z to test tie-breaking
    const objects = (doc as any).getMap('objects') as Y.Map<any>;
    objects.get(id1).set('z', 5);
    objects.get(id2).set('z', 5);
    objects.get(id3).set('z', 5);

    const snap1 = snapshot(doc);
    const snap2 = snapshot(doc);

    // Sorted by id
    const ids = snap1.map((s) => s.id);
    const sortedIds = [...ids].sort();
    expect(ids).toEqual(sortedIds);

    // Stable across calls
    expect(snap1.map((s) => s.id)).toEqual(snap2.map((s) => s.id));
  });

  // TC-12: unknown object type in doc → skipped by snapshot, no throw
  it('TC-12: snapshot skips unknown types without throwing', () => {
    const objects = (doc as any).getMap('objects') as Y.Map<any>;
    const fakeObj = new Y.Map();
    fakeObj.set('type', 'shape');
    fakeObj.set('x', 0);
    fakeObj.set('y', 0);
    fakeObj.set('z', 1);
    objects.set('fake-id', fakeObj);

    // Should not throw
    const snap = snapshot(doc);
    expect(snap).toHaveLength(0);
  });

  // TC-39: moveObject and createSticky with NaN/Infinity → false, 0 updates
  it('TC-39a: createSticky with NaN coordinates returns without creating', () => {
    const updates = countUpdates(doc, () => {
      expect(() => createSticky(doc, { x: NaN, y: 0 })).toThrow();
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-39b: createSticky with Infinity coordinates returns without creating', () => {
    const updates = countUpdates(doc, () => {
      expect(() => createSticky(doc, { x: Infinity, y: 0 })).toThrow();
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-39c: moveObject with NaN returns false, 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, id, NaN, 0);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-39d: moveObject with Infinity returns false, 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, id, 0, -Infinity);
      expect(ok).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('initDoc sets meta.schemaVersion to 1 and does not overwrite', () => {
    const meta = (doc as any).getMap('meta') as Y.Map<any>;
    expect(meta.get('schemaVersion')).toBe(1);

    // Call again — should not change
    meta.set('schemaVersion', 99);
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(99);
  });

  // getStickyText returns the Y.Text
  it('getStickyText returns the Y.Text for a sticky note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
  });

  it('getStickyText returns undefined for unknown id', () => {
    const text = getStickyText(doc, 'nonexistent');
    expect(text).toBeUndefined();
  });
});
