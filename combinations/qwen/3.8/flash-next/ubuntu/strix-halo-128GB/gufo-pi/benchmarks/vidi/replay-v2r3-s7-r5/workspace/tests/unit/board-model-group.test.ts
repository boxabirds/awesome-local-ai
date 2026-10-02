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
  deleteObject,
  getObjectsMap,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';

/** Counts Y.Doc `update` events. */
function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => { n += 1; };
  doc.on('update', handler);
  return () => { doc.off('update', handler); return n; };
}

describe('board-model group — objectBounds (TC-10)', () => {
  it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);
    const bounds = objectBounds(notes[0]);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    expect(bounds.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(bounds.y).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-10: first resizeObjects writes both width and height', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Initially no explicit width/height
    expect(snapshot(doc)[0].width).toBeUndefined();
    expect(snapshot(doc)[0].height).toBeUndefined();

    // Resize
    const rects = new Map([[id, { x: -100, y: -100, width: 300, height: 300 }]]);
    expect(resizeObjects(doc, rects)).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.width).toBe(300);
    expect(after.height).toBe(300);
    expect(after.x).toBe(-100);
    expect(after.y).toBe(-100);
  });
});

describe('board-model group — objectsInRect (TC-07)', () => {
  it('TC-07: A fully inside, B partly, C outside → [A]', () => {
    const doc = new Y.Doc();
    // Note A: at (10,10), size 200 → fully inside rect(0,0,500,500)
    const idA = createSticky(doc, { x: 10 + STICKY_SIZE_WORLD / 2, y: 10 + STICKY_SIZE_WORLD / 2 });
    // Note B: at (400,400), size 200 → partly outside rect(0,0,500,500)
    const idB = createSticky(doc, { x: 400 + STICKY_SIZE_WORLD / 2, y: 400 + STICKY_SIZE_WORLD / 2 });
    // Note C: at (600,600), size 200 → fully outside
    const idC = createSticky(doc, { x: 600 + STICKY_SIZE_WORLD / 2, y: 600 + STICKY_SIZE_WORLD / 2 });

    const snap = snapshot(doc);
    const rect = { x: 0, y: 0, width: 500, height: 500 };
    const result = objectsInRect(snap, rect);

    expect(result).toContain(idA);
    expect(result).not.toContain(idB);
    expect(result).not.toContain(idC);
  });
});

describe('board-model group — allObjectIds (TC-08)', () => {
  it('TC-08: excludes unknown types', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Manually insert an unknown type
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 10);
      shape.set('y', 10);
      getObjectsMap(doc).set('shape-1', shape);
    });

    const snap = snapshot(doc);
    const ids = allObjectIds(snap);
    expect(ids).toContain(id);
    expect(ids).not.toContain('shape-1');
    expect(ids).toHaveLength(1);
  });
});

describe('board-model group — moveObjects (TC-05, TC-09)', () => {
  it('TC-05: moves 3 ids with 1 deleted remotely → returns 2, exactly 1 update event', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });

    // Delete b externally (simulating remote delete)
    deleteObject(doc, b);

    const stop = updateCounter(doc);
    const positions = new Map([
      [a, { x: 10, y: 10 }],
      [b, { x: 20, y: 20 }], // missing — should be skipped
      [c, { x: 30, y: 30 }],
    ]);

    const count = moveObjects(doc, positions);
    expect(count).toBe(2);
    expect(stop()).toBe(1); // exactly one transaction

    const snap = snapshot(doc);
    const noteA = snap.find((n) => n.id === a);
    const noteC = snap.find((n) => n.id === c);
    expect(noteA?.x).toBe(10);
    expect(noteA?.y).toBe(10);
    expect(noteC?.x).toBe(30);
    expect(noteC?.y).toBe(30);
  });

  it('TC-09: NaN positions → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    const positions = new Map([[a, { x: NaN, y: 0 }]]);
    expect(moveObjects(doc, positions)).toBe(0);
    expect(stop()).toBe(0);

    const positions2 = new Map([[a, { x: 0, y: Infinity }]]);
    expect(moveObjects(doc, positions2)).toBe(0);
    expect(stop()).toBe(0);
  });

  it('empty id list → 0, no transaction', () => {
    const doc = Y.Doc.prototype ? new Y.Doc() : new Y.Doc();
    const stop = updateCounter(doc);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — resizeObjects (TC-09)', () => {
  it('NaN/Infinity in rect → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    const rects = new Map([[a, { x: NaN, y: 0, width: 100, height: 100 }]]);
    expect(resizeObjects(doc, rects)).toBe(0);
    expect(stop()).toBe(0);

    const rects2 = new Map([[a, { x: 0, y: 0, width: Infinity, height: 100 }]]);
    expect(resizeObjects(doc, rects2)).toBe(0);
    expect(stop()).toBe(0);
  });

  it('empty map → 0, no transaction', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — bringObjectsToFront (TC-06)', () => {
  it('TC-06: 3 overlapping selected over 2 unselected → all selected above unselected, relative z preserved', () => {
    const doc = new Y.Doc();
    // Create 5 notes, z = 1,2,3,4,5
    const s1 = createSticky(doc, { x: 0, y: 0 });   // z=1
    const s2 = createSticky(doc, { x: 10, y: 0 });  // z=2
    const u1 = createSticky(doc, { x: 20, y: 0 });  // z=3
    const s3 = createSticky(doc, { x: 30, y: 0 });  // z=4
    const u2 = createSticky(doc, { x: 40, y: 0 });  // z=5

    // Select s1, s2, s3; bring to front
    const stop = updateCounter(doc);
    const count = bringObjectsToFront(doc, [s1, s2, s3]);
    expect(stop()).toBe(1);

    const snap = snapshot(doc);
    const zOf = (id: string) => snap.find((n) => n.id === id)!.z;

    // Unselected: u1 z=3, u2 z=5 → maxUnselectedZ = 5
    // Selected sorted by original z: s1(1), s2(2), s3(4)
    // New z: s1 = 6, s2 = 7, s3 = 8
    expect(zOf(s1)).toBe(6);
    expect(zOf(s2)).toBe(7);
    expect(zOf(s3)).toBe(8);
    // Unselected unchanged
    expect(zOf(u1)).toBe(3);
    expect(zOf(u2)).toBe(5);
    // All selected are above all unselected
    expect(zOf(s1)).toBeGreaterThan(zOf(u2));
    // Relative order among selected preserved
    expect(zOf(s1)).toBeLessThan(zOf(s2));
    expect(zOf(s2)).toBeLessThan(zOf(s3));
  });
});

describe('board-model group — deleteObjects', () => {
  it('deletes multiple ids, returns count', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });

    const stop = updateCounter(doc);
    const count = deleteObjects(doc, [a, b]);
    expect(count).toBe(2);
    expect(stop()).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('skips missing ids', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });

    const count = deleteObjects(doc, [a, 'non-existent']);
    expect(count).toBe(1);
  });

  it('empty list → 0, no transaction', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(stop()).toBe(0);
  });
});
