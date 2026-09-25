import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  snapshotObjects,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

const HALF = STICKY_SIZE_WORLD / 2;

function countUpdates(doc: Y.Doc): { count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** A note whose top-left is at (x, y). */
function noteAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x: x + HALF, y: y + HALF });
}

function z(doc: Y.Doc, id: string): number {
  return objectsMap(doc).get(id)?.get('z') as number;
}

let doc: Y.Doc;
beforeEach(() => {
  doc = new Y.Doc();
});

describe('sel.geometry_ops: group operations on a real Y.Doc', () => {
  it('TC-05 moveObjects with one of three ids deleted remotely → returns 2 in one update', () => {
    const [a, b, c] = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    objectsMap(doc).delete(b!);
    const updates = countUpdates(doc);
    const moved = moveObjects(
      doc,
      new Map([
        [a!, { x: 10, y: 20 }],
        [b!, { x: 310, y: 20 }],
        [c!, { x: 610, y: 20 }],
      ]),
    );
    expect(moved).toBe(2);
    expect(updates.count).toBe(1);
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
    expect(snapshot(doc).map((n) => [n.x, n.y])).toEqual([
      [10, 20],
      [610, 20],
    ]);
    expect(objectsMap(doc).has(b!)).toBe(false); // not re-created
  });

  it('TC-06 bringObjectsToFront: 3 overlapping selected above 2 unselected, relative order kept', () => {
    const ids = [0, 1, 2, 3, 4].map((i) => noteAt(doc, i * 20, 0)); // z 1..5
    const selected = [ids[0]!, ids[2]!, ids[3]!];
    const unselected = [ids[1]!, ids[4]!];
    const updates = countUpdates(doc);
    expect(bringObjectsToFront(doc, selected)).toBeGreaterThan(0);
    expect(updates.count).toBe(1);
    const minSelected = Math.min(...selected.map((id) => z(doc, id)));
    const maxUnselected = Math.max(...unselected.map((id) => z(doc, id)));
    expect(minSelected).toBeGreaterThan(maxUnselected);
    expect(z(doc, ids[0]!)).toBeLessThan(z(doc, ids[2]!));
    expect(z(doc, ids[2]!)).toBeLessThan(z(doc, ids[3]!));
    // Already on top: no update.
    expect(bringObjectsToFront(doc, selected)).toBe(0);
    expect(updates.count).toBe(1);
  });

  it('TC-07 objectsInRect: A fully inside, B partly inside, C outside → [A]', () => {
    const a = noteAt(doc, 100, 100);
    noteAt(doc, 450, 100); // B: half inside
    noteAt(doc, 2000, 2000); // C
    const rect = { x: 50, y: 50, width: 500, height: 300 };
    expect(objectsInRect(snapshotObjects(doc), rect)).toEqual([a]);
  });

  it('TC-08 allObjectIds skips an unknown object type', () => {
    const a = noteAt(doc, 0, 0);
    const shape = new Y.Map<unknown>();
    objectsMap(doc).set('future-shape', shape);
    shape.set('type', 'future-shape-type');
    shape.set('x', 0);
    shape.set('y', 0);
    const all = snapshotObjects(doc);
    expect(all.map((o) => o.id)).toContain('future-shape');
    expect(allObjectIds(all)).toEqual([a]);
    expect(objectsInRect(all, { x: -1000, y: -1000, width: 5000, height: 5000 })).toEqual([a]);
  });

  it('TC-09 NaN / Infinity values and empty id lists → 0, no transaction', () => {
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    const updates = countUpdates(doc);
    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    // One bad value rejects the whole call, including valid entries.
    expect(
      moveObjects(
        doc,
        new Map([
          [a, { x: 5, y: 5 }],
          [b, { x: Number.POSITIVE_INFINITY, y: 0 }],
        ]),
      ),
    ).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: Number.NaN, height: 100 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: -5, height: 100 }]]))).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['missing'])).toBe(0);
    expect(updates.count).toBe(0);
    expect(snapshot(doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-10 a note without width/height reads STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const legacy = new Y.Map<unknown>();
    objectsMap(doc).set('old', legacy);
    legacy.set('type', 'sticky');
    legacy.set('x', 10);
    legacy.set('y', 20);
    legacy.set('color', 'yellow');
    legacy.set('text', new Y.Text());
    legacy.set('z', 1);
    const [note] = snapshotObjects(doc);
    expect(objectBounds(note!)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(legacy.has('width')).toBe(false);
    const updates = countUpdates(doc);
    expect(resizeObjects(doc, new Map([['old', { x: 10, y: 20, width: 300, height: 300 }]]))).toBe(1);
    expect(updates.count).toBe(1);
    expect(legacy.get('width')).toBe(300);
    expect(legacy.get('height')).toBe(300);
    expect(snapshot(doc)[0]).toMatchObject({ width: 300, height: 300 });
  });

  it('deleteObjects removes every present id in one update and skips missing ones', () => {
    const [a, b, c] = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a!, c!, 'missing'])).toBe(2);
    expect(updates.count).toBe(1);
    expect(snapshot(doc).map((n) => n.id)).toEqual([b]);
  });

  it('new notes are created with explicit width and height', () => {
    const a = noteAt(doc, 0, 0);
    expect(objectsMap(doc).get(a)?.get('width')).toBe(STICKY_SIZE_WORLD);
    expect(objectsMap(doc).get(a)?.get('height')).toBe(STICKY_SIZE_WORLD);
  });
});
