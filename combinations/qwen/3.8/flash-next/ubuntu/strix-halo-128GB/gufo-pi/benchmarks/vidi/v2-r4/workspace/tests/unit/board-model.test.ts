import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Count `update` events emitted by a doc while `fn` runs. */
function countUpdates(doc: Y.Doc, fn: () => void): { updates: number; result: unknown } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  try {
    const result = fn();
    return { updates, result };
  } finally {
    doc.off('update', listener);
  }
}

describe('board.model — create', () => {
  it('TC-01 creates the first sticky centred on the point, yellow, z 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { updates, result } = countUpdates(doc, () => createSticky(doc, { x: 100, y: 100 }));
    const id = result as string;
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.x).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2, 6);
    expect(Number.isFinite(note.createdAt)).toBe(true);
  });

  it('TC-02 creates with z = maxZ + 1 when notes exist at z 1 and 2', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const notes = snapshot(doc);
    expect(notes.map((n) => n.z).sort((a, b) => a - b)).toEqual([1, 2]);
    const { updates, result } = countUpdates(doc, () => createSticky(doc, { x: 0, y: 300 }));
    expect(updates).toBe(1);
    const created = snapshot(doc).find((n) => n.id === result);
    expect(created?.z).toBe(3);
  });

  it('TC-39 rejects non-finite coordinates with false and no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    for (const point of [
      { x: NaN, y: 0 },
      { x: 0, y: NaN },
      { x: Infinity, y: 0 },
      { x: 0, y: -Infinity },
    ]) {
      const { updates, result } = countUpdates(doc, () => createSticky(doc, point));
      expect(result).toBe('');
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model — move', () => {
  it('TC-03 moves a note and leaves other fields unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 }, 'green');
    const before = snapshot(doc)[0]!;
    const { updates, result } = countUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = snapshot(doc)[0]!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const { updates, result } = countUpdates(doc, () =>
      moveObject(doc, 'missing-id', 5, 5),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-39 moveObject with NaN or Infinity coordinates returns false, 0 updates', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0]!;
    for (const [x, y] of [
      [NaN, 0],
      [0, NaN],
      [Infinity, 1],
      [1, -Infinity],
    ]) {
      const { updates, result } = countUpdates(doc, () => moveObject(doc, id, x, y));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    const after = snapshot(doc)[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('board.model — colour', () => {
  it('TC-05 setStickyColor applies and touches nothing else', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 7, y: 9 });
    const ytext = getStickyText(doc, id);
    ytext?.insert(0, 'hello');
    const before = snapshot(doc)[0]!;
    const { updates, result } = countUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = snapshot(doc)[0]!;
    expect(after.color).toBe('green');
    expect(after.text).toBe('hello');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06 setStickyColor with an unknown colour returns false, 0 updates', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const { updates, result } = countUpdates(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('accepts all six colour names', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    for (const name of Object.keys(STICKY_COLORS) as StickyColor[]) {
      expect(setStickyColor(doc, id, name)).toBe(true);
      expect(snapshot(doc)[0]!.color).toBe(name);
    }
  });
});

describe('board.model — delete', () => {
  it('TC-07 deleteObject removes the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const { updates, result } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const { updates, result } = countUpdates(doc, () => deleteObject(doc, 'missing-id'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('board.model — stacking', () => {
  it('TC-09 bringToFront moves the bottom note of three to the top', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const id = createSticky(doc, { x: 0, y: 0 });
    // ids created in order; z 1, 2, 3 — bring the first to front
    const first = snapshot(doc).find((n) => n.z === 1)!.id;
    const { updates, result } = countUpdates(doc, () => bringToFront(doc, first));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = snapshot(doc);
    expect(after.find((n) => n.id === first)?.z).toBe(4);
    expect(id).toBeTruthy();
  });

  it('TC-10 bringToFront on the topmost note returns false with no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const top = snapshot(doc).reduce((a, b) => (a.z > b.z ? a : b)).id;
    const { updates, result } = countUpdates(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11 snapshot sorts by (z, id): equal z breaks ties by id, stable', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Force two notes with equal z by writing the doc directly.
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      for (const id of ['b-id', 'a-id', 'c-id']) {
        const map = new Y.Map();
        map.set('type', 'sticky');
        map.set('x', 0);
        map.set('y', 0);
        map.set('color', 'yellow');
        map.set('text', new Y.Text());
        map.set('z', 1);
        map.set('createdAt', 0);
        objects.set(id, map);
      }
    });
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a-id', 'b-id', 'c-id']);
    // stable across calls
    expect(snapshot(doc).map((n) => n.id)).toEqual(first);
  });

  it('TC-12 snapshot skips objects with an unknown type without throwing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('z', 99);
      objects.set('shape-1', shape);
    });
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe('sticky');
  });
});

describe('board.model — initDoc', () => {
  it('sets meta.schemaVersion to 1 once and leaves an existing value alone', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    const { updates } = countUpdates(doc, () => initDoc(doc));
    expect(updates).toBe(0);
    meta.set('schemaVersion', 7);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(7);
  });
});
