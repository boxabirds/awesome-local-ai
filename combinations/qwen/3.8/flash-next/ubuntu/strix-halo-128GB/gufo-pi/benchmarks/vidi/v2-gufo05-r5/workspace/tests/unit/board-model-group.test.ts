/**
 * Board-model group operations unit tests (TC-05 to TC-10).
 * Run against a real Y.Doc.
 */
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  allObjectIds,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts update events emitted while fn runs. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => { updates += 1; };
  doc.on('update', listener);
  try { fn(); } finally { doc.off('update', listener); }
  return updates;
}

describe('moveObjects', () => {
  // TC-05: move 3 ids, 1 deleted remotely → returns 2; exactly 1 update event
  test('TC-05: missing ids are skipped, one transaction', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 200, y: 200 });
    const id3 = createSticky(doc, { x: 300, y: 300 });

    // Delete id2 "remotely" (directly from objects map)
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => { objects.delete(id2); });

    const positions = new Map([
      [id1, { x: 50, y: 50 }],
      [id2, { x: 99, y: 99 }],
      [id3, { x: 350, y: 350 }],
    ]);

    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = moveObjects(doc, positions); });

    expect(result).toBe(2); // id2 was skipped
    expect(updates).toBe(1); // one transaction

    const notes = snapshot(doc);
    expect(notes.find((n) => n.id === id1)?.x).toBe(50);
    expect(notes.find((n) => n.id === id3)?.x).toBe(350);
  });

  // TC-09: NaN/Infinity positions → 0 applied, no transaction
  test('TC-09a: NaN position returns 0, no transaction', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const positions = new Map([[id1, { x: NaN, y: 100 }]]);
    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = moveObjects(doc, positions); });
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  test('TC-09b: Infinity position returns 0, no transaction', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const positions = new Map([[id1, { x: Infinity, y: 100 }]]);
    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = moveObjects(doc, positions); });
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  test('TC-09c: empty id list returns 0, no transaction', () => {
    const doc = newDoc();
    createSticky(doc, { x: 100, y: 100 });
    const positions = new Map<string, { x: number; y: number }>();
    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = moveObjects(doc, positions); });
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('bringObjectsToFront', () => {
  // TC-06: 3 overlapping selected over 2 unselected → all selected z above, relative order kept
  test('TC-06: selected raised above unselected, relative z preserved', () => {
    const doc = newDoc();
    // Create 5 notes with specific z order: a(1), b(2), c(3), d(4), e(5)
    const idA = createSticky(doc, { x: 0, y: 0 });
    const idB = createSticky(doc, { x: 10, y: 10 });
    const idC = createSticky(doc, { x: 20, y: 20 });
    const idD = createSticky(doc, { x: 30, y: 30 });
    const idE = createSticky(doc, { x: 40, y: 40 });

    // Selected: A, C, E. Unselected: B, D.
    // Before: A=1, B=2, C=3, D=4, E=5
    // After bringToFront([A, C, E]): max unselected z = 4 (D)
    // Selected sorted by z: A(1), C(3), E(5)
    // New: A=5, C=6, E=7
    bringObjectsToFront(doc, [idA, idC, idE]);

    const notes = snapshot(doc);
    const zMap = new Map(notes.map((n) => [n.id, n.z]));

    // All selected must be above unselected
    const maxUnselected = Math.max(zMap.get(idB)!, zMap.get(idD)!);
    expect(zMap.get(idA)!).toBeGreaterThan(maxUnselected);
    expect(zMap.get(idC)!).toBeGreaterThan(maxUnselected);
    expect(zMap.get(idE)!).toBeGreaterThan(maxUnselected);

    // Relative order among selected preserved: A < C < E
    expect(zMap.get(idA)!).toBeLessThan(zMap.get(idC)!);
    expect(zMap.get(idC)!).toBeLessThan(zMap.get(idE)!);
  });

  test('empty ids list returns 0', () => {
    const doc = newDoc();
    expect(bringObjectsToFront(doc, [])).toBe(0);
  });
});

describe('objectsInRect', () => {
  // TC-07: A fully inside, B partly, C outside → [A]
  test('TC-07: only fully contained objects returned', () => {
    const doc = newDoc();
    // Notes are 200×200 by default
    const idA = createSticky(doc, { x: 150, y: 150 }); // rect: (50,50,200,200) — inside marquee
    const idB = createSticky(doc, { x: 350, y: 150 }); // rect: (250,50,200,200) — right edge at 450, outside marquee(400)
    const idC = createSticky(doc, { x: 600, y: 600 }); // rect: (500,500,200,200) — fully outside

    const marquee: Rect = { x: 0, y: 0, width: 400, height: 400 };
    const snap = snapshot(doc);
    const result = objectsInRect(snap, marquee);

    expect(result).toContain(idA);
    expect(result).not.toContain(idB);
    expect(result).not.toContain(idC);
    expect(result.length).toBe(1);
  });
});

describe('allObjectIds', () => {
  // TC-08: skips unknown type
  test('TC-08: unknown types not included', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 200, y: 200 });

    // Write an unknown type directly into the objects map
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const raw = new Y.Map<unknown>();
    doc.transact(() => {
      raw.set('type', 'unknown_future_type');
      raw.set('x', 500);
      raw.set('y', 500);
      raw.set('z', 99);
      objects.set('unknown-id', raw);
    });

    const snap = snapshot(doc);
    const ids = allObjectIds(snap);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).not.toContain('unknown-id');
  });
});

describe('resizeObjects', () => {
  // TC-10: sticky without width/height reads STICKY_SIZE_WORLD; first resize writes both fields
  test('TC-10: implicit size fallback and explicit write', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 }); // no width/height written
    const snap = snapshot(doc);
    const note = snap.find((n) => n.id === id)!;

    // objectBounds reads STICKY_SIZE_WORLD when width/height absent
    const bounds = objectBounds(note);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);

    // First resize writes both fields
    const rects = new Map([[id, { x: 100, y: 100, width: 300, height: 300 }]]);
    const count = resizeObjects(doc, rects);
    expect(count).toBe(1);

    const snap2 = snapshot(doc);
    const note2 = snap2.find((n) => n.id === id)!;
    expect(note2.width).toBe(300);
    expect(note2.height).toBe(300);
    expect(objectBounds(note2).width).toBe(300);
  });

  test('non-finite rect values → 0, no transaction', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const rects = new Map([[id, { x: NaN, y: 0, width: 100, height: 100 }]]);
    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = resizeObjects(doc, rects); });
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  test('empty map returns 0, no transaction', () => {
    const doc = newDoc();
    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = resizeObjects(doc, new Map()); });
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('deleteObjects', () => {
  test('deletes existing objects, skips missing', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 200, y: 200 });

    const count = deleteObjects(doc, [id1, id2, 'nonexistent']);
    expect(count).toBe(2);
    expect(snapshot(doc).length).toBe(0);
  });

  test('empty list returns 0, no transaction', () => {
    const doc = newDoc();
    let updates = 0;
    let result = 0;
    updates = countUpdates(doc, () => { result = deleteObjects(doc, []); });
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});
