// sel.geometry_ops (story 7, TC-05 to TC-10): generic group operations
// against a real Y.Doc. Each mutating test also counts `update` events:
// 1 for a successful change, 0 for a rejection/no-op.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  objectBounds,
  objectsInRect,
  moveObjects,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { clampScale, scaleWithin, unionRects, type Rect } from '../../src/shared/geometry';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function withUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  const result = fn();
  doc.off('update', observer);
  return { result, updates };
}

/** Create a sticky with its top-left at (x, y). */
function stickyAt(doc: Y.Doc, x: number, y: number): string {
  const id = createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  moveObjects(doc, new Map([[id, { x, y }]]));
  return id;
}

/** Insert an object of an unregistered type straight into the doc. */
function unknownObject(doc: Y.Doc, id: string): void {
  const m = new Y.Map();
  m.set('type', 'mystery');
  m.set('x', 0);
  m.set('y', 0);
  m.set('z', 1);
  m.set('createdAt', Date.now());
  doc.getMap('objects').set(id, m);
}

describe('sel.geometry_ops — group operations', () => {
  it('TC-05 moveObjects with one remotely-deleted id: returns 2, exactly 1 update event', () => {
    const doc = freshDoc();
    const a = stickyAt(doc, 0, 0);
    const b = stickyAt(doc, 300, 0);
    const c = stickyAt(doc, 600, 0);
    deleteObjects(doc, [b]);

    const { result, updates } = withUpdates(doc, () =>
      moveObjects(
        doc,
        new Map([
          [a, { x: 10, y: 20 }],
          [b, { x: 310, y: 20 }],
          [c, { x: 610, y: 20 }],
        ]),
      ),
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);
    const snap = new Map(snapshot(doc).map((o) => [o.id, o]));
    expect(snap.get(a)?.x).toBe(10);
    expect(snap.get(a)?.y).toBe(20);
    expect(snap.get(c)?.x).toBe(610);
    expect(snap.has(b)).toBe(false);
  });

  it('TC-06 bringObjectsToFront: selected group above unselected, relative order kept', () => {
    const doc = freshDoc();
    // Three overlapping selected at z 1,2,3; two unselected created later at
    // z 4,5 (above them), so the operation has real work to do.
    const a = stickyAt(doc, 100, 100);
    const b = stickyAt(doc, 150, 150);
    const c = stickyAt(doc, 200, 200);
    stickyAt(doc, 0, 0);
    stickyAt(doc, 400, 400);
    const z = (id: string) => snapshot(doc).find((o) => o.id === id)?.z;

    const { result, updates } = withUpdates(doc, () => bringObjectsToFront(doc, [c, a, b]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const za = z(a)!;
    const zb = z(b)!;
    const zc = z(c)!;
    // All three above both unselected (z 4,5).
    expect(za).toBeGreaterThan(5);
    expect(zb).toBeGreaterThan(5);
    expect(zc).toBeGreaterThan(5);
    // Exactly the rank assignment: 6,7,8.
    expect(za).toBe(6);
    expect(zb).toBe(7);
    expect(zc).toBe(8);
    // Relative order among the selected is preserved (a < b < c by z).
    expect(za).toBeLessThan(zb);
    expect(zb).toBeLessThan(zc);
  });

  it('TC-06b bringObjectsToFront already-ordered selection: 0, no transaction (no-op)', () => {
    const doc = freshDoc();
    stickyAt(doc, 0, 0);
    const a = stickyAt(doc, 100, 100);
    const b = stickyAt(doc, 200, 200);
    // a, b are already above the single unselected note.
    const { result, updates } = withUpdates(doc, () => bringObjectsToFront(doc, [a, b]));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  it('TC-07 objectsInRect: fully inside / partly inside / outside -> [A] only', () => {
    const doc = freshDoc();
    // A: 0..200 x 0..200. B: 150..350 (half inside a 0..250 rect). C: 500..700.
    const a = stickyAt(doc, 0, 0);
    stickyAt(doc, 150, 0);
    stickyAt(doc, 500, 0);
    void a;
    const snap = snapshot(doc);
    const inside = objectsInRect(snap, { x: 0, y: 0, width: 250, height: 200 });
    expect(inside).toHaveLength(1);
    // The fully-inside note is the one at x 0.
    expect(inside[0]).toBe(snapshot(doc).find((o) => o.x === 0)!.id);
  });

  it('TC-08 allObjectIds excludes unregistered types', () => {
    const doc = freshDoc();
    const a = stickyAt(doc, 0, 0);
    const b = stickyAt(doc, 300, 0);
    unknownObject(doc, 'mystery-1');
    const ids = allObjectIds(snapshot(doc));
    expect(ids.sort()).toEqual([a, b].sort());
  });

  it('TC-09 non-finite positions and empty id list -> 0, no transaction', () => {
    const doc = freshDoc();
    const a = stickyAt(doc, 0, 0);

    const nan = withUpdates(doc, () => moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]])));
    expect(nan.result).toBe(0);
    expect(nan.updates).toBe(0);

    const inf = withUpdates(doc, () => moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]])));
    expect(inf.result).toBe(0);
    expect(inf.updates).toBe(0);

    const empty = withUpdates(doc, () => moveObjects(doc, new Map()));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);

    const missing = withUpdates(doc, () => moveObjects(doc, new Map([['nope', { x: 1, y: 2 }]])));
    expect(missing.result).toBe(0);
    expect(missing.updates).toBe(0);

    // Nothing was written.
    expect(snapshot(doc).find((o) => o.id === a)?.x).toBe(0);
  });

  it('TC-09b resizeObjects rejects non-finite rects and empty input the same way', () => {
    const doc = freshDoc();
    const a = stickyAt(doc, 0, 0);

    const bad = withUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 100, height: NaN }]])),
    );
    expect(bad.result).toBe(0);
    expect(bad.updates).toBe(0);

    const empty = withUpdates(doc, () => resizeObjects(doc, new Map()));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);

    expect(snapshot(doc).find((o) => o.id === a)?.width).toBeUndefined();
  });

  it('TC-10 sticky without width/height: objectBounds uses STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const doc = freshDoc();
    const a = stickyAt(doc, 10, 20);
    const obj = snapshot(doc).find((o) => o.id === a)!;
    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();
    expect(objectBounds(obj)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const target: Rect = { x: 30, y: 40, width: 260, height: 260 };
    const { result, updates } = withUpdates(doc, () => resizeObjects(doc, new Map([[a, target]])));
    expect(result).toBe(1);
    expect(updates).toBe(1);

    const after = snapshot(doc).find((o) => o.id === a)!;
    expect(after.width).toBe(260);
    expect(after.height).toBe(260);
    expect(objectBounds(after)).toEqual(target);
  });

  it('deleteObjects removes every given id in one transaction; skips missing ids', () => {
    const doc = freshDoc();
    const a = stickyAt(doc, 0, 0);
    const b = stickyAt(doc, 300, 0);
    const c = stickyAt(doc, 600, 0);
    const { result, updates } = withUpdates(doc, () => deleteObjects(doc, [a, b, 'missing', c]));
    expect(result).toBe(3);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('group resize end-to-end: two notes scaled by the clamped box scale (max size stops it)', () => {
    const doc = freshDoc();
    // Note A 100x100 and note B 20,000x100 (created then resized to max width).
    const a = stickyAt(doc, 0, 0);
    const b = stickyAt(doc, 300, 0);
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 100, height: 100 }], [b, { x: 300, y: 0, width: MAX_OBJECT_SIZE_WORLD, height: 100 }]]));

    const snap = snapshot(doc);
    const byId = new Map(snap.map((o) => [o.id, o]));
    const rects = [a, b].map((id) => objectBounds(byId.get(id)!));
    const box = unionRects(rects)!;
    // Ask for width x2: the max-size object forbids it; the clamped scale is 1.
    const scale = { x: 2, y: 1 };
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped).toEqual({ x: 1, y: 1 });
    const clampedBox: Rect = {
      x: box.x,
      y: box.y,
      width: box.width * clamped.x,
      height: box.height * clamped.y,
    };
    const next: Map<string, Rect> = new Map();
    rects.forEach((r, i) => {
      next.set([a, b][i]!, scaleWithin(r, box, clampedBox));
    });
    const { result } = withUpdates(doc, () => resizeObjects(doc, next));
    expect(result).toBe(2);
    const after = new Map(snapshot(doc).map((o) => [o.id, o]));
    expect(objectBounds(after.get(a)!)).toEqual(rects[0]);
    expect(objectBounds(after.get(b)!)).toEqual(rects[1]);
    // And the min-size floor still holds for the small note.
    const floor = clampToMin(rects[0], { x: 0.1, y: 0.1 });
    expect(floor.width).toBe(STICKY_MIN_SIZE_WORLD);
  });
});

function clampToMin(rect: Rect, scale: { x: number; y: number }): Rect {
  const sx = Math.max(scale.x, STICKY_MIN_SIZE_WORLD / rect.width);
  const sy = Math.max(scale.y, STICKY_MIN_SIZE_WORLD / rect.height);
  return { x: rect.x, y: rect.y, width: rect.width * sx, height: rect.height * sy };
}
