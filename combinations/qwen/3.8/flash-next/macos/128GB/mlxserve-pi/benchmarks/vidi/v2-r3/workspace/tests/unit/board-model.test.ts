// board.model unit tests (TC-01 … TC-12, TC-39) against a REAL Y.Doc: all
// mutation rules live in src/shared/board-model.ts and Yjs is deterministic
// in-process, so mocking the document would hide real behaviour.
import { describe, expect, it } from 'vitest';
import { Doc, Map as YMap, Text as YText } from 'yjs';
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
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Counts the `update` events a doc emits: 1 per successful mutation, 0 per rejection. */
function updateCounter(doc: Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  return () => count;
}

function newDoc(): Doc {
  const doc = new Doc();
  initDoc(doc);
  return doc;
}

/** Read the raw per-object Y.Map for schema-level assertions. */
function rawObject(doc: Doc, id: string): YMap<unknown> {
  return doc.getMap<YMap<unknown>>('objects').get(id)!;
}

describe('initDoc', () => {
  it('sets meta.schemaVersion once and is idempotent', () => {
    const doc = new Doc();
    const updates = updateCounter(doc);

    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates()).toBe(1);

    // A second call must not rewrite (or emit) anything.
    initDoc(doc);
    expect(updates()).toBe(1);
  });
});

describe('createSticky', () => {
  // TC-01: create on an empty doc → one sticky, centred on the point, on top.
  it('TC-01 creates one yellow empty note centred on the point with z 1', () => {
    const doc = newDoc();
    const updates = updateCounter(doc);

    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred: the stored top-left is the point minus half the note size.
    expect(note.x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
  });

  // TC-02: new notes stack above every existing one.
  it('TC-02 gives the new note z = maxZ + 1', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    const updates = updateCounter(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    expect(updates()).toBe(1);

    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.z).toBe(3);
    expect(snapshot(doc)).toHaveLength(3);
  });

  it('TC-01b honours an explicit colour and uses crypto.randomUUID ids', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 10, y: 20 }, 'violet');
    const note = snapshot(doc)[0];
    expect(note.color).toBe('violet');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // TC-39 (create half): non-finite coordinates are rejected without a write.
  it('TC-39 rejects NaN / Infinity creation coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const doc = newDoc();
      const updates = updateCounter(doc);
      const id = createSticky(doc, { x: bad, y: 0 });
      expect(id).toBeFalsy();
      expect(snapshot(doc)).toHaveLength(0);
      expect(doc.getMap('objects').size).toBe(0);
      expect(updates()).toBe(0);

      const doc2 = newDoc();
      const updates2 = updateCounter(doc2);
      expect(createSticky(doc2, { x: 0, y: bad })).toBeFalsy();
      expect(snapshot(doc2)).toHaveLength(0);
      expect(updates2()).toBe(0);
    }
  });

  it('stores a Y.Text under text and returns it from getStickyText', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(YText);
    expect(ytext!.toString()).toBe('');
    expect(getStickyText(doc, 'nope')).toBeUndefined();
  });
});

describe('moveObject', () => {
  // TC-03: move updates x,y only.
  it('TC-03 writes the new coordinates and leaves every other field alone', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const updates = updateCounter(doc);

    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  // TC-04 (negative): a stale id changes nothing.
  it('TC-04 rejects a stale id with false and no update event', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc);
    const updates = updateCounter(doc);

    expect(moveObject(doc, 'missing-id', 40, 40)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });

  // TC-39 (move half): non-finite coordinates are rejected.
  it('TC-39 rejects NaN / Infinity coordinates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc);
    const updates = updateCounter(doc);

    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(moveObject(doc, id, bad, 5)).toBe(false);
      expect(moveObject(doc, id, 5, bad)).toBe(false);
    }
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });
});

