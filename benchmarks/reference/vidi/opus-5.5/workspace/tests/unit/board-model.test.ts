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
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

const HALF = 2;
const ORIGIN = { x: 0, y: 0 } as const;
const MISSING_ID = 'no-such-note';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts Yjs `update` events emitted while `fn` runs (one per transaction that changed the doc). */
function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const onUpdate = (_update: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', onUpdate);
  try {
    const result = fn();
    return { result, updates: origins.length, origins };
  } finally {
    doc.off('update', onUpdate);
  }
}

function only(doc: Y.Doc) {
  const notes = snapshot(doc);
  expect(notes).toHaveLength(1);
  return notes[0]!;
}

describe('board.model', () => {
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const first = countUpdates(doc, () => initDoc(doc));
    expect(first.updates).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    const second = countUpdates(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
  });

  it('TC-01 createSticky on an empty doc adds one centred yellow sticky with empty text and z 1', () => {
    const doc = newDoc();
    expect(doc.getMap('objects').size).toBe(0);
    const at = { x: 40, y: -60 };
    const { result: id, updates, origins } = countUpdates(doc, () => createSticky(doc, at));
    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    expect(doc.getMap('objects').size).toBe(1);
    const note = only(doc);
    expect(note).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: at.x - STICKY_SIZE_WORLD / HALF,
      y: at.y - STICKY_SIZE_WORLD / HALF,
    });
    expect(typeof note.createdAt).toBe('number');
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });

  it('TC-02 createSticky stacks above existing notes (z = max + 1)', () => {
    const doc = newDoc();
    createSticky(doc, ORIGIN);
    createSticky(doc, ORIGIN);
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    const id = createSticky(doc, ORIGIN);
    expect(snapshot(doc).find((n) => n.id === id)?.z).toBe(3);
  });

  it('createSticky accepts an explicit colour', () => {
    const doc = newDoc();
    createSticky(doc, ORIGIN, 'blue');
    expect(only(doc).color).toBe('blue');
  });

  it('createSticky rejects non-finite coordinates without a transaction', () => {
    const doc = newDoc();
    const { result, updates } = countUpdates(doc, () => createSticky(doc, { x: Number.NaN, y: 0 }));
    expect(result).toBe('');
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-03 moveObject updates x,y and nothing else', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: STICKY_SIZE_WORLD / HALF, y: STICKY_SIZE_WORLD / HALF });
    const before = only(doc);
    expect([before.x, before.y]).toEqual([0, 0]);
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(only(doc)).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id returns false and emits nothing', () => {
    const doc = newDoc();
    createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => moveObject(doc, MISSING_ID, 1, 1));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('moveObject rejects non-finite coordinates and same-position no-ops', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    const before = only(doc);
    const bad = countUpdates(doc, () => [
      moveObject(doc, id, Number.POSITIVE_INFINITY, 0),
      moveObject(doc, id, 0, Number.NaN),
      moveObject(doc, id, before.x, before.y),
    ]);
    expect(bad.result).toEqual([false, false, false]);
    expect(bad.updates).toBe(0);
    expect(only(doc)).toEqual(before);
  });

  it('TC-05 setStickyColor applies a known colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(only(doc).color).toBe('green');
  });

  it('TC-06 setStickyColor rejects an unknown colour without a transaction', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(only(doc).color).toBe('yellow');
  });

  it('setStickyColor rejects a stale id, a prototype key and the current colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => [
      setStickyColor(doc, MISSING_ID, 'green'),
      setStickyColor(doc, id, 'toString'),
      setStickyColor(doc, id, 'yellow'),
    ]);
    expect(result).toEqual([false, false, false]);
    expect(updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false and emits nothing', () => {
    const doc = newDoc();
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, MISSING_ID));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront moves the lowest of three notes to z 4', () => {
    const doc = newDoc();
    const first = createSticky(doc, ORIGIN);
    createSticky(doc, ORIGIN);
    createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, first));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes.at(-1)).toMatchObject({ id: first, z: 4 });
  });

  it('TC-10 bringToFront on the topmost note is a no-op with no update', () => {
    const doc = newDoc();
    createSticky(doc, ORIGIN);
    const top = createSticky(doc, ORIGIN);
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === top)?.z).toBe(2);
  });

  it('bringToFront on a stale id returns false', () => {
    const doc = newDoc();
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, MISSING_ID));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('bringToFront lifts a note that shares the top z with another note', () => {
    const doc = newDoc();
    const a = createSticky(doc, ORIGIN);
    const b = createSticky(doc, ORIGIN);
    // Simulate two clients that both picked z 2 concurrently (possible once story 3 syncs).
    (doc.getMap('objects').get(a) as Y.Map<unknown>).set('z', 2);
    expect(bringToFront(doc, a)).toBe(true);
    expect(snapshot(doc).map((n) => n.id)).toEqual([b, a]);
  });

  it('TC-11 equal z values are ordered by id, stable across calls', () => {
    const doc = newDoc();
    const ids = [createSticky(doc, ORIGIN), createSticky(doc, ORIGIN), createSticky(doc, ORIGIN)];
    const objects = doc.getMap('objects');
    for (const id of ids) (objects.get(id) as Y.Map<unknown>).set('z', 1);
    const expected = [...ids].sort();
    expect(snapshot(doc).map((n) => n.id)).toEqual(expected);
    expect(snapshot(doc).map((n) => n.id)).toEqual(expected);
  });

  it('TC-12 snapshot skips unknown object types without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    const shape = new Y.Map<unknown>();
    doc.getMap('objects').set('shape-1', shape);
    shape.set('type', 'shape');
    shape.set('x', 0);
    doc.getMap('objects').set('garbage', 'not a map' as unknown as Y.Map<unknown>);
    let notes: ReturnType<typeof snapshot> = [];
    expect(() => {
      notes = snapshot(doc);
    }).not.toThrow();
    expect(notes.map((n) => n.id)).toEqual([id]);
  });

  it('snapshot reflects text typed into the Y.Text', () => {
    const doc = newDoc();
    const id = createSticky(doc, ORIGIN);
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    expect(only(doc).text).toBe('Faster onboarding');
  });
});
