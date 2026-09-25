import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7 group-operation unit tests (task 6, TC-05 to TC-10) against a
 * real Y.Doc: single-transaction semantics, stale-id/error paths and the
 * width/height additive behaviour.
 */

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts `update` events from now on (1 per successful mutation, 0 for rejections). */
function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

describe('moveObjects (TC-05, TC-09)', () => {
  it('TC-05 three ids with one deleted → returns 2; exactly 1 update event (missing id skipped)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const c = createSticky(doc, { x: 20, y: 20 });
    deleteObjects(doc, [c]);

    const updates = countUpdates(doc);
    const moved = moveObjects(doc, new Map([[a, { x: 1, y: 2 }], [b, { x: 3, y: 4 }], [c, { x: 5, y: 6 }]]));
    expect(moved).toBe(2);
    expect(updates()).toBe(1); // one transaction for all live moves
    const notes = Object.fromEntries(snapshot(doc).map((n) => [n.id, n]));
    expect({ x: notes[a]!.x, y: notes[a]!.y }).toEqual({ x: 1, y: 2 });
    expect({ x: notes[b]!.x, y: notes[b]!.y }).toEqual({ x: 3, y: 4 });
    expect(notes[c]).toBeUndefined(); // the deleted id is skipped, never re-created
  });

  it('TC-09 NaN / Infinity positions and empty id list → 0, no transaction (error path)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 1 });

    let updates = countUpdates(doc);
    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(updates()).toBe(0);

    updates = countUpdates(doc);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(updates()).toBe(0);

    updates = countUpdates(doc);
    expect(moveObjects(doc, new Map<string, { x: number; y: number }>())).toBe(0);
    expect(updates()).toBe(0);

    // A mix of valid and invalid entries moves only the valid ones.
    updates = countUpdates(doc);
    expect(moveObjects(doc, new Map([[a, { x: 5, y: 5 }], [b, { x: Number.NaN, y: 0 }]]))).toBe(1);
    expect(updates()).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)!.x).toBe(5);
  });
});

describe('resizeObjects (TC-10)', () => {
  it('TC-10 a sticky without width/height: objectBounds uses STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const before = snapshot(doc).find((n) => n.id === id)!;
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({ x: -100, y: -100, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const updates = countUpdates(doc);
    const changed = resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 300, height: 150 }]]));
    expect(changed).toBe(1);
    expect(updates()).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.width).toBe(300);
    expect(after.height).toBe(150);
    expect(objectBounds(after)).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });

  it('non-finite or invalid rects are skipped (0, no transaction)', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: Number.NaN, height: 100 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: -5, height: 100 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 100, height: 0 }]]))).toBe(0);
    expect(updates()).toBe(0);
  });
});

describe('bringObjectsToFront (TC-06)', () => {
  it('TC-06 three overlapping selected over two unselected → all selected z above unselected, relative order kept', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 0, y: 0 }); // z 2
    const c = createSticky(doc, { x: 0, y: 0 }); // z 3
    const d = createSticky(doc, { x: 0, y: 0 }); // z 4
    const e = createSticky(doc, { x: 0, y: 0 }); // z 5

    const updates = countUpdates(doc);
    // Selection order [b, a, e]: b ends below a, a below e (given order).
    const raised = bringObjectsToFront(doc, [b, a, e]);
    expect(raised).toBe(3);
    expect(updates()).toBe(1);

    const z = Object.fromEntries(snapshot(doc).map((n) => [n.id, n.z]));
    // Every selected object sits above every unselected one …
    expect(Math.min(z[b]!, z[a]!, z[e]!)).toBeGreaterThan(Math.max(z[c]!, z[d]!));
    // … and the relative order among the selected ones is the call order.
    expect(z[b]!).toBeLessThan(z[a]!);
    expect(z[a]!).toBeLessThan(z[e]!);
    // Unselected objects are untouched.
    expect(z[c]!).toBe(3);
    expect(z[d]!).toBe(4);
  });

  it('stale ids are skipped; an all-stale list is a no-op', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(bringObjectsToFront(doc, [a, 'missing'])).toBe(1);
    expect(updates()).toBe(1);
    expect(bringObjectsToFront(doc, ['missing', 'gone'])).toBe(0);
    expect(updates()).toBe(1); // no second transaction
    expect(bringObjectsToFront(doc, [])).toBe(0);
  });
});

describe('objectsInRect (TC-07)', () => {
  it('TC-07 A fully inside, B partly, C outside → [A] (negative for B)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 150, y: 150 }); // 50..250
    const b = createSticky(doc, { x: 350, y: 150 }); // 250..450: half inside 0..300
    const c = createSticky(doc, { x: 600, y: 600 }); // far outside
    const ids = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 300, height: 300 });
    expect(ids).toEqual([a]);
  });

  it('edge-touching counts as inside (the marquee boundary)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 100, y: 100 }); // exactly 0..200
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 200, height: 200 })).toEqual([a]);
  });
});

describe('allObjectIds (TC-08)', () => {
  it('TC-08 skips an unknown type', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const shape = new Y.Map();
    shape.set('type', 'shape');
    shape.set('x', 5);
    shape.set('y', 5);
    doc.getMap('objects').set('shape-1', shape);

    const ids = allObjectIds(snapshot(doc));
    expect(ids.sort()).toEqual([a, b].sort());
  });

  it('empty snapshot → empty list (Ctrl+A boundary)', () => {
    expect(allObjectIds([])).toEqual([]);
  });
});

describe('deleteObjects', () => {
  it('deletes several in one transaction; stale ids skipped; empty → no transaction', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 1 });
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a, b, 'missing'])).toBe(2);
    expect(updates()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(deleteObjects(doc, [a])).toBe(0); // all stale now
    expect(updates()).toBe(1);
    expect(deleteObjects(doc, [])).toBe(0);
  });
});
