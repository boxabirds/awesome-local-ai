/**
 * board.model unit tests (TC-01 to TC-12, TC-39).
 *
 * Everything runs against a **real** `Y.Doc`: Yjs is in-process and
 * deterministic, and it is the store under test, so mocking it would hide the
 * merge and observe behaviour story 3 depends on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
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
  type StickySnapshot,
} from '../../src/shared/board-model';

/** Count `update` events: 1 per successful mutation, 0 per rejection. */
function updateCounter(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

/** Raw access to `objects`, for the fixtures the contract does not offer. */
function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function stickyById(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((note) => note.id === id);
}

describe('board.model initDoc', () => {
  it('records the schema version once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

    // Called again (story 4 opens a persisted document), it writes nothing.
    const updates = updateCounter(doc);
    initDoc(doc);
    expect(updates()).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});

describe('board.model createSticky', () => {
  let doc: Y.Doc;
  let updates: () => number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    updates = updateCounter(doc);
  });

  // TC-01
  it('TC-01 adds one yellow note with empty text at z 1, centred on the point', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();
    expect(objectsMap(doc).size).toBe(1);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // The note is centred on the point, so its top-left is half a size away.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(updates()).toBe(1);
  });

  // TC-02
  it('TC-02 stacks a new note above existing notes at z 1 and z 2', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const third = createSticky(doc, { x: 600, y: 0 });
    expect(stickyById(doc, third)?.z).toBe(3);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
  });

  it('accepts an explicit colour from the palette', () => {
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');
    expect(stickyById(doc, id)?.color).toBe('violet');
  });

  // TC-39 (create half)
  it('TC-39 refuses non-finite coordinates without writing anything', () => {
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      expect(createSticky(doc, at)).toBeFalsy();
    }
    expect(objectsMap(doc).size).toBe(0);
    expect(updates()).toBe(0);
  });

  it('uses the shared colour palette for defaults', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const note = stickyById(doc, id)!;
    expect(Object.keys(STICKY_COLORS)).toContain(note.color);
  });
});

describe('board.model moveObject', () => {
  let doc: Y.Doc;
  let id: string;
  let before: StickySnapshot;
  let updates: () => number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 0, y: 0 });
    before = stickyById(doc, id)!;
    updates = updateCounter(doc);
  });

  // TC-03
  it('TC-03 writes the new position and nothing else', () => {
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    const after = stickyById(doc, id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates()).toBe(1);
  });

  // TC-04 (negative)
  it('TC-04 rejects a stale id with false and no update', () => {
    expect(moveObject(doc, 'missing-note', 5, 5)).toBe(false);
    expect(updates()).toBe(0);
    expect(stickyById(doc, id)).toEqual(before);
  });

  // TC-39 (move half)
  it('TC-39 rejects non-finite coordinates with false and no update', () => {
    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NaN)).toBe(false);
    expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 3)).toBe(false);
    expect(moveObject(doc, id, 1, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(updates()).toBe(0);
    expect(stickyById(doc, id)).toEqual(before);
  });
});

describe('board.model setStickyColor', () => {
  let doc: Y.Doc;
  let id: string;
  let before: StickySnapshot;
  let updates: () => number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 40, y: 60 });
    const text = getStickyText(doc, id);
    text?.insert(0, 'Faster onboarding');
    before = stickyById(doc, id)!;
    updates = updateCounter(doc);
  });

  // TC-05
  it('TC-05 changes only the colour', () => {
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    const after = stickyById(doc, id)!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(updates()).toBe(1);
  });

  it('applies every colour in the palette', () => {
    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(stickyById(doc, id)?.color).toBe(color);
    }
  });

  // TC-06 (negative)
  it('TC-06 rejects an unknown colour with false and no update', () => {
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates()).toBe(0);
    expect(stickyById(doc, id)?.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('rejects a stale id with false and no update', () => {
    expect(setStickyColor(doc, 'missing-note', 'green')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model deleteObject', () => {
  let doc: Y.Doc;
  let id: string;
  let updates: () => number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 0, y: 0 });
    updates = updateCounter(doc);
  });

  // TC-07
  it('TC-07 removes the note', () => {
    expect(deleteObject(doc, id)).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsMap(doc).size).toBe(0);
    expect(updates()).toBe(1);
  });

  // TC-08 (negative)
  it('TC-08 rejects a stale id with false and no update', () => {
    expect(deleteObject(doc, 'missing-note')).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('board.model bringToFront', () => {
  let doc: Y.Doc;
  let first: string;
  let second: string;
  let top: string;
  let updates: () => number;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    first = createSticky(doc, { x: 0, y: 0 });
    second = createSticky(doc, { x: 300, y: 0 });
    top = createSticky(doc, { x: 600, y: 0 });
    updates = updateCounter(doc);
  });

  // TC-09
  it('TC-09 raises the bottom note of three above the topmost', () => {
    expect(bringToFront(doc, first)).toBe(true);
    expect(stickyById(doc, first)?.z).toBe(4);
    expect(snapshot(doc).map((note) => note.id)).toEqual([second, top, first]);
    expect(updates()).toBe(1);
  });

  // TC-10 (negative)
  it('TC-10 does nothing when the note is already topmost', () => {
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates()).toBe(0);
    expect(stickyById(doc, top)?.z).toBe(3);
  });

  it('rejects a stale id with false and no update', () => {
    expect(bringToFront(doc, 'missing-note')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model snapshot', () => {
  // TC-11
  it('TC-11 breaks equal z ties by id, stably across calls', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const b = createSticky(doc, { x: 0, y: 0 });
    const a = createSticky(doc, { x: 300, y: 0 });
    // Force the tie story 3 can produce when two clients pick maxZ + 1 at once.
    doc.transact(() => {
      objectsMap(doc).get(a)?.set('z', 1);
      objectsMap(doc).get(b)?.set('z', 1);
    });

    const expected = [a, b].sort((left, right) => (left < right ? -1 : 1));
    expect(snapshot(doc).map((note) => note.id)).toEqual(expected);
    expect(snapshot(doc).map((note) => note.id)).toEqual(expected);
  });

  // TC-12
  it('TC-12 skips objects of an unknown type', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 10);
      shape.set('y', 20);
      objectsMap(doc).set('shape-1', shape);
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(id);
  });

  it('orders notes by z with unknown objects and ties mixed in', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    bringToFront(doc, a);
    expect(snapshot(doc).map((note) => note.id)).toEqual([b, a]);
  });

  it('reads note text back through getStickyText', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    text?.insert(0, 'Faster onboarding');
    expect(snapshot(doc)[0]?.text).toBe('Faster onboarding');
    expect(getStickyText(doc, 'missing-note')).toBeUndefined();
  });

  it('snapshots return plain immutable data, not live Yjs objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);
    expect(Object.isFrozen(notes)).toBe(true);
    moveObject(doc, id, 5, 5);
    expect(notes[0]?.x).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('marks local transactions with LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 }); // so bringToFront has somewhere to go
    const origins: unknown[] = [];
    doc.on('update', (_update: unknown, origin: unknown) => {
      origins.push(origin);
    });
    moveObject(doc, id, 1, 2);
    setStickyColor(doc, id, 'blue');
    bringToFront(doc, id);
    deleteObject(doc, id);
    expect(origins).toEqual([LOCAL_ORIGIN, LOCAL_ORIGIN, LOCAL_ORIGIN, LOCAL_ORIGIN]);
  });
});
