import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  type StickyColor,
} from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  SCHEMA_VERSION,
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
 * Unit tests for the board document model (anchor `board.model`).
 * A real `Y.Doc` is used everywhere: it *is* the store under test, and Yjs is
 * deterministic in process, so mocking it would hide real merge/observe bugs.
 *
 * Every mutation test also asserts the number of `update` events: 1 for a
 * successful change, 0 for a rejection or no-op (story 3 must not see pointless
 * sync traffic).
 */

interface UpdateCounter {
  count(): number;
  origins(): unknown[];
  reset(): void;
}

function watchUpdates(doc: Y.Doc): UpdateCounter {
  const events: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    events.push(origin);
  });
  return {
    count: () => events.length,
    origins: () => [...events],
    reset: () => {
      events.length = 0;
    },
  };
}

/** A doc with story 2's schema already applied and no update history. */
function freshDoc(): { doc: Y.Doc; updates: UpdateCounter } {
  const doc = new Y.Doc();
  initDoc(doc);
  const updates = watchUpdates(doc);
  return { doc, updates };
}

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const firstNote = (doc: Y.Doc) => {
  const notes = snapshot(doc);
  const note = notes[0];
  if (!note) {
    throw new Error('expected at least one sticky note in the snapshot');
  }
  return note;
};

describe('board.model - document schema', () => {
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const updates = watchUpdates(doc);

    initDoc(doc);
    const meta = doc.getMap<number>('meta');
    expect(meta.get('schemaVersion')).toBe(SCHEMA_VERSION);
    expect(meta.get('schemaVersion')).toBe(1);
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);

    // A second initDoc (e.g. on every page load) changes nothing.
    updates.reset();
    initDoc(doc);
    expect(doc.getMap<number>('meta').get('schemaVersion')).toBe(SCHEMA_VERSION);
    expect(updates.count()).toBe(0);
  });

  it('objects are keyed by id in a Y.Map, text is a Y.Text (future wire format)', () => {
    const { doc } = freshDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(id).toEqual(expect.any(String));
    expect((id ?? '').length).toBeGreaterThanOrEqual(8);

    const stored = objectsOf(doc).get(id ?? '');
    expect(stored).toBeInstanceOf(Y.Map);
    expect(stored?.get('type')).toBe('sticky');
    expect(stored?.get('text')).toBeInstanceOf(Y.Text);
    expect(typeof stored?.get('x')).toBe('number');
    expect(typeof stored?.get('y')).toBe('number');
    expect(typeof stored?.get('z')).toBe('number');
    expect(typeof stored?.get('createdAt')).toBe('number');
  });
});

describe('board.model - create', () => {
  // TC-01
  it('TC-01 createSticky on an empty doc creates one yellow note, centred, z 1', () => {
    const { doc, updates } = freshDoc();
    expect(snapshot(doc)).toHaveLength(0);

    const id = createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);

    expect(objectsOf(doc).size).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      // `at` is the point the note is centred on, so the top-left is half a
      // note up and to the left of it.
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
    });
    expect(notes[0]!.createdAt).toBeGreaterThan(0);
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);
  });

  it('TC-01 createSticky honours an explicit colour', () => {
    const { doc, updates } = freshDoc();
    createSticky(doc, { x: 0, y: 0 }, 'violet');
    expect(firstNote(doc).color).toBe('violet');
    expect(firstNote(doc).color in STICKY_COLORS).toBe(true);
    expect(updates.count()).toBe(1);
  });

  // TC-02
  it('TC-02 createSticky stacks on top: new z = maxZ + 1', () => {
    const { doc, updates } = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2]);

    updates.reset();
    createSticky(doc, { x: 100, y: 0 });
    const notes = snapshot(doc);
    expect(notes.map((note) => note.z)).toEqual([1, 2, 3]);
    expect(notes[2]!.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(updates.count()).toBe(1);
  });
});

