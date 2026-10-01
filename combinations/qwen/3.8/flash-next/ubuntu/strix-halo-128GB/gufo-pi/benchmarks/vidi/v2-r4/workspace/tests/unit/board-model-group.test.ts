import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  snapshot,
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/** Count `update` events emitted by a doc while `fn` runs. */
function countUpdates(doc: Y.Doc, fn: () => void): { updates: number; result: unknown } {
  let updates = 0;
  const listener = () => { updates += 1; };
  doc.on('update', listener);
  try {
    const result = fn();
    return { updates, result };
  } finally {
    doc.off('update', listener);
  }
}

describe('board-model group — moveObjects', () => {
  it('TC-05 moves 3 ids with 1 deleted → returns 2; exactly 1 update event', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 200, y: 0 });
    const id3 = createSticky(doc, { x: 400, y: 0 });
    // Delete id2
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => { objects.delete(id2); }, LOCAL_ORIGIN);

    const positions = new Map<string, { x: number; y: number }>([
      [id1, { x: 10, y: 10 }],
      [id2, { x: 20, y: 20 }], // deleted, should be skipped
      [id3, { x: 30, y: 30 }],
    ]);

    const { updates, result } = countUpdates(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1);

    const snap = snapshot(doc);
    expect(snap.find((n) => n.id === id1)?.x).toBe(10);
    expect(snap.find((n) => n.id === id3)?.x).toBe(30);
  });

  it('TC-09 NaN/Infinity positions → 0 applied, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });

    const badPositions = new Map<string, { x: number; y: number }>([
      [id, { x: NaN, y: 0 }],
    ]);
    const { updates: u1, result: r1 } = countUpdates(doc, () => moveObjects(doc, badPositions));
    expect(r1).toBe(0);
    expect(u1).toBe(0);

    const badPositions2 = new Map<string, { x: number; y: number }>([
      [id, { x: Infinity, y: 0 }],
    ]);
    const { updates: u2, result: r2 } = countUpdates(doc, () => moveObjects(doc, badPositions2));
    expect(r2).toBe(0);
    expect(u2).toBe(0);
  });

  it('empty id list returns 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { updates, result } = countUpdates(doc, () => moveObjects(doc, new Map()));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('board-model group — bringObjectsToFront', () => {
  it('TC-06 brings 3 selected above unselected, preserves relative z', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 }); // z=1
    const id2 = createSticky(doc, { x: 0, y: 0 }); // z=2
    const id3 = createSticky(doc, { x: 0, y: 0 }); // z=3
    const id4 = createSticky(doc, { x: 0, y: 0 }); // z=4
    const id5 = createSticky(doc, { x: 0, y: 0 }); // z=5

    // Select 1, 3, 5 (which have z=1, 3, 5); 2, 4 are unselected (z=2, 4)
    const count = bringObjectsToFront(doc, [id1, id3, id5]);

    const snap = snapshot(doc);
    const zOf = (id: string) => snap.find((n) => n.id === id)?.z ?? 0;

    // All selected must be above max unselected (z=4)
    expect(zOf(id1)).toBeGreaterThan(zOf(id2));
    expect(zOf(id1)).toBeGreaterThan(zOf(id4));
    expect(zOf(id3)).toBeGreaterThan(zOf(id2));
    expect(zOf(id3)).toBeGreaterThan(zOf(id4));
    expect(zOf(id5)).toBeGreaterThan(zOf(id2));
    expect(zOf(id5)).toBeGreaterThan(zOf(id4));

    // Relative order among selected preserved
    expect(zOf(id1)).toBeLessThan(zOf(id3));
    expect(zOf(id3)).toBeLessThan(zOf(id5));

    expect(count).toBeGreaterThan(0);
  });
});

describe('board-model group — deleteObjects', () => {
  it('deletes multiple ids, returns count', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 200, y: 0 });
    const id3 = createSticky(doc, { x: 400, y: 0 });

    const { updates, result } = countUpdates(doc, () => deleteObjects(doc, [id1, id3]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.id).toBe(id2);
  });

  it('skips missing ids', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const { result } = countUpdates(doc, () => deleteObjects(doc, [id1, 'nonexistent']));
    expect(result).toBe(1);
  });

  it('empty list returns 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { updates, result } = countUpdates(doc, () => deleteObjects(doc, []));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('board-model group — objectsInRect', () => {
  it('TC-07 fully inside selected, partly inside and outside not selected', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const idA = createSticky(doc, { x: 150, y: 150 }); // note at (50,50), 200x200
    const idB = createSticky(doc, { x: 350, y: 150 }); // note at (250,50), 200x200
    const idC = createSticky(doc, { x: 900, y: 900 }); // note at (800,800), 200x200

    const snap = snapshot(doc);
    // Rect that fully contains A (50-250,50-250) but only partially B (250-450,50-250)
    const rect: Rect = { x: 40, y: 40, width: 220, height: 220 };
    const ids = objectsInRect(snap, rect);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idB);
    expect(ids).not.toContain(idC);
  });
});

describe('board-model group — allObjectIds', () => {
  it('TC-08 skips unknown type objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    // Add an unknown-type object directly
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      objects.set('shape-1', shape);
    });

    const snap = snapshot(doc); // snapshot already filters unknown types
    const ids = allObjectIds(snap);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });
});

describe('board-model group — resizeObjects', () => {
  it('TC-10 sticky without width/height: objectBounds uses STICKY_SIZE_WORLD; resize writes both fields', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const note = snap[0]!;
    // No width/height fields yet
    expect(note.width).toBeUndefined();
    expect(note.height).toBeUndefined();

    const bounds = objectBounds(note);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);

    // First resize writes both fields
    const rects = new Map<string, Rect>([
      [id, { x: 100, y: 100, width: 300, height: 300 }],
    ]);
    const count = resizeObjects(doc, rects);
    expect(count).toBe(1);

    const snap2 = snapshot(doc);
    const note2 = snap2[0]!;
    expect(note2.width).toBe(300);
    expect(note2.height).toBe(300);
  });

  it('non-finite rect values → 0, no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const rects = new Map<string, Rect>([
      [id, { x: NaN, y: 0, width: 100, height: 100 }],
    ]);
    const { updates, result } = countUpdates(doc, () => resizeObjects(doc, rects));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});
