// Unit tests for the board document model (board.model, TC-01 to TC-12).
// Uses a real Y.Doc (no mocks); each mutation also counts `update` events:
// exactly 1 for a successful mutation, 0 for a rejection.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObject,
  bringToFront,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

interface UpdateSpy {
  count: number;
  off: () => void;
}

/** Counts Yjs update events on the doc (one per transaction). */
function spyUpdates(doc: Y.Doc): UpdateSpy {
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function stickies(doc: Y.Doc): StickySnapshot[] {
  return [...snapshot(doc)];
}

describe('board.model (real Y.Doc)', () => {
  it('TC-01: createSticky on empty doc → 1 sticky, yellow, empty text, z 1, centred', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    expect(updates.count).toBe(1);
    const [note] = stickies(doc);
    expect(note).toEqual({
      id,
      type: 'sticky',
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      createdAt: note.createdAt,
    });
    expect(note.createdAt).toBeTypeOf('number');
    expect(Number.isFinite(note.createdAt)).toBe(true);
    updates.off();
  });

  it('TC-02: create with existing z 1,2 → new note gets z 3', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);

    const updates = spyUpdates(doc);
    const c = createSticky(doc, { x: 20, y: 20 });
    expect(updates.count).toBe(1);

    const byId = new Map(stickies(doc).map((n) => [n.id, n]));
    expect(byId.get(a)!.z).toBe(1);
    expect(byId.get(b)!.z).toBe(2);
    expect(byId.get(c)!.z).toBe(3);
    updates.off();
  });

  it('TC-03: moveObject updates x,y and leaves every other field unchanged', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = stickies(doc)[0];
    expect([before.x, before.y]).toEqual([-STICKY_SIZE_WORLD / 2, -STICKY_SIZE_WORLD / 2]);

    const updates = spyUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates.count).toBe(1);

    const after = stickies(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    // Other fields unchanged.
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    updates.off();
  });

  it('TC-04 (negative): moveObject on a stale id → false, no update emitted', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);

    expect(moveObject(doc, 'missing-id', 10, -20)).toBe(false);
    expect(updates.count).toBe(0);
    expect(stickies(doc)).toHaveLength(0);
    updates.off();
  });

  it('TC-05: setStickyColor green → colour applied', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(stickies(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);

    const updates = spyUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates.count).toBe(1);
    expect(stickies(doc)[0].color).toBe('green');
    updates.off();
  });

  it('TC-06 (negative): setStickyColor with unknown colour → false, unchanged, no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = spyUpdates(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates.count).toBe(0);
    expect(stickies(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    updates.off();
  });

  it('TC-07: deleteObject → note removed', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(stickies(doc)).toHaveLength(1);

    const updates = spyUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count).toBe(1);
    expect(stickies(doc)).toHaveLength(0);
    updates.off();
  });

  it('TC-08 (negative): deleteObject on a stale id → false, no update', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);

    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(updates.count).toBe(0);
    updates.off();
  });

  it('TC-09: bringToFront on z 1 of 3 → z 4', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 1, y: 1 }); // z 2
    const c = createSticky(doc, { x: 2, y: 2 }); // z 3
    const byId = new Map(stickies(doc).map((n) => [n.id, n]));
    expect([byId.get(a)!.z, byId.get(b)!.z, byId.get(c)!.z]).toEqual([1, 2, 3]);

    const updates = spyUpdates(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates.count).toBe(1);
    expect(new Map(stickies(doc).map((n) => [n.id, n])).get(a)!.z).toBe(4);
    updates.off();
  });

  it('TC-10 (negative): bringToFront on the topmost note → no update emitted', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 1 }); // topmost, z 2

    const updates = spyUpdates(doc);
    expect(bringToFront(doc, b)).toBe(false);
    expect(updates.count).toBe(0);
    expect(new Map(stickies(doc).map((n) => [n.id, n])).get(b)!.z).toBe(2);
    expect(new Map(stickies(doc).map((n) => [n.id, n])).get(a)!.z).toBe(1);
    updates.off();
  });

  it('TC-11: equal z → snapshot ordered by id tie-break, stable across calls', () => {
    const doc = newDoc();
    // Simulate concurrent equal-z values (possible once story 3 syncs).
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 1 });
    const objects = doc.getMap('objects');
    const high = Math.max(
      (objects.get(a) as Y.Map<unknown>).get('z') as number,
      (objects.get(b) as Y.Map<unknown>).get('z') as number,
    );
    doc.transact(() => {
      (objects.get(a) as Y.Map<unknown>).set('z', high);
      (objects.get(b) as Y.Map<unknown>).set('z', high);
    });

    const order = (): string[] => stickies(doc).map((n) => n.id);
    const first = order();
    const [lo, hi] = [a, b].sort();
    expect(first).toEqual([lo, hi]);
    // Stable across repeated calls.
    expect(order()).toEqual(first);
    expect(order()).toEqual(first);
  });

  it('TC-12: snapshot skips unknown object types without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 5);
      shape.set('y', 6);
      objects.set('shape-1', shape);
    });

    expect(() => snapshot(doc)).not.toThrow();
    const notes = stickies(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
  });

  it('extra: non-finite coordinates are rejected with no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = spyUpdates(doc);

    expect(moveObject(doc, id, Number.NaN, 5)).toBe(false);
    expect(moveObject(doc, id, 5, Number.POSITIVE_INFINITY)).toBe(false);
    // createSticky cannot return false (its contract returns the new id);
    // non-finite input is rejected the same way: no transaction, id '' (documented in NOTES.md).
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBe('');
    expect(updates.count).toBe(0);
    expect(stickies(doc)).toHaveLength(1);
    updates.off();
  });

  it('extra: initDoc sets meta.schemaVersion once and never overwrites it', () => {
    const doc = new Y.Doc();
    const meta = doc.getMap('meta');
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(1);

    // Simulate a future schema version in the doc; initDoc must not clobber it.
    meta.set('schemaVersion', 2);
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(2);
  });

  it('extra: getStickyText returns the Y.Text for stickies and undefined otherwise', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');

    // Unknown type is not a sticky.
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      objects.set('shape-1', shape);
    });
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
    expect(getStickyText(doc, 'missing-id')).toBeUndefined();
  });

  it('extra: snapshot text reflects Y.Text content (within the limit)', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id)!;
    doc.transact(() => {
      text.insert(0, 'hello '.repeat(100).trim()); // well under the limit
    });
    const note = stickies(doc)[0];
    expect(note.text).toBe('hello '.repeat(100).trim());
    expect(note.text.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
  });
});
