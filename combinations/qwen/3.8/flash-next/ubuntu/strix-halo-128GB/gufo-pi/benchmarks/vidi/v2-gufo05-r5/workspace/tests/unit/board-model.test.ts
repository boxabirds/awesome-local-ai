/**
 * board.model unit tests (TC-01 to TC-12, TC-39).
 *
 * Run against a real `Y.Doc`: Yjs is the store under test, it is deterministic
 * in-process, and mocking it would hide real merge/observe behaviour.
 *
 * Every mutation test also counts the `update` events the document emits: exactly 1
 * for a successful change (story 3 must be able to sync it) and 0 for a rejection
 * (a pointless sync message otherwise).
 */
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Opens a document the way the app does. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts the `update` events emitted while `fn` runs. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

/** Runs a mutation and returns its result together with the number of updates it emitted. */
function mutated<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let result!: T;
  const updates = countUpdates(doc, () => {
    result = fn();
  });
  return { result, updates };
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Writes a raw object into the document, bypassing the model (for hostile input). */
function writeRawObject(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
): Y.Map<unknown> {
  const raw = new Y.Map<unknown>();
  doc.transact(() => {
    for (const [key, value] of Object.entries(fields)) raw.set(key, value);
    objectsMap(doc).set(id, raw);
  });
  return raw;
}

function getNote(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((note) => note.id === id);
}

describe('board.model.create', () => {
  test('TC-01 creates the first note centred on the point, on top, yellow and empty', () => {
    const doc = newDoc();
    const { result: id, updates } = mutated(doc, () => createSticky(doc, { x: 0, y: 0 }));

    expect(typeof id).toBe('string');
    expect(id).not.toBe('');
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);

    const note = getNote(doc, id);
    expect(note).toBeDefined();
    expect(note?.type).toBe('sticky');
    expect(note?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note?.text).toBe('');
    expect(note?.z).toBe(1);
    // centred on the clicked point: the stored top-left is the point minus half the size
    expect(note?.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(note?.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(Number.isFinite(note?.createdAt)).toBe(true);
  });

  test('TC-02 a new note stacks above the notes that already exist (z 1,2 -> z 3)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2]);

    const { result: id, updates } = mutated(doc, () => createSticky(doc, { x: 0, y: 300 }));
    expect(updates).toBe(1);
    expect(getNote(doc, id)?.z).toBe(3);
  });

  test('the id is unique and getStickyText returns the note text', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    expect(a).not.toBe(b);
    expect(getStickyText(doc, a)?.toString()).toBe('');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });

  test('initDoc records the schema version once', () => {
    const doc = new Y.Doc();
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined();
    expect(countUpdates(doc, () => initDoc(doc))).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    // a second call (e.g. a document loaded in story 4) changes nothing
    expect(countUpdates(doc, () => initDoc(doc))).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});

describe('board.model.move', () => {
  test('TC-03 moveObject updates only the position', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    doc.transact(() => {
      getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    });
    const before = getNote(doc, id);
    if (!before) throw new Error('fixture is missing a note');

    const { result, updates } = mutated(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = getNote(doc, id);
    expect(after?.x).toBe(10);
    expect(after?.y).toBe(-20);
    expect(after?.color).toBe(before.color);
    expect(after?.text).toBe(before.text);
    expect(after?.z).toBe(before.z);
    expect(after?.createdAt).toBe(before.createdAt);
    expect(after?.id).toBe(before.id);
  });

  test('TC-04 moveObject on a stale id returns false and writes nothing', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = mutated(doc, () => moveObject(doc, 'gone', 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0]?.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
  });

  test('TC-39 non-finite coordinates are rejected (move and create)', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = getNote(doc, id);

    const badCoordinates: Array<[number, number]> = [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of badCoordinates) {
      const { result, updates } = mutated(doc, () => moveObject(doc, id, x, y));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    const unchanged = getNote(doc, id);
    expect(unchanged?.x).toBe(before?.x);
    expect(unchanged?.y).toBe(before?.y);

    // createSticky rejects too: no id, no object, no update
    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 1 },
      { x: 1, y: Number.NEGATIVE_INFINITY },
    ]) {
      const { result, updates } = mutated(doc, () => createSticky(doc, point));
      expect(result).toBe('');
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(1);
  });

  test('TC-09 bringToFront raises the bottom note of three above the top', () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    expect(getNote(doc, bottom)?.z).toBe(1);

    const { result, updates } = mutated(doc, () => bringToFront(doc, bottom));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(getNote(doc, bottom)?.z).toBe(4);
    expect(snapshot(doc)[snapshot(doc).length - 1]?.id).toBe(bottom);
  });

  test('TC-10 bringToFront on the topmost note emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });

    const { result, updates } = mutated(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(getNote(doc, top)?.z).toBe(2);
  });

  test('bringToFront on a stale id returns false with no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = mutated(doc, () => bringToFront(doc, 'gone'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model.color', () => {
  test('TC-05 setStickyColor changes only the colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 40, y: 60 });
    doc.transact(() => {
      getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    });
    createSticky(doc, { x: 0, y: 0 }); // give the note a neighbour so z matters
    const before = getNote(doc, id);
    if (!before) throw new Error('fixture is missing a note');

    const { result, updates } = mutated(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = getNote(doc, id);
    expect(after?.color).toBe('green');
    expect(after?.text).toBe(before.text);
    expect(after?.x).toBe(before.x);
    expect(after?.y).toBe(before.y);
    expect(after?.z).toBe(before.z);
  });

  test('every colour in the palette can be applied; re-applying the current one is a no-op', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    for (const name of Object.keys(STICKY_COLORS) as StickyColor[]) {
      if (name === getNote(doc, id)?.color) continue;
      const { result, updates } = mutated(doc, () => setStickyColor(doc, id, name));
      expect(result).toBe(true);
      expect(updates).toBe(1);
      expect(getNote(doc, id)?.color).toBe(name);
    }
    // setting the colour the note already has writes nothing (no pointless sync message)
    const current = getNote(doc, id)?.color as StickyColor;
    const { result, updates } = mutated(doc, () => setStickyColor(doc, id, current));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  test('TC-06 an unknown colour name is rejected without an update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    for (const bad of ['teal', 'YELLOW', '', 'rgb(0,255,0)', '#FFF59D']) {
      const { result, updates } = mutated(doc, () => setStickyColor(doc, id, bad));
      expect(result).toBe(false);
      expect(updates).toBe(0);
      expect(getNote(doc, id)?.color).toBe(DEFAULT_STICKY_COLOR);
    }
  });

  test('setStickyColor on a stale id returns false with no update', () => {
    const doc = newDoc();
    const { result, updates } = mutated(doc, () => setStickyColor(doc, 'gone', 'green'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model.delete', () => {
  test('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const keep = createSticky(doc, { x: 0, y: 0 });
    const gone = createSticky(doc, { x: 300, y: 0 });
    expect(snapshot(doc)).toHaveLength(2);

    const { result, updates } = mutated(doc, () => deleteObject(doc, gone));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]?.id).toBe(keep);
    expect(objectsMap(doc).has(gone)).toBe(false);
  });

  test('TC-08 deleteObject on a stale id returns false with no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = mutated(doc, () => deleteObject(doc, 'gone'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).map((note) => note.id)).toEqual([id]);
  });
});

