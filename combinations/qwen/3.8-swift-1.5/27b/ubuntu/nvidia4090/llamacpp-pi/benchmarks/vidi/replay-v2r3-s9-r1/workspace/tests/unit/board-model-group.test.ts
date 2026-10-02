import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  deleteObject,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
// Importing the registry registers 'sticky' as a known object type (side effect),
// which `allObjectIds` relies on (TC-08).
import '../../src/client/objects/registry';

/** Run `fn` and count how many `update` events the doc emits. */
function withUpdateCount(doc: Y.Doc, fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: unknown;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeNote(doc: Y.Doc, at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  expect(id, 'createSticky should succeed').not.toBe(false);
  return id as string;
}

/** Put an object of an unregistered type into the doc (forward compatibility). */
function addUnknownObject(doc: Y.Doc, id: string): void {
  const shape = new Y.Map<unknown>();
  shape.set('type', 'shape');
  shape.set('x', 0);
  shape.set('y', 0);
  shape.set('z', 1);
  doc.getMap('objects').set(id, shape);
}

/**
 * Story 7 (sel.geometry_ops): generic group operations against a real Y.Doc.
 * TC-05 to TC-10.
 */
describe('board-model group ops (real Y.Doc)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05
  it('TC-05: moveObjects with one id deleted remotely → returns 2, exactly 1 update event', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const c = makeNote(doc, { x: 200, y: 0 });
    deleteObject(doc, b); // b is gone before the group move

    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 20 }],
      [b, { x: 110, y: 20 }], // missing id → skipped
      [c, { x: 210, y: 20 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1); // one LOCAL_ORIGIN transaction for the whole group

    const snaps = new Map(snapshot(doc).map((s) => [s.id, s]));
    expect(snaps.get(a)).toMatchObject({ x: 10, y: 20 });
    expect(snaps.get(c)).toMatchObject({ x: 210, y: 20 });
    expect(snaps.has(b)).toBe(false);
  });

  // TC-06
  it('TC-06: bringObjectsToFront puts the selection above unselected, relative z preserved', () => {
    const a = makeNote(doc, { x: 0, y: 0 }); // z 1
    const b = makeNote(doc, { x: 0, y: 0 }); // z 2
    const c = makeNote(doc, { x: 0, y: 0 }); // z 3
    makeNote(doc, { x: 0, y: 0 }); // z 4 (unselected)
    const e = makeNote(doc, { x: 0, y: 0 }); // z 5 (unselected)

    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, b, c]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const z = new Map(snapshot(doc).map((s) => [s.id, s.z]));
    // All selected above both unselected…
    expect(z.get(a)!).toBeGreaterThan(z.get(e)!);
    expect(z.get(b)!).toBeGreaterThan(z.get(e)!);
    expect(z.get(c)!).toBeGreaterThan(z.get(e)!);
    // …with their relative stacking order preserved (a was lowest).
    expect(z.get(a)!).toBeLessThan(z.get(b)!);
    expect(z.get(b)!).toBeLessThan(z.get(c)!);
  });

  it('bringObjectsToFront with nothing to change → 0, no transaction', () => {
    makeNote(doc, { x: 0, y: 0 }); // z 1
    const b = makeNote(doc, { x: 0, y: 0 }); // z 2 (topmost)
    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [b]));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  // TC-07
  it('TC-07: objectsInRect selects only objects lying entirely inside (A inside, B half, C outside → [A])', () => {
    const a = makeNote(doc, { x: 300, y: 300 }); // top-left (200, 200), 200×200 → (200..400)²
    makeNote(doc, { x: 600, y: 300 }); // (500..700) — half inside a box ending at 600
    makeNote(doc, { x: 1000, y: 300 }); // far outside
    const rect: Rect = { x: 100, y: 100, width: 500, height: 400 }; // (100..600) × (100..500)
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
  });

  it('objectsInRect: empty board → []; touching from outside is not selected', () => {
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    const a = makeNote(doc, { x: 400, y: 300 }); // (300..500)²
    // Box whose right edge coincides with the note's right edge: fully inside.
    expect(objectsInRect(snapshot(doc), { x: 250, y: 150, width: 250, height: 300 })).toEqual([a]);
    // Box that only reaches the note's edge from outside: not inside.
    expect(objectsInRect(snapshot(doc), { x: 250, y: 150, width: 200, height: 300 })).toEqual([]);
  });

  // TC-08
  it('TC-08: allObjectIds excludes unregistered types', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 100 });
    addUnknownObject(doc, 'shape-1');
    const ids = allObjectIds(snapshot(doc));
    expect([...ids].sort()).toEqual([a, b].sort());
  });

  // TC-09
  it('TC-09: NaN/Infinity positions → 0 applied, no transaction; empty id list → 0, no transaction', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const bad: Array<[string, { x: number; y: number }]> = [
      [a, { x: NaN, y: 0 }],
      [a, { x: 0, y: NaN }],
      [a, { x: Infinity, y: 0 }],
      [a, { x: 0, y: -Infinity }],
    ];
    for (const [id, p] of bad) {
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, new Map([[id, p]])));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    const empty = withUpdateCount(doc, () => moveObjects(doc, new Map()));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);

    const badRects: Rect[] = [
      { x: NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: Infinity, width: 100, height: 100 },
      { x: 0, y: 0, width: NaN, height: 100 },
      { x: 0, y: 0, width: 100, height: -Infinity },
    ];
    for (const r of badRects) {
      const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, new Map([[a, r]])));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    const emptyRects = withUpdateCount(doc, () => resizeObjects(doc, new Map()));
    expect(emptyRects.result).toBe(0);
    expect(emptyRects.updates).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
  });

  // TC-10
  it('TC-10: sticky without width/height bounds at STICKY_SIZE_WORLD; first resizeObjects writes both fields', () => {
    const a = makeNote(doc, { x: 300, y: 300 }); // top-left (200, 200)
    const snap = snapshot(doc)[0] as ObjectSnapshot;
    expect(snap.width).toBeUndefined();
    expect(snap.height).toBeUndefined();
    expect(objectBounds(snap)).toEqual({
      x: 200, y: 200, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD,
    });

    // Resize to 250×250 at (150, 100).
    const { result, updates } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map([[a, { x: 150, y: 100, width: 250, height: 250 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);

    const after = snapshot(doc)[0] as ObjectSnapshot;
    expect(after.width).toBe(250);
    expect(after.height).toBe(250);
    expect(objectBounds(after)).toEqual({ x: 150, y: 100, width: 250, height: 250 });
  });

  it('resizeObjects skips missing ids and reports the count applied', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    deleteObject(doc, b);
    const rects = new Map<string, Rect>([
      [a, { x: 5, y: 6, width: 210, height: 210 }],
      [b, { x: 105, y: 6, width: 210, height: 210 }],
    ]);
    expect(resizeObjects(doc, rects)).toBe(1);
    expect(objectBounds(snapshot(doc)[0] as ObjectSnapshot)).toEqual({
      x: 5, y: 6, width: 210, height: 210,
    });
  });

  it('deleteObjects removes every present id in one transaction and skips missing ones', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const c = makeNote(doc, { x: 200, y: 0 });
    const { result, updates } = withUpdateCount(doc, () =>
      deleteObjects(doc, [a, 'ghost', b, c]),
    );
    expect(result).toBe(3);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // Sanity: group ops respect the size limits end to end.
  it('resizeObjects stores whatever it is given; limits are enforced by the gesture (clampScale)', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    // Far below the sticky minimum: the model stores it (limits live in the
    // gesture via clampScale), proving the model is a dumb writer.
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 49, height: 49 }]]));
    expect(objectBounds(snapshot(doc)[0] as ObjectSnapshot).width).toBe(49);
    // And far above the maximum:
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: MAX_OBJECT_SIZE_WORLD + 1, height: 100 }]]));
    expect(objectBounds(snapshot(doc)[0] as ObjectSnapshot).width).toBe(MAX_OBJECT_SIZE_WORLD + 1);
    void STICKY_MIN_SIZE_WORLD;
  });
});
