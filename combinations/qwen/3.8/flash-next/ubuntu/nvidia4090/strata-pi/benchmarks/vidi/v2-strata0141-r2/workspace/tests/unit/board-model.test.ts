import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

/**
 * board.model unit tests (TC-01 to TC-12, TC-39) against a **real** Y.Doc.
 * Every mutation test also asserts the number of `update` events the document
 * emitted: 1 for a successful change, 0 for a rejection.
 */

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>('objects');

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `body` while counting the doc's `update` events (one per transaction). */
function withUpdateCount<T>(doc: Y.Doc, body: () => T): { result: T; updates: number } {
  let updates = 0;
  const onupdate = (): void => {
    updates += 1;
  };
  doc.on('update', onupdate);
  try {
    return { result: body(), updates };
  } finally {
    doc.off('update', onupdate);
  }
}

function create(doc: Y.Doc, x: number, y: number, color?: StickyColor): string {
  const id = createSticky(doc, { x, y }, color);
  if (typeof id !== 'string') {
    throw new Error(`createSticky rejected valid input: ${String(id)}`);
  }
  return id;
}

function noteOf(doc: Y.Doc, id: string): StickySnapshot {
  const note = snapshot(doc).find((entry) => entry.id === id);
  if (!note) {
    throw new Error(`note ${id} missing from snapshot`);
  }
  return note;
}

describe('initDoc', () => {
  it('writes meta.schemaVersion once and leaves it alone afterwards', () => {
    const doc = new Y.Doc();
    const meta = doc.getMap<unknown>('meta');
    expect(meta.get('schemaVersion')).toBeUndefined();

    const first = withUpdateCount(doc, () => initDoc(doc));
    expect(meta.get('schemaVersion')).toBe(BOARD_SCHEMA_VERSION);
    expect(first.updates).toBe(1);

    // Idempotent: a second initDoc (e.g. after story 3 syncs a doc) rewrites nothing.
    const second = withUpdateCount(doc, () => initDoc(doc));
    expect(meta.get('schemaVersion')).toBe(BOARD_SCHEMA_VERSION);
    expect(second.updates).toBe(0);
  });
});

describe('createSticky', () => {
  // TC-01
  it('TC-01: adds one yellow, empty, top note centred on the given point', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    const { result: id, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(id).toEqual(expect.any(String));
    expect(updates).toBe(1);

    expect(objectsOf(doc).size).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);

    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    // `at` is the point the note is centred on; the stored x/y is its top-left.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-01b: centres on an arbitrary point and uses a 200 unit square', () => {
    const doc = newDoc();
    const id = create(doc, 400, 300);
    const note = noteOf(doc, id);
    expect(note.x).toBe(400 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(300 - STICKY_SIZE_WORLD / 2);
  });

  // TC-02
  it('TC-02: stacks on top of existing notes (z = max z + 1)', () => {
    const doc = newDoc();
    const a = create(doc, 0, 0);
    const b = create(doc, 50, 0);
    expect(noteOf(doc, a).z).toBe(1);
    expect(noteOf(doc, b).z).toBe(2);

    const { result: c, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 100, y: 0 }));
    expect(updates).toBe(1);
    expect(typeof c).toBe('string');
    expect(noteOf(doc, c as string).z).toBe(3);
    expect(snapshot(doc)).toHaveLength(3);
  });

  it('accepts any of the six preset colours', () => {
    const doc = newDoc();
    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      const id = create(doc, 0, 0, color);
      expect(noteOf(doc, id).color).toBe(color);
    }
  });
});

