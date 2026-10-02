import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  deleteObject,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  getObjectsMap,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => { n += 1; };
  doc.on('update', handler);
  return () => { doc.off('update', handler); return n; };
}

describe('board-model group — objectBounds', () => {
  it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD fallback', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    // createSticky places centred: x = 100 - 100 = 0, y = 0
    const notes = snapshot(doc);
    const snap = notes.find(n => n.id === id)!;
    // No width/height explicitly stored
    expect(snap.width).toBeUndefined();
    const bounds = objectBounds(snap);
    expect(bounds).toEqual({ x: snap.x, y: snap.y, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });

  it('returns explicit width/height when present', () => {
    const obj: ObjectSnapshot = { id: '1', type: 'sticky', x: 5, y: 10, z: 1, width: 300, height: 400 };
    expect(objectBounds(obj)).toEqual({ x: 5, y: 10, width: 300, height: 400 });
  });
});

describe('board-model group — objectsInRect', () => {
  it('TC-07: A fully inside, B partly, C outside → [A]', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Place notes so we can control positions precisely
    const idA = createSticky(doc, { x: 200, y: 200 }); // x=100,y=100, size=200
    const idB = createSticky(doc, { x: 350, y: 200 }); // x=250,y=100, size=200
    const idC = createSticky(doc, { x: 600, y: 200 }); // x=500,y=100, size=200

    const notes = snapshot(doc);
    // Rectangle that fully contains A (100,100,200,200) but only partially B (250,100,200,200)
    const rect = { x: 50, y: 50, width: 300, height: 300 };
    // A: x=100..300, fully in 50..350 → yes
    // B: x=250..450, 450 > 350 → no
    // C: x=500..700, not inside → no
    const result = objectsInRect(notes, rect);
    expect(result).toContain(idA);
    expect(result).not.toContain(idB);
    expect(result).not.toContain(idC);
  });
});

describe('board-model group — allObjectIds', () => {
  it('TC-08: returns all ids from snapshot', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const ids = allObjectIds(snapshot(doc));
    expect(ids).toHaveLength(2);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  it('TC-08: skips unknown type objects (not in snapshot)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    // Insert an unknown type directly
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'unknown-shape');
      shape.set('x', 10);
      shape.set('y', 10);
      shape.set('z', 99);
      getObjectsMap(doc).set('shape-1', shape);
    });
    const ids = allObjectIds(snapshot(doc));
    expect(ids).toEqual([a]);
  });
});

describe('board-model group — moveObjects', () => {
  it('TC-05: moves 3 ids with 1 deleted → returns 2, one update event', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });
    // Delete b
    deleteObject(doc, b);

    const stop = updateCounter(doc);
    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 10 }],
      [b, { x: 20, y: 20 }], // won't be found
      [c, { x: 30, y: 30 }],
    ]);
    const count = moveObjects(doc, positions);
    expect(count).toBe(2);
    expect(stop()).toBe(1); // one transaction
  });

  it('TC-09: NaN position → returns 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: NaN, y: 0 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(0);
    expect(stop()).toBe(0);
  });

  it('TC-09: Infinity position → returns 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: Infinity, y: 0 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(0);
    expect(stop()).toBe(0);
  });

  it('TC-09: empty map → returns 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — resizeObjects', () => {
  it('TC-10: first resize writes both width and height fields', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    // Before resize: no width/height
    let notes = snapshot(doc);
    expect(notes[0].width).toBeUndefined();

    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      [id, { x: 50, y: 50, width: 300, height: 300 }],
    ]);
    const count = resizeObjects(doc, rects);
    expect(count).toBe(1);

    notes = snapshot(doc);
    expect(notes[0].width).toBe(300);
    expect(notes[0].height).toBe(300);
    expect(notes[0].x).toBe(50);
    expect(notes[0].y).toBe(50);
  });

  it('returns 0 for non-finite values', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      [id, { x: NaN, y: 0, width: 100, height: 100 }],
    ]);
    expect(resizeObjects(doc, rects)).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — bringObjectsToFront', () => {
  it('TC-06: 3 selected above 2 unselected, relative z preserved', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const u1 = createSticky(doc, { x: 0, y: 0 });   // z=1
    const s1 = createSticky(doc, { x: 10, y: 0 });  // z=2
    const u2 = createSticky(doc, { x: 20, y: 0 });  // z=3
    const s2 = createSticky(doc, { x: 30, y: 0 });  // z=4
    const s3 = createSticky(doc, { x: 40, y: 0 });  // z=5

    const stop = updateCounter(doc);
    const count = bringObjectsToFront(doc, [s1, s2, s3]);
    expect(count).toBe(3);
    expect(stop()).toBe(1);

    const notes = snapshot(doc);
    // Unselected z: 1, 3. Max unselected = 3.
    // Selected should get z: 4, 5, 6 (preserving relative order s1 < s2 < s3)
    const zU1 = notes.find(n => n.id === u1)!.z;
    const zS1 = notes.find(n => n.id === s1)!.z;
    const zU2 = notes.find(n => n.id === u2)!.z;
    const zS2 = notes.find(n => n.id === s2)!.z;
    const zS3 = notes.find(n => n.id === s3)!.z;

    expect(zS1).toBeGreaterThan(zU1);
    expect(zS1).toBeGreaterThan(zU2);
    expect(zS2).toBeGreaterThan(zU1);
    expect(zS2).toBeGreaterThan(zU2);
    expect(zS3).toBeGreaterThan(zU1);
    expect(zS3).toBeGreaterThan(zU2);
    // Relative order preserved
    expect(zS1).toBeLessThan(zS2);
    expect(zS2).toBeLessThan(zS3);
  });

  it('returns 0 for empty ids array', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — deleteObjects', () => {
  it('deletes multiple objects in one transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    createSticky(doc, { x: 200, y: 0 });

    const stop = updateCounter(doc);
    const count = deleteObjects(doc, [a, b]);
    expect(count).toBe(2);
    expect(stop()).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('skips missing ids and returns actual count', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    const count = deleteObjects(doc, [a, 'nonexistent']);
    expect(count).toBe(1);
    expect(stop()).toBe(1);
  });

  it('returns 0 for empty ids array', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(stop()).toBe(0);
  });
});
