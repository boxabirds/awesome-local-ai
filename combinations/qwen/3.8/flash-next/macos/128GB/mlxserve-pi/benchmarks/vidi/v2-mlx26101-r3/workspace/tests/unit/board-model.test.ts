import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  META_MAP,
  OBJECTS_MAP,
  SCHEMA_VERSION,
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/**
 * board.model unit tests (TC-01 to TC-12, TC-39) against a **real** Y.Doc: the document is
 * the store under test, so nothing here is mocked. Every mutation test also asserts how
 * many `update` events the doc emitted - one per successful mutation, none for a
 * rejection - because story 3 turns those events into sync traffic.
 */

interface Counted<T> {
  result: T;
  updates: number;
  origins: unknown[];
}

/** Run `run` while counting the doc's `update` events and the origins that caused them. */
function countUpdates<T>(doc: Y.Doc, run: () => T): Counted<T> {
  let updates = 0;
  const origins: unknown[] = [];
  const observer = (_update: Uint8Array, origin: unknown): void => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates, origins };
  } finally {
    doc.off('update', observer);
  }
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsOf(doc).get(id);
}

/** Write a raw object into the document, bypassing the model (fixtures for negatives). */
function insertRaw(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, value);
    }
    objectsOf(doc).set(id, map);
  });
}

function setRawZ(doc: Y.Doc, id: string, z: number): void {
  doc.transact(() => {
    rawObject(doc, id)?.set('z', z);
  });
}

function only(doc: Y.Doc): StickySnapshot {
  const notes = snapshot(doc);
  if (notes.length !== 1) {
    throw new Error(`expected exactly one note, found ${notes.length}`);
  }
  return notes[0] as StickySnapshot;
}

describe('board.model: initDoc', () => {
  it('records the schema version once', () => {
    const doc = new Y.Doc();
    const first = countUpdates(doc, () => {
      initDoc(doc);
    });
    expect(first.updates).toBe(1);
    expect(first.origins[0]).toBe(LOCAL_ORIGIN);
    expect(doc.getMap<number>(META_MAP).get('schemaVersion')).toBe(SCHEMA_VERSION);

    // Idempotent: a second init (e.g. after loading a stored document) writes nothing.
    const second = countUpdates(doc, () => {
      initDoc(doc);
    });
    expect(second.updates).toBe(0);
    expect(doc.getMap<number>(META_MAP).get('schemaVersion')).toBe(SCHEMA_VERSION);
  });
});

describe('board.model: create', () => {
  it('TC-01: creates the first note as a centred, yellow, empty note at z 1', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    const { result: id, updates, origins } = countUpdates(doc, () =>
      createSticky(doc, { x: 0, y: 0 }),
    );

    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    expect(typeof id).toBe('string');
    expect(id).not.toBe('');

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0] as StickySnapshot;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.color).toBe('yellow');
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred on the requested point: the stored position is the note's top-left.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.createdAt).toBeGreaterThan(0);
    expect(Number.isFinite(note.createdAt)).toBe(true);
  });

  it('TC-01b: centres the note on the given point, whatever it is', () => {
    const doc = newDoc();
    createSticky(doc, { x: 320, y: -80 });
    const note = only(doc);
    expect(note.x).toBe(320 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-80 - STICKY_SIZE_WORLD / 2);
  });

  it('TC-02: stacks a new note above existing notes (z = maxZ + 1)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 40, y: 0 });
    const { result: id, updates } = countUpdates(doc, () => createSticky(doc, { x: 80, y: 0 }));

    expect(updates).toBe(1);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
    expect(snapshot(doc).at(-1)?.id).toBe(id);
  });

  it('TC-02b: accepts an explicit colour and gives every note a unique id', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 }, 'violet');
    const second = createSticky(doc, { x: 0, y: 0 }, 'violet');

    expect(first).not.toBe(second);
    expect(snapshot(doc).map((note) => note.color)).toEqual(['violet', 'violet']);
  });

  it('TC-39: refuses non-finite coordinates without writing anything', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 10, y: 20 });

    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      const { result, updates } = countUpdates(doc, () => createSticky(doc, at));
      expect(result, `createSticky(${at.x}, ${at.y})`).toBeFalsy();
      expect(updates).toBe(0);
    }
    expect(objectsOf(doc).size).toBe(1);
    expect(only(doc)).toMatchObject({ id, x: 10 - STICKY_SIZE_WORLD / 2 });
  });
});

