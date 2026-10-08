import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, moveObject, resizeObjects, deleteObject, snapshot, objectBounds, objectsInRect, allObjectIds, moveObjects, bringObjectsToFront, deleteObjects } from '@shared/board-model';
import { rectContains, normalizeRect, resizeRect, clampScale, scaleWithin } from '@shared/geometry';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '@shared/config';

// ─── Helpers ──────────────────────────────────────────────────────

function makeDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// TC-01: resizeRect corner handle se aspectLocked 200×200 + (100,40) → 300×300
describe('TC-01: resizeRect se handle with aspectLocked', () => {
  it('resizes 200×200 by (100,40) keeping aspect ratio to 300×300', () => {
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const result = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    // Aspect locked: height determines width since we dragged bottom edge more
    // Actually: dragging SE means both width and height increase. With aspect lock on a square,
    // if both change equally the aspect is kept. If one changes more, the other adjusts.
    // The implementation adjusts height based on width change or vice versa.
    // Width becomes 300. Height should match aspect: 300 × (200/200) = 300.
    expect(result.width).toBe(300);
    expect(result.height).toBe(300);
  });
});

// TC-02: shrink below STICKY_MIN_SIZE_WORLD → clamped 50×50
describe('TC-02: clampScale stops at minSize boundary', () => {
  it('shrinking a single rect below 50 is clamped to exactly 50', () => {
    const rects = [{ x: 0, y: 0, width: 200, height: 200 }];
    const minSizes = [STICKY_MIN_SIZE_WORLD];
    // Scale down by half would give 100px wide, but trying to go further
    let scale = { x: 0.2, y: 0.2 }; // Would give 40px — too small
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(clamped.x).toBe(50 / 200); // clamped so width = 50
    expect(clamped.y).toBe(50 / 200);

    // Test exact boundary: scale that would produce exactly 50
    scale = { x: 0.25, y: 0.25 };
    const exact = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(exact.x).toBe(0.25);
    expect(exact.y).toBe(0.25);

    // One unit below min: 200 * s < 50 → s < 0.25
    scale = { x: 0.24, y: 0.24 };
    const below = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    expect(below.x).toBe(50 / 200); // clamped back up
    expect(below.y).toBe(50 / 200);
  });
});

// TC-03: clampScale mixed rects – stops when first hits MAX_OBJECT_SIZE_WORLD
describe('TC-03: clampScale stops uniformly when first hits MAX_OBJECT_SIZE_WORLD', () => {
  it('two rects: smaller one hits max first, larger one also limited', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },   // smaller
      { x: 100, y: 0, width: 200, height: 200 }, // bigger
    ];
    const minSizes = [50, 50];
    // A scale of 200 would make the 100-width rect reach 20000 (=MAX)
    // The 200-width rect would reach 40000 which exceeds max
    let scale = { x: 100, y: 100 }; // Way too big
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // First rect limits: maxX = 20000 / 100 = 200
    // Second rect limits: maxY = 20000 / 200 = 100 → this is the tighter limit
    // So scale is clamped to 100
    expect(clamped.x).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 100);
    expect(clamped.y).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD / 200);
    // Both are same, relative layout preserved (same scale factor)
    expect(clamped.x).toEqual(clamped.y);
  });
});

// TC-04: two notes 100 apart, box width ×2 → 400 wide each, gap 200
describe('TC-04: scaleWithin preserves proportions and gaps', () => {
  it('two 200-unit notes 100 apart, bounding box doubles → gap also doubles', () => {
    const note1 = { x: 0, y: 0, width: 200, height: 200 };
    const note2 = { x: 300, y: 0, width: 200, height: 200 }; // 100 units gap
    
    const bbox = { x: 0, y: 0, width: 500, height: 200 }; // union: 0..500 x 0..200
    const newBbox = { x: 0, y: 0, width: 1000, height: 400 }; // doubled
    
    const n1Scaled = scaleWithin(note1, bbox, newBbox);
    const n2Scaled = scaleWithin(note2, bbox, newBbox);
    
    expect(n1Scaled.width).toBe(400);
    expect(n1Scaled.height).toBe(400);
    expect(n2Scaled.width).toBe(400);
    expect(n2Scaled.height).toBe(400);
    
    // Gap should be 200 (doubled from 100)
    const gapAfter = n2Scaled.x - (n1Scaled.x + n1Scaled.width);
    expect(gapAfter).toBe(200);
  });
});