describe('board.model - move', () => {
  // TC-03
  it('TC-03 moveObject changes x/y only', () => {
    const { doc, updates } = freshDoc();
    // `at` is a centre, so this note's top-left starts at (0, 0).
    const id = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 })!;
    const before = firstNote(doc);
    expect({ x: before.x, y: before.y }).toEqual({ x: 0, y: 0 });

    updates.reset();
    expect(moveObject(doc, id, 10, -20)).toBe(true);

    const after = firstNote(doc);
    expect({ x: after.x, y: after.y }).toEqual({ x: 10, y: -20 });
    expect(after.id).toBe(before.id);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.type).toBe('sticky');
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);
  });

  it('moveObject with an unchanged position is a no-op (no update)', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const before = firstNote(doc);
    updates.reset();
    expect(moveObject(doc, id, before.x, before.y)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0]).toMatchObject({ x: before.x, y: before.y });
  });

  // TC-04 (negative)
  it('TC-04 moveObject on a stale id changes nothing and emits no update', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const before = firstNote(doc);

    updates.reset();
    expect(moveObject(doc, 'no-such-id', 5, 5)).toBe(false);
    expect(moveObject(doc, '', 5, 5)).toBe(false);
    expect(updates.count()).toBe(0);
    const after = snapshot(doc);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before);
    expect(id).toBeTruthy();
  });

  // TC-39 (negative)
  it('TC-39 non-finite coordinates are rejected without a transaction', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const before = firstNote(doc);
    updates.reset();

    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NaN)).toBe(false);
    expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    expect(createSticky(doc, { x: 1, y: 1 }, 'teal' as StickyColor)).toBeFalsy();

    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]).toEqual(before);
  });
});

describe('board.model - colour', () => {
  // TC-05
  it('TC-05 setStickyColor changes the colour only', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 30, y: -70 })!;
    const before = firstNote(doc);

    updates.reset();
    expect(setStickyColor(doc, id, 'green')).toBe(true);

    const after = firstNote(doc);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);
  });

  it.each(Object.keys(STICKY_COLORS) as StickyColor[])(
    'the %s swatch colour is stored',
    (color) => {
      const { doc } = freshDoc();
      // Start from a different colour so the swatch is a real change.
      const start: StickyColor = color === 'blue' ? 'green' : 'blue';
      const id = createSticky(doc, { x: 0, y: 0 }, start)!;
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(firstNote(doc).color).toBe(color);
    },
  );

  // TC-06 (negative)
  it('TC-06 an unknown colour name is rejected and writes nothing', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    updates.reset();

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, '')).toBe(false);
    expect(setStickyColor(doc, id, 'YELLOW')).toBe(false);
    expect(setStickyColor(doc, 'no-such-id', 'green')).toBe(false);

    expect(updates.count()).toBe(0);
    expect(firstNote(doc).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('re-applying the current colour is a no-op (no update)', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue')!;
    updates.reset();
    expect(setStickyColor(doc, id, 'blue')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(firstNote(doc).color).toBe('blue');
  });
});

