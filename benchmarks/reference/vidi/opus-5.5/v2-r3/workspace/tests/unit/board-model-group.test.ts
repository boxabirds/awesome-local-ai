import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  getObjectsMap,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

const HALF = STICKY_SIZE_WORLD / 2;

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Creates a sticky whose top-left is (x, y). */
function noteAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x: x + HALF, y: y + HALF });
}

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

function byId(doc: Y.Doc, id: string): ObjectSnapshot {
  const found = snapshot(doc).find((o) => o.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe('board-model group operations (sel.geometry_ops)', () => {
  it('TC-05 moveObjects with one of three ids deleted remotely → 2 applied in one update', () => {
    const doc = newDoc();
    const [a, b, c] = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    deleteObject(doc, b);
    const positions = new Map([
      [a, { x: 10, y: 20 }],
      [b, { x: 310, y: 20 }],
      [c, { x: 610, y: 20 }],
    ]);
    const { result, updates, origins } = countUpdates(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);
    expect(byId(doc, a)).toMatchObject({ x: 10, y: 20 });
    expect(byId(doc, c)).toMatchObject({ x: 610, y: 20 });
    expect(getObjectsMap(doc).has(b)).toBe(false); // not re-created
  });

  it('moveObjects to the current positions is a no-op', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    const { result, updates } = countUpdates(doc, () => moveObjects(doc, new Map([[a, { x: 0, y: 0 }]])));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  it('TC-06 bringObjectsToFront: 3 overlapping selected above 2 unselected, relative order kept', () => {
    const doc = newDoc();
    const s1 = noteAt(doc, 0, 0); // z1
    const u1 = noteAt(doc, 50, 0); // z2
    const s2 = noteAt(doc, 100, 0); // z3
    const u2 = noteAt(doc, 150, 0); // z4
    const s3 = noteAt(doc, 200, 0); // z5
    const { result, updates } = countUpdates(doc, () => bringObjectsToFront(doc, [s3, s1, s2]));
    expect(result).toBeGreaterThan(0);
    expect(updates).toBe(1);
    const order = snapshot(doc).map((o) => o.id);
    expect(order).toEqual([u1, u2, s1, s2, s3]);
    const maxUnselected = Math.max(byId(doc, u1).z, byId(doc, u2).z);
    for (const id of [s1, s2, s3]) expect(byId(doc, id).z).toBeGreaterThan(maxUnselected);
    // Already on top → no-op.
    expect(countUpdates(doc, () => bringObjectsToFront(doc, [s1, s2, s3])).updates).toBe(0);
  });

  it('TC-07 objectsInRect: A fully inside, B half inside, C outside → [A]', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    noteAt(doc, 300, 0); // B: 300..500, rect ends at 400
    noteAt(doc, 1000, 1000);
    const rect = { x: -10, y: -10, width: 410, height: 300 };
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    // Exactly matching edges counts as inside.
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 200, height: 200 })).toEqual([a]);
  });

  it('TC-08 allObjectIds excludes an unknown object type', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    const list = snapshot(doc);
    const alien = { ...list[0], id: 'alien', type: 'hologram' } as unknown as ObjectSnapshot;
    expect(allObjectIds([...list, alien])).toEqual([a]);
    expect(objectsInRect([alien], { x: -1e6, y: -1e6, width: 2e6, height: 2e6 })).toEqual([]);
    // Unknown types in the doc never reach the snapshot either.
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'hologram');
      m.set('x', 0);
      m.set('y', 0);
      getObjectsMap(doc).set('alien', m);
    });
    expect(allObjectIds(snapshot(doc))).toEqual([a]);
  });

  it('TC-09 NaN / Infinity values and empty lists → 0, no transaction', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    const calls = [
      () => moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]])),
      () => moveObjects(doc, new Map([[a, { x: 5, y: 5 }], [b, { x: Infinity, y: 0 }]])),
      () => moveObjects(doc, new Map()),
      () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: Infinity, height: 10 }]])),
      () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]])),
      () => resizeObjects(doc, new Map()),
      () => bringObjectsToFront(doc, []),
      () => deleteObjects(doc, []),
      () => deleteObjects(doc, ['missing']),
    ];
    for (const call of calls) {
      const { result, updates } = countUpdates(doc, call);
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    expect(byId(doc, a)).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-10 legacy sticky without width/height: bounds use STICKY_SIZE_WORLD; first resize writes both', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    const map = getObjectsMap(doc).get(a)!;
    map.delete('width');
    map.delete('height');
    expect(map.has('width')).toBe(false);
    expect(objectBounds(byId(doc, a))).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    const { result, updates } = countUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, { x: -10, y: -10, width: 300, height: 300 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(map.get('width')).toBe(300);
    expect(map.get('height')).toBe(300);
    expect(objectBounds(byId(doc, a))).toEqual({ x: -10, y: -10, width: 300, height: 300 });
  });

  it('new stickies store their size explicitly', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    expect(getObjectsMap(doc).get(a)!.get('width')).toBe(STICKY_SIZE_WORLD);
    expect(getObjectsMap(doc).get(a)!.get('height')).toBe(STICKY_SIZE_WORLD);
  });

  it('deleteObjects removes present ids in one transaction and skips missing ones', () => {
    const doc = newDoc();
    const [a, b, c] = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    const { result, updates } = countUpdates(doc, () => deleteObjects(doc, [a, 'nope', c, a]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((o) => o.id)).toEqual([b]);
  });
});
