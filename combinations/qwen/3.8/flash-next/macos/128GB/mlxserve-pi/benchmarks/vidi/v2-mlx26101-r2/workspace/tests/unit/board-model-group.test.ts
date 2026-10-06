/**
 * sel.geometry_ops group-operation tests (TC-05 to TC-10).
 *
 * The board-model side of story 7: every group mutation runs against a **real**
 * Y.Doc, because the contract these tests guard is exactly "one LOCAL_ORIGIN
 * transaction on success, none on rejection, missing ids skipped" - which is only
 * observable through Yjs' own `update` events.
 */

import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  DOC_OBJECTS_MAP,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  type Point,
  type Rect,
} from '../../src/shared/board-model.js';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.js';

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown>>;

/** Count `update` events (one per transaction), ignoring anything already done. */
function updateCounter(doc: Y.Doc): { value(): number; stop(): void } {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('update', listener);
  return { value: () => count, stop: () => doc.off('update', listener) };
}

/** Put a raw object into the document outside board-model, for TC fixtures. */
function putObject(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) map.set(key, value);
    objectsOf(doc).set(id, map);
  });
}

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
});

describe('moveObjects (TC-05, TC-09)', () => {
  it('moves the objects that are there and skips the one deleted remotely (TC-05)', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 300, y: 0 }) as string;
    const c = createSticky(doc, { x: 600, y: 0 }) as string;

    // One of them goes away the way a remote delete would.
    deleteObjects(doc, [b]);

    const counter = updateCounter(doc);
    const positions = new Map<string, Point>([
      [a, { x: 10, y: 20 }],
      [b, { x: 40, y: 50 }], // already gone
      [c, { x: 70, y: 80 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(2);
    // The whole group lands in a single transaction.
    expect(counter.value()).toBe(1);

    const byId = new Map(snapshot(doc).map((n) => [n.id, n]));
    expect(byId.get(a)).toMatchObject({ x: 10, y: 20 });
    expect(byId.get(c)).toMatchObject({ x: 70, y: 80 });
    expect(byId.has(b)).toBe(false);
  });

  it('rejects a non-finite position entirely: nothing written, no transaction (TC-09)', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 300, y: 0 }) as string;
    const before = snapshot(doc);

    const counter = updateCounter(doc);
    // One bad coordinate in the batch poisons the whole call: a half-applied
    // group move would scatter a selection the user is still holding.
    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 5 }], [b, { x: 5, y: 5 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 5, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    // An empty id list is a no-op too.
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(counter.value()).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });
});

describe('resizeObjects (TC-10)', () => {
  it('makes an implicit-size note explicit and writes both fields on first resize', () => {
    // A note created before story 7: no width/height stored.
    putObject(doc, 'legacy', {
      type: 'sticky',
      x: 0,
      y: 0,
      color: 'yellow',
      text: new Y.Text(),
      z: 1,
      createdAt: 1,
    });

    // objectBounds falls back to the default square.
    const legacy = snapshot(doc).find((n) => n.id === 'legacy')!;
    expect(objectBounds(legacy)).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const counter = updateCounter(doc);
    const applied = resizeObjects(doc, new Map<string, Rect>([['legacy', { x: 0, y: 0, width: 300, height: 240 }]]));
    expect(applied).toBe(1);
    expect(counter.value()).toBe(1);

    const after = snapshot(doc).find((n) => n.id === 'legacy')!;
    expect(after.width).toBe(300);
    expect(after.height).toBe(240);
    expect(objectBounds(after)).toEqual({ x: 0, y: 0, width: 300, height: 240 });
  });

  it('writes nothing for a non-finite or non-positive rect (error path)', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const counter = updateCounter(doc);
    expect(resizeObjects(doc, new Map([['a', { x: 0, y: 0, width: Number.NaN, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 10, height: -1 }]]))).toBe(0);
    expect(counter.value()).toBe(0);
  });
});

