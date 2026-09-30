import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  clampScale,
  resizeRect,
  scaleWithin,
  type Rect,
} from '../../src/shared/geometry';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  type ObjectSnapshot,
  type Point,
} from '../../src/shared/board-model';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

// ---- TC-01: resizeRect corner (se), aspectLocked ----

describe('geometry resizeRect', () => {
  it('TC-01 se handle, aspect locked: 200x200 + (100,40) → 300x300', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // Aspect locked: original ratio 1:1. Larger delta is x (100 > 40),
    // so width determines: new width = 300, new height = 300
    expect(result.width).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(300);
  });

  it('resizeRect se without aspect lock changes both independently', () => {
    const start: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, false);
    expect(result.width).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(240);
  });

  it('resizeRect nw handle moves top-left corner', () => {
    const start: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeRect(start, 'nw', { x: -50, y: -30 }, false);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(70);
    expect(result.width).toBeCloseTo(250);
    expect(result.height).toBeCloseTo(230);
  });
});

// ---- TC-02: clampScale at STICKY_MIN_SIZE_WORLD boundary ----

describe('geometry clampScale min boundary', () => {
  it('TC-02 shrink below STICKY_MIN_SIZE_WORLD → clamped to 50x50', () => {
    // A single 200x200 sticky; scale of 0.25 would give 50, scale of 0.24 → 48 which is below min
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Desired scale to go below min
    const result = clampScale({ x: 0.24, y: 0.24 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // clamped so width = 50: scale = 50/200 = 0.25
    expect(result.x).toBeCloseTo(0.25);
    expect(result.y).toBeCloseTo(0.25);
  });

  it('TC-02 exactly at min is allowed', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    const result = clampScale({ x: 0.25, y: 0.25 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(0.25);
    expect(result.y).toBeCloseTo(0.25);
  });
});

// ---- TC-03: clampScale stops all when first hits MAX_OBJECT_SIZE_WORLD ----

describe('geometry clampScale max boundary', () => {
  it('TC-03 mixed rects: stops when first object would exceed MAX_OBJECT_SIZE_WORLD', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10000, height: 10000 },
      { x: 20000, y: 0, width: 5000, height: 5000 },
    ];
    const minSizes = [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD];
    // Scale of 3: first object becomes 30000 > MAX (20000), second becomes 15000 < MAX
    // Max scale for first: 20000/10000 = 2
    // Max scale for second: 20000/5000 = 4
    // Uniform max = min(2, 4) = 2
    const result = clampScale({ x: 3, y: 3 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(result.x).toBeCloseTo(2);
    expect(result.y).toBeCloseTo(2);
  });

  it('TC-03 relative layout preserved (scale applies uniformly)', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10000, height: 10000 },
      { x: 11000, y: 0, width: 5000, height: 5000 },
    ];
    const minSizes = [10, 10];
    const result = clampScale({ x: 1.5, y: 1.5 }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // 10000*1.5=15000 < MAX, so scale not clamped
    expect(result.x).toBeCloseTo(1.5);
    expect(result.y).toBeCloseTo(1.5);
  });
});

// ---- TC-04: scaleWithin two notes 100 apart, box ×2 width → 400 wide, gap 200 ----

describe('geometry scaleWithin', () => {
  it('TC-04 two 200-unit notes 100 apart, box width ×2 → 400 wide, gap 200', () => {
    // Note A: x=0, w=200. Note B: x=300, w=200. Gap = 100.
    // Bounding box: x=0, width=500.
    // Scale box to ×2 width: new box width=1000, height unchanged.
    const boxFrom: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const boxTo: Rect = { x: 0, y: 0, width: 1000, height: 200 };

    const noteA: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const noteB: Rect = { x: 300, y: 0, width: 200, height: 200 };

    const a = scaleWithin(noteA, boxFrom, boxTo);
    const b = scaleWithin(noteB, boxFrom, boxTo);

    // Note A should be 400 wide
    expect(a.width).toBeCloseTo(400);
    // Note B should be 400 wide
    expect(b.width).toBeCloseTo(400);
    // Gap between A (ends at 400) and B (starts at 600): 200
    expect(b.x - (a.x + a.width)).toBeCloseTo(200);
  });
});

// ---- TC-05: moveObjects with 1 id missing ----

describe('board-model moveObjects', () => {
  function harness() {
    const doc = new Y.Doc();
    initDoc(doc);
    let updateCount = 0;
    doc.on('update', (_u: unknown, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });
    return { doc, getUpdates: () => updateCount, resetUpdates: () => { updateCount = 0; } };
  }

  it('TC-05 move 3 ids, 1 deleted remotely → returns 2, 1 update event', () => {
    const h = harness();
    const a = createSticky(h.doc, { x: 0, y: 0 });
    const b = createSticky(h.doc, { x: 300, y: 0 });
    const c = createSticky(h.doc, { x: 600, y: 0 });
    // Delete b
    deleteObject(h.doc, b);
    h.resetUpdates();

    const positions = new Map<string, Point>([
      [a, { x: 10, y: 10 }],
      [b, { x: 310, y: 10 }],
      [c, { x: 610, y: 10 }],
    ]);
    const count = moveObjects(h.doc, positions);
    expect(count).toBe(2);
    expect(h.getUpdates()).toBe(1);
  });
});