describe('board.model: move', () => {
  it('TC-03: moveObject writes the new top-left and touches nothing else', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 }, 'blue');
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    const before = only(doc);
    expect(before).toMatchObject({ x: 0, y: 0 });

    const { result, updates, origins } = countUpdates(doc, () => moveObject(doc, id, 10, -20));

    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    const after = only(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe('blue');
    expect(after.text).toBe('Faster onboarding');
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04: moveObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc);

    const { result, updates } = countUpdates(doc, () =>
      moveObject(doc, 'missing-note', 5, 5),
    );

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });

  it('TC-39: moveObject rejects non-finite coordinates and leaves the note in place', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = only(doc);

    const rejections: [number, number][] = [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 1],
      [1, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of rejections) {
      const { result, updates } = countUpdates(doc, () => moveObject(doc, id, x, y));
      expect(result, `moveObject(${x}, ${y})`).toBe(false);
      expect(updates).toBe(0);
    }
    expect(only(doc)).toEqual(before);
  });

  it('TC-09: bringToFront puts a buried note on top', () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 20, y: 0 });
    createSticky(doc, { x: 40, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);

    const { result, updates } = countUpdates(doc, () => bringToFront(doc, bottom));

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes.map((note) => note.z)).toEqual([2, 3, 4]);
    expect(notes.at(-1)?.id).toBe(bottom);
    // Position, colour and text survive a re-stack.
    expect(notes.at(-1)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, color: 'yellow', text: '' });
  });

  it('TC-10: bringToFront on the topmost note is a no-op with no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 20, y: 0 });
    const before = snapshot(doc);

    const { result, updates } = countUpdates(doc, () => bringToFront(doc, top));

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });

  it('TC-10b: bringToFront on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = countUpdates(doc, () => bringToFront(doc, 'missing-note'));

    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11: equal z values are ordered by id, stable across calls', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 300 });
    const c = createSticky(doc, { x: 0, y: 600 });
    // Concurrent peers (story 3) can produce the same z; the id breaks the tie.
    setRawZ(doc, a, 5);
    setRawZ(doc, b, 5);
    setRawZ(doc, c, 1);

    const first = snapshot(doc);
    const second = snapshot(doc);

    const byId = [a, b].sort();
    expect(first.map((note) => note.id)).toEqual([c, ...byId]);
    expect(second.map((note) => note.id)).toEqual(first.map((note) => note.id));
    expect(first.map((note) => note.z)).toEqual([1, 5, 5]);
  });
});

describe('board.model: colour', () => {
  it('TC-05: setStickyColor changes only the colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    moveObject(doc, id, 12, 34);
    const before = only(doc);

    const { result, updates, origins } = countUpdates(doc, () =>
      setStickyColor(doc, id, 'green'),
    );

    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    const after = only(doc);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-05b: every one of the six colours can be applied', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');

    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, color));
      expect(result, color).toBe(true);
      expect(updates, color).toBe(1);
      expect(only(doc).color).toBe(color);
    }
  });

  it('TC-05c: setting the colour the note already has writes nothing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'yellow'));

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(only(doc).color).toBe('yellow');
  });

  it('TC-06: an unknown colour changes nothing and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = only(doc);

    for (const color of ['teal', '', 'Yellow', 'yellow ', '#FFF59D']) {
      const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, color));
      expect(result, color).toBe(false);
      expect(updates, color).toBe(0);
    }
    const after = only(doc);
    expect(after.color).toBe(DEFAULT_STICKY_COLOR);
    expect(after).toEqual(before);
  });

  it('TC-06b: setStickyColor on a stale id returns false and emits no update', () => {
    const doc = newDoc();

    const { result, updates } = countUpdates(doc, () =>
      setStickyColor(doc, 'missing-note', 'pink'),
    );

    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: delete', () => {
  it('TC-07: deleteObject removes the note', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const id = createSticky(doc, { x: 0, y: 300 });
    expect(snapshot(doc)).toHaveLength(2);

    const { result, updates, origins } = countUpdates(doc, () => deleteObject(doc, id));

    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]?.id).not.toBe(id);
    expect(objectsOf(doc).has(id)).toBe(false);
  });

  it('TC-08: deleteObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = countUpdates(doc, () => deleteObject(doc, 'missing-note'));

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(only(doc).id).toBe(id);

    // A second delete of the same note is also a rejection.
    deleteObject(doc, id);
    const again = countUpdates(doc, () => deleteObject(doc, id));
    expect(again.result).toBe(false);
    expect(again.updates).toBe(0);
  });
});

describe('board.model: reading the document', () => {
  it('TC-12: objects of unknown types are skipped by snapshot without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // A future story's object type (frames, shapes, ...) must not break this client.
    insertRaw(doc, 'shape-1', { type: 'shape', x: 0, y: 0, z: 9 });
    insertRaw(doc, 'broken-1', { x: 1, y: 2 });

    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((note) => note.id)).toEqual([id]);
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
  });

  it('TC-12b: snapshot skips a sticky whose fields are unusable instead of throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    insertRaw(doc, 'sticky-but-broken', {
      type: 'sticky',
      x: Number.NaN,
      y: 0,
      color: 'teal',
      text: new Y.Text('nope'),
      z: 3,
    });

    expect(snapshot(doc).map((note) => note.id)).toEqual([id]);
  });

  it('exposes the note text as a Y.Text so text edits are mergeable', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);

    const { updates } = countUpdates(doc, () => {
      ytext?.insert(0, 'Hello');
    });
    expect(updates).toBe(1);
    expect(only(doc).text).toBe('Hello');
    expect(getStickyText(doc, 'missing-note')).toBeUndefined();
  });

  it('reads text written by a peer into the snapshot', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const peer = new Y.Doc();
    initDoc(peer);
    const peerId = createSticky(peer, { x: 0, y: 0 });
    getStickyText(peer, peerId)?.insert(0, 'From a peer');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    // The peer note joins this document's (z, id) order; the renderer only needs a
    // stable order and the peer's text (real stacking across peers is story 3).
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first).toHaveLength(2);
    expect(first.some((note) => note.text === 'From a peer')).toBe(true);
    expect(first.some((note) => note.id === peerId)).toBe(true);
    expect(second.map((note) => note.id)).toEqual(first.map((note) => note.id));
  });

  it('TC-12c: a document with no objects at all snapshots to an empty list', () => {
    const doc = new Y.Doc();
    expect(snapshot(doc)).toEqual([]);
  });
});
