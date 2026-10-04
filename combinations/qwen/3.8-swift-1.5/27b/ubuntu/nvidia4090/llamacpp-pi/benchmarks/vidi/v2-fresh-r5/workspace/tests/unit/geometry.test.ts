import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  type Rect,
  type Point,
  resizeRect,
  clampScale,
  scaleWithin,
} from '../../src/shared/geometry';
import {
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  initDoc,
  createSticky,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

// ─── TC-01: resizeRect corner, aspectLocked ───────────────────────────────────
describe('TC-01: resizeRect corner aspectLocked', () => {
  it('se handle 200×200 + (100,40) → 300×300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
  });
});

// ─── TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped ─────────────────────
describe('TC-02: size limits clamping', () => {
  it('shrink to STICKY_MIN_SIZE_WORLD - 1 → clamped to 50×50', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Resize to make it very small
    const result = resizeRect(start, 'se', { x: -199, y: -199 }, true);
    // The raw result would be 1×1, but clampScale should prevent going below min
    const scale = {
      x: result.width / start.width,
      y: result.height / start.height,
    };
    const clamped = clampScale(scale, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    const finalW = start.width * clamped.x;
    const finalH = start.height * clamped.y;
    expect(finalW).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    expect(finalH).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
  });

  it('shrink to exactly STICKY_MIN_SIZE_WORLD → 50×50', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Scale to exactly 50/200 = 0.25
    const clamped = clampScale({ x: 0.25, y: 0.25 }, [start], [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    const finalW = start.width * clamped.x;
    const finalH = start.height * clamped.y;
    expect(finalW).toBe(STICKY_MIN_SIZE_WORLD);
    expect(finalH).toBe(STICKY_MIN_SIZE_WORLD);
  });
});

// ─── TC-03: clampScale mixed rects stops uniformly ───────────────────────────
describe('TC-03: clampScale mixed rects', () => {
  it('stops uniformly when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 0, width: 100, height: 100 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // A scale of 200 would make the second rect 20000 wide (at limit)
    // and the first rect 40000 wide (exceeds limit)
    const scale = { x: 200, y: 200 };
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // The first rect (200) would hit max at scale 100
    expect(clamped.x).toBeLessThanOrEqual(100);
    expect(clamped.y).toBeLessThanOrEqual(100);
    // Relative layout preserved: both use same scale
    expect(clamped.x).toBe(clamped.y);
  });
});

// ─── TC-04: scaleWithin ──────────────────────────────────────────────────────
describe('TC-04: scaleWithin', () => {
  it('two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    const from: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const to: Rect = { x: 0, y: 0, width: 1000, height: 200 };
    // Note 1 at x=0, width=200
    const child1: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // Note 2 at x=300, width=200 (100 apart from note 1's right edge at 200)
    const child2: Rect = { x: 300, y: 0, width: 200, height: 200 };

    const scaled1 = scaleWithin(child1, from, to);
    const scaled2 = scaleWithin(child2, from, to);

    expect(scaled1.width).toBe(400);
    expect(scaled2.width).toBe(400);
    // Gap: note2.x - (note1.x + note1.width) = 600 - 400 = 200
    const gap = scaled2.x - (scaled1.x + scaled1.width);
    expect(gap).toBe(200);
  });
});

// ─── TC-05: moveObjects with 1 deleted ──────────────────────────────────────
describe('TC-05: moveObjects with deleted id', () => {
  it('3 ids with 1 deleted → returns 2; exactly 1 update event', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 300, y: 100 });
    const id3 = createSticky(doc, { x: 500, y: 100 });

    // Delete id2
    deleteObjects(doc, [id2]);

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const positions = new Map<string, Point>([
      [id1, { x: 200, y: 200 }],
      [id2, { x: 400, y: 200 }], // deleted - should be skipped
      [id3, { x: 600, y: 200 }],
    ]);

    const changed = moveObjects(doc, positions);
    expect(changed).toBe(2);
    expect(updateCount).toBe(1);
  });
});

