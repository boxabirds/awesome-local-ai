import { describe, it, expect } from 'vitest';
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
  registerBoardObjectType,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return { doc, mutations: () => count };
}

describe('TC-10: objectBounds and first persisted size', () => {
  it('falls back to STICKY_SIZE_WORLD when size is not persisted', () => {
    const bounds = objectBounds({ id: 'a', type: 'sticky', x: 10, y: 20, z: 1 });
    expect(bounds).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });
  it('uses persisted width/height', () => {
    const bounds = objectBounds({ id: 'a', type: 'sticky', x: 0, y: 0, z: 1, width: 120, height: 80 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 120, height: 80 });
  });
});

describe('TC-07: objectsInRect (marquee rule: fully inside)', () => {
  const objs: ObjectSnapshot[] = [
    { id: 'in', type: 'sticky', x: 10, y: 10, z: 1, width: 20, height: 20 },
    { id: 'touch', type: 'sticky', x: 0, y: 0, z: 2, width: 30, height: 30 },
    { id: 'clip', type: 'sticky', x: 25, y: 25, z: 3, width: 20, height: 20 },
  ];
  it('selects objects fully enclosed, excluding clipped ones', () => {
    const ids = objectsInRect(objs, { x: 0, y: 0, width: 30, height: 30 });
    expect(ids).toContain('in');
    expect(ids).toContain('touch'); // edges coincide
    expect(ids).not.toContain('clip'); // sticks out
  });
});

describe('TC-08: allObjectIds', () => {
  it('includes known types only', () => {
    registerBoardObjectType('testbox');
    const objs: ObjectSnapshot[] = [
      { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 },
      { id: 'b', type: 'testbox', x: 0, y: 0, z: 2 },
      { id: 'c', type: 'mystery', x: 0, y: 0, z: 3 },
    ];
    expect(new Set(allObjectIds(objs))).toEqual(new Set(['a', 'b']));
  });
});

describe('TC-05: moveObjects', () => {
  it('moves several objects in one transaction', () => {
    const { doc, mutations } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 100 });
    const before = mutations();
    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 5, y: 5 }],
        [b, { x: 105, y: 105 }],
      ]),
    );
    expect(n).toBe(2);
    expect(mutations()).toBe(before + 1); // exactly one transaction
    const snap = snapshot(doc);
    expect(snap.find((o) => o.id === a)?.x).toBe(5);
    expect(snap.find((o) => o.id === b)?.x).toBe(105);
  });
  it('skips missing ids', () => {
    const { doc } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 1, y: 1 }],
        ['ghost', { x: 2, y: 2 }],
      ]),
    );
    expect(n).toBe(1);
  });
  it('TC-09: rejects a non-finite position entirely (no transaction)', () => {
    const { doc, mutations } = setup();
    const a = createSticky(doc, { x: 3, y: 3 });
    const before = mutations();
    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 5, y: 5 }],
        ['ghost', { x: Number.NaN, y: 0 }],
      ]),
    );
    expect(n).toBe(0);
    expect(mutations()).toBe(before);
    expect(snapshot(doc)[0]?.x).toBe(3 - STICKY_SIZE_WORLD / 2);
  });
  it('is a no-op for an empty map', () => {
    const { doc, mutations } = setup();
    const before = mutations();
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(mutations()).toBe(before);
  });
});

describe('TC-10: resizeObjects persists both fields', () => {
  it('persists x, y, width and height in one transaction', () => {
    const { doc, mutations } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = mutations();
    const n = resizeObjects(doc, new Map([[a, { x: 10, y: 20, width: 300, height: 150 }]]));
    expect(n).toBe(1);
    expect(mutations()).toBe(before + 1);
    const obj = snapshot(doc).find((o) => o.id === a);
    expect(obj?.width).toBe(300);
    expect(obj?.height).toBe(150);
    expect(obj?.x).toBe(10);
  });
});

describe('TC-06: bringObjectsToFront', () => {
  function docs() {
    const { doc } = setup();
    const a = createSticky(doc, { x: 0, y: 0 }); // z=1
    const b = createSticky(doc, { x: 0, y: 0 }); // z=2
    const c = createSticky(doc, { x: 0, y: 0 }); // z=3
    return { doc, a, b, c };
  }
  it('raises the selected above unselected, preserving relative order', () => {
    const { doc, a, b, c } = docs();
    // selected a & b, unselected c at z=3 → a,b become z=4,5 in their relative order
    const changed = bringObjectsToFront(doc, [a, b]);
    expect(changed).toBe(2);
    const snap = snapshot(doc);
    const za = snap.find((o) => o.id === a)!.z;
    const zb = snap.find((o) => o.id === b)!.z;
    const zc = snap.find((o) => o.id === c)!.z;
    expect(zc).toBe(3);
    expect(za).toBe(4);
    expect(zb).toBe(5);
  });
  it('returns 0 when nothing needs to change', () => {
    const { doc, a, b, c } = docs();
    bringObjectsToFront(doc, [a, b, c]);
    const { doc: doc2 } = setup();
    void doc2;
    // Re-running on already-front objects changes nothing.
    expect(bringObjectsToFront(doc, [a, b, c])).toBe(0);
  });
  it('returns 0 for empty or all-missing ids', () => {
    const { doc } = docs();
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['ghost'])).toBe(0);
  });
});

describe('deleteObjects (support)', () => {
  it('removes several in one transaction and counts removed', () => {
    const { doc, mutations } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const before = mutations();
    const n = deleteObjects(doc, [a, b, 'ghost']);
    expect(n).toBe(2);
    expect(mutations()).toBe(before + 1);
    expect(snapshot(doc)).toHaveLength(1);
  });
  it('returns 0 for empty input', () => {
    const { doc } = setup();
    expect(deleteObjects(doc, [])).toBe(0);
  });
});

describe('TC-10: snapshot width/height (backward compatible)', () => {
  it('omits width/height for freshly created stickies, includes them after resize', () => {
    const { doc } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const fresh = snapshot(doc)[0]!;
    expect(fresh.width).toBeUndefined();
    expect(fresh.height).toBeUndefined();
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 42, height: 43 }]]));
    const resized = snapshot(doc)[0]!;
    expect(resized.width).toBe(42);
    expect(resized.height).toBe(43);
  });
});
