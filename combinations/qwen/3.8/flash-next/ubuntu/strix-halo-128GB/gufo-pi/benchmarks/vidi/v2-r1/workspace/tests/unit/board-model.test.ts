import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

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
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/**
 * Unit tests for `src/shared/board-model.ts` (anchor `board.model`).
 *
 * A real `Y.Doc` is used everywhere: it is the store under test, it is
 * deterministic in-process, and mocking it would hide the merge/observe
 * behaviour stories 3 and 4 depend on.
 */

interface Harness {
  doc: Y.Doc;
  /** Number of `update` events since the last `resetUpdateCount()`. */
  updates(): number;
  resetUpdateCount(): void;
}

function harness(): Harness {
  const doc = new Y.Doc();
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return {
    doc,
    updates: () => count,
    resetUpdateCount: () => {
      count = 0;
    },
  };
}

function notes(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

/** Write raw objects into the document, bypassing the mutations under test. */
function putRawObject(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const item = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) item.set(key, value);
    objects.set(id, item);
  });
}

describe('board.model initDoc', () => {
  it('sets meta.schemaVersion once and never again', () => {
    const h = harness();
    initDoc(h.doc);
    expect(h.doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(h.updates()).toBe(1);

    h.resetUpdateCount();
    initDoc(h.doc);
    expect(h.doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(h.updates()).toBe(0);
  });
});

describe('board.model createSticky (TC-01, TC-02)', () => {
  it('TC-01 creates one centred yellow empty note on an empty doc', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const list = notes(h.doc);
    expect(list).toHaveLength(1);
    const note = list[0]!;
    // centred on the given point: stored coordinates are the top-left
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(h.updates()).toBe(1);
  });

  it('TC-01 centring follows the point, not the origin', () => {
    const h = harness();
    createSticky(h.doc, { x: 400, y: 300 });
    const note = notes(h.doc)[0]!;
    expect(note.x).toBe(400 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(300 - STICKY_SIZE_WORLD / 2);
  });

  it('TC-02 stacks a new note on top of existing z values', () => {
    const h = harness();
    createSticky(h.doc, { x: 0, y: 0 });
    createSticky(h.doc, { x: 300, y: 0 });
    expect(notes(h.doc).map((n) => n.z)).toEqual([1, 2]);

    h.resetUpdateCount();
    const third = createSticky(h.doc, { x: 600, y: 0 });
    expect(notes(h.doc).find((n) => n.id === third)!.z).toBe(3);
    expect(h.updates()).toBe(1);
  });

  it('uses an explicit colour when one is given and the default otherwise', () => {
    const h = harness();
    createSticky(h.doc, { x: 0, y: 0 }, 'violet');
    expect(notes(h.doc)[0]!.color).toBe('violet');
    expect(h.updates()).toBe(1);

    createSticky(h.doc, { x: 0, y: 0 }, 'nonsense' as StickyColor);
    // a colour the model does not know must not be written into the document
    expect(notes(h.doc)).toHaveLength(1);
    expect(h.updates()).toBe(1);
  });

  it('exposes the note text as a Y.Text', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    const text = getStickyText(h.doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    expect(getStickyText(h.doc, 'no-such-id')).toBeUndefined();
  });
});

describe('board.model moveObject (TC-03, TC-04, TC-39)', () => {
  it('TC-03 updates x and y and nothing else', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 }, 'orange');
    const before = notes(h.doc)[0]!;
    h.resetUpdateCount();

    expect(moveObject(h.doc, id, 10, -20)).toBe(true);

    const after = notes(h.doc)[0]!;
    expect({ x: after.x, y: after.y }).toEqual({ x: 10, y: -20 });
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe('orange');
    expect(after.text).toBe('');
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(h.updates()).toBe(1);
  });

  it('TC-04 rejects a stale id with false and no update', () => {
    const h = harness();
    createSticky(h.doc, { x: 0, y: 0 });
    h.resetUpdateCount();

    expect(moveObject(h.doc, '5a3bde86-0000-4000-8000-000000000000', 5, 5)).toBe(false);
    expect(notes(h.doc)[0]!.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(h.updates()).toBe(0);
  });

  it('TC-39 rejects non-finite coordinates with false and no update', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.resetUpdateCount();

    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ] as const) {
      expect(moveObject(h.doc, id, x, y)).toBe(false);
    }
    expect(notes(h.doc)[0]!.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(h.updates()).toBe(0);

    expect(createSticky(h.doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(h.doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    expect(notes(h.doc)).toHaveLength(1);
    expect(h.updates()).toBe(0);
  });
});

describe('board.model setStickyColor (TC-05, TC-06)', () => {
  it('TC-05 changes only the colour', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 100, y: 200 });
    getStickyText(h.doc, id)!.insert(0, 'Faster onboarding');
    moveObject(h.doc, id, 30, 40);
    const before = notes(h.doc)[0]!;
    h.resetUpdateCount();

    expect(setStickyColor(h.doc, id, 'green')).toBe(true);

    const after = notes(h.doc)[0]!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(h.updates()).toBe(1);
  });

  it('TC-06 rejects an unknown colour with false, unchanged and no update', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.resetUpdateCount();

    expect(setStickyColor(h.doc, id, 'teal')).toBe(false);
    expect(notes(h.doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
    expect(h.updates()).toBe(0);

    expect(setStickyColor(h.doc, id, '')).toBe(false);
    expect(setStickyColor(h.doc, id, 'YELLOW')).toBe(false);
    expect(setStickyColor(h.doc, id, STICKY_COLORS.green)).toBe(false);
    expect(h.updates()).toBe(0);
  });

  it('rejects a stale id and a no-op recolour without an update', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.resetUpdateCount();

    expect(setStickyColor(h.doc, 'no-such-id', 'pink')).toBe(false);
    expect(setStickyColor(h.doc, id, DEFAULT_STICKY_COLOR)).toBe(false);
    expect(h.updates()).toBe(0);
  });
});