// TC-05: moveObjects 3 ids with 1 deleted → returns 2
describe('TC-05: moveObjects skips missing id', () => {
  it('returns count of actually moved objects; emits 1 update event', () => {
    const doc = makeDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 100, y: 0 });
    const id3 = createSticky(doc, { x: 200, y: 0 });
    
    // Delete one before moving
    deleteObject(doc, id3);
    
    let updateCount = 0;
    const unsub = (doc.on('update' as any, () => { updateCount++; }) as unknown) as () => void;
    
    const positions = new Map<string, { x: number; y: number }>();
    positions.set(id1, { x: 50, y: 50 });
    positions.set(id2, { x: 150, y: 50 });
    positions.set('nonexistent-id', { x: 999, y: 999 }); // skipped
    
    const result = moveObjects(doc, positions);
    expect(result).toBe(2);
    expect(updateCount).toBe(1);
    
    unsub();
    
    const snaps = snapshot(doc);
    expect(snaps.length).toBe(2); // id3 was deleted
  });
});

// TC-06: bringObjectsToFront 3 overlapping → above unselected, relative z preserved
describe('TC-06: bringObjectsToFront preserves relative order above unselected', () => {
  it('3 selected notes placed above 2 unselected; selected internal order unchanged', () => {
    const doc = makeDoc();
    const idA = createSticky(doc, { x: 0, y: 0 });
    const idB = createSticky(doc, { x: 10, y: 0 });
    const idC = createSticky(doc, { x: 20, y: 0 });
    createSticky(doc, { x: -10, y: 0 }); // idD, unselected
    createSticky(doc, { x: -20, y: 0 }); // idE, unselected
    
    const all = snapshot(doc);
    const selectedIds = [idA, idB, idC];
    
    bringObjectsToFront(doc, selectedIds);
    
    const snapped = snapshot(doc);
    const zs = snapped.map((s) => ({ id: s.id, z: s.z }));
    
    // Unselected should have lower z than selected
    const unselectedZs = zs.filter((z) => !selectedIds.includes(z.id)).map((z) => z.z);
    const selectedZs = zs.filter((z) => selectedIds.includes(z.id)).map((z) => z.z);
    
    const maxUnselectedZ = Math.max(...unselectedZs);
    const minSelectedZ = Math.min(...selectedZs);
    expect(minSelectedZ).toBeGreaterThan(maxUnselectedZ);
    
    // Relative order preserved: A had lowest original z among selected → still lowest
    const relOrder = snapped
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => s.id);
    // Should maintain original creation order (by ascending z)
    expect(relOrder[0]).toBe(idA);
    expect(relOrder[1]).toBe(idB);
    expect(relOrder[2]).toBe(idC);
  });
});

// TC-07: objectsInRect — A fully inside, B partly, C outside → [A]
describe('TC-07: objectsInRect selects only fully-contained objects', () => {
  it('A inside, B partly in, C outside → only A', () => {
    const doc = makeDoc();
    // Sticky centre at (150,150) → bounds (50,50,200,200)
    createSticky(doc, { x: 150, y: 150 });
    // Sticky centre at (350,50) → bounds (250,-50,200,200) – partly in
    createSticky(doc, { x: 350, y: 50 });
    // Sticky centre at (600,600) → far away
    createSticky(doc, { x: 600, y: 600 });
    
    const snaps = snapshot(doc);
    
    // Marquee rect fully containing A (50,50,200,200) but not B or C
    const marquee = { x: 40, y: 40, width: 220, height: 220 }; // spans 40..260 in both axes
    
    const ids = objectsInRect(snaps, marquee);
    expect(ids.length).toBe(1);
    expect(ids[0]).toBe(snaps[0].id); // first note created = A
  });
});