// ---- TC-06: bringObjectsToFront preserves relative z ----

describe('board-model bringObjectsToFront', () => {
  function harness() {
    const doc = new Y.Doc();
    initDoc(doc);
    return doc;
  }

  it('TC-06 3 overlapping selected above 2 unselected, relative order kept', () => {
    const doc = harness();
    // Create 5 stickies with z 1, 2, 3, 4, 5
    const s1 = createSticky(doc, { x: 0, y: 0 }); // z=1
    const s2 = createSticky(doc, { x: 0, y: 0 }); // z=2
    const s3 = createSticky(doc, { x: 0, y: 0 }); // z=3
    const u1 = createSticky(doc, { x: 500, y: 0 }); // z=4
    const u2 = createSticky(doc, { x: 500, y: 0 }); // z=5

    // Selected: s1(z=1), s2(z=2), s3(z=3) → above max unselected (5)
    bringObjectsToFront(doc, [s1, s2, s3]);

    const entries = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>);
    const zOf = (id: string) => entries.get(id)!.get('z') as number;

    // Selected should be at z 6, 7, 8 (relative order: s1 < s2 < s3)
    expect(zOf(s1)).toBe(6);
    expect(zOf(s2)).toBe(7);
    expect(zOf(s3)).toBe(8);
    // Unselected unchanged
    expect(zOf(u1)).toBe(4);
    expect(zOf(u2)).toBe(5);
  });
});

// ---- TC-07: objectsInRect - fully/partly/outside ----

describe('board-model objectsInRect', () => {
  it('TC-07 A fully inside, B partly, C outside → [A]', () => {
    const snap: ObjectSnapshot[] = [
      { id: 'a', type: 'sticky', x: 10, y: 10, z: 1, width: 50, height: 50 },
      { id: 'b', type: 'sticky', x: 90, y: 10, z: 2, width: 50, height: 50 },
      { id: 'c', type: 'sticky', x: 200, y: 200, z: 3, width: 50, height: 50 },
    ];
    // Selection rect: x=0..100, y=0..100
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // A: 10..60 fully inside
    // B: 90..140 right edge outside
    // C: far outside
    expect(objectsInRect(snap, rect)).toEqual(['a']);
  });
});

// ---- TC-08: allObjectIds skips unknown type ----

describe('board-model allObjectIds', () => {
  it('TC-08 returns sticky ids, excludes unknown type', () => {
    const snap: ObjectSnapshot[] = [
      { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 },
      { id: 'b', type: 'shape', x: 0, y: 0, z: 2 },
      { id: 'c', type: 'sticky', x: 100, y: 0, z: 3 },
    ];
    const ids = allObjectIds(snap);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).toContain('c');
  });
});

// ---- TC-09: non-finite and empty ----

describe('board-model moveObjects invalid input', () => {
  it('TC-09 NaN/Infinity positions → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    let updateCount = 0;
    doc.on('update', (_u: unknown, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    expect(moveObjects(doc, new Map([[id, { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[id, { x: 0, y: Infinity }]]))).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updateCount).toBe(0);
  });

  it('resizeObjects invalid rects → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    let updateCount = 0;
    doc.on('update', (_u: unknown, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    expect(
      resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: NaN, height: 100 }]])),
    ).toBe(0);
    expect(updateCount).toBe(0);
  });
});

// ---- TC-10: sticky without width/height reads STICKY_SIZE_WORLD; resize writes both ----

describe('board-model objectBounds and resizeObjects with implicit size', () => {
  it('TC-10 objectBounds uses STICKY_SIZE_WORLD when width/height absent', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 200 });
    // The entry doesn't have width/height
    const snap = objectSnapshotsHelper(doc);
    const obj = snap.find((o) => o.id === id)!;
    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();
    const bounds = objectBounds(obj);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
  });

  it('TC-10 first resizeObjects writes both width and height', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 200 });
    const count = resizeObjects(doc, new Map([[id, { x: 50, y: 60, width: 300, height: 300 }]]));
    expect(count).toBe(1);
    const entry = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id)!;
    expect(entry.get('width')).toBe(300);
    expect(entry.get('height')).toBe(300);
    expect(entry.get('x')).toBe(50);
    expect(entry.get('y')).toBe(60);
  });
});

// Helper to get object snapshots directly
function objectSnapshotsHelper(doc: Y.Doc): ObjectSnapshot[] {
  const list: ObjectSnapshot[] = [];
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  for (const [id, entry] of objects) {
    const type = entry.get('type');
    const x = entry.get('x');
    const y = entry.get('y');
    const z = entry.get('z');
    if (typeof type !== 'string' || typeof x !== 'number' || typeof y !== 'number') continue;
    const width = entry.get('width');
    const height = entry.get('height');
    list.push({
      id,
      type,
      x,
      y,
      z: typeof z === 'number' ? z : 0,
      width: typeof width === 'number' ? width : undefined,
      height: typeof height === 'number' ? height : undefined,
    });
  }
  return list;
}
