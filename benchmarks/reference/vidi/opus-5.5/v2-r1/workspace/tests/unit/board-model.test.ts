import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
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
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts `update` events emitted while `fn` runs, and the transaction origins used. */
function countUpdates<T>(doc: Y.Doc, fn: () => T) {
  const origins: unknown[] = [];
  const onUpdate = (_u: Uint8Array, origin: unknown) => origins.push(origin);
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
  return notes[0];
}

describe('board.model', () => {
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    expect(countUpdates(doc, () => initDoc(doc)).updates).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(SCHEMA_VERSION);
    expect(countUpdates(doc, () => initDoc(doc)).updates).toBe(0);
  });

  it('TC-01 createSticky on an empty doc creates one centred yellow note with z 1', () => {
    const doc = newDoc();
    const {
      result: id,
      updates,
      origins,
    } = countUpdates(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(typeof id).toBe('string');
    expect(doc.getMap('objects').size).toBe(1);
    const note = only(doc);
    expect(note).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
    });
    expect(note.createdAt).toBeGreaterThan(0);
    expect(getStickyText(doc, id as string)).toBeInstanceOf(Y.Text);
  });

  it('TC-01 creation is centred on the given point', () => {
    const doc = newDoc();
    createSticky(doc, { x: 350, y: -40 });
    expect(only(doc)).toMatchObject({
      x: 350 - STICKY_SIZE_WORLD / 2,
      y: -40 - STICKY_SIZE_WORLD / 2,
    });
  });

  it('TC-02 a new note goes above existing notes (z 1, 2 → 3)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    const id = createSticky(doc, { x: 20, y: 20 });
    expect(snapshot(doc).find((n) => n.id === id)?.z).toBe(3);
  });

  it('TC-03 moveObject updates x, y only', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    getStickyText(doc, id)!.insert(0, 'Faster onboarding');
    const before = only(doc);
    expect(before).toMatchObject({ x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(only(doc)).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id returns false and emits nothing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    deleteObject(doc, id);
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 10, 10));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(countUpdates(doc, () => moveObject(doc, 'unknown-id', 1, 1)).result).toBe(false);
  });

  it('moveObject to the same position is a no-op', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 0, 0));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    getStickyText(doc, id)!.insert(0, 'Retro: what went well');
    const before = only(doc);
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(only(doc)).toEqual({ ...before, color: 'green' });
  });

  it('TC-06 setStickyColor with an unknown colour returns false and changes nothing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    for (const color of ['teal', 'toString', '__proto__', '']) {
      const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, color));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(only(doc).color).toBe('yellow');
    expect(countUpdates(doc, () => setStickyColor(doc, 'stale', 'green')).updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false and emits nothing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    deleteObject(doc, id);
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront raises the bottom note of 3 to z 4', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes[notes.length - 1]).toMatchObject({ id: a, z: 4 });
  });

  it('TC-10 bringToFront on the topmost note emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 }) as string;
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(countUpdates(doc, () => bringToFront(doc, 'stale')).result).toBe(false);
  });

  it('TC-11 equal z values are ordered by id, stable across calls; bringToFront breaks the tie', () => {
    const doc = newDoc();
    const objects = doc.getMap('objects');
    const ids = ['c-note', 'a-note', 'b-note'];
    doc.transact(() => {
      for (const id of ids) {
        const m = new Y.Map<unknown>();
        m.set('type', 'sticky');
        m.set('x', 0);
        m.set('y', 0);
        m.set('color', 'blue');
        m.set('text', new Y.Text('tie'));
        m.set('z', 5);
        m.set('createdAt', 1);
        objects.set(id, m);
      }
    });
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a-note', 'b-note', 'c-note']);
    expect(snapshot(doc).map((n) => n.id)).toEqual(first);
    expect(bringToFront(doc, 'b-note')).toBe(true);
    expect(snapshot(doc).map((n) => [n.id, n.z])).toEqual([
      ['a-note', 5],
      ['c-note', 5],
      ['b-note', 6],
    ]);
  });

  it('TC-12 unknown object types are skipped by snapshot without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 1);
      shape.set('y', 1);
      shape.set('z', 9);
      doc.getMap('objects').set('shape-1', shape);
      doc.getMap('objects').set('junk', 42);
    });
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);
    // New notes still go above unknown objects.
    const next = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(snapshot(doc).find((n) => n.id === next)?.z).toBe(10);
  });

  it('snapshot is immutable', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);
    expect(Object.isFrozen(notes)).toBe(true);
    expect(Object.isFrozen(notes[0])).toBe(true);
  });

  it('TC-39 non-finite coordinates are rejected by moveObject and createSticky', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    for (const [x, y] of [
      [NaN, 0],
      [0, NaN],
      [Infinity, 0],
      [0, -Infinity],
    ]) {
      const move = countUpdates(doc, () => moveObject(doc, id, x, y));
      expect(move.result).toBe(false);
      expect(move.updates).toBe(0);
      const create = countUpdates(doc, () => createSticky(doc, { x, y }));
      expect(create.result).toBe(false);
      expect(create.updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(1);
    expect(only(doc)).toMatchObject({ x: -100, y: -100 });
  });
});