describe('moveObject', () => {
  // TC-03
  it('TC-03: writes the new top-left and changes nothing else', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);
    const before = noteOf(doc, id);

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = noteOf(doc, id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('treats a move to the note\u2019s current position as a no-op: false, 0 updates', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);
    const before = noteOf(doc, id);
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, before.x, before.y));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    const after = noteOf(doc, id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  // TC-04 (negative)
  it('TC-04: rejects a stale id with false and no update event', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);
    const before = snapshot(doc);

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, 'missing-note', 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toEqual(before);
    expect(id).toBeTruthy();
  });

  // TC-39 (negative)
  it('TC-39: rejects non-finite coordinates for move and create, writing nothing', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);
    const before = noteOf(doc, id);

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const move = withUpdateCount(doc, () => moveObject(doc, id, bad, 0));
      expect(move.result).toBe(false);
      expect(move.updates).toBe(0);

      const move2 = withUpdateCount(doc, () => moveObject(doc, id, 0, bad));
      expect(move2.result).toBe(false);
      expect(move2.updates).toBe(0);

      const made = withUpdateCount(doc, () => createSticky(doc, { x: bad, y: bad }));
      expect(made.result).toBeFalsy();
      expect(made.updates).toBe(0);
    }

    const after = noteOf(doc, id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('setStickyColor', () => {
  // TC-05
  it('TC-05: changes only the colour of a selected note', () => {
    const doc = newDoc();
    const id = create(doc, 30, 40);
    const ytext = getStickyText(doc, id);
    if (!ytext) {
      throw new Error('getStickyText returned undefined for a sticky note');
    }
    ytext.insert(0, 'Faster onboarding');
    moveObject(doc, id, 12, -8);
    const before = noteOf(doc, id);

    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = noteOf(doc, id);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  // TC-06 (negative)
  it('TC-06: rejects an unknown colour with false, no update, still yellow', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);

    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(noteOf(doc, id).color).toBe(DEFAULT_STICKY_COLOR);

    const stale = withUpdateCount(doc, () => setStickyColor(doc, 'missing-note', 'green'));
    expect(stale.result).toBe(false);
    expect(stale.updates).toBe(0);
  });
});

describe('deleteObject', () => {
  // TC-07
  it('TC-07: removes the note from the board', () => {
    const doc = newDoc();
    const a = create(doc, 0, 0);
    const b = create(doc, 300, 0);

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    expect(objectsOf(doc).size).toBe(1);
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(b);
  });

  // TC-08 (negative)
  it('TC-08: rejects a stale id with false and no update event', () => {
    const doc = newDoc();
    const a = create(doc, 0, 0);

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, 'missing-note'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    expect(a).toBeTruthy();
  });
});

describe('bringToFront', () => {
  // TC-09
  it('TC-09: raises the bottom note of three to the top (z 1 to 4)', () => {
    const doc = newDoc();
    const a = create(doc, 0, 0);
    const b = create(doc, 300, 0);
    const c = create(doc, 600, 0);
    expect([noteOf(doc, a).z, noteOf(doc, b).z, noteOf(doc, c).z]).toEqual([1, 2, 3]);

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    expect(noteOf(doc, a).z).toBe(4);
    expect(noteOf(doc, b).z).toBe(2);
    expect(noteOf(doc, c).z).toBe(3);
    expect(snapshot(doc).map((note) => note.id)).toEqual([b, c, a]);
  });

  // TC-10 (negative)
  it('TC-10: does nothing (false, 0 updates) when the note is already topmost', () => {
    const doc = newDoc();
    const a = create(doc, 0, 0);
    const b = create(doc, 300, 0);

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, b));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(noteOf(doc, b).z).toBe(2);
    expect(noteOf(doc, a).z).toBe(1);

    const stale = withUpdateCount(doc, () => bringToFront(doc, 'missing-note'));
    expect(stale.result).toBe(false);
    expect(stale.updates).toBe(0);
  });
});

describe('snapshot', () => {
  // TC-11
  it('TC-11: sorts by z and breaks z ties by id, stably across calls', () => {
    const doc = newDoc();
    const a = create(doc, 0, 0);
    const b = create(doc, 300, 0);
    const c = create(doc, 600, 0);
    const objects = objectsOf(doc);
    // Force two notes to the same z, exactly what story 3 sync can produce.
    objects.get(a)!.set('z', 7);
    objects.get(b)!.set('z', 7);
    objects.get(c)!.set('z', 3);

    const tiedIds = [a, b].sort((p, q) => (p < q ? -1 : 1));
    const first = snapshot(doc).map((note) => note.id);
    const second = snapshot(doc).map((note) => note.id);

    expect(first).toEqual([c, tiedIds[0], tiedIds[1]]);
    expect(second).toEqual(first);
    expect(snapshot(doc).map((note) => note.z)).toEqual([3, 7, 7]);
  });

  // TC-12
  it('TC-12: skips objects of an unknown type without throwing', () => {
    const doc = newDoc();
    const sticky = create(doc, 0, 0);
    const objects = objectsOf(doc);
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 10);
    shape.set('y', 10);
    shape.set('z', 5);
    objects.set('shape-1', shape);
    // A malformed entry must not crash the renderer either.
    const broken = new Y.Map<unknown>();
    objects.set('broken-1', broken);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(sticky);
    expect(notes[0]!.type).toBe('sticky');
  });

  it('returns immutable snapshots with the note text', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);
    const ytext = getStickyText(doc, id);
    if (!ytext) {
      throw new Error('getStickyText returned undefined for a sticky note');
    }
    ytext.insert(0, 'Faster onboarding');

    const notes = snapshot(doc);
    expect(notes[0]!.text).toBe('Faster onboarding');
    expect(Object.isFrozen(notes[0])).toBe(true);
    expect(() => {
      (notes as StickySnapshot[]).pop();
    }).toThrow(TypeError);
  });
});

describe('getStickyText', () => {
  it('returns the note Y.Text, and undefined for stale ids and non-sticky objects', () => {
    const doc = newDoc();
    const id = create(doc, 0, 0);
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');

    expect(getStickyText(doc, 'missing-note')).toBeUndefined();

    objectsOf(doc).set('shape-1', (() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      return shape;
    })());
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
  });
});
