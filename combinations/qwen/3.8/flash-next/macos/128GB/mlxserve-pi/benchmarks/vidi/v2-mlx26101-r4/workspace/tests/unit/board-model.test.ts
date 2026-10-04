/**
 * Unit tests for the board document model (board.model), run against a **real**
 * `Y.Doc`: the document is the store under test, and Yjs is deterministic
 * in-process, so mocking it would hide the merge/observe behaviour stories 3
 * and 4 depend on.
 *
 * Every mutation test also asserts how many `update` events the document
 * emitted: exactly 1 for a successful call (one transaction, which story 3
 * syncs and story 8 undoes) and 0 for a rejection (no pointless sync traffic).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
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

const HALF = STICKY_SIZE_WORLD / 2;

/** A fresh, initialised document, the way `useBoardDoc` leaves it. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** Starts counting `update` events; returns a reader of the count. */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  const origins: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  });
  return () => updates;
}

/** A raw sticky inserted without the model, to reach states it cannot create. */
function seedSticky(
  doc: Y.Doc,
  id: string,
  fields: { x?: number; y?: number; z?: number; color?: string; text?: string; type?: string },
): Y.Map<unknown> {
  const objects = objectsOf(doc);
  const note = new Y.Map<unknown>();
  doc.transact(() => {
    note.set('type', fields.type ?? 'sticky');
    note.set('x', fields.x ?? 0);
    note.set('y', fields.y ?? 0);
    note.set('color', fields.color ?? DEFAULT_STICKY_COLOR);
    note.set('z', fields.z ?? 1);
    note.set('createdAt', 1_700_000_000_000);
    note.set('text', new Y.Text(fields.text ?? ''));
    objects.set(id, note);
  });
  return note;
}

describe('board.model initDoc', () => {
  it('records the schema version once and leaves an existing one alone', () => {
    const doc = new Y.Doc();
    const updates = countUpdates(doc);

    initDoc(doc);
    expect(doc.getMap<number>('meta').get('schemaVersion')).toBe(1);
    expect(updates()).toBe(1);

    // Idempotent: attaching to an already-initialised document changes nothing.
    initDoc(doc);
    initDoc(doc);
    expect(updates()).toBe(1);
    expect(objectsOf(doc).size).toBe(0);
  });
});

describe('board.model createSticky', () => {
  it('TC-01: creates the first note centred on the point, yellow and empty, z 1', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred on the click: the stored position is the note's top-left.
    expect(note.x).toBe(-HALF);
    expect(note.y).toBe(-HALF);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(new Date(note.createdAt).getTime()).toBe(note.createdAt);
  });

  it('stacks above every existing note (z = maxZ + 1)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 500 });
    const updates = countUpdates(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    expect(updates()).toBe(1);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
    expect(snapshot(doc).find((note) => note.id === id)?.z).toBe(3);
  });

  it('TC-02: gives the third note z 3 when z 1 and 2 already exist', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    seedSticky(doc, 'preexisting-top', { z: 2 });
    const updates = countUpdates(doc);

    createSticky(doc, { x: 10, y: 10 });
    expect(updates()).toBe(1);
    expect(Math.max(...snapshot(doc).map((note) => note.z))).toBe(3);
  });

  it('uses the requested colour and ignores an unknown one', () => {
    const doc = newDoc();
    const green = createSticky(doc, { x: 0, y: 0 }, 'green');
    expect(snapshot(doc).find((note) => note.id === green)?.color).toBe('green');

    const updates = countUpdates(doc);
    const fallback = createSticky(doc, { x: 0, y: 0 }, 'teal' as StickyColor);
    expect(snapshot(doc).find((note) => note.id === fallback)?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates()).toBe(1); // the note is still created, just in the default colour
  });

  it('writes with LOCAL_ORIGIN so later stories can filter local changes', () => {
    const doc = newDoc();
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));

    createSticky(doc, { x: 0, y: 0 });
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('exposes the note text as a Y.Text on the document (stories 3-4 need CRDT text)', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext?.toString()).toBe('');

    doc.transact(() => ytext?.insert(0, 'shared later'));
    expect(snapshot(doc).find((note) => note.id === id)?.text).toBe('shared later');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });

  it('TC-39: refuses non-finite coordinates without touching the document', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);

    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      expect(() => createSticky(doc, at)).not.toThrow();
    }
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model moveObject', () => {
  it('TC-03: updates the position and nothing else', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 200, y: 300 }, 'blue');
    const before = snapshot(doc).find((note) => note.id === id)!;
    const updates = countUpdates(doc);

    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates()).toBe(1);

    const after = snapshot(doc).find((note) => note.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  it('TC-04: a stale id is rejected with no change and no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    const before = snapshot(doc);
    const updates = countUpdates(doc);

    expect(moveObject(doc, id, 5, 5)).toBe(false);
    expect(moveObject(doc, 'never-existed', 5, 5)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });

  it('is a no-op for the position it already has, and rejects non-finite numbers', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    expect(moveObject(doc, id, -HALF, -HALF)).toBe(false);
    const updates = countUpdates(doc);
    expect(moveObject(doc, id, Number.NaN, 1)).toBe(false);
    expect(moveObject(doc, id, 1, Number.POSITIVE_INFINITY)).toBe(false);
    expect(updates()).toBe(0);

    const note = snapshot(doc).find((entry) => entry.id === id)!;
    expect(note.x).toBe(-HALF);
    expect(note.y).toBe(-HALF);
  });

  it('TC-39: will not write a non-finite position even to an existing note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 7, y: 9 });
    const updates = countUpdates(doc);

    expect(moveObject(doc, id, Number.NaN, Number.NaN)).toBe(false);
    expect(updates()).toBe(0);
    const note = snapshot(doc).find((entry) => entry.id === id)!;
    expect(note.x).toBe(7 - HALF);
    expect(note.y).toBe(9 - HALF);
  });
});

