import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => { n += 1; };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

describe('board-model group ops — moveObjects (TC-05, TC-09)', () => {
  it('TC-05: moves 3 objects, one deleted → returns 2, one transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });

    // Delete b
    objectsMap(doc).delete(b);

    const stop = updateCounter(doc);
    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 50, y: 50 }],
      [b, { x: 150, y: 50 }],
      [c, { x: 250, y: 50 }],
    ]);

    const count = moveObjects(doc, positions);
    expect(count).toBe(2);
    expect(stop()).toBe(1);

    const snap = snapshot(doc);
    expect(snap.find(n => n.id === a)?.x).toBe(50);
    expect(snap.find(n => n.id === c)?.x).toBe(250);
  });

  it('TC-09: NaN/Infinity positions → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    const bad1 = new Map<string, { x: number; y: number }>([[a, { x: NaN, y: 0 }]]);
    expect(moveObjects(doc, bad1)).toBe(0);

    const bad2 = new Map<string, { x: number; y: number }>([[a, { x: Infinity, y: 0 }]]);
    expect(moveObjects(doc, bad2)).toBe(0);

    const bad3 = new Map<string, { x: number; y: number }>([[a, { x: 0, y: -Infinity }]]);
    expect(moveObjects(doc, bad3)).toBe(0);

    expect(stop()).toBe(0);
    // Position unchanged
    expect(snapshot(doc)[0].x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
  });

  it('empty id list → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group ops — resizeObjects (TC-10)', () => {
  it('TC-10: sticky without width/height, objectBounds uses STICKY_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const bounds = objectBounds(snap[0]);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
  });

  it('TC-10: first resizeObjects writes both width and height fields', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const m = objectsMap(doc).get(id)!;
    expect(m.get('width')).toBeUndefined();
    expect(m.get('height')).toBeUndefined();

    const rects = new Map<string, Rect>([[id, { x: 10, y: 20, width: 300, height: 300 }]]);
    const count = resizeObjects(doc, rects);
    expect(count).toBe(1);
    expect(m.get('width')).toBe(300);
    expect(m.get('height')).toBe(300);
    expect(m.get('x')).toBe(10);
    expect(m.get('y')).toBe(20);
  });

  it('empty map → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(stop()).toBe(0);
  });

  it('non-finite rect → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    const rects = new Map<string, Rect>([[id, { x: NaN, y: 0, width: 200, height: 200 }]]);
    expect(resizeObjects(doc, rects)).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group ops — bringObjectsToFront (TC-06)', () => {
  it('TC-06: 3 selected above 2 unselected, relative z preserved', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Create 5 notes with z 1..5
    const a = createSticky(doc, { x: 0, y: 0 });   // z=1
    const b = createSticky(doc, { x: 10, y: 0 });  // z=2
    const c = createSticky(doc, { x: 20, y: 0 });  // z=3
    const d = createSticky(doc, { x: 30, y: 0 });  // z=4
    const e = createSticky(doc, { x: 40, y: 0 });  // z=5

    // Move a, c, e to top (they overlap d, e which are unselected)
    const count = bringObjectsToFront(doc, [a, c, e]);
    expect(count).toBeGreaterThan(0);

    const snap = snapshot(doc);
    const zMap = new Map(snap.map(n => [n.id, n.z]));
    // All selected objects should have z > max unselected z
    // Unselected: b(z=2), d(z=4) → maxUnselectedZ = 4 (originally was 5 for e, but e moved)
    // Actually we need to recompute: after the call:
    // Unselected z: b=2, d=4 → maxUnselectedZ = 4
    // Selected get: a=5, c=6, e=7 (preserving relative order a<c<e)
    expect(zMap.get(a)!).toBeGreaterThan(zMap.get(b)!);
    expect(zMap.get(a)!).toBeGreaterThan(zMap.get(d)!);
    expect(zMap.get(c)!).toBeGreaterThan(zMap.get(b)!);
    expect(zMap.get(e)!).toBeGreaterThan(zMap.get(d)!);
    // Relative order preserved
    expect(zMap.get(a)!).toBeLessThan(zMap.get(c)!);
    expect(zMap.get(c)!).toBeLessThan(zMap.get(e)!);
  });

  it('empty ids → 0', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(bringObjectsToFront(doc, [])).toBe(0);
  });
});

describe('board-model group ops — deleteObjects (TC-05 complement)', () => {
  it('deletes multiple objects, skips missing ids', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    const stop = updateCounter(doc);

    const count = deleteObjects(doc, [a, 'nonexistent', b]);
    expect(count).toBe(2);
    expect(stop()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('empty ids → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group ops — objectsInRect (TC-07)', () => {
  it('TC-07: A fully inside, B partly inside, C outside → [A]', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 50 + STICKY_SIZE_WORLD / 2, y: 50 + STICKY_SIZE_WORLD / 2 });  // top-left at (50,50), fits in (0,0,300,300)
    const b = createSticky(doc, { x: 200 + STICKY_SIZE_WORLD / 2, y: 200 + STICKY_SIZE_WORLD / 2 }); // top-left at (200,200), goes to (400,400) - partly outside (0,0,300,300)
    const c = createSticky(doc, { x: 500 + STICKY_SIZE_WORLD / 2, y: 500 + STICKY_SIZE_WORLD / 2 }); // way outside

    const rect: Rect = { x: 0, y: 0, width: 300, height: 300 };
    const snap = snapshot(doc);
    const result = objectsInRect(snap, rect);

    expect(result).toContain(a);
    expect(result).not.toContain(b);
    expect(result).not.toContain(c);
    expect(result).toHaveLength(1);
  });
});

describe('board-model group ops — allObjectIds (TC-08)', () => {
  it('TC-08: skips unknown types', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    // Add an unknown type directly
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 10);
      shape.set('y', 20);
      objectsMap(doc).set('shape-1', shape);
    });

    const ids = allObjectIds(snapshot(doc));
    expect(ids).toContain(a);
    expect(ids).not.toContain('shape-1');
    expect(ids).toHaveLength(1);
  });
});

describe('board-model group ops — LOCAL_ORIGIN', () => {
  it('all group mutations use LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const origins: unknown[] = [];
    doc.on('update', (_u: unknown, origin: unknown) => origins.push(origin));

    moveObjects(doc, new Map([[a, { x: 1, y: 1 }]]));
    resizeObjects(doc, new Map([[a, { x: 2, y: 2, width: 300, height: 300 }]]));
    bringObjectsToFront(doc, [a, b]);
    deleteObjects(doc, [a]);

    // Should have some transactions (at least one per call that did something)
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });
});