// ─── TC-06: bringObjectsToFront ─────────────────────────────────────────────
describe('TC-06: bringObjectsToFront', () => {
  it('3 overlapping selected over 2 unselected → all selected z above unselected, relative order kept', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 110, y: 110 });
    const id3 = createSticky(doc, { x: 120, y: 120 });
    const id4 = createSticky(doc, { x: 500, y: 500 });
    const id5 = createSticky(doc, { x: 510, y: 510 });

    // Reorder z: make id4 and id5 have higher z
    const objects = doc.getMap('objects');
    doc.transact(() => {
      (objects.get(id4) as Y.Map<unknown>).set('z', 10);
      (objects.get(id5) as Y.Map<unknown>).set('z', 11);
      (objects.get(id1) as Y.Map<unknown>).set('z', 1);
      (objects.get(id2) as Y.Map<unknown>).set('z', 2);
      (objects.get(id3) as Y.Map<unknown>).set('z', 3);
    });

    bringObjectsToFront(doc, [id1, id2, id3]);

    const snap = snapshot(doc);
    const z1 = snap.find(n => n.id === id1)!.z;
    const z2 = snap.find(n => n.id === id2)!.z;
    const z3 = snap.find(n => n.id === id3)!.z;
    const z4 = snap.find(n => n.id === id4)!.z;
    const z5 = snap.find(n => n.id === id5)!.z;

    // All selected above unselected
    expect(z1).toBeGreaterThan(z4);
    expect(z1).toBeGreaterThan(z5);
    expect(z2).toBeGreaterThan(z4);
    expect(z2).toBeGreaterThan(z5);
    expect(z3).toBeGreaterThan(z4);
    expect(z3).toBeGreaterThan(z5);
    // Relative order preserved
    expect(z1).toBeLessThan(z2);
    expect(z2).toBeLessThan(z3);
  });
});

// ─── TC-07: objectsInRect ───────────────────────────────────────────────────
describe('TC-07: objectsInRect', () => {
  it('A fully inside, B partly, C outside → [A]', () => {
    // Marquee rect
    const marquee: Rect = { x: 100, y: 100, width: 200, height: 200 };

    const objA: ObjectSnapshot = { id: 'a', type: 'sticky', x: 120, y: 120, width: 50, height: 50, z: 1, color: 'yellow', text: '', createdAt: 0 };
    const objB: ObjectSnapshot = { id: 'b', type: 'sticky', x: 250, y: 120, width: 100, height: 100, z: 2, color: 'yellow', text: '', createdAt: 0 }; // partly inside (right edge at 350 > 300)
    const objC: ObjectSnapshot = { id: 'c', type: 'sticky', x: 400, y: 400, width: 50, height: 50, z: 3, color: 'yellow', text: '', createdAt: 0 };

    const result = objectsInRect([objA, objB, objC], marquee);
    expect(result).toEqual(['a']);
  });
});

// ─── TC-08: allObjectIds skips unknown type ─────────────────────────────────
describe('TC-08: allObjectIds', () => {
  it('skips an unknown type', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const id1 = createSticky(doc, { x: 100, y: 100 });

    // Add an unknown type
    const objects = doc.getMap('objects');
    const unknownMap = new Y.Map<unknown>();
    unknownMap.set('type', 'mystery');
    unknownMap.set('x', 0);
    unknownMap.set('y', 0);
    doc.transact(() => {
      objects.set('unknown-1', unknownMap);
    });

    const ids = allObjectIds(doc);
    expect(ids).toContain(id1);
    expect(ids).not.toContain('unknown-1');
  });
});

// ─── TC-09: NaN/Infinity → 0, no transaction ────────────────────────────────
describe('TC-09: invalid values', () => {
  it('NaN/Infinity positions → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const positions = new Map<string, Point>([
      [id1, { x: NaN, y: 100 }],
    ]);
    const changed = moveObjects(doc, positions);
    expect(changed).toBe(0);
    expect(updateCount).toBe(0);
  });

  it('empty id list → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const changed = moveObjects(doc, new Map());
    expect(changed).toBe(0);
    expect(updateCount).toBe(0);
  });
});

// ─── TC-10: sticky without width/height ─────────────────────────────────────
describe('TC-10: implicit size', () => {
  it('objectBounds uses STICKY_SIZE_WORLD; first resizeObjects writes both fields', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });

    const snap = snapshot(doc);
    const obj = snap.find(n => n.id === id1)!;
    const bounds = objectBounds(obj);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);

    // Resize to 300×300
    const rects = new Map<string, Rect>([
      [id1, { x: 50, y: 50, width: 300, height: 300 }],
    ]);
    const changed = resizeObjects(doc, rects);
    expect(changed).toBe(1);

    // Verify width/height were written
    const objects = doc.getMap('objects');
    const objMap = objects.get(id1) as Y.Map<unknown>;
    expect(objMap.get('width')).toBe(300);
    expect(objMap.get('height')).toBe(300);
  });
});