// TC-08: allObjectIds excludes unknown types
describe('TC-08: allObjectIds only returns known registered types', () => {
  it('snapshot already filters unknown types, so allObjectIds matches', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    
    // Inject a truly unknown-type object
    const objects = (doc as any).getMap('objects');
    const fakeMap = new Y.Map();
    (fakeMap as any).set('type', 'phantom');
    (fakeMap as any).set('x', 0);
    (fakeMap as any).set('y', 0);
    (objects as any).set('fake-phantom', fakeMap);
    
    const snaps = snapshot(doc) as import('@shared/board-model').StickySnapshot[];
    const allIds = allObjectIds(snaps);
    
    expect(allIds).toEqual([stickyId]);
  });
});

// TC-09: NaN/Infinity → 0 applied, no transaction
describe('TC-09: invalid coordinates rejected by moveObjects', () => {
  it('moveObjects with NaN/Infinity returns 0', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    const snaps = snapshot(doc);
    
    let updateCount = 0;
    const unsub = (doc.on('update' as any, () => { updateCount++; }) as unknown) as () => void;
    
    const positions = new Map<string, { x: number; y: number }>();
    positions.set(snaps[0].id, { x: NaN, y: 0 });
    const r1 = moveObjects(doc, positions);
    expect(r1).toBe(0);
    expect(updateCount).toBe(0);
    
    positions.set(snaps[0].id, { x: Infinity, y: 0 });
    const r2 = moveObjects(doc, positions);
    expect(r2).toBe(0);
    
    positions.set(snaps[0].id, { x: -Infinity, y: 0 });
    const r3 = moveObjects(doc, positions);
    expect(r3).toBe(0);
    
    positions.set(snaps[0].id, { x: 0, y: NaN });
    const r4 = moveObjects(doc, positions);
    expect(r4).toBe(0);
    
    unsub();
  });

  it('empty position map → 0', () => {
    const doc = makeDoc();
    const positions = new Map<string, { x: number; y: number }>();
    expect(moveObjects(doc, positions)).toBe(0);
  });
});

// TC-10: sticky without width/height uses STICKY_SIZE_WORLD
describe('TC-10: objectBounds fallback and first resize writes fields', () => {
  it('objectBounds uses STICKY_SIZE_WORLD for unwidened stickies', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const snaps = snapshot(doc);
    const bounds = objectBounds(snaps[0]);
    expect(bounds.x).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2);
    expect(bounds.y).toBeCloseTo(100 - STICKY_SIZE_WORLD / 2);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    // No explicit width/height stored
    const dm = (doc as any).getMap('objects').get(id);
    expect(dm.has('width')).toBe(false);
    expect(dm.has('height')).toBe(false);
  });

  it('first resizeObjects writes width and height', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
    rects.set(id, { x: 90, y: 90, width: 220, height: 220 });
    
    resizeObjects(doc, rects);
    
    const snaps = snapshot(doc);
    expect(snaps[0].width).toBe(220);
    expect(snaps[0].height).toBe(220);
    
    const bounds = objectBounds(snaps[0]);
    expect(bounds.width).toBe(220);
    expect(bounds.height).toBe(220);
  });
});

// ─── Additional rectContains tests ─────────────────────────────────

describe('rectContains', () => {
  it('outer completely contains inner', () => {
    expect(rectContains({ x: 0, y: 0, width: 200, height: 200 }, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
  });

  it('inner touches outer edge from inside → true', () => {
    expect(rectContains({ x: 0, y: 0, width: 200, height: 200 }, { x: 0, y: 0, width: 200, height: 200 })).toBe(true);
  });

  it('inner partly outside → false', () => {
    expect(rectContains({ x: 0, y: 0, width: 200, height: 200 }, { x: 100, y: 100, width: 200, height: 200 })).toBe(false);
  });

  it('inner entirely outside → false', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 50, height: 50 })).toBe(false);
  });
});

