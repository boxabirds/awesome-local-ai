import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';
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

/**
 * Unit tests for the board document model (TC-01 to TC-12).
 *
 * A real `Y.Doc` is used everywhere: Yjs is deterministic in-process, so
 * mocking it would hide the merge and observe behaviour the model relies on.
 * Every mutation test also pins the number of `update` events emitted - one
 * for a successful change, zero for a rejection or a no-op - because those
 * events become network traffic in story 3.
 */

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` while counting the `update` events it emits on the doc. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

describe('createSticky (TC-01, TC-02)', () => {
  it('TC-01 creates one centred yellow note with empty text on an empty doc', () => {
    const doc = createDoc();
    expect(snapshot(doc)).toHaveLength(0);

    let id = '';
    const updates = withUpdateCount(doc, () => {
      id = createSticky(doc, { x: 0, y: 0 });
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // The point passed in is the centre of the note, not its top-left corner.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(updates).toBe(1);
  });

  it('TC-01 a note created away from the origin keeps the point centred', () => {
    const doc = createDoc();
    createSticky(doc, { x: 500, y: -250 });
    const note = snapshot(doc)[0]!;
    expect({ x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 }).toEqual({
      x: 500,
      y: -250,
    });
  });

  it('TC-02 stacks a new note above the existing ones (z = maxZ + 1)', () => {
    const doc = createDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 });

    let thirdZ = 0;
    const updates = withUpdateCount(doc, () => {
      const id = createSticky(doc, { x: 800, y: 0 });
      thirdZ = snapshot(doc).find((note) => note.id === id)!.z;
    });

    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
    expect(thirdZ).toBe(3);
    expect(updates).toBe(1);
  });

  it('accepts an explicit colour and keeps unknown input out of the document', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');
    expect(snapshot(doc).find((note) => note.id === id)!.color).toBe('violet');
  });

  it('rejects non-finite coordinates with no document update', () => {
    const doc = createDoc();
    let first = 'unset';
    let second = 'unset';
    const updates = withUpdateCount(doc, () => {
      first = createSticky(doc, { x: Number.NaN, y: 10 });
      second = createSticky(doc, { x: 10, y: Number.POSITIVE_INFINITY });
    });
    expect(first).toBe('');
    expect(second).toBe('');
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates).toBe(0);
  });
});

describe('moveObject (TC-03, TC-04)', () => {
  it('TC-03 updates x and y and leaves every other field alone', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 100, y: 100 }, 'green');
    const before = snapshot(doc).find((note) => note.id === id)!;
    const text = getStickyText(doc, id)!;
    text.insert(0, 'Faster onboarding');
    expect(getStickyText(doc, id)!.toString()).toBe('Faster onboarding');

    let applied = false;
    const updates = withUpdateCount(doc, () => {
      applied = moveObject(doc, id, 10, -20);
    });

    expect(applied).toBe(true);
    const after = snapshot(doc).find((note) => note.id === id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: 10, y: -20 });
    expect(after.color).toBe(before.color);
    expect(after.text).toBe('Faster onboarding');
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates).toBe(1);
  });

  it('TC-04 a stale id returns false and emits no update', () => {
    const doc = createDoc();
    createSticky(doc, { x: 0, y: 0 });

    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = moveObject(doc, 'missing-id', 5, 5);
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('rejects non-finite coordinates with no update (contract error)', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0]!;

    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = moveObject(doc, id, Number.NaN, 3);
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0]).toEqual(before);
  });

  it('refuses to move an object of an unknown type', () => {
    const doc = createDoc();
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    objects(doc).set('shape-1', shape);
    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = moveObject(doc, 'shape-1', 1, 1);
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('setStickyColor (TC-05, TC-06)', () => {
  it('TC-05 recolours a note', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    let applied = false;
    const updates = withUpdateCount(doc, () => {
      applied = setStickyColor(doc, id, 'green');
    });
    expect(applied).toBe(true);
    expect(snapshot(doc)[0]!.color).toBe('green');
    expect(updates).toBe(1);
  });

  it('TC-06 an unknown colour is rejected with no update and no change', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = setStickyColor(doc, id, 'teal');
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('re-applying the current colour is a no-op with no update', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue');

    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = setStickyColor(doc, id, 'blue');
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });

  it('rejects a stale id', () => {
    const doc = createDoc();
    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = setStickyColor(doc, 'missing-id', 'green');
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('deleteObject (TC-07, TC-08)', () => {
  it('TC-07 removes the note', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    let applied = false;
    const updates = withUpdateCount(doc, () => {
      applied = deleteObject(doc, id);
    });
    expect(applied).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objects(doc).size).toBe(0);
    expect(updates).toBe(1);
  });

  it('TC-08 a stale id returns false and emits no update', () => {
    const doc = createDoc();
    createSticky(doc, { x: 0, y: 0 });

    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = deleteObject(doc, 'missing-id');
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('bringToFront (TC-09, TC-10)', () => {
  it('TC-09 raises the bottom note of three above the top one', () => {
    const doc = createDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 });
    createSticky(doc, { x: 800, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);

    let applied = false;
    const updates = withUpdateCount(doc, () => {
      applied = bringToFront(doc, first);
    });
    expect(applied).toBe(true);
    const moved = snapshot(doc).find((note) => note.id === first)!;
    expect(moved.z).toBe(4);
    // Render order follows z, so the moved note is now last (on top).
    expect(snapshot(doc).at(-1)!.id).toBe(first);
    expect(updates).toBe(1);
  });

  it('TC-10 a note that is already on top emits no update', () => {
    const doc = createDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 400, y: 0 });

    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = bringToFront(doc, top);
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).find((note) => note.id === top)!.z).toBe(2);
  });

  it('rejects a stale id with no update', () => {
    const doc = createDoc();
    createSticky(doc, { x: 0, y: 0 });
    let applied = true;
    const updates = withUpdateCount(doc, () => {
      applied = bringToFront(doc, 'missing-id');
    });
    expect(applied).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('snapshot ordering and forward compatibility (TC-11, TC-12)', () => {
  it('TC-11 sorts equal z values by id, stably', () => {
    const doc = createDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });

    // Force a tie, which becomes reachable once story 3 syncs concurrent edits.
    doc.transact(() => {
      objects(doc).get(a)!.set('z', 7);
      objects(doc).get(b)!.set('z', 7);
    });

    const first = snapshot(doc).map((note) => note.id);
    const second = snapshot(doc).map((note) => note.id);
    expect(first).toEqual([...first].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it('TC-12 skips objects of an unknown type instead of throwing', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    const broken = new Y.Map<unknown>();
    broken.set('type', 'sticky'); // no coordinates at all
    doc.transact(() => {
      objects(doc).set('shape-1', shape);
      objects(doc).set('broken-1', broken);
      objects(doc).set('plain-1', 42 as unknown as Y.Map<unknown>);
    });

    const notes = snapshot(doc);
    expect(notes.map((note) => note.id)).toEqual([id]);
    expect(notes.every((note) => note.type === 'sticky')).toBe(true);
  });

  it('is a pure read: repeated calls never throw and always agree', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 });
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(second.map((note) => note.id)).toEqual(first.map((note) => note.id));
    moveObject(doc, id, 5, 5);
    expect(snapshot(doc).find((note) => note.id === id)!.x).toBe(5);
  });
});

describe('initDoc', () => {
  it('records the schema version once', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates).toBe(1);

    initDoc(doc);
    expect(updates).toBe(1);
  });
});
