// board.model unit tests (TC-01..TC-12, TC-39) against a real Y.Doc: every
// successful mutation is exactly one `update` event, every rejection is none.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  bringToFront,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  snapshotByCreation,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Counts the `update` events a doc emits from now on (one per transaction). */
function updateCounter(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

/** A ready document, as the client and (from story 4) the server would create it. */
function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** The raw objects map, for tests that must write the schema by hand. */
function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  // read through the generic-free getter: the schema nests Y.Maps, which the
  // typed getter cannot express
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/** Write an object straight into the schema, bypassing the mutations. */
function rawObject(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown> & { type: string },
): void {
  const m = new Y.Map<unknown>();
  Object.entries(fields).forEach(([key, value]) => {
    m.set(key, value);
  });
  doc.transact(() => {
    objectsOf(doc).set(id, m);
  });
}

function only(doc: Y.Doc) {
  const notes = snapshot(doc);
  if (notes.length !== 1) throw new Error(`expected exactly one object, got ${notes.length}`);
  return notes[0];
}

describe('board model: creation', () => {
  // TC-01: one note on an empty doc, centred on the requested point.
  it('TC-01 creates a yellow empty note centred on the point with z 1', () => {
    const doc = freshDoc();
    const updates = updateCounter(doc);

    const id = createSticky(doc, { x: 300, y: 200 });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      // the stored position is the top-left, half a note above/left of the point
      x: 300 - STICKY_SIZE_WORLD / 2,
      y: 200 - STICKY_SIZE_WORLD / 2,
      z: 1,
    });
    expect(Number.isFinite(notes[0].createdAt)).toBe(true);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(updates()).toBe(1);
  });

  it('TC-01b creates the note centred on the point in the negative quadrant too', () => {
    const doc = freshDoc();
    createSticky(doc, { x: -40, y: -60 });
    expect(only(doc)).toMatchObject({ x: -40 - STICKY_SIZE_WORLD / 2, y: -60 - STICKY_SIZE_WORLD / 2 });
  });

  // TC-02: stacking is max(z) + 1, so a new note is always on top.
  it('TC-02 gives a third note z 3 when z 1 and 2 exist', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    const updates = updateCounter(doc);
    const id = createSticky(doc, { x: 20, y: 20 });

    expect(snapshot(doc)).toHaveLength(3);
    expect(snapshot(doc).find((n) => n.id === id)?.z).toBe(3);
    expect(updates()).toBe(1);
  });

  it('uses the colour argument when one is given', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 }, 'blue');
    expect(only(doc).color).toBe('blue');
  });

  it('TC-39 refuses non-finite creation coordinates without a transaction', () => {
    const doc = freshDoc();
    const updates = updateCounter(doc);

    expect(createSticky(doc, { x: Number.NaN, y: 5 })).toBe('');
    expect(createSticky(doc, { x: 5, y: Number.NaN })).toBe('');
    expect(createSticky(doc, { x: Number.POSITIVE_INFINITY, y: 5 })).toBe('');
    expect(createSticky(doc, { x: 5, y: Number.NEGATIVE_INFINITY })).toBe('');

    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsOf(doc).size).toBe(0);
    expect(updates()).toBe(0);
  });

  it('TC-12 skips objects of an unknown type instead of throwing', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    // a shape from a later story, which this story's renderer must ignore
    rawObject(doc, 'shape-1', { type: 'shape', x: 1, y: 2, z: 9 });

    const notes = snapshot(doc);
    expect(notes.map((n) => n.id)).toEqual([a]);
    expect(() => snapshot(doc)).not.toThrow();
    // its text is not a sticky's text
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
  });

  it('skips malformed sticky objects but keeps an unknown colour on default', () => {
    const doc = freshDoc();
    rawObject(doc, 'broken-1', { type: 'sticky', x: Number.NaN, y: 0, z: 1, text: new Y.Text() });
    rawObject(doc, 'broken-2', { type: 'sticky', x: 0, y: 0, z: Number.NaN, text: new Y.Text() });
    rawObject(doc, 'broken-3', { type: 'sticky', x: 0, y: 0, z: 3 });
    rawObject(doc, 'future-colour', {
      type: 'sticky',
      x: 3,
      y: 4,
      z: 4,
      color: 'chartreuse',
      createdAt: 7,
      text: new Y.Text('from a newer client'),
    });
    const good = createSticky(doc, { x: 0, y: 0 });

    // an unparseable position or a missing text is not a note this story can
    // draw; a colour this story does not know falls back to the default so the
    // note is still visible (a newer client may add colours)
    const notes = snapshot(doc);
    expect(notes.map((n) => n.id)).toEqual(['future-colour', good]);
    expect(notes[0]).toMatchObject({ color: DEFAULT_STICKY_COLOR, text: 'from a newer client' });
  });
});

