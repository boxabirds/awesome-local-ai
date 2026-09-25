import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectSnapshot,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A note whose top-left is at (x, y). */
function noteAt(doc: Y.Doc, x: number, y: number) {
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
}

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

function byId(doc: Y.Doc, id: string) {
  const o = objectSnapshot(doc).find((n) => n.id === id);
  if (!o) throw new Error(`object ${id} missing`);
  return o;
}

describe('group operations (sel.geometry_ops)', () => {
  it('TC-05 moveObjects with one of three ids deleted remotely moves the other two in one update', () => {
    const doc = newDoc();
    const [a, b, c] = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    deleteObject(doc, b);
    const positions = new Map([
      [a, { x: 10, y: 20 }],
      [b, { x: 310, y: 20 }],
      [c, { x: 610, y: 20 }],
    ]);
    const { result, updates, origins } = updatesDuring(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(byId(doc, a)).toMatchObject({ x: 10, y: 20 });
    expect(byId(doc, c)).toMatchObject({ x: 610, y: 20 });
    expect(doc.getMap('objects').has(b)).toBe(false);
  });

  it('TC-06 bringObjectsToFront lifts 3 overlapping selected notes above the unselected ones, keeping their order', () => {
    const doc = newDoc();
    const ids = [0, 1, 2, 3, 4].map((i) => noteAt(doc, i * 50, 0)); // z 1..5
    const selected = [ids[0], ids[2], ids[3]];
    const { result, updates } = updatesDuring(doc, () => bringObjectsToFront(doc, selected));
    expect(result).toBe(3);
    expect(updates).toBe(1);
    const order = snapshot(doc).map((n) => n.id);
    expect(order).toEqual([ids[1], ids[4], ids[0], ids[2], ids[3]]);
    const maxUnselected = Math.max(byId(doc, ids[1]).z, byId(doc, ids[4]).z);
    for (const id of selected) expect(byId(doc, id).z).toBeGreaterThan(maxUnselected);
    // Already on top: no-op, no update.
    expect(updatesDuring(doc, () => bringObjectsToFront(doc, selected))).toMatchObject({ result: 0, updates: 0 });
  });

  it('TC-07 objectsInRect selects only objects fully inside (A), not partly inside (B) or outside (C)', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    noteAt(doc, 300, 0); // B: half inside
    noteAt(doc, 1000, 1000); // C: outside
    const rect = { x: -10, y: -10, width: 410, height: 220 };
    expect(objectsInRect(objectSnapshot(doc), rect)).toEqual([a]);
    // Touching edges exactly still counts as inside.
    expect(objectsInRect(objectSnapshot(doc), { x: 0, y: 0, width: 200, height: 200 })).toEqual([a]);
  });

  it('TC-08 allObjectIds skips an object of an unknown type', () => {
    const known: ObjectSnapshot = { id: 'a', type: 'sticky', x: 0, y: 0, width: 200, height: 200, z: 1 };
    const unknown: ObjectSnapshot = { id: 'u', type: 'hologram', x: 0, y: 0, width: 10, height: 10, z: 2 };
    expect(allObjectIds([known, unknown])).toEqual(['a']);
    expect(objectsInRect([known, unknown], { x: -100, y: -100, width: 1000, height: 1000 })).toEqual(['a']);
    expect(allObjectIds([])).toEqual([]);
  });

  it.each([
    ['NaN', { x: NaN, y: 0 }],
    ['Infinity', { x: 0, y: Infinity }],
  ])('TC-09 moveObjects with a %s position applies 0 and emits no update', (_label, p) => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    const before = objectSnapshot(doc);
    const positions = new Map([
      [a, { x: 5, y: 5 }],
      [b, p],
    ]);
    expect(updatesDuring(doc, () => moveObjects(doc, positions))).toMatchObject({ result: 0, updates: 0 });
    expect(objectSnapshot(doc)).toEqual(before);
  });

  it('TC-09 invalid rects and empty id lists apply 0 with no update', () => {
    const doc = newDoc();
    const a = noteAt(doc, 0, 0);
    const calls = [
      () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 10 }]])),
      () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]])),
      () => moveObjects(doc, new Map()),
      () => resizeObjects(doc, new Map()),
      () => bringObjectsToFront(doc, []),
      () => deleteObjects(doc, []),
      () => deleteObjects(doc, ['missing']),
      () => moveObjects(doc, new Map([[a, { x: 0, y: 0 }]])), // already there
    ];
    for (const call of calls) expect(updatesDuring(doc, call)).toMatchObject({ result: 0, updates: 0 });
  });

  it('TC-10 a note without width/height reads as STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const doc = newDoc();
    const id = noteAt(doc, 0, 0);
    const map = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    doc.transact(() => {
      map.delete('width');
      map.delete('height');
    });
    expect(map.has('width')).toBe(false);
    expect(objectBounds(byId(doc, id))).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    const { result, updates } = updatesDuring(doc, () =>
      resizeObjects(doc, new Map([[id, { x: -10, y: -10, width: 300, height: 300 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(map.get('width')).toBe(300);
    expect(map.get('height')).toBe(300);
    expect(objectBounds(byId(doc, id))).toEqual({ x: -10, y: -10, width: 300, height: 300 });
  });

  it('createSticky writes an explicit size', () => {
    const doc = newDoc();
    const id = noteAt(doc, 0, 0);
    const map = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect([map.get('width'), map.get('height')]).toEqual([STICKY_SIZE_WORLD, STICKY_SIZE_WORLD]);
  });

  it('deleteObjects removes every present id in one update', () => {
    const doc = newDoc();
    const ids = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    const { result, updates } = updatesDuring(doc, () => deleteObjects(doc, [ids[0], ids[2], 'gone']));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(objectSnapshot(doc).map((o) => o.id)).toEqual([ids[1]]);
  });
});
