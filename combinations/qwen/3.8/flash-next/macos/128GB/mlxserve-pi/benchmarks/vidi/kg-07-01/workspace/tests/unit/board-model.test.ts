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

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts `update` events emitted by the doc while `fn` runs. */
function updatesDuring<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  let updates = 0;
  const origins: unknown[] = [];
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    updates++;
    origins.push(origin);
  };
  doc.on('update', onUpdate);
  try {
    return { result: fn(), updates, origins };
  } finally {
    doc.off('update', onUpdate);
  }
}

function objects(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function byId(doc: Y.Doc, id: string) {
  const s = snapshot(doc).find((n) => n.id === id);
  if (!s) throw new Error(`note ${id} not in snapshot`);
  return s;
}

describe('board model (board.model)', () => {
  it('TC-01 createSticky on an empty doc adds one yellow, empty sticky at z 1 centred on the point', () => {
    const doc = newDoc();
    expect(objects(doc).size).toBe(0);
    const { result: id, updates, origins } = updatesDuring(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(objects(doc).size).toBe(1);
    const n = byId(doc, id);
    expect(n).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
    });
    expect(n.createdAt).toBeGreaterThan(0);
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });

  it('createSticky honours an explicit valid colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 50 }, 'blue');
    expect(byId(doc, id)).toMatchObject({ color: 'blue', x: 100 - STICKY_SIZE_WORLD / 2, y: 50 - STICKY_SIZE_WORLD / 2 });
  });

  it('TC-02 createSticky with existing z 1 and 2 gets z 3', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    const id = createSticky(doc, { x: 20, y: 20 });
    expect(byId(doc, id).z).toBe(3);
  });

  it('TC-03 moveObject updates x,y and leaves other fields unchanged', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    getStickyText(doc, id)!.insert(0, 'Faster onboarding');
    const before = byId(doc, id);
    expect(before).toMatchObject({ x: 0, y: 0 });
    const { result, updates } = updatesDuring(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(byId(doc, id)).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = updatesDuring(doc, () => moveObject(doc, 'missing', 1, 2));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('moveObject rejects non-finite coordinates and no-op moves without an update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = byId(doc, id);
    const { updates } = updatesDuring(doc, () => {
      expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
      expect(moveObject(doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
      expect(moveObject(doc, id, before.x, before.y)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(byId(doc, id)).toEqual(before);
  });

  it('createSticky rejects non-finite coordinates without an update', () => {
    const doc = newDoc();
    const { result, updates } = updatesDuring(doc, () => createSticky(doc, { x: Number.NaN, y: 0 }));
    expect(result).toBe('');
    expect(updates).toBe(0);
    expect(objects(doc).size).toBe(0);
  });

  it('TC-05 setStickyColor changes yellow to green', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = updatesDuring(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(byId(doc, id).color).toBe('green');
  });

  it('TC-06 setStickyColor with an unknown colour returns false, keeps yellow and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { updates } = updatesDuring(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
      expect(setStickyColor(doc, id, 'toString')).toBe(false);
      expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
      expect(setStickyColor(doc, id, 'yellow')).toBe(false); // already yellow: no-op
    });
    expect(updates).toBe(0);
    expect(byId(doc, id).color).toBe('yellow');
  });

  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = updatesDuring(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(objects(doc).size).toBe(0);
    expect(snapshot(doc)).toEqual([]);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    const { result, updates } = updatesDuring(doc, () => deleteObject(doc, id));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront on the bottom of three notes gives it z 4', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(byId(doc, a).z).toBe(1);
    const { result, updates } = updatesDuring(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(byId(doc, a).z).toBe(4);
    expect(snapshot(doc).at(-1)!.id).toBe(a);
  });

  it('TC-10 bringToFront on the topmost note leaves z unchanged and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = updatesDuring(doc, () => {
      const r = bringToFront(doc, top);
      expect(bringToFront(doc, 'missing')).toBe(false);
      return r;
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(byId(doc, top).z).toBe(2);
  });

  it('bringToFront lifts a note that only ties the highest z', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    objects(doc).get(a)!.set('z', 2);
    expect(bringToFront(doc, a)).toBe(true);
    expect(byId(doc, a).z).toBe(3);
    expect(byId(doc, b).z).toBe(2);
  });

  it('TC-11 notes with equal z are ordered by id, stable across calls', () => {
    const doc = newDoc();
    const ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 0, y: 0 })];
    doc.transact(() => ids.forEach((id) => objects(doc).get(id)!.set('z', 5)));
    const expected = [...ids].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    expect(snapshot(doc).map((n) => n.id)).toEqual(expected);
    expect(snapshot(doc).map((n) => n.id)).toEqual(expected);
    // z still dominates the id tie-break.
    objects(doc).get(expected[0])!.set('z', 6);
    expect(snapshot(doc).map((n) => n.id)).toEqual([expected[1], expected[2], expected[0]]);
  });

  it('TC-12 snapshot skips unknown object types without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 9);
      objects(doc).set('shape-1', shape);
    });
    let result: ReturnType<typeof snapshot> = [];
    expect(() => (result = snapshot(doc))).not.toThrow();
    expect(result.map((n) => n.id)).toEqual([id]);
  });

  it('snapshot is immutable', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const s = snapshot(doc);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s[0])).toBe(true);
  });

  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const first = updatesDuring(doc, () => initDoc(doc));
    expect(first.updates).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    const second = updatesDuring(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});
