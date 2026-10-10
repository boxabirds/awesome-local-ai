/**
 * board.model unit tests (TC-01 .. TC-12, TC-39) against a real Y.Doc.
 *
 * Every mutation test also counts the `update` events the doc emits: exactly
 * 1 for a success (one transaction) and 0 for a rejection (TC-04, TC-06,
 * TC-08, TC-10, TC-39), because story 3 will forward every update over the
 * wire and pointless updates become pointless traffic.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  META_KEY,
  moveObject,
  OBJECTS_KEY,
  SCHEMA_VERSION,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';

/** Half the note size: `createSticky` centres the note on the given point. */
const HALF = STICKY_SIZE_WORLD / 2;

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn`, returning the number of `update` events the doc emitted. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = (): void => {
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

/** Create a note, failing loudly if the model rejected the input. */
function mustCreate(doc: Y.Doc, at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  if (typeof id !== 'string') throw new Error(`createSticky rejected ${JSON.stringify(at)}`);
  return id;
}

function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
  const entry = objects.get(id);
  if (!entry) throw new Error(`object ${id} missing`);
  return entry;
}

describe('initDoc', () => {
  it('sets meta.schemaVersion once (extra)', () => {
    const doc = new Y.Doc();
    const meta = doc.getMap<number>(META_KEY);
    expect(meta.get('schemaVersion')).toBeUndefined();

    expect(countUpdates(doc, () => initDoc(doc))).toBe(1);
    expect(meta.get('schemaVersion')).toBe(SCHEMA_VERSION);

    // A second init (e.g. when story 4 loads an existing doc) changes nothing.
    expect(countUpdates(doc, () => initDoc(doc))).toBe(0);
    expect(meta.get('schemaVersion')).toBe(SCHEMA_VERSION);
  });
});

describe('createSticky', () => {
  it('TC-01: creates the first note centred on the point, z 1, yellow, empty text', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    let created: string | false = false;
    const updates = countUpdates(doc, () => {
      created = createSticky(doc, { x: 0, y: 0 });
    });
    expect(updates).toBe(1);
    if (typeof created !== 'string') throw new Error('createSticky was rejected');

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(created);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred: the stored top-left is the point minus half the note size.
    expect(note.x).toBe(0 - HALF);
    expect(note.y).toBe(0 - HALF);
    expect(note.createdAt).toBeGreaterThan(0);
  });

  it('TC-02: with existing notes at z 1 and 2 the new note gets z 3', () => {
    const doc = newDoc();
    mustCreate(doc, { x: 0, y: 0 });
    mustCreate(doc, { x: 250, y: 0 });
    const before = snapshot(doc).map((note) => note.z).sort((a, b) => a - b);
    expect(before).toEqual([1, 2]);

    const third = mustCreate(doc, { x: 500, y: 0 });
    const note = snapshot(doc).find((entry) => entry.id === third);
    expect(note?.z).toBe(3);
  });

  it('TC-39: refuses non-finite coordinates without an update (negative)', () => {
    const doc = newDoc();
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      let result: string | false = false;
      expect(countUpdates(doc, () => {
        result = createSticky(doc, at);
      })).toBe(0);
      expect(result).toBe(false);
    }
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('writes with LOCAL_ORIGIN so story 3/8 can recognise local changes', () => {
    const doc = newDoc();
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    mustCreate(doc, { x: 0, y: 0 });
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});

describe('moveObject', () => {
  it('TC-03: updates x and y and touches nothing else', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    doc.transact(() => getStickyText(doc, id)?.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    const before = snapshot(doc).find((note) => note.id === id)!;

    const moved = countUpdates(doc, () => {
      expect(moveObject(doc, id, 10, -20)).toBe(true);
    });
    expect(moved).toBe(1);

    const after = snapshot(doc).find((note) => note.id === id)!;
    expect(after.x).toBe(10 - 0);
    expect(after.y).toBe(-20 - 0);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  it('TC-04: a stale id returns false and emits no update (negative)', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    expect(countUpdates(doc, () => expect(moveObject(doc, id, 5, 5)).toBe(false))).toBe(0);
    expect(countUpdates(doc, () => expect(moveObject(doc, 'missing-id', 5, 5)).toBe(false))).toBe(0);
  });

  it('TC-39: refuses non-finite coordinates without an update (negative)', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0]!;
    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      expect(countUpdates(doc, () => expect(moveObject(doc, id, x, y)).toBe(false))).toBe(0);
    }
    const after = snapshot(doc)[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('setStickyColor', () => {
  it('TC-05: recolours the note and keeps text, x, y and z', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 40, y: 60 });
    doc.transact(() => {
      getStickyText(doc, id)?.insert(0, 'green field');
      rawObject(doc, id).set('z', 7);
    }, LOCAL_ORIGIN);
    const before = snapshot(doc).find((note) => note.id === id)!;
    expect(before.color).toBe('yellow');

    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });
    expect(updates).toBe(1);

    const after = snapshot(doc).find((note) => note.id === id)!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06: an unknown colour returns false and changes nothing (negative)', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    expect(countUpdates(doc, () => expect(setStickyColor(doc, id, 'teal')).toBe(false))).toBe(0);
    expect(snapshot(doc)[0]!.color).toBe('yellow');
    // Stale id with a valid colour is rejected too.
    expect(countUpdates(doc, () => expect(setStickyColor(doc, 'missing', 'pink')).toBe(false))).toBe(0);
  });

  it('accepts every configured colour; re-applying the current one is a no-op', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    // The note is already yellow, so asking for yellow again changes nothing.
    expect(countUpdates(doc, () => expect(setStickyColor(doc, id, 'yellow')).toBe(false))).toBe(0);
    for (const color of Object.keys(STICKY_COLORS)) {
      if (color === 'yellow') continue;
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(snapshot(doc)[0]!.color).toBe(color);
    }
  });
});

describe('deleteObject', () => {
  it('TC-07: removes the note', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08: a stale id returns false and emits no update (negative)', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    expect(countUpdates(doc, () => expect(deleteObject(doc, id)).toBe(false))).toBe(0);
    expect(countUpdates(doc, () => expect(deleteObject(doc, 'missing')).toBe(false))).toBe(0);
  });
});

describe('bringToFront', () => {
  it('TC-09: brings z 1 of 3 notes to z 4', () => {
    const doc = newDoc();
    const first = mustCreate(doc, { x: 0, y: 0 });
    mustCreate(doc, { x: 250, y: 0 });
    mustCreate(doc, { x: 500, y: 0 });
    expect(snapshot(doc).find((note) => note.id === first)?.z).toBe(1);

    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, first)).toBe(true);
    });
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes.find((note) => note.id === first)?.z).toBe(4);
    expect(notes.at(-1)!.id).toBe(first);
  });

  it('TC-10: the topmost note stays put with no update (negative)', () => {
    const doc = newDoc();
    mustCreate(doc, { x: 0, y: 0 });
    const top = mustCreate(doc, { x: 250, y: 0 });
    expect(countUpdates(doc, () => expect(bringToFront(doc, top)).toBe(false))).toBe(0);
    // And a stale id is rejected.
    expect(countUpdates(doc, () => expect(bringToFront(doc, 'missing')).toBe(false))).toBe(0);
  });
});

describe('snapshot', () => {
  it('TC-11: equal z orders by id and is stable across calls', () => {
    const doc = newDoc();
    const ids = [mustCreate(doc, { x: 0, y: 0 }), mustCreate(doc, { x: 250, y: 0 })].sort();
    // Force equal z, as concurrent creation in story 3 could produce.
    doc.transact(() => {
      for (const id of ids) rawObject(doc, id).set('z', 5);
    }, LOCAL_ORIGIN);

    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((note) => note.id)).toEqual(ids);
    expect(second.map((note) => note.id)).toEqual(ids);
  });

  it('TC-12: skips objects of unknown type without throwing', () => {
    const doc = newDoc();
    const sticky = mustCreate(doc, { x: 0, y: 0 });
    // A 'shape' object as stories 9-12 would add; the renderer must ignore it.
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      objects.set('shape-1', shape);
    }, LOCAL_ORIGIN);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(sticky);
  });

  it('recomputes when the doc changes (story 3 contract)', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);
    mustCreate(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('getStickyText', () => {
  it('returns the Y.Text of a note so components can observe it', () => {
    const doc = newDoc();
    const id = mustCreate(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    doc.transact(() => text?.insert(0, 'hello'), LOCAL_ORIGIN);
    expect(snapshot(doc)[0]!.text).toBe('hello');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});
