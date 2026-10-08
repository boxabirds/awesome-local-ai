/**
 * Story 7, sel.geometry_ops group operations (unit TC-05 to TC-10) against a
 * REAL Y.Doc. Each mutating call must open exactly one LOCAL_ORIGIN
 * transaction (one `update` event) on success and none on rejection, and
 * return the number of objects changed.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_ORIGIN,
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
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): { count: () => number; dispose: () => void } {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  return { count: () => updates, dispose: () => doc.off('update', handler) };
}

function objectsOf(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects') as Y.Map<any>;
}

function notes(doc: Y.Doc): readonly ObjectSnapshot[] {
  return snapshot(doc);
}

function byId(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return notes(doc).find((n) => n.id === id);
}

/** Creates n stickies at given points; returns their ids in order. */
function createMany(doc: Y.Doc, at: { x: number; y: number }[]): string[] {
  return at.map((p) => createSticky(doc, p));
}

describe('board-model group: moveObjects (TC-05, TC-09)', () => {
  it('TC-05: 3 ids with 1 deleted remotely → returns 2, exactly 1 update event', () => {
    const doc = freshDoc();
    const [a, b, c] = createMany(doc, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ]);
    // A third party deletes b while I am about to move a, b, c.
    objectsOf(doc).delete(b);

    const updates = countUpdates(doc);
    const applied = moveObjects(
      doc,
      new Map([
        [a, { x: 10, y: 20 }],
        [b, { x: 110, y: 20 }],
        [c, { x: 210, y: 20 }],
      ]),
    );
    expect(applied).toBe(2);
    expect(updates.count()).toBe(1);
    expect(byId(doc, a)).toMatchObject({ x: 10, y: 20 });
    expect(byId(doc, c)).toMatchObject({ x: 210, y: 20 });
    expect(byId(doc, b)).toBeUndefined();
    updates.dispose();
  });

  it('TC-09: NaN / Infinity positions → 0 applied, no transaction', () => {
    const doc = freshDoc();
    const [a] = createMany(doc, [{ x: 0, y: 0 }]);
    const updates = countUpdates(doc);

    expect(
      moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]])),
    ).toBe(0);
    expect(
      moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]])),
    ).toBe(0);
    expect(
      moveObjects(doc, new Map([[a, { x: -Infinity, y: 5 }]])),
    ).toBe(0);
    // One bad entry rejects the whole call.
    expect(
      moveObjects(
        doc,
        new Map([
          [a, { x: 1, y: 1 }],
          ['other', { x: NaN, y: 0 }],
        ]),
      ),
    ).toBe(0);

    expect(updates.count()).toBe(0);
    expect(byId(doc, a)).toMatchObject({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
    });
    updates.dispose();
  });

  it('TC-09: empty position map → 0, no transaction', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates.count()).toBe(0);
    updates.dispose();
  });

  it('writes with LOCAL_ORIGIN origin', () => {
    const doc = freshDoc();
    const [a] = createMany(doc, [{ x: 0, y: 0 }]);
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    moveObjects(doc, new Map([[a, { x: 5, y: 5 }]]));
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});

describe('board-model group: bringObjectsToFront (TC-06)', () => {
  it('TC-06: 3 overlapping selected over 2 unselected → all above unselected, relative order kept', () => {
    const doc = freshDoc();
    // Selected notes first (z 1, 2, 3), then the unselected ones (z 4, 5),
    // so the whole selection starts BELOW both unselected notes.
    const s3 = createSticky(doc, { x: 0, y: 0 });
    const s4 = createSticky(doc, { x: 10, y: 0 });
    const s5 = createSticky(doc, { x: 20, y: 0 });
    const u1 = createSticky(doc, { x: 500, y: 0 });
    const u2 = createSticky(doc, { x: 600, y: 0 });
    // Shuffle the id order to prove ranking, not call order, decides z.
    const updates = countUpdates(doc);
    const applied = bringObjectsToFront(doc, [s5, s3, s4]);
    expect(applied).toBe(3);
    expect(updates.count()).toBe(1);

    const z3 = byId(doc, s3)?.z;
    const z4 = byId(doc, s4)?.z;
    const z5 = byId(doc, s5)?.z;
    const zU1 = byId(doc, u1)?.z;
    const zU2 = byId(doc, u2)?.z;
    // All selected above all unselected.
    expect(Math.min(z3!, z4!, z5!)).toBeGreaterThan(Math.max(zU1!, zU2!));
    // Relative stacking among selected preserved (s3 below s4, s4 below s5).
    expect(z3!).toBeLessThan(z4!);
    expect(z4!).toBeLessThan(z5!);
    updates.dispose();
  });

  it('missing ids are skipped; already-stacked selection and empty list are no-ops', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 50, y: 0 }); // z 2
    const updates = countUpdates(doc);
    expect(bringObjectsToFront(doc, [a, 'ghost'])).toBe(1); // a → z 3
    expect(byId(doc, a)?.z).toBe(3);
    expect(bringObjectsToFront(doc, ['ghost'])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    // a is topmost now: no-op.
    expect(bringObjectsToFront(doc, [a])).toBe(0);
    expect(updates.count()).toBe(1);
    updates.dispose();
  });
});