describe('board model: move', () => {
  // TC-03: move writes x, y only.
  it('TC-03 updates x and y and leaves every other field alone', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = only(doc);
    const updates = updateCounter(doc);

    expect(moveObject(doc, id, 10, -20)).toBe(true);

    const after = only(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates()).toBe(1);
  });

  it('accepts a move to the same position without touching other fields', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = only(doc);
    expect(moveObject(doc, id, before.x, before.y)).toBe(true);
    expect(only(doc).x).toBe(before.x);
  });

  // TC-04: a stale id is a silent no-op.
  it('TC-04 rejects a move of an unknown id without a transaction', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(moveObject(doc, 'missing-id', 5, 5)).toBe(false);
    expect(moveObject(doc, '', 5, 5)).toBe(false);
    expect(only(doc)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
    expect(updates()).toBe(0);
  });

  // TC-39: non-finite coordinates never reach the document.
  it('TC-39 rejects non-finite move coordinates without a transaction', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NaN)).toBe(false);
    expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NEGATIVE_INFINITY)).toBe(false);

    expect(only(doc)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
    expect(updates()).toBe(0);
  });

  it('does not move an object that is not a readable sticky', () => {
    const doc = freshDoc();
    rawObject(doc, 'broken-1', { type: 'sticky', x: 0, y: 0, z: 1 });
    const updates = updateCounter(doc);
    // rawObject wrote no text field, so this is not a note the model owns
    expect(moveObject(doc, 'broken-1', 3, 3)).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board model: stacking', () => {
  // TC-09: bringing the bottom note of three to the front gives max(z) + 1.
  it('TC-09 raises z 1 of 3 to z 4', () => {
    const doc = freshDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 0 });
    createSticky(doc, { x: 20, y: 0 });
    const updates = updateCounter(doc);

    expect(bringToFront(doc, first)).toBe(true);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(3);
    expect(notes[2].id).toBe(first);
    expect(notes[2].z).toBe(4);
    expect(notes.map((n) => n.z).sort((p, q) => p - q)).toEqual([2, 3, 4]);
    // only stacking changed
    expect(notes[2].x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(updates()).toBe(1);
  });

  // TC-10: the topmost note is already on top: no transaction at all, so story 3
  // would never sync a pointless update.
  it('TC-10 does not emit an update when the topmost note is raised', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 0 });
    const updates = updateCounter(doc);

    expect(bringToFront(doc, top)).toBe(false);

    expect(snapshot(doc)).toHaveLength(2);
    expect(snapshot(doc).find((n) => n.id === top)?.z).toBe(2);
    expect(updates()).toBe(0);
  });

  it('rejects bringToFront for an unknown id without a transaction', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(bringToFront(doc, 'missing-id')).toBe(false);
    expect(updates()).toBe(0);
  });

  // TC-11: equal z (possible once story 3 syncs) is broken by id, stably.
  it('TC-11 sorts equal z values by id and is stable across calls', () => {
    const doc = freshDoc();
    rawObject(doc, 'b-note', {
      type: 'sticky',
      x: 0,
      y: 0,
      color: 'yellow',
      z: 5,
      createdAt: 10,
      text: new Y.Text('b'),
    });
    rawObject(doc, 'a-note', {
      type: 'sticky',
      x: 0,
      y: 0,
      color: 'yellow',
      z: 5,
      createdAt: 20,
      text: new Y.Text('a'),
    });
    const high = createSticky(doc, { x: 0, y: 0 });

    const order = () => snapshot(doc).map((n) => n.id);
    expect(order()).toEqual(['a-note', 'b-note', high]);
    expect(order()).toEqual(order());
    // and reading twice does not write
    const updates = updateCounter(doc);
    snapshot(doc);
    snapshot(doc);
    expect(updates()).toBe(0);
  });

  it('sorts by z before id', () => {
    const doc = freshDoc();
    rawObject(doc, 'z2-a', { type: 'sticky', x: 0, y: 0, color: 'yellow', z: 2, createdAt: 1, text: new Y.Text() });
    rawObject(doc, 'z1-z', { type: 'sticky', x: 0, y: 0, color: 'yellow', z: 1, createdAt: 1, text: new Y.Text() });
    expect(snapshot(doc).map((n) => n.id)).toEqual(['z1-z', 'z2-a']);
  });
});

