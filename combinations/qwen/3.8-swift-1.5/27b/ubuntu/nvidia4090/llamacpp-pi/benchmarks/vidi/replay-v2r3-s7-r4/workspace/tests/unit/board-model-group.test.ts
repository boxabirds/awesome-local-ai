import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

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

describe('sel.geometry_ops (generic group operations on a real Y.Doc)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05
  it('TC-05: moveObjects with one of three ids deleted remotely → returns 2; exactly 1 update event', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const c = makeNote(doc, { x: 200, y: 0 });
    deleteObjects(doc, [b]);

    const { result, updates } = withUpdateCount(doc, () =>
      moveObjects(doc, new Map([
        [a, { x: 10, y: 20 }],
        [b, { x: 300, y: 300 }], // missing id is skipped
        [c, { x: -5, y: 5 }],
      ])),
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(objMap(doc, a).get('x')).toBe(10);
    expect(objMap(doc, a).get('y')).toBe(20);
    expect(objMap(doc, c).get('x')).toBe(-5);
  });

  // TC-06
  it('TC-06: bringObjectsToFront puts all selected above unselected, relative z preserved', () => {
    const a = makeNote(doc, { x: 0, y: 0 }); // z 1
    const b = makeNote(doc, { x: 10, y: 0 }); // z 2
    const c = makeNote(doc, { x: 20, y: 0 }); // z 3
    makeNote(doc, { x: 30, y: 0 }); // z 4 (unselected)
    makeNote(doc, { x: 40, y: 0 }); // z 5 (unselected)

    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, b, c]));
    expect(result).toBe(3);
    expect(updates).toBe(1);
    // All selected above both unselected, relative order a < b < c kept.
    expect(objMap(doc, a).get('z')).toBe(6);
    expect(objMap(doc, b).get('z')).toBe(7);
    expect(objMap(doc, c).get('z')).toBe(8);
    const unselected = [4, 5] as const;
    for (const z of unselected) {
      expect(objMap(doc, a).get('z')).toBeGreaterThan(z);
    }
  });

  it('bringObjectsToFront is a no-op when the selection is already on top', () => {
    makeNote(doc, { x: 0, y: 0 }); // z 1
    const b = makeNote(doc, { x: 10, y: 0 }); // z 2 (topmost)
    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [b]));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  // TC-07
  it('TC-07: objectsInRect selects only the fully-inside object (A in, B partly, C out)', () => {
    // Notes are 200×200 with top-left at the given point.
    const a = makeNoteAtTopLeft(doc, 100, 100); // 100..300 × 100..300
    makeNoteAtTopLeft(doc, 300, 100); // 300..500 × 100..300 (half in)
    makeNoteAtTopLeft(doc, 400, 500); // 400..600 × 500..700 (outside)
    const marquee: Rect = { x: 50, y: 50, width: 300, height: 300 }; // 50..350 × 50..350

    const snaps = snapshot(doc);
    expect(objectsInRect(snaps, marquee)).toEqual([a]);
  });

  // TC-08
  it('TC-08: allObjectIds excludes unknown types', () => {
    const a = makeNoteAtTopLeft(doc, 0, 0);
    // A raw object of an unregistered type.
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    shape.set('z', 1);
    shape.set('createdAt', 0);
    doc.getMap('objects').set('shape-1', shape);

    const snaps = snapshot(doc);
    expect(allObjectIds(snaps)).toEqual([a]);

    // allObjectIds itself also filters a hand-built snapshot.
    const handBuilt = [
      { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 },
      { id: 's', type: 'shape', x: 0, y: 0, z: 1, createdAt: 0 },
    ];
    expect(allObjectIds(handBuilt)).toEqual(['a']);
  });

  // TC-09
  it('TC-09: non-finite positions / rects and empty id lists → 0 applied, no transaction', () => {
    const a = makeNoteAtTopLeft(doc, 0, 0);
    const badPoints = [
      new Map([['nope', { x: NaN, y: 0 }]]),
      new Map([[a, { x: Infinity, y: 0 }]]),
      new Map([[a, { x: 0, y: -Infinity }]]),
      new Map<string, { x: number; y: number }>(), // empty
    ];
    for (const positions of badPoints) {
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    expect(objMap(doc, a).get('x')).toBe(0);
    expect(objMap(doc, a).get('y')).toBe(0);

    const badRects: Rect[] = [
      { x: NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: Infinity, height: 100 },
      { x: 0, y: 0, width: 100, height: NaN },
    ];
    for (const rect of badRects) {
      const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, new Map([[a, rect]])));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    {
      const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, new Map()));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    {
      const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, []));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
  });

  // TC-10
  it('TC-10: sticky without width/height → objectBounds uses STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const a = makeNoteAtTopLeft(doc, 10, 20);
    const m = objMap(doc, a);
    expect(m.get('width')).toBeUndefined();
    expect(m.get('height')).toBeUndefined();

    const snap = snapshot(doc).find((s) => s.id === a)!;
    expect(objectBounds(snap)).toEqual({
      x: 10,
      y: 20,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const rect: Rect = { x: 30, y: 40, width: 250, height: 250 };
    const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, new Map([[a, rect]])));
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(objMap(doc, a).get('width')).toBe(250);
    expect(objMap(doc, a).get('height')).toBe(250);
    expect(objMap(doc, a).get('x')).toBe(30);
    expect(objMap(doc, a).get('y')).toBe(40);
    // The implicit-size note is now explicit.
    expect(objectBounds(snapshot(doc).find((s) => s.id === a)!)).toEqual(rect);
  });

  it('deleteObjects removes every listed object, skips missing ids, one transaction', () => {
    const a = makeNoteAtTopLeft(doc, 0, 0);
    const b = makeNoteAtTopLeft(doc, 50, 0);
    const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, [a, 'ghost', b]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

/** createSticky centres the note on `at`; this helper places the top-left directly. */
function makeNoteAtTopLeft(doc: Y.Doc, x: number, y: number): string {
  const id = makeNote(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  moveObjects(doc, new Map([[id, { x, y }]]));
  return id;
}