describe('bringObjectsToFront (TC-06)', () => {
  it('raises the selection above everything unselected, keeping its own order', () => {
    // Five notes stacked 1..5. Select 1, 3 and 5; 2 and 4 stay unselected.
    const ids = [1, 2, 3, 4, 5].map((n) => {
      const id = createSticky(doc, { x: n * 10, y: 0 }) as string;
      // Force the z the test wants so the ordering is deterministic.
      doc.transact(() => {
        objectsOf(doc).get(id)!.set('z', n);
      });
      return id;
    });
    const selected = [ids[0], ids[2], ids[4]]; // z 1, 3, 5
    const unselected = [ids[1], ids[3]]; // z 2, 4

    const counter = updateCounter(doc);
    const changed = bringObjectsToFront(doc, selected);
    // At least the two lower ones move; the already-top one may not need to.
    expect(changed).toBeGreaterThanOrEqual(2);
    expect(counter.value()).toBe(1);

    const zOf = (id: string): number => snapshot(doc).find((n) => n.id === id)!.z;
    const highestUnselected = Math.max(...unselected.map(zOf));
    for (const id of selected) expect(zOf(id)).toBeGreaterThan(highestUnselected);

    // The selected objects keep their relative order: 1 was below 3 was below 5,
    // and after the restack that ordering survives.
    expect(zOf(ids[0])).toBeLessThan(zOf(ids[2]));
    expect(zOf(ids[2])).toBeLessThan(zOf(ids[4]));
  });

  it('does nothing when the selection is already on top', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string; // z 1
    const b = createSticky(doc, { x: 10, y: 0 }) as string; // z 2 (already top)
    const counter = updateCounter(doc);
    expect(bringObjectsToFront(doc, [b])).toBe(0);
    expect(counter.value()).toBe(0);
    void a;
  });

  it('skips unknown ids and an empty list writes nothing', () => {
    const counter = updateCounter(doc);
    expect(bringObjectsToFront(doc, ['does-not-exist'])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(counter.value()).toBe(0);
  });
});

describe('objectsInRect (TC-07)', () => {
  it('returns only the object lying fully inside the rectangle', () => {
    // A fully inside, B half in, C outside. Positions are the note top-lefts, and
    // every note is STICKY_SIZE_WORLD square (created before any resize).
    putObject(doc, 'A', { type: 'sticky', x: 10, y: 10, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD, color: 'yellow', text: new Y.Text(), z: 1, createdAt: 1 });
    // B pokes past the right edge of the box (x + size > box right).
    putObject(doc, 'B', { type: 'sticky', x: 390, y: 10, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD, color: 'yellow', text: new Y.Text(), z: 2, createdAt: 2 });
    // C is entirely outside.
    putObject(doc, 'C', { type: 'sticky', x: 1000, y: 1000, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD, color: 'yellow', text: new Y.Text(), z: 3, createdAt: 3 });

    // A box that fully holds A (10..210) but only half of B (390..590) and none of C.
    const box: Rect = { x: 0, y: 0, width: 300, height: 300 };
    expect(objectsInRect(snapshot(doc), box)).toEqual(['A']);
  });

  it('selects an object that exactly touches the box border', () => {
    putObject(doc, 'A', { type: 'sticky', x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD, color: 'yellow', text: new Y.Text(), z: 1, createdAt: 1 });
    // Box right/bottom edges exactly meet the note's edges.
    const box: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    expect(objectsInRect(snapshot(doc), box)).toEqual(['A']);
  });
});

describe('allObjectIds (TC-08)', () => {
  it('skips an object of an unknown type', () => {
    const sticky = createSticky(doc, { x: 0, y: 0 }) as string;
    // An object this build cannot draw or move: never selected by Select all.
    putObject(doc, 'shape-1', { type: 'shape', x: 5, y: 5, width: 10, height: 10, z: 9, createdAt: 9 });

    const ids = allObjectIds(snapshot(doc));
    expect(ids).toContain(sticky);
    expect(ids).not.toContain('shape-1');
  });
});

describe('group operations ignore a deleted target (regression)', () => {
  it('deleteObjects removes what exists, skips what does not, in one transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 0, y: 0 }) as string;
    const counter = updateCounter(doc);
    expect(deleteObjects(doc, [a, 'ghost', b])).toBe(2);
    expect(counter.value()).toBe(1);
    expect(deleteObjects(doc, ['ghost'])).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(counter.value()).toBe(1); // still one: the rejections wrote nothing
  });
});
