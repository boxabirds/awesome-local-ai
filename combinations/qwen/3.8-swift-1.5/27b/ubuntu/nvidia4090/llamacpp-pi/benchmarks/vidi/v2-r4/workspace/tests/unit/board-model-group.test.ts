import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  objectBounds,
  snapshot,
  setRegisteredTypes,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect, Point } from '../../src/shared/geometry';

function countUpdates(doc: Y.Doc): { count: () => number; off: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    count: () => count,
    off: () => { doc.off('update', handler); },
  };
}

describe('board-model group operations', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-05: moveObjects 3 ids with 1 deleted → returns 2; exactly 1 update event
  it('TC-05: moveObjects skips missing ids and returns count of moved', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 100, y: 100 });
    const id3 = createSticky(doc, { x: 200, y: 200 });

    // Delete id2
    deleteObjects(doc, [id2]);

    const positions = new Map<string, Point>([
      [id1, { x: 10, y: 10 }],
      [id2, { x: 20, y: 20 }], // deleted
      [id3, { x: 30, y: 30 }],
    ]);

    const up = countUpdates(doc);
    const result = moveObjects(doc, positions);
    expect(result).toBe(2);
    expect(up.count()).toBe(1); // one transaction
    up.off();

    const snap = snapshot(doc);
    const note1 = snap.find((s) => s.id === id1)!;
    const note3 = snap.find((s) => s.id === id3)!;
    expect(note1.x).toBe(10);
    expect(note1.y).toBe(10);
    expect(note3.x).toBe(30);
    expect(note3.y).toBe(30);
  });

  // TC-06: bringObjectsToFront 3 overlapping selected over 2 unselected
  it('TC-06: bringObjectsToFront raises selection above unselected, preserving relative order', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 });
    const id3 = createSticky(doc, { x: 20, y: 20 });
    const id4 = createSticky(doc, { x: 30, y: 30 });
    const id5 = createSticky(doc, { x: 40, y: 40 });

    // z order: id1=1, id2=2, id3=3, id4=4, id5=5
    // Select id1, id2, id3 (the bottom 3)
    const up = countUpdates(doc);
    const result = bringObjectsToFront(doc, [id1, id2, id3]);
    expect(result).toBe(3);
    expect(up.count()).toBe(1);
    up.off();

    const snap = snapshot(doc);
    const z1 = snap.find((s) => s.id === id1)!.z;
    const z2 = snap.find((s) => s.id === id2)!.z;
    const z3 = snap.find((s) => s.id === id3)!.z;
    const z4 = snap.find((s) => s.id === id4)!.z;
    const z5 = snap.find((s) => s.id === id5)!.z;

    // All selected should be above unselected
    expect(z1).toBeGreaterThan(z4);
    expect(z1).toBeGreaterThan(z5);
    expect(z2).toBeGreaterThan(z4);
    expect(z2).toBeGreaterThan(z5);
    expect(z3).toBeGreaterThan(z4);
    expect(z3).toBeGreaterThan(z5);

    // Relative order preserved: id1 < id2 < id3
    expect(z1).toBeLessThan(z2);
    expect(z2).toBeLessThan(z3);
  });

  // TC-07: objectsInRect: A fully inside, B partly, C outside → [A]
  it('TC-07: objectsInRect returns only fully contained objects', () => {
    // Create objects at specific positions
    const objects = doc.getMap('objects');
    doc.transact(() => {
      // A: fully inside the rect (0,0,100,100)
      const objA = new Y.Map<unknown>();
      objA.set('type', 'sticky');
      objA.set('x', 10);
      objA.set('y', 10);
      objA.set('color', 'yellow');
      objA.set('text', new Y.Text());
      objA.set('z', 1);
      objA.set('createdAt', 0);
      objects.set('a', objA);

      // B: partly inside (extends beyond right edge)
      const objB = new Y.Map<unknown>();
      objB.set('type', 'sticky');
      objB.set('x', 50);
      objB.set('y', 10);
      objB.set('color', 'yellow');
      objB.set('text', new Y.Text());
      objB.set('z', 2);
      objB.set('createdAt', 0);
      objects.set('b', objB);

      // C: outside
      const objC = new Y.Map<unknown>();
      objC.set('type', 'sticky');
      objC.set('x', 200);
      objC.set('y', 200);
      objC.set('color', 'yellow');
      objC.set('text', new Y.Text());
      objC.set('z', 3);
      objC.set('createdAt', 0);
      objects.set('c', objC);
    }, LOCAL_ORIGIN);

    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    // All stickies are 200×200 by default
    const rect: Rect = { x: 0, y: 0, width: 300, height: 300 };
    const result = objectsInRect(snap, rect);

    // A is at (10,10) size 200×200 → extends to (210,210) → inside (0,0,300,300) ✓
    // B is at (50,10) size 200×200 → extends to (250,210) → inside (0,0,300,300) ✓
    // C is at (200,200) size 200×200 → extends to (400,400) → outside (0,0,300,300) ✗
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).not.toContain('c');
  });

  // TC-08: allObjectIds skips unknown types
  it('TC-08: allObjectIds excludes unregistered types', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    // Add an unknown type
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'unknown-type');
      obj.set('x', 50);
      obj.set('y', 50);
      obj.set('z', 1);
      objects.set('unknown-id', obj);
    }, LOCAL_ORIGIN);

    // Set registered types to only 'sticky'
    setRegisteredTypes(new Set(['sticky']));

    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const ids = allObjectIds(snap);
    expect(ids).toContain(id);
    expect(ids).not.toContain('unknown-id');
  });

  // TC-09: NaN/Infinity positions → 0, no transaction
  it('TC-09: moveObjects with NaN positions returns 0 with no transaction', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    const up = countUpdates(doc);
    const positions = new Map<string, Point>([[id, { x: NaN, y: 0 }]]);
    const result = moveObjects(doc, positions);
    expect(result).toBe(0);
    expect(up.count()).toBe(0);
    up.off();
  });

  it('TC-09: moveObjects with Infinity positions returns 0 with no transaction', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    const up = countUpdates(doc);
    const positions = new Map<string, Point>([[id, { x: 0, y: Infinity }]]);
    const result = moveObjects(doc, positions);
    expect(result).toBe(0);
    expect(up.count()).toBe(0);
    up.off();
  });

  it('TC-09: moveObjects with empty id list returns 0 with no transaction', () => {
    const up = countUpdates(doc);
    const result = moveObjects(doc, new Map());
    expect(result).toBe(0);
    expect(up.count()).toBe(0);
    up.off();
  });

  // TC-10: sticky without width/height: objectBounds uses STICKY_SIZE_WORLD;
  // first resizeObjects writes both fields
  it('TC-10: objectBounds falls back to STICKY_SIZE_WORLD for stickies without width/height', () => {
    createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const obj = snap[0] as ObjectSnapshot;

    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();

    const bounds = objectBounds(obj);
    expect(bounds).toEqual({
      x: 100 - STICKY_SIZE_WORLD / 2,
      y: 100 - STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('TC-10: resizeObjects writes width and height fields', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const obj = snap[0] as ObjectSnapshot;
    const bounds = objectBounds(obj);

    // Resize to 300×300
    const rects = new Map<string, Rect>([[id, { x: bounds.x, y: bounds.y, width: 300, height: 300 }]]);
    const result = resizeObjects(doc, rects);
    expect(result).toBe(1);

    const after = snapshot(doc)[0] as ObjectSnapshot;
    expect(after.width).toBe(300);
    expect(after.height).toBe(300);

    // Now objectBounds uses the explicit width/height
    const newBounds = objectBounds(after);
    expect(newBounds.width).toBe(300);
    expect(newBounds.height).toBe(300);
  });

  // Additional: deleteObjects
  it('deleteObjects removes multiple objects', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 100, y: 100 });
    const id3 = createSticky(doc, { x: 200, y: 200 });

    const up = countUpdates(doc);
    const result = deleteObjects(doc, [id1, id2]);
    expect(result).toBe(2);
    expect(up.count()).toBe(1);
    up.off();

    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].id).toBe(id3);
  });

  it('deleteObjects with empty list returns 0', () => {
    const up = countUpdates(doc);
    const result = deleteObjects(doc, []);
    expect(result).toBe(0);
    expect(up.count()).toBe(0);
    up.off();
  });

  it('deleteObjects skips missing ids', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const result = deleteObjects(doc, [id1, 'nonexistent']);
    expect(result).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