describe('board.model - delete', () => {
  // TC-07
  it('TC-07 deleteObject removes the note', () => {
    const { doc, updates } = freshDoc();
    const keep = createSticky(doc, { x: 0, y: 0 })!;
    const gone = createSticky(doc, { x: 400, y: 0 })!;
    expect(objectsOf(doc).size).toBe(2);

    updates.reset();
    expect(deleteObject(doc, gone)).toBe(true);
    expect(objectsOf(doc).size).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([keep]);
    expect(getStickyText(doc, gone)).toBeUndefined();
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);
  });

  // TC-08 (negative)
  it('TC-08 deleteObject on a stale id emits no update', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    updates.reset();
    expect(deleteObject(doc, 'no-such-id')).toBe(false);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(deleteObject(doc, id)).toBe(false);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model - stacking', () => {
  // TC-09
  it('TC-09 bringToFront on the bottom note of three raises z 1 to 4', () => {
    const { doc, updates } = freshDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 })!;
    const middle = createSticky(doc, { x: 10, y: 0 })!;
    const top = createSticky(doc, { x: 20, y: 0 })!;
    expect(snapshot(doc).map((note) => note.id)).toEqual([bottom, middle, top]);

    updates.reset();
    expect(bringToFront(doc, bottom)).toBe(true);
    expect(snapshot(doc).map((note) => [note.id, note.z])).toEqual([
      [middle, 2],
      [top, 3],
      [bottom, 4],
    ]);
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);
  });

  // TC-10 (negative)
  it('TC-10 bringToFront on the topmost note emits no update', () => {
    const { doc, updates } = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 0 })!;
    updates.reset();

    expect(bringToFront(doc, top)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2]);
  });

  it('bringToFront on a stale id emits no update', () => {
    const { doc, updates } = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(bringToFront(doc, 'no-such-id')).toBe(false);
    expect(updates.count()).toBe(0);
  });

  // TC-11
  it('TC-11 equal z values are ordered by id, stably', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 0, y: 300 })!;
    const c = createSticky(doc, { x: 300, y: 0 })!;

    // Story 3 can produce equal z values from concurrent clients: simulate that.
    doc.transact(() => {
      for (const id of [a, b, c]) {
        objectsOf(doc).get(id)?.set('z', 7);
      }
    });
    updates.reset();

    const expected = [a, b, c].sort((one, other) => (one < other ? -1 : one > other ? 1 : 0));
    const first = snapshot(doc).map((note) => note.id);
    const second = snapshot(doc).map((note) => note.id);
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(updates.count()).toBe(0);
    // Sorting never mutates the document.
    expect(snapshot(doc).map((note) => note.z)).toEqual([7, 7, 7]);
  });
});

describe('board.model - read', () => {
  // TC-12
  it('TC-12 objects of an unknown type are skipped without throwing', () => {
    const { doc, updates } = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 })!;

    doc.transact(() => {
      // Story 9-12 object types must not break the sticky renderer.
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 12);
      shape.set('y', 34);
      objectsOf(doc).set('shape-1', shape);
      // A value that is not an object map at all must also be skipped.
      doc.getMap<unknown>('objects').set('not-a-map', 42);
      objectsOf(doc).set('missing-type', new Y.Map<unknown>([['x', 1], ['y', 2]]));
    });
    updates.reset();

    const notes = snapshot(doc);
    expect(notes.map((note) => note.id)).toEqual([sticky]);
    expect(notes[0]!.type).toBe('sticky');
    expect(snapshot(doc).map((note) => note.id)).toEqual([sticky]);
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
    expect(deleteObject(doc, 'shape-1')).toBe(true);
    expect(updates.count()).toBe(1);
  });

  it('getStickyText returns the note Y.Text and reflects edits', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');

    updates.reset();
    text?.insert(0, 'Faster onboarding');
    expect(getStickyText(doc, id)?.toString()).toBe('Faster onboarding');
    expect(firstNote(doc).text).toBe('Faster onboarding');
    expect(updates.count()).toBe(1);
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });

  it('snapshot is immutable: changing the returned objects does not touch the doc', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    updates.reset();
    const notes = snapshot(doc);
    const note = notes[0]!;
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (note as any).x = 999;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (note as any).text = 'tampered';
    }).toThrow(TypeError);
    expect(snapshot(doc)[0]).toMatchObject({ id, x: -STICKY_SIZE_WORLD / 2, text: '' });
    expect(updates.count()).toBe(0);
  });

  it('text longer than the product limit round-trips through the model', () => {
    const { doc } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(
      Math.ceil(STICKY_TEXT_MAX_CHARS / 41),
    );
    const text = getStickyText(doc, id)!;
    text.insert(0, filler.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(text.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(firstNote(doc).text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });
});