describe('board model: colour', () => {
  // TC-05: colour is the only field a recolour touches.
  it('TC-05 changes only the colour field', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 40, y: 50 });
    moveObject(doc, id, 7, 9);
    const before = only(doc);
    const updates = updateCounter(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(true);

    const after = only(doc);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates()).toBe(1);
  });

  it.each(Object.keys(STICKY_COLORS) as StickyColor[])('accepts the preset colour %s', (color) => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(setStickyColor(doc, id, color)).toBe(true);
    expect(only(doc).color).toBe(color);
  });

  // TC-06: an unknown colour name writes nothing.
  it('TC-06 rejects a colour outside the six presets', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);

    expect(only(doc).color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates()).toBe(0);
  });

  it.each([['', 'empty'], [String(STICKY_COLORS.yellow), 'the raw hex'], ['YELLOW', 'wrong case'], ['undefined', 'the string']])(
    'rejects the colour value %s',
    (value) => {
      const doc = freshDoc();
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);
      expect(setStickyColor(doc, id, value)).toBe(false);
      expect(only(doc).color).toBe(DEFAULT_STICKY_COLOR);
      expect(updates()).toBe(0);
    },
  );

  it('rejects a colour change on an unknown id without a transaction', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(setStickyColor(doc, 'missing-id', 'green')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board model: delete', () => {
  // TC-07: the object key is removed.
  it('TC-07 removes the note from the document', () => {
    const doc = freshDoc();
    const keep = createSticky(doc, { x: 0, y: 0 });
    const gone = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(deleteObject(doc, gone)).toBe(true);

    expect(snapshot(doc).map((n) => n.id)).toEqual([keep]);
    expect(objectsOf(doc).has(gone)).toBe(false);
    expect(updates()).toBe(1);
  });

  // TC-08: deleting twice (two people, one note) is a silent no-op.
  it('TC-08 rejects deleting an unknown id without a transaction', () => {
    const doc = freshDoc();
    const gone = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, gone);
    const updates = updateCounter(doc);

    expect(deleteObject(doc, gone)).toBe(false);
    expect(deleteObject(doc, 'missing-id')).toBe(false);

    expect(snapshot(doc)).toHaveLength(0);
    expect(updates()).toBe(0);
  });
});

describe('board model: text and metadata', () => {
  it('exposes a note text as a Y.Text that the snapshot mirrors', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');

    doc.transact(() => text?.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    expect(only(doc).text).toBe('Faster onboarding');
  });

  it('returns undefined text for an unknown id', () => {
    const doc = freshDoc();
    expect(getStickyText(doc, 'missing-id')).toBeUndefined();
  });

  it('does not hand out the text of a note that is not a sticky', () => {
    const doc = freshDoc();
    rawObject(doc, 'connector-1', { type: 'connector', z: 1, createdAt: 1 });
    expect(getStickyText(doc, 'connector-1')).toBeUndefined();
  });

  it('TC-40 initDoc sets meta.schemaVersion once and never again', () => {
    const doc = new Y.Doc();
    const updates = updateCounter(doc);

    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates()).toBe(1);

    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates()).toBe(1);
  });

  it('creates the objects map as a Y.Map so snapshot works on a fresh doc', () => {
    const doc = freshDoc();
    expect(snapshot(doc)).toEqual([]);
    expect(doc.getMap('objects')).toBeInstanceOf(Y.Map);
  });

  it('writes its transactions with the local origin', () => {
    const doc = freshDoc();
    const origins: unknown[] = [];
    doc.on('update', (_update: unknown, origin: unknown) => origins.push(origin));
    const id = createSticky(doc, { x: 0, y: 0 });
    moveObject(doc, id, 1, 1);
    expect(origins).toEqual([LOCAL_ORIGIN, LOCAL_ORIGIN]);
  });
});

describe('board model: painting order', () => {
  // The DOM gives a note one element for its whole life, and the browser stacks
  // notes by their z value. So the list the renderer maps over must be ordered
  // by creation, not by z: re-ordering it would move the element of a note that
  // is being dragged out from under the pointer.
  it('TC-22 lists notes in the order they were created, whatever their z is', () => {
    const doc = freshDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 300, y: 0 });

    expect(snapshotByCreation(doc).map((note) => note.id)).toEqual([first, second]);

    expect(bringToFront(doc, first)).toBe(true);
    // the drawn-on-top order changed ...
    expect(snapshot(doc).map((note) => note.id)).toEqual([second, first]);
    // ... while the list the renderer walks did not
    expect(snapshotByCreation(doc).map((note) => note.id)).toEqual([first, second]);
    // the numbers went up, the places did not move
    expect(snapshotByCreation(doc).map((note) => note.z)).toEqual([3, 2]);
  });

  it('lists exactly the notes snapshot lists, with the same fields', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const raised = createSticky(doc, { x: 300, y: 0 });
    bringToFront(doc, raised);

    const byCreation = snapshotByCreation(doc);
    expect(byCreation.map((note) => note.id).sort()).toEqual(snapshot(doc).map((note) => note.id).sort());
    expect(byCreation.map((note) => [note.id, note.x, note.y, note.z, note.color, note.text])).toEqual(
      snapshot(doc)
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((note) => [note.id, note.x, note.y, note.z, note.color, note.text]),
    );
  });

  it('ignores objects it cannot draw, as snapshot does', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    rawObject(doc, 'shape-1', { type: 'shape', x: 1, y: 2, z: 9 });

    expect(snapshotByCreation(doc).map((entry) => entry.id)).toEqual([note]);
  });

  it('emits no document update, because it only reads', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    snapshotByCreation(doc);

    expect(updates()).toBe(0);
  });
});
