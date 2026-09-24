/**
 * Story 7 · task 6 — group-operation unit tests against a real `Y.Doc`
 * (TC-05 … TC-10). Each successful mutating call must be a single transaction
 * (exactly one `update` event); a rejected call (empty list / non-finite data /
 * stale ids) writes nothing at all.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function tracked(): { doc: Y.Doc; updates: () => number } {
  const doc = new Y.Doc();
  initDoc(doc);
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return { doc, updates: () => count };
}

function getRecord(doc: Y.Doc, id: string): Y.Map<unknown> {
  const record = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!record) throw new Error(`no object ${id}`);
  return record;
}

/** Place a sticky with an explicit size so the geometry is exact. */
function place(doc: Y.Doc, id: string, rect: Rect): void {
  const record = getRecord(doc, id);
  record.set('x', rect.x);
  record.set('y', rect.y);
  record.set('width', rect.width);
  record.set('height', rect.height);
}

describe('moveObjects', () => {
  it('TC-05: moves the surviving objects of a mixed id list in one transaction', () => {
    const { doc, updates } = tracked();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    const c = createSticky(doc, { x: 1000, y: 0 });
    deleteObject(doc, c); // one of the three ids is now stale
    const before = updates();

    const positions = new Map([
      [a, { x: 10, y: 10 }],
      [b, { x: 20, y: 20 }],
      [c, { x: 30, y: 30 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(2); // c is gone, skipped
    expect(updates() - before).toBe(1); // exactly one transaction
    expect(getRecord(doc, a).get('x')).toBe(10);
    expect(getRecord(doc, b).get('x')).toBe(20);
  });

  it('TC-09: non-finite positions and an empty list write nothing (no transaction)', () => {
    const { doc, updates } = tracked();
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = updates();

    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 100 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 100, y: Infinity }]]))).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates()).toBe(before); // no new transactions
  });
});

describe('resizeObjects', () => {
  it('TC-10: the first resize turns an implicit-size sticky explicit (writes both fields)', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(getRecord(doc, id).get('width')).toBeUndefined();
    const before = updates();

    const rects = new Map<string, Rect>([[id, { x: 0, y: 0, width: 300, height: 300 }]]);
    expect(resizeObjects(doc, rects)).toBe(1);
    expect(updates() - before).toBe(1);
    const record = getRecord(doc, id);
    expect(record.get('width')).toBe(300);
    expect(record.get('height')).toBe(300);
  });

  it('skips stale ids and non-finite rects (error path)', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = updates();

    const rects = new Map<string, Rect>([
      ['missing', { x: 0, y: 0, width: 100, height: 100 }],
      [id, { x: 0, y: 0, width: Infinity, height: 100 }],
    ]);
    expect(resizeObjects(doc, rects)).toBe(0);
    expect(updates()).toBe(before);
  });
});

describe('bringObjectsToFront', () => {
  it('TC-06: lifts a whole selection above unselected objects, keeping relative order', () => {
    const { doc, updates } = tracked();
    // Three overlapping (selected) + two others (unselected, higher on top).
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 10, y: 10 });
    const s3 = createSticky(doc, { x: 20, y: 20 });
    const u1 = createSticky(doc, { x: 300, y: 0 });
    const u2 = createSticky(doc, { x: 600, y: 0 });
    const before = updates();

    expect(bringObjectsToFront(doc, [s3, s2, s1])).toBe(3);
    expect(updates() - before).toBe(1);

    const zOf = (id: string) => getRecord(doc, id).get('z') as number;
    const selectedZ = [zOf(s1), zOf(s2), zOf(s3)];
    const unselectedZ = [zOf(u1), zOf(u2)];
    // Every selected note is now above every unselected one…
    expect(Math.min(...selectedZ)).toBeGreaterThan(Math.max(...unselectedZ));
    // …and s1 < s2 < s3 preserved their original stacking order.
    expect(selectedZ).toEqual([...selectedZ].sort((a, b) => a - b));
    expect(zOf(s1)).toBeLessThan(zOf(s2));
    expect(zOf(s2)).toBeLessThan(zOf(s3));
  });

  it('a selection already on top changes nothing (no transaction)', () => {
    const { doc, updates } = tracked();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 0, y: 0 }); // z 2
    const before = updates();
    // Raising both (already the whole board) still has to keep order; a lone
    // top note raises nothing.
    const top = createSticky(doc, { x: 0, y: 0 }); // z 3, alone → nothing above it
    void a;
    void b;
    const before2 = updates();
    expect(bringObjectsToFront(doc, [top])).toBe(0);
    expect(updates()).toBe(before2);
    void before;
  });
});

describe('deleteObjects', () => {
  it('deletes every present id in one transaction and skips stale ids', () => {
    const { doc, updates } = tracked();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    const before = updates();

    expect(deleteObjects(doc, [a, b, 'nope'])).toBe(2);
    expect(updates() - before).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('an empty selection deletes nothing', () => {
    const { doc, updates } = tracked();
    createSticky(doc, { x: 0, y: 0 });
    const before = updates();
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['ghost'])).toBe(0);
    expect(updates()).toBe(before);
  });
});

describe('objectsInRect (snapshot-level marquee)', () => {
  it('TC-07: returns only objects entirely inside the rectangle', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 20, y: 20 }); // fully inside 0..100
    const b = createSticky(doc, { x: 90, y: 10 }); // sticks out past x=100
    const c = createSticky(doc, { x: 400, y: 400 }); // outside
    place(doc, a, { x: 10, y: 10, width: 20, height: 20 });
    place(doc, b, { x: 90, y: 10, width: 40, height: 20 });
    place(doc, c, { x: 400, y: 400, width: 20, height: 20 });

    const inside = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 100, height: 100 });
    expect(inside).toEqual([a]); // only A; B (partly) and C (outside) rejected
    expect(inside).not.toContain(b);
    expect(inside).not.toContain(c);
  });
});

describe('allObjectIds (select-all)', () => {
  it('TC-08: skips a type this client cannot resolve', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const sticky = createSticky(doc, { x: 0, y: 0 });
    // A newer client's object type: forward-compatible, must not be selectable.
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 500);
    shape.set('y', 500);
    shape.set('z', 1);
    shape.set('createdAt', 0);
    doc.getMap<Y.Map<unknown>>('objects').set('shape-1', shape);

    const ids = allObjectIds(snapshot(doc));
    expect(ids).toContain(sticky);
    expect(ids).not.toContain('shape-1');
  });

  it('TC-33 basis: a sticky is snapshotted with its default size when none is stored', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc).find((o) => o.id === id)!;
    const bounds = objectBounds(snap);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
  });
});
