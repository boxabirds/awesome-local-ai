import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  deleteObject,
  getObjectsMap,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { BOARD_SCHEMA_VERSION, DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts `update` events (one per transaction that changed something) during `fn`. */
function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const handler = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', handler);
  try {
    const result = fn();
    return { result, updates: origins.length, origins };
  } finally {
    doc.off('update', handler);
  }
}

function only(doc: Y.Doc) {
  const list = snapshot(doc);
  expect(list).toHaveLength(1);
  return list[0];
}

const HALF = STICKY_SIZE_WORLD / 2;

describe('board-model (board.model)', () => {
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const first = countUpdates(doc, () => initDoc(doc));
    expect(first.updates).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(BOARD_SCHEMA_VERSION);
    const second = countUpdates(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
  });

  it('TC-01 createSticky on an empty doc adds one yellow, empty, z 1 note centred on the point', () => {
    const doc = newDoc();
    expect(getObjectsMap(doc).size).toBe(0);
    const { result: id, updates, origins } = countUpdates(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(getObjectsMap(doc).size).toBe(1);
    const n = only(doc);
    expect(n).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: -HALF,
      y: -HALF,
    });
    expect(n.createdAt).toBeGreaterThan(0);
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });

  it('TC-01 creation at an arbitrary point centres the note there', () => {
    const doc = newDoc();
    createSticky(doc, { x: 350, y: -40 });
    expect(only(doc)).toMatchObject({ x: 350 - HALF, y: -40 - HALF });
  });

  it('TC-02 createSticky with existing z 1, 2 gives z 3', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    const id = createSticky(doc, { x: 20, y: 20 });
    expect(snapshot(doc).find((n) => n.id === id)!.z).toBe(3);
  });

  it('TC-03 moveObject updates x, y only', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: HALF, y: HALF });
    getStickyText(doc, id)!.insert(0, 'Faster onboarding');
    const before = only(doc);
    expect(before).toMatchObject({ x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(only(doc)).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    const { result, updates } = countUpdates(doc, () => moveObject(doc, id, 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(countUpdates(doc, () => moveObject(doc, 'no-such-id', 1, 1)).updates).toBe(0);
  });

  it('TC-05 setStickyColor green changes colour only', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, 'Retro: what went well');
    const before = only(doc);
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(only(doc)).toEqual({ ...before, color: 'green' });
  });

  it('TC-06 setStickyColor with an unknown colour returns false and changes nothing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(only(doc).color).toBe('yellow');
    expect(countUpdates(doc, () => setStickyColor(doc, id, 'toString')).result).toBe(false);
    expect(countUpdates(doc, () => setStickyColor(doc, 'stale', 'green')).updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(getObjectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toEqual([]);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    const { result, updates } = countUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront on z 1 of 3 sets z 4', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const list = snapshot(doc);
    expect(list.at(-1)!.id).toBe(a);
    expect(list.at(-1)!.z).toBe(4);
  });

  it('TC-10 bringToFront on the topmost note emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = countUpdates(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(countUpdates(doc, () => bringToFront(doc, 'stale')).updates).toBe(0);
  });

  it('TC-11 equal z values are ordered by id, stably', () => {
    const doc = newDoc();
    const ids = ['c-note', 'a-note', 'b-note'];
    doc.transact(() => {
      for (const id of ids) {
        const m = new Y.Map<unknown>();
        m.set('type', 'sticky');
        m.set('x', 0);
        m.set('y', 0);
        m.set('color', 'yellow');
        m.set('text', new Y.Text());
        m.set('z', 5);
        m.set('createdAt', 1);
        getObjectsMap(doc).set(id, m);
      }
    });
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a-note', 'b-note', 'c-note']);
    expect(snapshot(doc).map((n) => n.id)).toEqual(first);
    // A tie with the topmost is not "strictly on top": bringToFront raises it.
    expect(bringToFront(doc, 'a-note')).toBe(true);
    expect(snapshot(doc).map((n) => n.id)).toEqual(['b-note', 'c-note', 'a-note']);
  });

  it('TC-12 unknown object types are skipped by snapshot without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      getObjectsMap(doc).set('shape-1', shape);
    });
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);
    // New notes still go on top of unknown objects.
    const next = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).find((n) => n.id === next)!.z).toBe(100);
  });

  it('TC-39 non-finite coordinates are rejected without an update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    for (const bad of [NaN, Infinity, -Infinity]) {
      const move = countUpdates(doc, () => moveObject(doc, id, bad, 0));
      expect(move.result).toBe(false);
      expect(move.updates).toBe(0);
      expect(countUpdates(doc, () => moveObject(doc, id, 0, bad)).updates).toBe(0);
      const create = countUpdates(doc, () => createSticky(doc, { x: bad, y: 0 }));
      expect(create.result).toBeFalsy();
      expect(create.updates).toBe(0);
    }
    expect(only(doc)).toMatchObject({ x: -HALF, y: -HALF });
  });

  it('snapshot is immutable', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const list = snapshot(doc);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
  });
});