describe('normalizeRect', () => {
  it('point before point', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 100, y: 200 })).toEqual({ x: 10, y: 20, width: 90, height: 180 });
  });

  it('point after point', () => {
    expect(normalizeRect({ x: 100, y: 200 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 90, height: 190 });
  });

  it('same point → zero rect', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

// ─── Resize handle tests ──────────────────────────────────────────

describe('resizeRect handles', () => {
  it('edge n moves top edge only', () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const r = resizeRect(start, 'n', { x: 0, y: -30 }, false);
    expect(r.y).toBe(-30);
    expect(r.height).toBe(130);
    expect(r.x).toBe(0);
    expect(r.width).toBe(100);
  });

  it('edge e moves right edge only', () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const r = resizeRect(start, 'e', { x: 30, y: 0 }, false);
    expect(r.width).toBe(130);
    expect(r.height).toBe(100);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('corner ne moves both edges', () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const r = resizeRect(start, 'ne', { x: 30, y: -20 }, false);
    expect(r.width).toBe(130);
    expect(r.height).toBe(120);
    expect(r.x).toBe(0);
    expect(r.y).toBe(-20);
  });

  it('aspectLocked nw scales proportionally from opposite anchor', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 };
    const r = resizeRect(start, 'nw', { x: -100, y: -50 }, true);
    // width = 200 - (-100) = 300? No, x += delta.x means 0 + (-100) = -100, width = oldWidth - delta.x = 200 - (-100) = 300
    // Actually: nx = sx + dx = 0 + (-100) = -100; nw = sw - dx = 200 - (-100) = 300
    // Then for aspect locked: h = w * (oldH/oldW) = 300 * 100/200 = 150
    // ny = sy + dy = 0 + (-50) = -50; nh gets adjusted to match aspect
    // Wait, for nw: after adjusting w-based h: nh = nw * (sh/sw) ... 
    // Actually the code does: if corner, after both changed, adjust height based on width
    // nh = nw / (sw/sh) = 300 / (200/100) = 300 / 2 = 150
    // But wait, the code says: for corners, it sets nh = nw / aspect where aspect = sw/sh = 2
    // So nh = 300/2 = 150
    expect(r.width).toBe(300);
    expect(r.height).toBe(150);
  });
});

// ─── Bring to front empty/more edge cases ─────────────────────────

describe('bringObjectsToFront edge cases', () => {
  it('single selected object brought to front', () => {
    const doc = makeDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    
    const beforeSnap = snapshot(doc);
    bringObjectsToFront(doc, [beforeSnap[1].id]);
    
    const afterSnap = snapshot(doc);
    const moved = afterSnap.find((s) => s.id === beforeSnap[1].id);
    expect(moved?.z).toBeGreaterThan(beforeSnap[0].z);
  });

  it('no-selected case returns 0', () => {
    const doc = makeDoc();
    expect(bringObjectsToFront(doc, [])).toBe(0);
  });
});

// ─── deleteObjects tests ──────────────────────────────────────────

describe('deleteObjects', () => {
  it('deletes multiple objects atomically', () => {
    const doc = makeDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 100, y: 0 });
    const id3 = createSticky(doc, { x: 200, y: 0 });
    
    let updateCount = 0;
    const unsub = (doc.on('update' as any, () => { updateCount++; }) as unknown) as () => void;
    
    const result = deleteObjects(doc, [id1, id2]);
    expect(result).toBe(2);
    expect(updateCount).toBe(1);
    
    unsub();
    
    expect(snapshot(doc).length).toBe(1);
  });

  it('skips missing ids', () => {
    const doc = makeDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    
    expect(deleteObjects(doc, [id1, 'nonexistent'])).toBe(1);
    expect(snapshot(doc).length).toBe(0);
  });

  it('empty list returns 0', () => {
    const doc = makeDoc();
    expect(deleteObjects(doc, [])).toBe(0);
  });
});

// ─── scaleWithin tests ────────────────────────────────────────────

describe('scaleWithin', () => {
  it('maps child offset within from→to preserving proportion', () => {
    const child = { x: 10, y: 10, width: 50, height: 30 };
    const from = { x: 0, y: 0, width: 100, height: 100 };
    const to = { x: 0, y: 0, width: 200, height: 200 };
    
    const result = scaleWithin(child, from, to);
    expect(result.x).toBe(20);     // 10/100 * 200
    expect(result.y).toBe(20);     // 10/100 * 200
    expect(result.width).toBe(100); // 50/100 * 200
    expect(result.height).toBe(60);  // 30/100 * 200
  });

  it('zero-size from returns copy unchanged', () => {
    const child = { x: 10, y: 10, width: 50, height: 30 };
    const from = { x: 0, y: 0, width: 0, height: 0 };
    const to = { x: 0, y: 0, width: 100, height: 100 };
    expect(scaleWithin(child, from, to)).toEqual({ x: 10, y: 10, width: 50, height: 30 });
  });
});