describe('board.model deleteObject (TC-07, TC-08)', () => {
  it('TC-07 removes the note', () => {
    const h = harness();
    const keep = createSticky(h.doc, { x: 0, y: 0 });
    const gone = createSticky(h.doc, { x: 250, y: 0 });
    h.resetUpdateCount();

    expect(deleteObject(h.doc, gone)).toBe(true);

    expect(notes(h.doc).map((n) => n.id)).toEqual([keep]);
    expect(h.updates()).toBe(1);
  });

  it('TC-08 rejects a stale id with false and no update', () => {
    const h = harness();
    createSticky(h.doc, { x: 0, y: 0 });
    h.resetUpdateCount();

    expect(deleteObject(h.doc, 'no-such-id')).toBe(false);
    expect(notes(h.doc)).toHaveLength(1);
    expect(h.updates()).toBe(0);
  });
});

describe('board.model bringToFront (TC-09, TC-10)', () => {
  it('TC-09 lifts the bottom note of three above all others', () => {
    const h = harness();
    const first = createSticky(h.doc, { x: 0, y: 0 });
    createSticky(h.doc, { x: 250, y: 0 });
    createSticky(h.doc, { x: 500, y: 0 });
    expect(notes(h.doc).map((n) => n.z)).toEqual([1, 2, 3]);
    h.resetUpdateCount();

    expect(bringToFront(h.doc, first)).toBe(true);

    expect(notes(h.doc).find((n) => n.id === first)!.z).toBe(4);
    expect(notes(h.doc).map((n) => n.z)).toEqual([2, 3, 4]);
    expect(h.updates()).toBe(1);
  });

  it('TC-10 leaves the topmost note alone with no update', () => {
    const h = harness();
    createSticky(h.doc, { x: 0, y: 0 });
    const top = createSticky(h.doc, { x: 250, y: 0 });
    h.resetUpdateCount();

    expect(bringToFront(h.doc, top)).toBe(false);
    expect(notes(h.doc).find((n) => n.id === top)!.z).toBe(2);
    expect(h.updates()).toBe(0);
  });

  it('rejects a stale id without an update and keeps position, colour and text', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 7, y: 9 }, 'blue');
    getStickyText(h.doc, id)!.insert(0, 'retro');
    h.resetUpdateCount();

    expect(bringToFront(h.doc, 'no-such-id')).toBe(false);
    expect(h.updates()).toBe(0);

    expect(bringToFront(h.doc, id)).toBe(false); // only note: already topmost
    const note = notes(h.doc)[0]!;
    expect({ x: note.x, y: note.y, color: note.color, text: note.text }).toEqual({
      x: 7 - STICKY_SIZE_WORLD / 2,
      y: 9 - STICKY_SIZE_WORLD / 2,
      color: 'blue',
      text: 'retro',
    });

    // with a second note on top, bringing the first forward changes only z
    createSticky(h.doc, { x: 300, y: 0 });
    h.resetUpdateCount();
    expect(bringToFront(h.doc, id)).toBe(true);
    const lifted = notes(h.doc).find((n) => n.id === id)!;
    expect({ x: lifted.x, y: lifted.y, color: lifted.color, text: lifted.text }).toEqual({
      x: 7 - STICKY_SIZE_WORLD / 2,
      y: 9 - STICKY_SIZE_WORLD / 2,
      color: 'blue',
      text: 'retro',
    });
    expect(h.updates()).toBe(1);
  });
});

