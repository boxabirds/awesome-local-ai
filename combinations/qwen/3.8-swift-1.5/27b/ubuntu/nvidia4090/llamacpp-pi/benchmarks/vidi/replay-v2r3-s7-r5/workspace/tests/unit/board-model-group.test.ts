import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  objects,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

/**
 * Story 7 unit tests for the generic group operations (sel.geometry_ops),
 * TC-05 to TC-10, against a real Y.Doc.
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

/** Insert a raw object of an unknown type directly into the doc. */
function insertUnknownType(doc: Y.Doc, id: string): void {
  const objectsMap = doc.getMap('objects');
  const m = new Y.Map<unknown>();
  m.set('type', 'mystery');
  m.set('x', 0);
  m.set('y', 0);
  m.set('z', 1);
  m.set('createdAt', 0);
  doc.transact(() => {
    objectsMap.set(id, m);
  });
}

describe('board-model group operations (story 7, sel.geometry_ops)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05
  it('TC-05: moveObjects with one id deleted remotely → returns 2, exactly 1 update event', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const c = makeNote(doc, { x: 200, y: 0 });
    deleteObjects(doc, [b]); // b disappears before the move

    const { result, updates } = withUpdateCount(doc, () =>
      moveObjects(doc, new Map<string, Point>([[a, { x: 10, y: 10 }], [b, { x: 110, y: 10 }], [c, { x: 210, y: 10 }]])),
    );
    expect(result).toBe(2); // missing id skipped
    expect(updates).toBe(1); // one transaction
    const byId = new Map(objects(doc).map((o) => [o.id, o]));
    expect(byId.get(a)?.x).toBe(10);
    expect(byId.get(a)?.y).toBe(10);
    expect(byId.get(c)?.x).toBe(210);
    expect(byId.has(b)).toBe(false);
  });

  // TC-06
  it('TC-06: bringObjectsToFront puts 3 overlapping selected above 2 unselected, keeping relative z', () => {
    const u1 = makeNote(doc, { x: 500, y: 500 }); // unselected, z 1
    const s1 = makeNote(doc, { x: 0, y: 0 }); // selected, z 2
    const u2 = makeNote(doc, { x: 600, y: 600 }); // unselected, z 3
    const s2 = makeNote(doc, { x: 20, y: 20 }); // selected, z 4 (overlaps s1)
    const s3 = makeNote(doc, { x: 40, y: 40 }); // selected, z 5 (overlaps s1, s2)

    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [s1, s2, s3]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const byId = new Map(objects(doc).map((o) => [o.id, o]));
    const zs = [byId.get(s1)!.z, byId.get(s2)!.z, byId.get(s3)!.z];
    // All selected above every unselected object.
    expect(Math.min(...zs)).toBeGreaterThan(byId.get(u1)!.z);
    expect(Math.min(...zs)).toBeGreaterThan(byId.get(u2)!.z);
    // Relative stacking order among the selected objects is preserved
    // (s1 was below s2, s2 below s3 — still is).
    expect(zs[0]).toBeLessThan(zs[1]);
    expect(zs[1]).toBeLessThan(zs[2]);
  });

  // TC-07
  it('TC-07: objectsInRect selects only the fully-inside object (A in, B partly, C out)', () => {
    const a = makeNote(doc, { x: 300, y: 300 }); // bounds (200,200)-(400,400)
    // B: centre (550, 300) → bounds (450,200)-(650,400): half inside a box ending at 550.
    makeNote(doc, { x: 550, y: 300 });
    makeNote(doc, { x: 900, y: 900 }); // far outside

    const rect: Rect = { x: 150, y: 150, width: 400, height: 400 }; // (150,150)-(550,550)
    const ids = objectsInRect(objects(doc), rect);
    expect(ids).toEqual([a]);
  });

  // TC-08
  it('TC-08: allObjectIds excludes unknown types', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    insertUnknownType(doc, 'mystery-1');
    const snaps = objects(doc);
    expect(snaps.map((o) => o.id)).toEqual([a]); // objects() itself skips unknown types
    // allObjectIds must also skip unknown types when handed a raw snapshot list.
    const raw: ObjectSnapshot[] = [
      { id: a, type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 },
      { id: 'mystery-1', type: 'mystery', x: 0, y: 0, z: 2, createdAt: 0 },
    ];
    expect(allObjectIds(raw)).toEqual([a]);
  });

  // TC-09
  it('TC-09: NaN / Infinity positions and empty id list → 0 applied, no transaction', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const before = objects(doc).find((o) => o.id === a)!;
    const badPositions: Array<ReadonlyMap<string, Point>> = [
      new Map([[a, { x: NaN, y: 0 }]]),
      new Map([[a, { x: 0, y: NaN }]]),
      new Map([[a, { x: Infinity, y: 0 }]]),
      new Map([[a, { x: 0, y: -Infinity }]]),
      new Map(),
    ];
    for (const positions of badPositions) {
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    const after = objects(doc).find((o) => o.id === a)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    // Same rules for resizeObjects.
    const badRects: Array<ReadonlyMap<string, Rect>> = [
      new Map([[a, { x: NaN, y: 0, width: 100, height: 100 }]]),
      new Map([[a, { x: 0, y: 0, width: Infinity, height: 100 }]]),
      new Map([[a, { x: 0, y: 0, width: -5, height: 100 }]]),
      new Map(),
    ];
    for (const rects of badRects) {
      const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, rects));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }

    // deleteObjects with an empty list → 0, no transaction.
    const del = withUpdateCount(doc, () => deleteObjects(doc, []));
    expect(del.result).toBe(0);
    expect(del.updates).toBe(0);
  });

  // TC-10
  it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const id = makeNote(doc, { x: 100, y: 100 });
    // Remove the explicit size fields to simulate a pre-story-7 note.
    doc.transact(() => {
      const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
      m.delete('width');
      m.delete('height');
    });
    const snap = objects(doc).find((o) => o.id === id)!;
    expect(snap.width).toBeUndefined();
    expect(snap.height).toBeUndefined();
    expect(objectBounds(snap)).toEqual({
      x: 100 - STICKY_SIZE_WORLD / 2,
      y: 100 - STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    // The first resize writes width and height (implicit → explicit).
    const { result, updates } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map([[id, { x: 50, y: 50, width: 120, height: 120 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(m.get('width')).toBe(120);
    expect(m.get('height')).toBe(120);
    expect(m.get('x')).toBe(50);
    expect(m.get('y')).toBe(50);
    expect(objectBounds(objects(doc).find((o) => o.id === id)!)).toEqual({
      x: 50,
      y: 50,
      width: 120,
      height: 120,
    });
  });

  it('moveObjects writes absolute positions in one LOCAL_ORIGIN transaction', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 100 });
    let origin: unknown = 'unset';
    doc.getMap('objects').observeDeep((_e, tr) => {
      origin = tr.origin;
    });
    const applied = moveObjects(doc, new Map<string, Point>([[a, { x: 5, y: 6 }], [b, { x: 15, y: 16 }]]));
    expect(applied).toBe(2);
    expect(origin).toBeDefined();
    expect(origin).not.toBe('unset');
    const byId = new Map(objects(doc).map((o) => [o.id, o]));
    expect(byId.get(a)?.x).toBe(5);
    expect(byId.get(b)?.y).toBe(16);
  });

  it('deleteObjects removes several objects and skips missing ids', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, [a, b, 'ghost']));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(objects(doc)).toHaveLength(0);
  });
});