describe('board.model setStickyColor', () => {
  it('TC-05: applies one of the six colours and changes nothing else', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 200 });
    doc.transact(() => getStickyText(doc, id)?.insert(0, 'Faster onboarding'));
    const before = snapshot(doc).find((note) => note.id === id)!;
    const updates = countUpdates(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates()).toBe(1);

    const after = snapshot(doc).find((note) => note.id === id)!;
    expect(after.color).toBe('green');
    expect(STICKY_COLORS[after.color]).toBe('#C5E1A5');
    expect(after.text).toBe('Faster onboarding');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-06: an unknown colour name is rejected, leaving the note untouched', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    for (const colour of ['teal', '', 'Yellow', 'yellow ', '#FFF59D', 'null']) {
      expect(setStickyColor(doc, id, colour)).toBe(false);
    }
    expect(updates()).toBe(0);
    expect(snapshot(doc).find((note) => note.id === id)?.color).toBe('yellow');
  });

  it('rejects a stale id, the same colour twice, and never throws', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    expect(setStickyColor(doc, id, 'yellow')).toBe(false); // already yellow
    deleteObject(doc, id);
    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'pink')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model deleteObject', () => {
  it('TC-07: removes the note from the document', () => {
    const doc = newDoc();
    const keep = createSticky(doc, { x: 0, y: 0 });
    const drop = createSticky(doc, { x: 300, y: 0 });
    const updates = countUpdates(doc);

    expect(deleteObject(doc, drop)).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([keep]);
    expect(objectsOf(doc).has(drop)).toBe(false);
    expect(getStickyText(doc, drop)).toBeUndefined();
  });

  it('TC-08: a stale id is rejected with no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    const updates = countUpdates(doc);

    expect(deleteObject(doc, id)).toBe(false);
    expect(deleteObject(doc, 'never-existed')).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model bringToFront', () => {
  it('TC-09: raises the bottom note of three above the topmost', () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 0 });
    createSticky(doc, { x: 20, y: 0 });
    const updates = countUpdates(doc);

    expect(bringToFront(doc, bottom)).toBe(true);
    expect(updates()).toBe(1);

    const notes = snapshot(doc);
    expect(notes.map((note) => note.z)).toEqual([2, 3, 4]);
    expect(notes[2]!.id).toBe(bottom);
    // Only stacking changed.
    expect(notes[2]!.x).toBe(-HALF);
    expect(notes[2]!.color).toBe('yellow');
  });

  it('TC-10: the note that is already on top produces no transaction at all', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 100 });
    const updates = countUpdates(doc);

    expect(bringToFront(doc, top)).toBe(false);
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc).find((note) => note.id === top)?.z).toBe(2);
  });

  it('TC-11: equal z (possible once story 3 merges) is broken by id, stably', () => {
    const doc = newDoc();
    // Two clients that both picked maxZ + 1 while offline end up with equal z.
    seedSticky(doc, 'bbb', { z: 5 });
    seedSticky(doc, 'aaa', { z: 5 });
    seedSticky(doc, 'ccc', { z: 4 });
    seedSticky(doc, 'ccc2', { z: 4 });

    const first = snapshot(doc).map((note) => note.id);
    const second = snapshot(doc).map((note) => note.id);
    // Sorted by z first (ccc/ccc2 are at 4), then by id inside a tie.
    expect(first).toEqual(['ccc', 'ccc2', 'aaa', 'bbb']);
    expect(second).toEqual(first);

    // A note tied for the top still has to move up to be on top of its tie.
    const updates = countUpdates(doc);
    expect(bringToFront(doc, 'aaa')).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual(['ccc', 'ccc2', 'bbb', 'aaa']);
  });

  it('rejects a stale id without an update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(bringToFront(doc, 'never-existed')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model snapshot', () => {
  it('TC-12: skips objects of unknown type instead of throwing', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    seedSticky(doc, 'shape-1', { type: 'shape' });
    seedSticky(doc, 'arrow-1', { type: 'arrow' });

    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((note) => note.id)).toEqual([sticky]);
    expect(snapshot(doc).every((note) => note.type === 'sticky')).toBe(true);
  });

  it('tolerates a malformed object and a missing text field', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    objectsOf(doc).set('not-a-map', null as unknown as Y.Map<unknown>);
    seedSticky(doc, 'no-text', {});
    doc.transact(() => objectsOf(doc).get('no-text')?.delete('text'));

    const notes = snapshot(doc);
    expect(notes.map((note) => note.id)).toEqual([sticky, 'no-text']);
    expect(notes[1]!.text).toBe('');
  });

  it('returns an immutable, new array only after a change to the document', () => {
    const doc = newDoc();
    const first = snapshot(doc);
    expect(snapshot(doc)).not.toBe(first); // recomputed on demand: no stale cache here
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.id).toBe(id);
  });

  it('observes deep changes so a text edit reaches the snapshot', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    let deepEvents = 0;
    objectsOf(doc).observeDeep(() => {
      deepEvents += 1;
    });
    doc.transact(() => getStickyText(doc, id)?.insert(0, 'Faster onboarding'));

    expect(deepEvents).toBe(1);
    expect(snapshot(doc).find((note) => note.id === id)?.text).toBe('Faster onboarding');
  });

  it('orders by z, so the render order is the stacking order', () => {
    const doc = newDoc();
    seedSticky(doc, 'top', { z: 9 });
    seedSticky(doc, 'middle', { z: 5 });
    seedSticky(doc, 'bottom', { z: 1 });
    expect(snapshot(doc).map((note) => note.id)).toEqual(['bottom', 'middle', 'top']);
  });
});
