import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';
import {
  createSticky,
  initDoc,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { ensureTestbox } from '../fixtures/testbox';
import { getObjectType } from '../../src/client/objects/registry';

/**
 * Unit tests for story 7 group operations (TC-05 to TC-10).
 * Real Y.Doc used throughout.
 */

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => { count += 1; };
  doc.on('update', listener);
  try { fn(); } finally { doc.off('update', listener); }
  return count;
}

describe('objectBounds', () => {
  // TC-10: sticky without width/height reads STICKY_SIZE_WORLD
  it('TC-10 uses STICKY_SIZE_WORLD for implicit sizes', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc)[0]!;
    const bounds = objectBounds(snap);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    expect(bounds.x).toBe(snap.x);
    expect(bounds.y).toBe(snap.y);
  });

  it('reads explicit width/height when present', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Write width/height directly.
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const note = objects.get(id)!;
    doc.transact(() => {
      note.set('width', 300);
      note.set('height', 400);
    });
    const snap = snapshot(doc)[0]!;
    const bounds = objectBounds(snap);
    expect(bounds.width).toBe(300);
    expect(bounds.height).toBe(400);
  });
});

describe('objectsInRect', () => {
  // TC-07: A fully inside, B partly, C outside → [A]
  it('TC-07 returns only objects fully inside the rect', () => {
    const doc = createDoc();
    // Place three 200x200 notes.
    const idA = createSticky(doc, { x: 50, y: 50 });   // center: bounds at (50-100, 50-100) = (-50,-50) to (150,150)
    const idB = createSticky(doc, { x: 180, y: 180 }); // center: bounds at (80,80) to (280,280)
    const idC = createSticky(doc, { x: 500, y: 500 }); // center: bounds at (400,400) to (600,600)

    // A: x=-50,y=-50,w=200,h=200 → fully inside (-100,-100) to (300,300)
    // B: x=80,y=80,w=200,h=200 → right edge 280 inside, bottom 280 inside → fully inside
    // C: x=400,y=400,w=200,h=200 → outside
    const rect = { x: -100, y: -100, width: 400, height: 400 };
    const result = objectsInRect(snapshot(doc), rect);
    // A and B are fully inside; C is not.
    expect(result).toContain(idA);
    expect(result).toContain(idB);
    expect(result).not.toContain(idC);
  });

  it('does NOT select an object only partly inside', () => {
    const doc = createDoc();
    // Place a note at center (50,50). Bounds: x=-50,y=-50,w=200,h=200
    const idA = createSticky(doc, { x: 50, y: 50 });
    // Place a note at center (250,50). Bounds: x=150,y=-50,w=200,h=200
    const idB = createSticky(doc, { x: 250, y: 50 });
    // Marquee from 0,0 to 200,200 → A is partially outside (x=-50 < 0), B is partially outside (x+width=350>200)
    const rect = { x: 0, y: 0, width: 200, height: 200 };
    const result = objectsInRect(snapshot(doc), rect);
    // Neither is fully inside because A starts at x=-50.
    expect(result).not.toContain(idA);
    expect(result).not.toContain(idB);
  });

  it('returns empty array when nothing is inside', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 1000, y: 1000 });
    const rect = { x: -100, y: -100, width: 50, height: 50 };
    expect(objectsInRect(snapshot(doc), rect)).toEqual([]);
  });
});

describe('allObjectIds', () => {
  // TC-08: skips unknown types
  it('TC-08 allObjectIds excludes unregistered types', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Add an object of unknown type directly.
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    doc.transact(() => { objects.set('shape-1', shape); });
    // snapshot() already skips unknown types, so allObjectIds on the snapshot won't include it.
    const ids = allObjectIds(snapshot(doc));
    expect(ids).toContain(id);
    expect(ids).not.toContain('shape-1');
  });

  it('a REGISTERED non-sticky type is also dropped by snapshot', () => {
    // Pins the actual rule in `snapshot()`: it filters on `type === 'sticky'`,
    // not on "is this type registered". TC-08 above uses an unregistered
    // 'shape', so on its own it cannot tell those two rules apart -- and only
    // the second one is what stories 9-12 need. This test is the trip wire:
    // it starts failing the day `snapshot()` carries real types, which is the
    // same change that has to teach the renderer to dispatch on
    // `getObjectType` (today App paints every snapshot entry with
    // `<StickyNote>`). See the note on ObjectTypeSpec.Component.
    ensureTestbox();
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const box = new Y.Map<unknown>();
    box.set('type', 'testbox');
    box.set('x', 300);
    box.set('y', 0);
    box.set('z', 1);
    box.set('width', 100);
    box.set('height', 100);
    doc.transact(() => { objects.set('box-1', box); });

    expect(getObjectType('testbox')).toBeDefined();
    // ...and it still never reaches the UI.
    expect(allObjectIds(snapshot(doc))).toEqual([id]);
  });

  it('returns all ids when all are recognized', () => {
    const doc = createDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const ids = allObjectIds(snapshot(doc));
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).toHaveLength(2);
  });
});

