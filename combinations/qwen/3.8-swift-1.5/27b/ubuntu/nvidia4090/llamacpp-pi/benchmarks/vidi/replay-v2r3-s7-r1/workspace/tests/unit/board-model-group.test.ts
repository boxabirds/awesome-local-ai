import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  deleteObject,
  deleteObjects,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectsInRect,
  allObjectIds,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

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

describe('sel.geometry_ops (board-model group operations against a real Y.Doc)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05
  it('TC-05: moveObjects with one of three ids deleted remotely → returns 2, exactly one update event', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 10, y: 10 });
    const c = makeNote(doc, { x: 20, y: 20 });
    expect(deleteObject(doc, b)).toBe(true);

    const { result, updates } = withUpdateCount(doc, () =>
      moveObjects(
        doc,
        new Map<string, { x: number; y: number }>([
          [a, { x: 1, y: 2 }],
          [b, { x: 3, y: 4 }], // deleted remotely: skipped
          [c, { x: 5, y: 6 }],
        ]),
      ),
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(objMap(doc, a).get('x')).toBe(1);
    expect(objMap(doc, a).get('y')).toBe(2);
    expect(objMap(doc, c).get('x')).toBe(5);
    expect(objMap(doc, c).get('y')).toBe(6);
  });

  // TC-06
  it('TC-06: bringObjectsToFront raises the selection above all unselected objects, relative order kept', () => {
    const a = makeNote(doc, { x: 0, y: 0 }); // z 1
    const b = makeNote(doc, { x: 0, y: 0 }); // z 2
    const c = makeNote(doc, { x: 0, y: 0 }); // z 3
    makeNote(doc, { x: 0, y: 0 }); // d z 4 (unselected)
    makeNote(doc, { x: 0, y: 0 }); // e z 5 (unselected)

    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, b, c]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const za = objMap(doc, a).get('z') as number;
    const zb = objMap(doc, b).get('z') as number;
    const zc = objMap(doc, c).get('z') as number;
    const zd = 4;
    const ze = 5;
    // All selected above all unselected…
    for (const z of [za, zb, zc]) {
      expect(z).toBeGreaterThan(Math.max(zd, ze));
    }
    // …with their relative stacking order preserved.
    expect(za).toBeLessThan(zb);
    expect(zb).toBeLessThan(zc);
  });

  // TC-07
  it('TC-07: objectsInRect selects only the fully-inside object (partly inside is negative)', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 0, y: 0 });
    const c = makeNote(doc, { x: 0, y: 0 });
    // Place the notes at explicit 80×80 top-left bounds (x/y are top-left, not centres).
    objMap(doc, a).set('x', 110); objMap(doc, a).set('y', 110);
    objMap(doc, b).set('x', 190); objMap(doc, b).set('y', 110);
    objMap(doc, c).set('x', 300); objMap(doc, c).set('y', 300);
    for (const id of [a, b, c]) {
      objMap(doc, id).set('width', 80);
      objMap(doc, id).set('height', 80);
    }
    const rect = { x: 100, y: 100, width: 100, height: 100 };
    // A: (110,110)–(190,190) fully inside. B: (190,110)–(270,190) half inside. C: outside.
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
  });

  // TC-08
  it('TC-08: allObjectIds excludes objects of unknown types', () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const mystery = new Y.Map<unknown>();
    mystery.set('type', 'mystery');
    mystery.set('x', 0);
    mystery.set('y', 0);
    mystery.set('z', 1);
    objects.set('m1', mystery);

    const snaps = snapshot(doc);
    expect(snaps.map((s) => s.id)).toEqual([id]); // snapshot skips unknown types
    expect(allObjectIds(snaps)).toEqual([id]);

    // Directly: a hand-made snapshot containing an unknown type.
    const hand: ObjectSnapshot[] = [
      { id: 'x', type: 'mystery', x: 0, y: 0, z: 1, createdAt: 0 },
      { id: 'y', type: 'sticky', x: 0, y: 0, z: 2, createdAt: 0 },
    ];
    expect(allObjectIds(hand)).toEqual(['y']);
  });

  // TC-09
  it('TC-09: NaN/Infinity positions and an empty id list → 0 applied, no transaction (error path)', () => {
    const id = makeNote(doc, { x: 100, y: 100 });
    const bad = [
      new Map([[id, { x: NaN, y: 0 }]]),
      new Map([[id, { x: 0, y: NaN }]]),
      new Map([[id, { x: Infinity, y: 0 }]]),
      new Map([[id, { x: 0, y: -Infinity }]]),
      new Map<string, { x: number; y: number }>(),
    ];
    for (const positions of bad) {
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    expect(objMap(doc, id).get('x')).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(objMap(doc, id).get('y')).toBe(100 - STICKY_SIZE_WORLD / 2);

    // Same rules for resizeObjects.
    const badRects = [
      new Map([[id, { x: NaN, y: 0, width: 100, height: 100 }]]),
      new Map<string, { x: number; y: number; width: number; height: number }>(),
    ];
    for (const rects of badRects) {
      const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, rects));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    // And deleteObjects with an empty list.
    const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, []));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  // TC-10
  it('TC-10: a sticky without width/height reads STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const id = makeNote(doc, { x: 300, y: 200 });
    const obj = snapshot(doc).find((o) => o.id === id)!;
    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();
    expect(objectBounds(obj)).toEqual({
      x: 300 - STICKY_SIZE_WORLD / 2,
      y: 200 - STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const { result, updates } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map([[id, { x: 150, y: 120, width: 250, height: 250 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    const m = objMap(doc, id);
    expect(m.get('x')).toBe(150);
    expect(m.get('y')).toBe(120);
    expect(m.get('width')).toBe(250);
    expect(m.get('height')).toBe(250);
    // The snapshot now exposes the explicit size.
    const after = snapshot(doc).find((o) => o.id === id)!;
    expect(after.width).toBe(250);
    expect(after.height).toBe(250);
  });

  it('deleteObjects removes every existing id in one transaction and skips missing ones', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 10, y: 10 });
    const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, [a, b, 'ghost']));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