describe('board.model.snapshot', () => {
  test('TC-11 notes with equal z are ordered by id, stably', () => {
    const doc = newDoc();
    // two notes forced to the same z, written in the opposite order to their ids
    const second = writeRawObject(doc, 'b-note', {
      type: 'sticky',
      x: 0,
      y: 0,
      color: 'yellow',
      text: new Y.Text('b'),
      z: 1,
      createdAt: 1,
    });
    const first = writeRawObject(doc, 'a-note', {
      type: 'sticky',
      x: 0,
      y: 0,
      color: 'yellow',
      text: new Y.Text('a'),
      z: 1,
      createdAt: 2,
    });
    expect(second.get('z')).toBe(1);
    expect(first.get('z')).toBe(1);

    const order = snapshot(doc).map((note) => note.id);
    expect(order).toEqual(['a-note', 'b-note']);
    // stable across calls: every client renders the same stacking
    expect(snapshot(doc).map((note) => note.id)).toEqual(order);
    expect(snapshot(doc).map((note) => note.id)).toEqual(order);
  });

  test('TC-12 an object with an unknown type is skipped and does not throw', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    writeRawObject(doc, 'shape-1', {
      type: 'shape',
      x: 0,
      y: 0,
      z: 99,
      createdAt: 1,
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(id);
  });

  test('a malformed note is skipped rather than crashing the board', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    writeRawObject(doc, 'broken', { type: 'sticky', x: 'nope', y: 0, z: 5 });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(id);
  });

  test('snapshot returns plain immutable data sorted by (z, id)', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 }); // z 1
    const second = createSticky(doc, { x: 500, y: 0 }); // z 2
    const third = createSticky(doc, { x: 900, y: 0 }); // z 3
    bringToFront(doc, first); // z 4

    const notes = snapshot(doc);
    expect(notes.map((note) => note.z)).toEqual([2, 3, 4]);
    expect(notes.map((note) => note.id)).toEqual([second, third, first]);
    // the snapshot is frozen plain data: nobody can mutate what React renders
    expect(Object.isFrozen(notes)).toBe(true);
    expect(Object.isFrozen(notes[0])).toBe(true);
  });

  test('mutations run with LOCAL_ORIGIN so story 3 can skip echoes', () => {
    const doc = newDoc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: { origin: unknown }) => origins.push(tr.origin));
    const id = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 });
    moveObject(doc, id, 1, 2);
    setStickyColor(doc, id, 'blue');
    bringToFront(doc, id);
    deleteObject(doc, id);
    expect(origins).toEqual([LOCAL_ORIGIN, LOCAL_ORIGIN, LOCAL_ORIGIN, LOCAL_ORIGIN, LOCAL_ORIGIN, LOCAL_ORIGIN]);
  });
});
