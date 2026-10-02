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

/**
 * Runs `fn` and counts the number of `update` events the doc emits.
 * A successful mutation is exactly one transaction → 1 update;
 * a rejected mutation opens no transaction → 0 updates.
 */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const handler = () => {
    updates++;
  };
  doc.on('update', handler);
  try {
    const result = fn();
    return { result, updates };
  } finally {
    doc.off('update', handler);
  }
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board.model (TC-01 to TC-12, TC-39)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  describe('initDoc', () => {
    it('sets meta.schemaVersion once and does not overwrite an existing value', () => {
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);

      // A second call must not clobber the value
      meta.set('schemaVersion', 42);
      initDoc(doc);
      expect(meta.get('schemaVersion')).toBe(42);
    });
  });

  it('TC-01 create on empty doc: 1 object, type sticky, default colour, empty text, z 1, centred', () => {
    const { result: id, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(typeof id).toBe('string');

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    const note = snap[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Creation is centred: top-left = point - STICKY_SIZE_WORLD / 2
    expect(note.x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(typeof note.createdAt).toBe('number');
  });

  it('TC-02 create with existing z 1,2 → new z 3', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    const { result: id, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 20, y: 20 }));
    expect(updates).toBe(1);

    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.z).toBe(3);
  });

  it('TC-03 moveObject → x,y updated, other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const before = snapshot(doc).find((n) => n.id === id)!;

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id → false, 0 updates (negative)', () => {
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, 'no-such-id', 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-05 setStickyColor green → applied; text, x, y, z unchanged', () => {
    const id = createSticky(doc, { x: 30, y: 40 }) as string;
    const before = snapshot(doc).find((n) => n.id === id)!;
    expect(before.color).toBe('yellow');

    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06 setStickyColor with unknown colour "teal" → false, unchanged, 0 updates (negative)', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.color).toBe('yellow');
  });

  it('TC-07 deleteObject → removed', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(snapshot(doc)).toHaveLength(1);

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 deleteObject on a stale id → false, 0 updates (negative)', () => {
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, 'no-such-id'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront on z 1 of 3 → z 4', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 }) as string;
    const id2 = createSticky(doc, { x: 10, y: 10 }) as string;
    const id3 = createSticky(doc, { x: 20, y: 20 }) as string;
    const before = snapshot(doc).find((n) => n.id === id1)!;
    expect(before.z).toBe(1);

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, id1));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id1)!;
    expect(after.z).toBe(4);
    // Render order is bottom-to-top: id1 is now on top (last)
    expect(snapshot(doc).map((n) => n.id)).toEqual([id2, id3, id1]);
  });

  it('TC-10 bringToFront on the topmost note → false, 0 updates (negative)', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 10, y: 10 }) as string;
    const topId = createSticky(doc, { x: 20, y: 20 }) as string;
    expect(id1).not.toBe(topId);

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, topId));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11 equal z → snapshot sorted by id tie-break, stable across calls', () => {
    const idA = createSticky(doc, { x: 0, y: 0 }) as string;
    const idB = createSticky(doc, { x: 10, y: 10 }) as string;

    // Force equal z values (possible once story 3 syncs concurrent creates)
    const objects = doc.getMap('objects');
    const mapA = objects.get(idA) as Y.Map<unknown>;
    const mapB = objects.get(idB) as Y.Map<unknown>;
    mapA.set('z', 5);
    mapB.set('z', 5);

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(second);

    const [lo, hi] = [idA, idB].sort();
    expect(first).toEqual([lo, hi]);
  });

  it('TC-12 unknown object type in doc → skipped by snapshot, no throw', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    // Inject an object of an unknown type (forward compatibility, stories 9–12)
    const objects = doc.getMap('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    objects.set('shape-1', shape);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0]!.id).toBe(id);
    expect(snap[0]!.type).toBe('sticky');
  });

  it('TC-39a createSticky with NaN coordinates → false, 0 updates (negative)', () => {
    const { result, updates } = withUpdateCount(doc, () => createSticky(doc, { x: NaN, y: 0 }));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-39b createSticky with Infinity coordinates → false, 0 updates (negative)', () => {
    const { result, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: Infinity }));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-39c moveObject with NaN coordinates → false, 0 updates (negative)', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, NaN, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-39d moveObject with -Infinity coordinates → false, 0 updates (negative)', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 5, -Infinity));
    expect(result).toBe(false);
    expect(updates).toBe(0);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.y).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('getStickyText returns the note Y.Text, undefined for stale ids', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });
});
