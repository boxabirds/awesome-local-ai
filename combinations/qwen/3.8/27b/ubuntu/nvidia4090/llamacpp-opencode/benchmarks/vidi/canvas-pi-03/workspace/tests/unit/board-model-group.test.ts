import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  createSticky,
  objectBounds,
  objectSnapshot,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  snapshot,
  type ObjectSnapshot,
} from '@/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '@/shared/config';

/**
 * Story 7 unit tests for the generic group operations (sel.geometry_ops,
 * TC-05 to TC-10) against a REAL Y.Doc.
 */

function trackUpdates(doc: Y.Doc): { count: () => number; lastOrigin: () => unknown; dispose: () => void } {
  let count = 0;
  let lastOrigin: unknown = undefined;
  const cb = (_update: Uint8Array, origin: unknown) => {
    count += 1;
    lastOrigin = origin;
  };
  doc.on('update', cb);
  return {
    count: () => count,
    lastOrigin: () => lastOrigin,
    dispose: () => doc.off('update', cb),
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function obj(doc: Y.Doc, id: string): Y.Map<unknown> {
  const map = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!map) throw new Error(`object ${id} missing`);
  return map;
}

describe('board-model group ops (unit, real Y.Doc)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('TC-05: moveObjects with one deleted id returns 2 and emits exactly one update', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const c = createSticky(doc, { x: 20, y: 20 });
    deleteObjects(doc, [c]); // c is gone remotely before the group move

    const updates = trackUpdates(doc);
    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 100, y: 100 }],
        [b, { x: 200, y: 200 }],
        [c, { x: 300, y: 300 }],
      ]),
    );
    expect(n).toBe(2);
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);
    expect(obj(doc, a).get('x')).toBe(100);
    expect(obj(doc, b).get('y')).toBe(200);
    updates.dispose();
  });

  it('TC-06: bringObjectsToFront puts 3 overlapping selected above 2 unselected, relative order kept', () => {
    const u1 = createSticky(doc, { x: 0, y: 0 });
    const u2 = createSticky(doc, { x: 5, y: 5 });
    // Three overlapping selected notes with a non-trivial relative order:
    // s3 is currently topmost of the three, s2 in the middle, s1 bottom.
    const s3 = createSticky(doc, { x: 10, y: 10 });
    const s2 = createSticky(doc, { x: 12, y: 12 });
    const s1 = createSticky(doc, { x: 14, y: 14 });
    // Re-order so the selection's internal order is not the creation order.
    doc.transact(() => {
      obj(doc, s1).set('z', 10);
      obj(doc, s2).set('z', 8);
      obj(doc, s3).set('z', 12);
    });
    // Unselected get high z values that the selection must pass.
    doc.transact(() => {
      obj(doc, u1).set('z', 30);
      obj(doc, u2).set('z', 31);
    });

    const updates = trackUpdates(doc);
    const n = bringObjectsToFront(doc, [s3, s2, s1]); // given in scrambled order
    expect(n).toBe(3);
    expect(updates.count()).toBe(1);

    const z = (id: string) => obj(doc, id).get('z') as number;
    // All selected above all unselected...
    expect(Math.min(z(s1), z(s2), z(s3))).toBeGreaterThan(Math.max(z(u1), z(u2)));
    // ...with the relative order preserved (s2 < s1 < s3 as before).
    expect(z(s2)).toBeLessThan(z(s1));
    expect(z(s1)).toBeLessThan(z(s3));
    updates.dispose();
  });

  it('TC-06 (negative): bringObjectsToFront when already on top: 0, no transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 }); // z=1
    const b = createSticky(doc, { x: 10, y: 10 }); // z=2
    const u = createSticky(doc, { x: 20, y: 20 }); // z=3, unselected and topmost
    expect(bringObjectsToFront(doc, [a, b])).toBe(2); // first call moves them above u
    const updates = trackUpdates(doc);
    expect(bringObjectsToFront(doc, [a, b])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['missing'])).toBe(0);
    expect(updates.count()).toBe(0);
    const z = (id: string) => obj(doc, id).get('z') as number;
    expect(z(a)).toBeGreaterThan(z(u));
    expect(z(b)).toBeGreaterThan(z(a)); // relative order kept
    updates.dispose();
  });

  it('TC-07: objectsInRect returns only the fully-inside note (A in, B half, C out)', () => {
    // A: fully inside the rect. B: half inside. C: outside.
    const a = createSticky(doc, { x: -100, y: -100 }); // top-left (-200,-200)
    const b = createSticky(doc, { x: 200, y: -100 }); // top-left (100,-200)
    const c = createSticky(doc, { x: 600, y: -100 }); // top-left (500,-200)
    const snap = objectSnapshot(doc);
    const ids = objectsInRect(snap, { x: -250, y: -250, width: 500, height: 500 });
    expect(ids).toEqual([a]);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
  });

  it('TC-08: allObjectIds excludes unknown types', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 5);
      shape.set('y', 6);
      shape.set('z', 1);
      shape.set('createdAt', 1);
      doc.getMap('objects').set('shape-1', shape);
    });
    const snap = objectSnapshot(doc);
    expect(snap).toHaveLength(2); // objectSnapshot keeps unknown types...
    expect(allObjectIds(snap)).toEqual([a]); // ...but select-all skips them
    expect(snapshot(doc)).toHaveLength(1); // story 2 sticky snapshot unchanged
  });

  it('TC-09 (error path): non-finite positions and empty id lists: 0, no transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const updates = trackUpdates(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(
      resizeObjects(
        doc,
        new Map([[a, { x: Number.NaN, y: 0, width: 100, height: 100 }]]),
      ),
    ).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['missing'])).toBe(0);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    updates.dispose();
  });

  it('TC-10: sticky without width/height bounds at STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = objectSnapshot(doc);
    const o = snap.find((s: ObjectSnapshot) => s.id === id)!;
    expect(o.width).toBeUndefined();
    expect(o.height).toBeUndefined();
    expect(objectBounds(o)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const updates = trackUpdates(doc);
    const n = resizeObjects(doc, new Map([[id, { x: 10, y: 20, width: 150, height: 150 }]]));
    expect(n).toBe(1);
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);

    const after = objectSnapshot(doc).find((s) => s.id === id)!;
    expect(after.width).toBe(150);
    expect(after.height).toBe(150);
    expect(objectBounds(after)).toEqual({ x: 10, y: 20, width: 150, height: 150 });
    updates.dispose();
  });

  it('moveObjects/resizeObjects/deleteObjects are one transaction per call for many ids', () => {
    const ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 5, y: 5 }), createSticky(doc, { x: 9, y: 9 })];
    const updates = trackUpdates(doc);
    expect(moveObjects(doc, new Map(ids.map((id, i) => [id, { x: i, y: i * 2 }])))).toBe(3);
    expect(resizeObjects(doc, new Map(ids.map((id, i) => [id, { x: i, y: i * 2, width: 60, height: 60 }])))).toBe(3);
    expect(deleteObjects(doc, ids)).toBe(3);
    expect(updates.count()).toBe(3);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);
    expect(snapshot(doc)).toHaveLength(0);
    updates.dispose();
  });

  it('size limits flow through: a resize past MAX_OBJECT_SIZE_WORLD is the caller\'s clamp', () => {
    // The model itself is not the clamp (clampScale is); this pins the
    // boundary values used by the clamp tests.
    expect(STICKY_MIN_SIZE_WORLD).toBe(50);
    expect(MAX_OBJECT_SIZE_WORLD).toBe(20000);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 50, height: 50 }]]))).toBe(1);
    const o = objectSnapshot(doc).find((s) => s.id === id)!;
    expect(o.width).toBe(50);
    expect(o.height).toBe(50);
  });
});