describe('board-model group: objectsInRect (TC-07)', () => {
  it('TC-07: A fully inside, B partly, C outside → [A]', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // bounds -100..100 on both axes
    const b = createSticky(doc, { x: 150, y: 0 }); // bounds 50..250 x: partly inside
    const c = createSticky(doc, { x: 500, y: 0 }); // bounds 400..600 x: outside
    // Marquee -110..110: contains a fully, b partly, c not at all.
    const marquee: Rect = { x: -110, y: -110, width: 220, height: 220 };
    expect(objectsInRect(snapshot(doc), marquee)).toEqual([a]);
  });

  it('an object exactly filling the rect counts as fully inside', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const exact: Rect = {
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    };
    expect(objectsInRect(snapshot(doc), exact)).toEqual([a]);
  });
});

describe('board-model group: allObjectIds (TC-08)', () => {
  it('TC-08: unknown types are excluded', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 50, y: 0 });
    const objects = objectsOf(doc);
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 5);
      shape.set('y', 5);
      objects.set('shape-1', shape);
    });
    expect(allObjectIds(snapshot(doc)).sort()).toEqual([a, b].sort());
  });
});

describe('board-model group: objectBounds + resizeObjects (TC-10)', () => {
  it('TC-10: sticky without width/height reads STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const doc = freshDoc();
    // A pre-story-7 sticky (no stored size): readers fall back to
    // STICKY_SIZE_WORLD. Built by hand, since createSticky now stores the
    // explicit default size.
    const id = crypto.randomUUID();
    const entry = new Y.Map();
    entry.set('type', 'sticky');
    entry.set('x', -STICKY_SIZE_WORLD / 2);
    entry.set('y', -STICKY_SIZE_WORLD / 2);
    entry.set('color', 'yellow');
    entry.set('text', new Y.Text());
    entry.set('z', 1);
    entry.set('createdAt', 0);
    objectsOf(doc).set(id, entry);
    const before = byId(doc, id)!;
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const updates = countUpdates(doc);
    const applied = resizeObjects(
      doc,
      new Map([[id, { x: 0, y: 0, width: 300, height: 300 }]]),
    );
    expect(applied).toBe(1);
    expect(updates.count()).toBe(1);
    const after = byId(doc, id)!;
    expect(after.width).toBe(300);
    expect(after.height).toBe(300);
    expect(after.x).toBe(0);
    expect(after.y).toBe(0);
    expect(objectBounds(after)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    updates.dispose();
  });

  it('TC-09: non-finite or non-positive rects → 0, no transaction; empty map too', () => {
    const doc = freshDoc();
    const [a] = createMany(doc, [{ x: 0, y: 0 }]);
    const updates = countUpdates(doc);
    expect(
      resizeObjects(doc, new Map([[a, { x: NaN, y: 0, width: 100, height: 100 }]])),
    ).toBe(0);
    expect(
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 100, height: -5 }]])),
    ).toBe(0);
    expect(
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 100 }]])),
    ).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(updates.count()).toBe(0);
    // createSticky stores the explicit default size; rejection leaves it.
    expect(byId(doc, a)?.width).toBe(STICKY_SIZE_WORLD);
    expect(byId(doc, a)?.height).toBe(STICKY_SIZE_WORLD);
    updates.dispose();
  });
});

describe('board-model group: deleteObjects', () => {
  it('deletes every present id in one transaction and returns the count', () => {
    const doc = freshDoc();
    const [a, b, c] = createMany(doc, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [a, 'ghost', c])).toBe(2);
    expect(updates.count()).toBe(1);
    expect(notes(doc).map((n) => n.id)).toEqual([b]);
    updates.dispose();
  });

  it('TC-09: empty id list → 0, no transaction', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(updates.count()).toBe(0);
    updates.dispose();
  });
});
