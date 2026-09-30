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

/** Counts `update` events (and their origins) emitted while `fn` runs. */
function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const listener = (_update: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', listener);
  try {
    const result = fn();
    return { result, updates: origins.length, origins };
  } finally {
    doc.off('update', listener);
  }
}

function create(doc: Y.Doc, at = { x: 0, y: 0 }): string {
  const id = createSticky(doc, at);
  if (id === false) throw new Error('create rejected');
  return id;
}

function note(doc: Y.Doc, id: string) {
  const found = snapshot(doc).find((n) => n.id === id);
  if (!found) throw new Error(`note ${id} missing`);
  return found;
}

describe('board.model', () => {
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const first = countUpdates(doc, () => initDoc(doc));
    expect(first.updates).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(SCHEMA_VERSION);
    const second = countUpdates(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
  });

  it('TC-01 createSticky on an empty doc adds one centred yellow sticky with empty text and z 1', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);
    const { result: id, updates, origins } = countUpdates(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(typeof id).toBe('string');
    expect(doc.getMap('objects').size).toBe(1);
    const n = note(doc, id as string);
    expect(n).toMatchObject({
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
    });
    expect(n.createdAt).toBeGreaterThan(0);
    expect(getStickyText(doc, id as string)).toBeInstanceOf(Y.Text);
  });

  it('TC-01 creation centres the note on the given point', () => {
    const doc = newDoc();
    const id = create(doc, { x: 1000, y: -250 });
    expect(note(doc, id)).toMatchObject({ x: 1000 - STICKY_SIZE_WORLD / 2, y: -250 - STICKY_SIZE_WORLD / 2 });
  });

  it('TC-02 a new note goes above existing notes (z 1, 2 → 3)', () => {
    const doc = newDoc();
    create(doc);
    create(doc);
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    const id = create(doc);
    expect(note(doc, id).z).toBe(3);
  });

  it('TC-03 moveObject updates x, y and nothing else', () => {
    const doc = newDoc();
    const id = create(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    const before = note(doc, id);
    expect(before).toMatchObject({ x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(note(doc, id)).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id returns false and emits nothing', () => {
    const doc = newDoc();
    const id = create(doc);
    deleteObject(doc, id);
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(countUpdates(doc, () => moveObject(doc, 'never-existed', 5, 5)).updates).toBe(0);
  });

  it('TC-05 setStickyColor applies the colour and leaves text, position and z unchanged', () => {
    const doc = newDoc();
    const id = create(doc);
    getStickyText(doc, id)?.insert(0, 'Retro: what went well');
    const before = note(doc, id);
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(note(doc, id)).toEqual({ ...before, color: 'green' });
  });

  it('TC-06 setStickyColor with an unknown colour returns false and changes nothing', () => {
    const doc = newDoc();
    const id = create(doc);
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(note(doc, id).color).toBe('yellow');
    // Inherited object keys are not colours either.
    expect(setStickyColor(doc, id, 'toString')).toBe(false);
  });

  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = create(doc);
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-08 deleteObject on a stale id returns false and emits nothing', () => {
    const doc = newDoc();
    const id = create(doc);
    deleteObject(doc, id);
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront on the bottom note of three gives it z 4', () => {
    const doc = newDoc();
    const bottom = create(doc);
    create(doc);
    create(doc);
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, bottom));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(note(doc, bottom).z).toBe(4);
    expect(snapshot(doc).at(-1)?.id).toBe(bottom);
  });

  it('TC-10 bringToFront on the topmost note emits no update', () => {
    const doc = newDoc();
    create(doc);
    const top = create(doc);
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(note(doc, top).z).toBe(2);
    expect(bringToFront(doc, 'stale')).toBe(false);
  });

  it('TC-10 bringToFront on a note tied for the top z still lifts it', () => {
    const doc = newDoc();
    const a = create(doc);
    const b = create(doc);
    doc.getMap<Y.Map<unknown>>('objects').get(a)?.set('z', 2);
    expect(bringToFront(doc, b)).toBe(true);
    expect(note(doc, b).z).toBe(3);
  });

  it('TC-11 equal z values are ordered by id, stably across calls', () => {
    const doc = newDoc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (const id of ['c-note', 'a-note', 'b-note']) {
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', 'blue');
      m.set('text', new Y.Text('Tie'));
      m.set('z', 5);
      m.set('createdAt', 1);
      objects.set(id, m);
    }
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a-note', 'b-note', 'c-note']);
    expect(snapshot(doc).map((n) => n.id)).toEqual(first);
  });

  it('TC-12 unknown object types are skipped without throwing', () => {
    const doc = newDoc();
    const id = create(doc);
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    shape.set('z', 9);
    doc.getMap('objects').set('some-shape', shape);
    doc.getMap('objects').set('not-a-map', 42 as unknown as Y.Map<unknown>);
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);
    // A new sticky still goes above the unknown object.
    const top = create(doc);
    expect(note(doc, top).z).toBe(10);
  });

  it('snapshots are frozen', () => {
    const doc = newDoc();
    create(doc);
    const snap = snapshot(doc);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap[0])).toBe(true);
  });

  it('TC-39 non-finite coordinates are rejected without writing', () => {
    const doc = newDoc();
    const id = create(doc);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const move = countUpdates(doc, () => [moveObject(doc, id, bad, 0), moveObject(doc, id, 0, bad)]);
      expect(move.result).toEqual([false, false]);
      expect(move.updates).toBe(0);
      const created = countUpdates(doc, () => [createSticky(doc, { x: bad, y: 0 }), createSticky(doc, { x: 0, y: bad })]);
      expect(created.result).toEqual([false, false]);
      expect(created.updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(1);
    expect(note(doc, id)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
  });
});
