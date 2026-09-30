import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  type ObjectSnapshot,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  objectsMap,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function create(doc: Y.Doc, at = { x: 0, y: 0 }): string {
  const id = createSticky(doc, at);
  if (id === false) throw new Error('create rejected');
  return id;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const listener = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', listener);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', listener);
  }
}

function byId(doc: Y.Doc) {
  return new Map(snapshot(doc).map((n) => [n.id, n]));
}

function obj(id: string, type: string, x: number, y: number, size = 200): ObjectSnapshot {
  return { id, type, x, y, width: size, height: size, z: 1, createdAt: 0 };
}

describe('sel.geometry_ops board-model group operations', () => {
  it('TC-05 moveObjects skips a remotely deleted id: returns 2 in one update', () => {
    const doc = newDoc();
    const [a, b, c] = [create(doc), create(doc, { x: 300, y: 0 }), create(doc, { x: 600, y: 0 })];
    objectsMap(doc).delete(b);
    const { result, updates, origins } = countUpdates(doc, () =>
      moveObjects(
        doc,
        new Map([
          [a, { x: 10, y: 20 }],
          [b, { x: 30, y: 40 }],
          [c, { x: 50, y: 60 }],
        ]),
      ),
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(byId(doc).get(a)).toMatchObject({ x: 10, y: 20 });
    expect(byId(doc).get(c)).toMatchObject({ x: 50, y: 60 });
    expect(byId(doc).has(b)).toBe(false);
  });

  it('TC-06 bringObjectsToFront lifts 3 overlapping notes above the others, keeping their order', () => {
    const doc = newDoc();
    const ids = Array.from({ length: 5 }, () => create(doc));
    // z: 1..5. Select 1st, 3rd and 4th (below the 5th).
    const selected = [ids[3]!, ids[0]!, ids[2]!];
    const { result, updates } = countUpdates(doc, () => bringObjectsToFront(doc, selected));
    expect(result).toBe(3);
    expect(updates).toBe(1);
    const notes = byId(doc);
    const unselectedMax = Math.max(notes.get(ids[1]!)!.z, notes.get(ids[4]!)!.z);
    const z = selected.map((id) => notes.get(id)!.z);
    expect(Math.min(...z)).toBeGreaterThan(unselectedMax);
    expect(notes.get(ids[0]!)!.z).toBeLessThan(notes.get(ids[2]!)!.z);
    expect(notes.get(ids[2]!)!.z).toBeLessThan(notes.get(ids[3]!)!.z);
    // Already on top: nothing to do.
    expect(countUpdates(doc, () => bringObjectsToFront(doc, selected))).toMatchObject({ result: 0, updates: 0 });
  });

  it('TC-07 objectsInRect selects only the fully-inside note', () => {
    const objects = [obj('A', 'sticky', 0, 0), obj('B', 'sticky', 250, 0), obj('C', 'sticky', 1000, 0)];
    const rect = { x: -10, y: -10, width: 360, height: 300 }; // B is half inside.
    expect(objectsInRect(objects, rect)).toEqual(['A']);
    // Touching the outside edge is not inside.
    expect(objectsInRect([obj('D', 'sticky', 350, 0)], rect)).toEqual([]);
  });

  it('TC-08 allObjectIds skips unknown types', () => {
    const objects = [obj('a', 'sticky', 0, 0), obj('m', 'mystery-type', 0, 0), obj('b', 'sticky', 5, 5)];
    expect(allObjectIds(objects)).toEqual(['a', 'b']);
    expect(objectsInRect(objects, { x: -1000, y: -1000, width: 5000, height: 5000 })).toEqual(['a', 'b']);
  });

  it('TC-09 non-finite values and empty id lists write nothing', () => {
    const doc = newDoc();
    const a = create(doc);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(countUpdates(doc, () => moveObjects(doc, new Map([[a, { x: bad, y: 0 }]])))).toMatchObject({ result: 0, updates: 0 });
      expect(
        countUpdates(doc, () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: bad, height: 100 }]]))),
      ).toMatchObject({ result: 0, updates: 0 });
    }
    expect(countUpdates(doc, () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 100 }]])))).toMatchObject({
      result: 0,
      updates: 0,
    });
    for (const call of [
      () => moveObjects(doc, new Map()),
      () => resizeObjects(doc, new Map()),
      () => bringObjectsToFront(doc, []),
      () => deleteObjects(doc, []),
    ]) {
      expect(countUpdates(doc, call)).toMatchObject({ result: 0, updates: 0 });
    }
    expect(byId(doc).get(a)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
  });

  it('TC-10 a sticky without width/height reads STICKY_SIZE_WORLD; the first resize writes both', () => {
    const doc = newDoc();
    const a = create(doc);
    const raw = objectsMap(doc).get(a)!;
    expect(raw.has('width')).toBe(false);
    expect(objectBounds(byId(doc).get(a)!)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    const { result, updates } = countUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 300, height: 300 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(raw.get('width')).toBe(300);
    expect(raw.get('height')).toBe(300);
    expect(byId(doc).get(a)).toMatchObject({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('deleteObjects removes present ids in one transaction and skips missing ones', () => {
    const doc = newDoc();
    const [a, b] = [create(doc), create(doc)];
    const { result, updates } = countUpdates(doc, () => deleteObjects(doc, [a, 'missing', b]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
