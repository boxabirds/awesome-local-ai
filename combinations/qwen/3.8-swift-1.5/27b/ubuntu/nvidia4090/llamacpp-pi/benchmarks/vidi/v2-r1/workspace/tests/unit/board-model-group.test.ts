import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc, createSticky, snapshot, objectBounds, objectsInRect, allObjectIds,
  moveObjects, resizeObjects, bringObjectsToFront, deleteObjects, LOCAL_ORIGIN,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD } from '@shared/config';
import type { Rect } from '@shared/geometry';

/**
 * Importing the registry registers the `sticky` type (and marks it known to
 * the shared model, so `allObjectIds` accepts it).
 */

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): { count: number; stop: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    get count() { return count; },
    stop: () => doc.off('update', handler),
  };
}

function createNote(doc: Y.Doc, x: number, y: number): string {
  // createSticky centres the note on the point; pass the top-left we want
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
}

describe('sel.geometry_ops (board-model group operations)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05: moveObjects with 3 ids, 1 deleted remotely → returns 2; exactly 1 update event
  it('TC-05: moveObjects skips missing ids and writes one transaction', () => {
    const a = createNote(doc, 0, 0);
    const b = createNote(doc, 300, 0);
    const c = createNote(doc, 600, 0);
    deleteObjects(doc, [b]); // b deleted remotely

    const updates = countUpdates(doc);
    const applied = moveObjects(doc, new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 20 }],
      [b, { x: 100, y: 100 }],
      [c, { x: 200, y: 300 }],
    ]));
    expect(applied).toBe(2);
    expect(updates.count).toBe(1);
    updates.stop();

    const snap = new Map(snapshot(doc).map(o => [o.id, o]));
    expect(snap.get(a)!.x).toBe(10);
    expect(snap.get(a)!.y).toBe(20);
    expect(snap.get(c)!.x).toBe(200);
    expect(snap.get(c)!.y).toBe(300);
    expect(snap.has(b)).toBe(false);
  });

  // TC-06: bringObjectsToFront raises the selection above unselected, relative z preserved
  it('TC-06: bringObjectsToFront puts all selected above unselected keeping relative order', () => {
    const a = createNote(doc, 0, 0);     // z 1
    const b = createNote(doc, 100, 0);   // z 2
    const c = createNote(doc, 200, 0);   // z 3
    const d = createNote(doc, 300, 0);   // z 4
    const e = createNote(doc, 400, 0);   // z 5

    // Select the bottom three (a, b, c); d and e unselected
    const updates = countUpdates(doc);
    const applied = bringObjectsToFront(doc, [a, b, c]);
    expect(applied).toBe(3);
    expect(updates.count).toBe(1);
    updates.stop();

    const snap = new Map(snapshot(doc).map(o => [o.id, o]));
    const za = snap.get(a)!.z, zb = snap.get(b)!.z, zc = snap.get(c)!.z;
    const zd = snap.get(d)!.z, ze = snap.get(e)!.z;
    // All selected above all unselected
    expect(za).toBeGreaterThan(zd);
    expect(za).toBeGreaterThan(ze);
    expect(zb).toBeGreaterThan(zd);
    expect(zb).toBeGreaterThan(ze);
    expect(zc).toBeGreaterThan(zd);
    expect(zc).toBeGreaterThan(ze);
    // Relative order among selected preserved
    expect(za).toBeLessThan(zb);
    expect(zb).toBeLessThan(zc);
  });

  // TC-07: objectsInRect — A fully inside, B partly, C outside → [A]
  it('TC-07: objectsInRect returns only fully-contained objects', () => {
    const a = createNote(doc, 100, 100); // 100..300 × 100..300
    createNote(doc, 280, 100); // 280..480 × 100..300 (partly inside the box)
    createNote(doc, 600, 100); // 600..800 × 100..300 (outside)

    const snap = snapshot(doc);
    const box: Rect = { x: 50, y: 50, width: 300, height: 300 }; // 50..350 × 50..350
    const ids = objectsInRect(snap, box);
    expect(ids).toEqual([a]);
  });

  // TC-08: allObjectIds excludes unknown types
  it('TC-08: allObjectIds skips unregistered object types', () => {
    const a = createNote(doc, 0, 0);
    // Add an object of a type that is not registered
    const objects = doc.getMap('objects');
    const unknown = new Y.Map();
    unknown.set('type', 'mystery');
    unknown.set('x', 0);
    unknown.set('y', 0);
    unknown.set('z', 99);
    unknown.set('createdAt', 0);
    doc.transact(() => {
      objects.set('unknown-1', unknown);
    }, LOCAL_ORIGIN);

    const snap = snapshot(doc);
    expect(allObjectIds(snap)).toEqual([a]);
  });

  // TC-09: NaN/Infinity positions and empty id list → 0, no transaction
  it('TC-09a: moveObjects with NaN position returns 0 with no transaction', () => {
    const a = createNote(doc, 0, 0);
    const updates = countUpdates(doc);
    const applied = moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]));
    expect(applied).toBe(0);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-09b: moveObjects with Infinity position returns 0 with no transaction', () => {
    const a = createNote(doc, 0, 0);
    const updates = countUpdates(doc);
    const applied = moveObjects(doc, new Map([[a, { x: Infinity, y: 0 }]]));
    expect(applied).toBe(0);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-09c: moveObjects with an empty list returns 0 with no transaction', () => {
    const updates = countUpdates(doc);
    const applied = moveObjects(doc, new Map());
    expect(applied).toBe(0);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-09d: resizeObjects with non-finite rect returns 0 with no transaction', () => {
    const a = createNote(doc, 0, 0);
    const updates = countUpdates(doc);
    const applied = resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 100 }]]));
    expect(applied).toBe(0);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('TC-09e: deleteObjects with an empty list returns 0 with no transaction', () => {
    const updates = countUpdates(doc);
    const applied = deleteObjects(doc, []);
    expect(applied).toBe(0);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  // TC-10: sticky without width/height → objectBounds uses STICKY_SIZE_WORLD; first resize writes both
  it('TC-10: objectBounds falls back to STICKY_SIZE_WORLD; resizeObjects writes explicit width and height', () => {
    const a = createNote(doc, 0, 0);
    const snap = snapshot(doc);
    const obj = snap.find(o => o.id === a)!;
    // Created before this story: no explicit width/height in the doc
    const raw = doc.getMap('objects').get(a) as Y.Map<unknown>;
    expect(raw.get('width')).toBeUndefined();
    expect(raw.get('height')).toBeUndefined();

    const bounds = objectBounds(obj);
    expect(bounds).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const updates = countUpdates(doc);
    const applied = resizeObjects(doc, new Map([[a, { x: 10, y: 20, width: 120, height: 120 }]]));
    expect(applied).toBe(1);
    expect(updates.count).toBe(1);
    updates.stop();

    const rawAfter = doc.getMap('objects').get(a) as Y.Map<unknown>;
    expect(rawAfter.get('width')).toBe(120);
    expect(rawAfter.get('height')).toBe(120);

    const snapAfter = snapshot(doc).find(o => o.id === a)!;
    expect(objectBounds(snapAfter)).toEqual({ x: 10, y: 20, width: 120, height: 120 });
  });

  // Supporting behaviour for the gesture
  it('resizeObjects on a missing id skips it and returns 0 when nothing applies', () => {
    const updates = countUpdates(doc);
    const applied = resizeObjects(doc, new Map([['ghost', { x: 0, y: 0, width: 100, height: 100 }]]));
    expect(applied).toBe(0);
    expect(updates.count).toBe(0);
    updates.stop();
  });

  it('snapshot exposes width/height for objects that have them', () => {
    const a = createNote(doc, 0, 0);
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 77, height: 88 }]]));
    const obj = snapshot(doc).find(o => o.id === a)!;
    expect(obj.width).toBe(77);
    expect(obj.height).toBe(88);
  });
});
