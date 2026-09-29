import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
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
  SCHEMA_VERSION,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';

const HALF = STICKY_SIZE_WORLD / 2;

/** A document that has been schema-initialised. */
const freshDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

/** Count `update` events emitted *after* this call (mutations only). */
const updateCounter = (doc: Y.Doc): (() => number) => {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
};

const objects = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const getSticky = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined =>
  objects(doc).get(id);

describe('board.model: initDoc', () => {
  it('sets meta.schemaVersion once and does not rewrite it', () => {
    const doc = new Y.Doc();
    const updates = updateCounter(doc);
    initDoc(doc);
    expect(updates()).toBe(1);
    const meta = doc.getMap<unknown>('meta');
    expect(meta.get('schemaVersion')).toBe(SCHEMA_VERSION);

    // A second init finds it present and opens no transaction.
    initDoc(doc);
    expect(updates()).toBe(1);
  });
});

describe('board.model: createSticky (TC-01, TC-02)', () => {
  // TC-01: create on an empty doc.
  it('TC-01 creates one yellow note centred on the point with z 1', () => {
    const doc = freshDoc();
    const updates = updateCounter(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);
    expect(objects(doc).size).toBe(1);

    const note = getSticky(doc, id);
    expect(note).toBeDefined();
    expect(note?.get('type')).toBe('sticky');
    expect(note?.get('color')).toBe(DEFAULT_STICKY_COLOR);
    expect((note?.get('text') as Y.Text).toString()).toBe('');
    expect(note?.get('z')).toBe(1);
    // Centred: top-left = point - half.
    expect(note?.get('x')).toBe(-HALF);
    expect(note?.get('y')).toBe(-HALF);
    expect(typeof note?.get('createdAt')).toBe('number');

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0]?.id).toBe(id);
    expect(snap[0]?.type).toBe('sticky');
    expect(snap[0]?.color).toBe('yellow');
    expect(snap[0]?.text).toBe('');
    expect(snap[0]?.z).toBe(1);
  });

  it('TC-01 accepts an explicit colour', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 300, y: 400 }, 'green');
    const snap = snapshot(doc);
    expect(snap[0]?.id).toBe(id);
    expect(snap[0]?.color).toBe('green');
    expect(snap[0]?.x).toBe(300 - HALF);
    expect(snap[0]?.y).toBe(400 - HALF);
  });

  // TC-02: create on top of existing notes.
  it('TC-02 stacks the new note above existing z values', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);
    expect(getSticky(doc, id)?.get('z')).toBe(3);
    const snap = snapshot(doc);
    expect(snap.map((s) => s.z)).toEqual([1, 2, 3]);
  });
});

describe('board.model: moveObject (TC-03, TC-04)', () => {
  // TC-03: move a note.
  it('TC-03 updates x,y and leaves other fields unchanged', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue');
    const before = getSticky(doc, id);
    const beforeText = (before?.get('text') as Y.Text).toString();
    const updates = updateCounter(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates()).toBe(1);
    const after = getSticky(doc, id);
    expect(after?.get('x')).toBe(10);
    expect(after?.get('y')).toBe(-20);
    expect(after?.get('color')).toBe('blue');
    expect(after?.get('z')).toBe(1);
    expect((after?.get('text') as Y.Text).toString()).toBe(beforeText);
  });

  // TC-04: move a stale id.
  it('TC-04 rejects a stale id with false and no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(moveObject(doc, 'does-not-exist', 5, 5)).toBe(false);
    expect(updates()).toBe(0);
  });

  // TC-39: non-finite coordinates.
  it('TC-39 rejects NaN / Infinity coordinates with false and no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(moveObject(doc, id, Number.NaN, 5)).toBe(false);
    expect(moveObject(doc, id, 5, Number.POSITIVE_INFINITY)).toBe(false);
    expect(moveObject(doc, id, Number.NEGATIVE_INFINITY, Number.NaN)).toBe(false);
    expect(updates()).toBe(0);
    // Position is untouched.
    expect(getSticky(doc, id)?.get('x')).toBe(-HALF);

    // Invalid creation returns a falsy id (no note created).
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    expect(updates()).toBe(0);
    expect(objects(doc).size).toBe(1);
  });
});

describe('board.model: setStickyColor (TC-05, TC-06)', () => {
  // TC-05: recolour a note.
  it('TC-05 applies a valid colour and leaves text/position/z unchanged', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 12, y: -34 });
    moveObject(doc, id, 10, 20);
    const updates = updateCounter(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates()).toBe(1);
    const note = getSticky(doc, id);
    expect(note?.get('color')).toBe('green');
    expect(note?.get('x')).toBe(10);
    expect(note?.get('y')).toBe(20);
    expect(note?.get('z')).toBe(1);
    // Every colour key is accepted.
    for (const name of Object.keys(STICKY_COLORS) as StickyColor[]) {
      expect(setStickyColor(doc, id, name)).toBe(true);
      expect(getSticky(doc, id)?.get('color')).toBe(name);
    }
  });

  // TC-06: unknown colour.
  it('TC-06 rejects an unknown colour with false and no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates()).toBe(0);
    expect(getSticky(doc, id)?.get('color')).toBe(DEFAULT_STICKY_COLOR);
    // A stale id with a valid colour is also rejected.
    expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model: deleteObject (TC-07, TC-08)', () => {
  // TC-07: delete a note.
  it('TC-07 removes the note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates()).toBe(1);
    expect(objects(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08: delete a stale id.
  it('TC-08 rejects a stale id with false and no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates()).toBe(0);
    expect(objects(doc).size).toBe(1);
  });
});

describe('board.model: bringToFront (TC-09, TC-10)', () => {
  // TC-09: bring a lower note to the front.
  it('TC-09 raises the z of a non-topmost note to maxZ + 1', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(getSticky(doc, a)?.get('z')).toBe(1);
    const updates = updateCounter(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates()).toBe(1);
    expect(getSticky(doc, a)?.get('z')).toBe(4);
    expect(snapshot(doc).at(-1)?.id).toBe(a);
  });

  // TC-10: bring the topmost note to the front.
  it('TC-10 does nothing when the note is already topmost', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates()).toBe(0);
    expect(getSticky(doc, top)?.get('z')).toBe(2);
    // A stale id is also rejected.
    expect(bringToFront(doc, 'missing')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model: snapshot ordering (TC-11, TC-12)', () => {
  // TC-11: equal z is tie-broken by id, stable.
  it('TC-11 sorts equal-z notes by id as a stable tie-break', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    // Force equal z directly (createSticky always assigns distinct z).
    doc.transact(() => {
      getSticky(doc, a)?.set('z', 1);
      getSticky(doc, b)?.set('z', 1);
    });
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
    const ids = first.map((s) => s.id);
    const sorted = [...ids].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  // TC-12: unknown types are skipped.
  it('TC-12 skips objects with an unknown type', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 5);
      objects(doc).set('shape-1', shape);
    });
    let result: readonly unknown[] = [];
    expect(() => {
      result = snapshot(doc);
    }).not.toThrow();
    expect(result).toHaveLength(1);
    expect(snapshot(doc)[0]?.id).toBe(sticky);
  });
});

describe('board.model: getStickyText', () => {
  it('returns the note Y.Text and undefined for non-notes', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});