describe('moveObjects', () => {
  // TC-05: 3 ids with 1 deleted → returns 2; exactly 1 update event
  it('TC-05 moves present objects and skips missing ids', () => {
    const doc = createDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const c = createSticky(doc, { x: 800, y: 0 });
    // Delete b
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => { objects.delete(b); });

    let count = 0;
    const updates = withUpdateCount(doc, () => {
      const positions = new Map([
        [a, { x: 10, y: 10 }],
        [b, { x: 20, y: 20 }], // missing
        [c, { x: 30, y: 30 }],
      ]);
      count = moveObjects(doc, positions);
    });
    expect(count).toBe(2);
    expect(updates).toBe(1);
  });

  // TC-09: NaN/Infinity → 0 applied, no transaction
  it('TC-09 rejects non-finite positions with no update', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    let count = -1;
    const updates = withUpdateCount(doc, () => {
      const positions = new Map<string, { x: number; y: number }>([
        [id, { x: Number.NaN, y: 0 }],
      ]);
      count = moveObjects(doc, positions);
    });
    expect(count).toBe(0);
    expect(updates).toBe(0);
  });

  it('TC-09 empty id list → 0', () => {
    const doc = createDoc();
    const positions = new Map<string, { x: number; y: number }>();
    expect(moveObjects(doc, positions)).toBe(0);
  });

  it('moves to absolute positions', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const count = moveObjects(doc, new Map([[id, { x: 5, y: 10 }]]));
    expect(count).toBe(1);
    const snap = snapshot(doc)[0]!;
    expect(snap.x).toBe(5);
    expect(snap.y).toBe(10);
  });
});

describe('resizeObjects', () => {
  // TC-10: first resize writes width and height
  it('TC-10 writes both width and height on first resize', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Before resize, width/height should be undefined
    expect(snapshot(doc)[0]!.width).toBeUndefined();
    expect(snapshot(doc)[0]!.height).toBeUndefined();

    const count = resizeObjects(doc, new Map([[id, { x: 10, y: 10, width: 300, height: 300 }]]));
    expect(count).toBe(1);
    const snap = snapshot(doc)[0]!;
    expect(snap.x).toBe(10);
    expect(snap.y).toBe(10);
    expect(snap.width).toBe(300);
    expect(snap.height).toBe(300);
  });

  it('rejects non-positive dimensions', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const count = resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 0, height: 100 }]]));
    expect(count).toBe(0);
  });

  it('rejects non-finite values with no update', () => {
    const doc = createDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    let updates = 0;
    doc.on('update', () => { updates++; });
    const count = resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: Infinity, height: 100 }]]));
    expect(count).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('bringObjectsToFront', () => {
  // TC-06: 3 overlapping selected over 2 unselected → above, relative order preserved
  it('TC-06 raises selected above unselected, keeping relative z', () => {
    const doc = createDoc();
    // Create 5 notes. z will be 1,2,3,4,5.
    const n1 = createSticky(doc, { x: 0, y: 0 });   // z=1
    const n2 = createSticky(doc, { x: 10, y: 10 }); // z=2
    const n3 = createSticky(doc, { x: 20, y: 20 }); // z=3 -- selected
    const n4 = createSticky(doc, { x: 30, y: 30 }); // z=4 -- unselected
    const n5 = createSticky(doc, { x: 40, y: 40 }); // z=5 -- unselected

    // Bring n1,z=1 and n3,z=3 to front. They should go above n5(z=5).
    const count = bringObjectsToFront(doc, [n1, n3]);
    expect(count).toBe(2);

    const snaps = snapshot(doc);
    const zMap = new Map(snaps.map(s => [s.id, s.z]));
    // n2 and n4 and n5 are unselected, max unselected z = 5.
    // Selected: n1 had z=1, n3 had z=3. Preserved relative: n1 < n3.
    // New: n1 → 5+1=6, n3 → 5+2=7
    expect(zMap.get(n1)).toBe(6);
    expect(zMap.get(n3)).toBe(7);
    // Unselected stay the same
    expect(zMap.get(n2)).toBe(2);
    expect(zMap.get(n4)).toBe(4);
    expect(zMap.get(n5)).toBe(5);
  });

  it('returns 0 when selected are already on top', () => {
    const doc = createDoc();
    const n1 = createSticky(doc, { x: 0, y: 0 }); // z=1 -- unselected
    const n2 = createSticky(doc, { x: 10, y: 10 }); // z=2 -- selected (already top)

    let updates = 0;
    doc.on('update', () => { updates++; });
    const count = bringObjectsToFront(doc, [n2]);
    // n2 is already above n1 → no change needed.
    expect(count).toBe(0);
    expect(updates).toBe(0);
  });

  it('returns 0 for empty list', () => {
    const doc = createDoc();
    expect(bringObjectsToFront(doc, [])).toBe(0);
  });
});

describe('deleteObjects', () => {
  it('removes multiple objects in one transaction', () => {
    const doc = createDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const c = createSticky(doc, { x: 800, y: 0 });
    // Delete a and b
    let count = 0;
    const updates = withUpdateCount(doc, () => {
      count = deleteObjects(doc, [a, b]);
    });
    expect(count).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.id).toBe(c);
  });

  it('returns 0 for empty list', () => {
    const doc = createDoc();
    expect(deleteObjects(doc, [])).toBe(0);
  });

  it('skips missing ids', () => {
    const doc = createDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const count = deleteObjects(doc, [a, 'nonexistent']);
    expect(count).toBe(1);
  });
});