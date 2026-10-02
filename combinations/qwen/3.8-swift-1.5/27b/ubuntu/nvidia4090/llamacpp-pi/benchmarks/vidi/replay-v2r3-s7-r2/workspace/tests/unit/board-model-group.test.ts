import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  deleteObject,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { STICKY_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7, sel.geometry_ops: generic group operations against a real Y.Doc
 * (unit level). TC-05 to TC-10.
 */

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

function objMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = doc.getMap('objects').get(id);
  expect(m, `object ${id} should exist`).toBeInstanceOf(Y.Map);
  return m as Y.Map<unknown>;
}

describe('board-model group operations (Y.Doc)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05 (error path: missing id skipped, single transaction)
  it('TC-05: moveObjects with one deleted id → returns 2, exactly 1 update event', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const c = makeNote(doc, { x: 200, y: 0 });
    deleteObject(doc, b);

    const { result, updates } = withUpdateCount(doc, () =>
      moveObjects(doc, new Map<string, { x: number; y: number }>([[a, { x: 10, y: 10 }], [b, { x: 20, y: 20 }], [c, { x: 30, y: 30 }]])),
    );
    expect(result).toBe(2); // b missing → skipped
    expect(updates).toBe(1); // one LOCAL_ORIGIN transaction
    expect(objMap(doc, a).get('x')).toBe(10);
    expect(objMap(doc, a).get('y')).toBe(10);
    expect(objMap(doc, c).get('x')).toBe(30);
  });

  // TC-06
  it('TC-06: bringObjectsToFront puts the selection above unselected, relative z kept', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 0, y: 0 });
    const c = makeNote(doc, { x: 0, y: 0 }); // selected: z 1,2,3
    const d = makeNote(doc, { x: 0, y: 0 });
    const e = makeNote(doc, { x: 0, y: 0 }); // unselected: z 4,5

    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, b, c]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const za = objMap(doc, a).get('z') as number;
    const zb = objMap(doc, b).get('z') as number;
    const zc = objMap(doc, c).get('z') as number;
    const zd = objMap(doc, d).get('z') as number;
    const ze = objMap(doc, e).get('z') as number;
    // All selected above every unselected object…
    expect(za).toBeGreaterThan(zd);
    expect(zb).toBeGreaterThan(ze);
    expect(zc).toBeGreaterThan(ze);
    // …with their relative stacking order preserved.
    expect(za).toBeLessThan(zb);
    expect(zb).toBeLessThan(zc);
  });

  // TC-07 (negative: partly-inside object not selected)
  it('TC-07: objectsInRect selects only fully-inside objects', () => {
    const a = makeNote(doc, { x: 200, y: 200 }); // bounds (100,100)-(300,300) fully inside
    const b = makeNote(doc, { x: 380, y: 200 }); // bounds (280,100)-(480,300) partly inside
    const c = makeNote(doc, { x: 700, y: 200 }); // bounds (600,100)-(800,300) outside
    const rect: Rect = { x: 50, y: 50, width: 300, height: 300 }; // (50,50)-(350,350)

    // All three are in the snapshot…
    expect(snapshot(doc).map((s) => s.id).sort()).toEqual([a, b, c].sort());
    // …but only the fully-inside one is returned.
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
  });

  // TC-08
  it('TC-08: allObjectIds excludes unknown types', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const mystery = new Y.Map<unknown>();
    mystery.set('type', 'mystery');
    mystery.set('x', 0);
    mystery.set('y', 0);
    mystery.set('z', 9);
    objects.set('mystery-1', mystery);

    // The snapshot skips unregistered types…
    const snaps = snapshot(doc);
    expect(snaps.map((s) => s.id)).toEqual([a]);
    // …and allObjectIds returns exactly the registered objects.
    expect(allObjectIds(snaps)).toEqual([a]);
  });

  // TC-09 (error paths: non-finite values, empty id list)
  it('TC-09: non-finite positions or an empty list → 0 applied, no transaction', () => {
    const a = makeNote(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    const bad = [
      new Map<string, { x: number; y: number }>([[a, { x: NaN, y: 5 }]]),
      new Map<string, { x: number; y: number }>([[a, { x: 5, y: Infinity }]]),
      new Map<string, { x: number; y: number }>(),
    ];
    for (const positions of bad) {
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    expect(objMap(doc, a).get('x')).toBe(0);
    expect(objMap(doc, a).get('y')).toBe(0);

    // Same rules for resizeObjects.
    const badRects: ReadonlyMap<string, Rect>[] = [
      new Map([[a, { x: NaN, y: 0, width: 100, height: 100 }]]),
      new Map([[a, { x: 0, y: 0, width: 100, height: -Infinity }]]),
      new Map<string, Rect>(),
    ];
    for (const rects of badRects) {
      const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, rects));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
  });

  // TC-10
  it('TC-10: sticky without width/height reads STICKY_SIZE_WORLD; first resize writes both', () => {
    // createSticky centres on `at`: at (200,200) → top-left (100,100).
    const a = makeNote(doc, { x: 200, y: 200 });
    const snap = snapshot(doc).find((s) => s.id === a)!;
    // Implicit size: no persisted width/height, bounds at STICKY_SIZE_WORLD.
    expect(snap.width).toBeUndefined();
    expect(snap.height).toBeUndefined();
    expect(objectBounds(snap)).toEqual({
      x: 100,
      y: 100,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const { result, updates } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map<string, Rect>([[a, { x: 120, y: 80, width: 120, height: 120 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    const m = objMap(doc, a);
    expect(m.get('width')).toBe(120);
    expect(m.get('height')).toBe(120);
    expect(m.get('x')).toBe(120);
    expect(m.get('y')).toBe(80);
    // The snapshot now exposes the explicit size.
    const after = snapshot(doc).find((s) => s.id === a)!;
    expect(objectBounds(after)).toEqual({ x: 120, y: 80, width: 120, height: 120 });
  });

  it('resizeObjects skips missing ids; deleteObjects removes several at once', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const { result: r1 } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map<string, Rect>([['ghost', { x: 0, y: 0, width: 10, height: 10 }], [a, { x: 5, y: 6, width: 90, height: 90 }]])),
    );
    expect(r1).toBe(1); // ghost skipped

    const { result: r2, updates } = withUpdateCount(doc, () => deleteObjects(doc, [a, b, 'ghost']));
    expect(r2).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);

    const { result: r3, updates: u3 } = withUpdateCount(doc, () => deleteObjects(doc, []));
    expect(r3).toBe(0);
    expect(u3).toBe(0);
  });

  it('objectBounds is a pure function of the snapshot', () => {
    const obj: ObjectSnapshot = { id: 'x', type: 'sticky', x: 1, y: 2, z: 1, createdAt: 0, width: 30, height: 40, color: 'yellow', text: '' };
    expect(objectBounds(obj)).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });

  // The MAX_OBJECT_SIZE_WORLD limit is a named setting used by clampScale.
  it('MAX_OBJECT_SIZE_WORLD is 20000 board units', () => {
    expect(MAX_OBJECT_SIZE_WORLD).toBe(20000);
  });
});