describe('setStickyColor', () => {
  // TC-05: recolour changes only `color`.
  it('TC-05 applies one of the six colours and keeps text, position, z', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 40, y: 60 });
    getStickyText(doc, id)!.insert(0, 'Faster onboarding');
    const before = snapshot(doc)[0];
    const updates = updateCounter(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe('Faster onboarding');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    // Every colour name in the palette is accepted.
    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(snapshot(doc)[0].color).toBe(color);
    }
  });

  // TC-06 (negative): an unknown colour name writes nothing.
  it('TC-06 rejects an unknown colour with false and no update event', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);

    // A stale id is rejected too.
    expect(setStickyColor(doc, 'missing-id', 'blue')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('deleteObject', () => {
  // TC-07: delete removes the note.
  it('TC-07 removes the note from objects', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(deleteObject(doc, id)).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(doc.getMap('objects').has(id)).toBe(false);
  });

  // TC-08 (negative): deleting a stale id is a no-op.
  it('TC-08 rejects a stale id with false and no update event', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('bringToFront', () => {
  // TC-09: bringing the bottom note to the front sets z = maxZ + 1.
  it('TC-09 raises a non-topmost note above all others', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    const updates = updateCounter(doc);

    expect(bringToFront(doc, a)).toBe(true);
    expect(updates()).toBe(1);

    const noteA = snapshot(doc).find((n) => n.id === a)!;
    expect(noteA.z).toBe(4);
    // It is now last in render order.
    expect(snapshot(doc)[snapshot(doc).length - 1].id).toBe(a);
  });

  // TC-10 (negative): bringing the topmost note to the front is a no-op
  // (pointless sync traffic once story 3 shares the doc).
  it('TC-10 rejects the already-topmost note with false and no update event', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });
    const before = snapshot(doc);
    const updates = updateCounter(doc);

    expect(bringToFront(doc, top)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toEqual(before);

    // A stale id is rejected the same way.
    expect(bringToFront(doc, 'missing-id')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('snapshot', () => {
  // TC-11: equal z values break the tie by id, stably.
  it('TC-11 sorts by (z, id) so equal z values keep a stable id order', () => {
    const doc = newDoc();
    const objects = doc.getMap<YMap<unknown>>('objects');
    // Insert three notes with equal z in non-id order.
    for (const id of ['ccc', 'aaa', 'bbb']) {
      const m = new YMap<unknown>();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', DEFAULT_STICKY_COLOR);
      m.set('text', new YText(''));
      m.set('z', 7);
      m.set('createdAt', 1);
      objects.set(id, m);
    }

    const order = () => snapshot(doc).map((n) => n.id);
    expect(order()).toEqual(['aaa', 'bbb', 'ccc']);
    // Stable across calls (and therefore across clients once story 3 syncs).
    expect(order()).toEqual(order());

    // z is the primary key: a higher z sorts after lower ones regardless of id.
    (objects.get('bbb') as YMap<unknown>).set('z', 9);
    expect(order()).toEqual(['aaa', 'ccc', 'bbb']);
  });

  // TC-12 (forward compatibility): unknown object types are skipped.
  it('TC-12 skips objects with an unknown type without throwing', () => {
    const doc = newDoc();
    const objects = doc.getMap<YMap<unknown>>('objects');
    const sticky = createSticky(doc, { x: 0, y: 0 });

    const shape = new YMap<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 1);
    objects.set('shape-1', shape);
    // An object with no type at all is skipped as well.
    objects.set('junk-1', new YMap<unknown>());

    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((n) => n.id)).toEqual([sticky]);
  });

  it('returns immutable plain objects and reads live text', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 }, 'blue');
    getStickyText(doc, id)!.insert(0, 'Faster onboarding');

    const first = snapshot(doc);
    expect(first[0].text).toBe('Faster onboarding');
    expect(first[0].color).toBe('blue');
    expect(first).not.toBe(snapshot(doc)); // a new array per call
    expect(Object.isFrozen(first[0])).toBe(true);
  });
});

describe('transaction origin', () => {
  it('runs each successful mutation in exactly one LOCAL_ORIGIN transaction', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 });

    const origins: unknown[] = [];
    doc.on('update', (_update: unknown, origin: unknown) => {
      origins.push(origin);
    });

    const expectOneLocalOrigin = (fn: () => unknown) => {
      origins.length = 0;
      expect(fn()).toBeTruthy();
      expect(origins).toEqual([LOCAL_ORIGIN]);
    };

    createSticky(doc, { x: 300, y: 0 }); // so bringToFront(first) has work to do
    expectOneLocalOrigin(() => moveObject(doc, first, 1, 2));
    expectOneLocalOrigin(() => setStickyColor(doc, first, 'pink'));
    expectOneLocalOrigin(() => bringToFront(doc, first));
    expectOneLocalOrigin(() => deleteObject(doc, first));
  });
});