describe('board.model snapshot (TC-11, TC-12)', () => {
  it('TC-11 breaks equal z ties by id, stably', () => {
    const h = harness();
    // three notes forced onto the same z, inserted in a scrambled id order
    putRawObject(h.doc, 'ccc', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(), z: 5, createdAt: 1 });
    putRawObject(h.doc, 'aaa', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(), z: 5, createdAt: 2 });
    putRawObject(h.doc, 'bbb', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(), z: 5, createdAt: 3 });

    const first = notes(h.doc).map((n) => n.id);
    expect(first).toEqual(['aaa', 'bbb', 'ccc']);
    // stable across calls: every client renders the same order
    expect(notes(h.doc).map((n) => n.id)).toEqual(first);
    expect(notes(h.doc).map((n) => n.id)).toEqual(first);
  });

  it('TC-11 sorts by z first and only uses id inside a tie', () => {
    const h = harness();
    putRawObject(h.doc, 'aaa', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(), z: 9, createdAt: 1 });
    putRawObject(h.doc, 'mmm', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(), z: 1, createdAt: 2 });
    putRawObject(h.doc, 'zzz', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(), z: 5, createdAt: 3 });
    expect(notes(h.doc).map((n) => n.id)).toEqual(['mmm', 'zzz', 'aaa']);
  });

  it('TC-12 skips objects of an unknown type without throwing', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    putRawObject(h.doc, 'shape-1', { type: 'shape', x: 0, y: 0, z: 4, width: 10 });
    putRawObject(h.doc, 'shape-2', { x: 0, y: 0, z: 4 });

    expect(() => snapshot(h.doc)).not.toThrow();
    expect(notes(h.doc).map((n) => n.id)).toEqual([id]);
  });

  it('TC-12 tolerates a damaged object entry without throwing', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.doc.transact(() => {
      (h.doc.getMap('objects') as Y.Map<unknown>).set('broken', 'not a map');
    });

    expect(() => snapshot(h.doc)).not.toThrow();
    expect(notes(h.doc).map((n) => n.id)).toEqual([id]);
  });

  it('reads text written straight into the Y.Text', () => {
    const h = harness();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    const text = getStickyText(h.doc, id)!;
    h.doc.transact(() => text.insert(0, 'Faster onboarding'));
    expect(notes(h.doc)[0]!.text).toBe('Faster onboarding');
  });

  it('returns immutable snapshots', () => {
    const h = harness();
    createSticky(h.doc, { x: 0, y: 0 });
    const list = notes(h.doc) as StickySnapshot[];
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(() => {
      list[0]!.x = 12_345;
    }).toThrow();
    expect(notes(h.doc)[0]!.x).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('runs every successful mutation with LOCAL_ORIGIN', () => {
    const h = harness();
    const origins: unknown[] = [];
    h.doc.on('update', (_update: unknown, origin: unknown) => origins.push(origin));
    const id = createSticky(h.doc, { x: 0, y: 0 });
    moveObject(h.doc, id, 1, 2);
    setStickyColor(h.doc, id, 'pink');
    createSticky(h.doc, { x: 40, y: 0 });
    bringToFront(h.doc, id);
    deleteObject(h.doc, id);
    expect(origins).toEqual([
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
    ]);
  });
});
