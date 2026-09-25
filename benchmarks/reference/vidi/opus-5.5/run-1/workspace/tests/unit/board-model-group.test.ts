import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
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

const HALF = 2;
const MISSING = 'gone';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const onUpdate = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', onUpdate);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', onUpdate);
  }
}

/** A sticky whose top-left is (x, y). */
function stickyAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / HALF, y: y + STICKY_SIZE_WORLD / HALF });
}

function byId(doc: Y.Doc, id: string): ObjectSnapshot {
  const obj = objectSnapshot(doc).find((o) => o.id === id);
  if (!obj) throw new Error(`no object ${id}`);
  return obj;
}

/** A sticky as saved before story 7: no width/height fields. */
function legacySticky(doc: Y.Doc, id: string, x: number, y: number): void {
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    doc.getMap('objects').set(id, note);
    note.set('type', 'sticky');
    note.set('x', x);
    note.set('y', y);
    note.set('color', 'yellow');
    note.set('text', new Y.Text());
    note.set('z', 1);
    note.set('createdAt', 1);
  });
}

describe('sel.geometry_ops: group operations on a real Y.Doc', () => {
  it('TC-05 moveObjects with one of three ids deleted remotely → returns 2, one update event', () => {
    const doc = newDoc();
    const [a, b, c] = [stickyAt(doc, 0, 0), stickyAt(doc, 300, 0), stickyAt(doc, 600, 0)];
    deleteObjects(doc, [b]);
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
    expect(objectSnapshot(doc).map((o) => o.id)).not.toContain(b);
  });

  it('TC-06 bringObjectsToFront: 3 overlapping selected go above 2 unselected, relative z kept', () => {
    const doc = newDoc();
    const ids = [0, 1, 2, 3, 4].map((i) => stickyAt(doc, i * 50, 0)); // z 1..5
    const selected = [ids[0]!, ids[2]!, ids[3]!];
    const unselected = [ids[1]!, ids[4]!];
    const { result, updates } = countUpdates(doc, () => bringObjectsToFront(doc, selected));
    expect(result).toBe(3);
    expect(updates).toBe(1);
    const z = (id: string) => byId(doc, id).z;
    const topUnselected = Math.max(...unselected.map(z));
    for (const id of selected) expect(z(id)).toBeGreaterThan(topUnselected);
    expect(z(selected[0]!)).toBeLessThan(z(selected[1]!));
    expect(z(selected[1]!)).toBeLessThan(z(selected[2]!));
    // Already on top: no-op, no update.
    expect(countUpdates(doc, () => bringObjectsToFront(doc, selected))).toMatchObject({ result: 0, updates: 0 });
  });

  it('TC-07 objectsInRect: fully inside yes, partly inside and outside no → [A]', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    stickyAt(doc, 300, 0); // B: half inside
    stickyAt(doc, 1000, 0); // C: outside
    const rect = { x: -10, y: -10, width: 410, height: 220 };
    expect(objectsInRect(objectSnapshot(doc), rect)).toEqual([a]);
  });

  it('TC-08 allObjectIds excludes an unknown object type', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      doc.getMap('objects').set('mystery', shape);
      shape.set('type', 'hologram');
      shape.set('x', 0);
      shape.set('y', 0);
    });
    const all = objectSnapshot(doc);
    expect(all.map((o) => o.id).sort()).toEqual([a, 'mystery'].sort());
    expect(allObjectIds(all)).toEqual([a]);
    // With a wider notion of "known" (the client registry), the other type is included.
    expect(allObjectIds(all, () => true).sort()).toEqual([a, 'mystery'].sort());
  });

  it('TC-09 NaN / Infinity values and empty id lists → 0 applied, no transaction', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    const before = byId(doc, a);
    const bad = countUpdates(doc, () => [
      moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]])),
      moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]])),
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }]])),
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]])),
      moveObjects(doc, new Map()),
      resizeObjects(doc, new Map()),
      bringObjectsToFront(doc, []),
      deleteObjects(doc, []),
      deleteObjects(doc, [MISSING]),
    ]);
    expect(bad.result).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(bad.updates).toBe(0);
    expect(byId(doc, a)).toEqual(before);
  });

  it('TC-10 a sticky without width/height is STICKY_SIZE_WORLD square; the first resize writes both', () => {
    const doc = newDoc();
    legacySticky(doc, 'old', 40, 60);
    const before = byId(doc, 'old');
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({ x: 40, y: 60, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    const rect = { x: 40, y: 60, width: 300, height: 300 };
    const { result, updates } = countUpdates(doc, () => resizeObjects(doc, new Map([['old', rect]])));
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(byId(doc, 'old')).toMatchObject(rect);
    const raw = doc.getMap<Y.Map<unknown>>('objects').get('old')!;
    expect(raw.get('width')).toBe(300);
    expect(raw.get('height')).toBe(300);
  });

  it('new stickies are created with explicit width and height', () => {
    const doc = newDoc();
    const id = stickyAt(doc, 0, 0);
    expect(byId(doc, id)).toMatchObject({ width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });

  it('deleteObjects removes several in one transaction and skips missing ids', () => {
    const doc = newDoc();
    const ids = [stickyAt(doc, 0, 0), stickyAt(doc, 300, 0), stickyAt(doc, 600, 0)];
    const { result, updates } = countUpdates(doc, () => deleteObjects(doc, [ids[0]!, ids[2]!, MISSING]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[1]]);
  });

  it('resizeObjects and moveObjects skip unchanged entries (no-op → no update)', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    const rect = objectBounds(byId(doc, a));
    expect(countUpdates(doc, () => resizeObjects(doc, new Map([[a, rect]])))).toMatchObject({ result: 0, updates: 0 });
    expect(countUpdates(doc, () => moveObjects(doc, new Map([[a, { x: 0, y: 0 }]])))).toMatchObject({
      result: 0,
      updates: 0,
    });
  });
});
