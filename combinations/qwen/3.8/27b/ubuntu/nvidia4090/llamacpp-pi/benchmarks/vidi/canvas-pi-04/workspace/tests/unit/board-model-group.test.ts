// Story 7, task 6: generic group-operation unit tests (TC-05 to TC-10).
//
// These run against a REAL Y.Doc. Every mutating call is checked for the exact
// number of `update` events (1 on a real change, 0 on rejection), matching the
// story-2 board-model test discipline.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  createStickyAt,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function updatesIn(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return updates;
}

describe('board.model: moveObjects', () => {
  it('TC-05 moves all present ids; a remotely-deleted id is skipped; one update event', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const c = createSticky(doc, { x: 20, y: 20 });

    // Simulate a remote deleting `b` before the move lands.
    doc.transact(() => {
      doc.getMap('objects').delete(b);
    });

    const positions = new Map([
      [a, { x: 5, y: 5 }],
      [b, { x: 5, y: 5 }], // b no longer exists -> skipped
      [c, { x: 7, y: 7 }],
    ]);
    const updates = updatesIn(doc, () => {
      expect(moveObjects(doc, positions)).toBe(2);
    });
    expect(updates).toBe(1);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(2);
    expect(snap.find((s) => s.id === a)).toMatchObject({ x: 5, y: 5 });
    expect(snap.find((s) => s.id === c)).toMatchObject({ x: 7, y: 7 });
    expect(snap.find((s) => s.id === b)).toBeUndefined();
  });
});

describe('board.model: bringObjectsToFront', () => {
  it('TC-06 raises the selection above unselected objects, preserving relative order', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 10, y: 10 }); // z 2
    const c = createSticky(doc, { x: 20, y: 20 }); // z 3
    const d = createSticky(doc, { x: 30, y: 30 }); // z 4 (unselected)
    const e = createSticky(doc, { x: 40, y: 40 }); // z 5 (unselected, topmost)

    const updates = updatesIn(doc, () => {
      expect(bringObjectsToFront(doc, [a, b, c])).toBeGreaterThan(0);
    });
    expect(updates).toBe(1);

    const z = (id: string): number => snapshot(doc).find((s) => s.id === id)!.z;
    // The whole selection is above every unselected object...
    expect(Math.min(z(a), z(b), z(c))).toBeGreaterThan(Math.max(z(d), z(e)));
    // ...and their relative order is preserved (a was lowest, c highest).
    expect(z(a)).toBeLessThan(z(b));
    expect(z(b)).toBeLessThan(z(c));
  });
});

describe('board.model: objectsInRect (marquee)', () => {
  it('TC-07 fully-inside selected; partly-inside and outside are not', () => {
    const doc = newDoc();
    // Sticky notes are STICKY_SIZE_WORLD (200) square at their top-left.
    const a = createStickyAt(doc, 100, 100); // spans 100..300
    createStickyAt(doc, 300, 50); // spans 300..500 (partly inside)
    createStickyAt(doc, 400, 400); // spans 400..600 (outside)

    const rect = { x: 50, y: 50, width: 300, height: 300 }; // spans 50..350
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
  });
});

describe('board.model: allObjectIds (select all)', () => {
  it('TC-08 excludes unknown types (they never enter the snapshot)', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      doc.getMap('objects').set('shape-1', shape);
    });

    const snap = snapshot(doc);
    expect(snap.map((s) => s.id)).not.toContain('shape-1');
    expect(allObjectIds(snap)).toEqual([sticky]);
  });
});

describe('board.model: group op error paths', () => {
  it('TC-09 non-finite values and empty id lists -> 0, no transaction', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const nanMove = new Map([[id, { x: Number.NaN, y: 0 }]]);
    const infMove = new Map([[id, { x: 0, y: Number.POSITIVE_INFINITY }]]);
    const nanResize = new Map([[id, { x: 0, y: 0, width: Number.NaN, height: 100 }]]);

    expect(
      updatesIn(doc, () => {
        expect(moveObjects(doc, nanMove)).toBe(0);
        expect(moveObjects(doc, infMove)).toBe(0);
        expect(moveObjects(doc, new Map<string, Point>())).toBe(0);
      }),
    ).toBe(0);

    expect(
      updatesIn(doc, () => {
        expect(resizeObjects(doc, nanResize)).toBe(0);
        expect(resizeObjects(doc, new Map<string, Rect>())).toBe(0);
      }),
    ).toBe(0);
  });
});

describe('board.model: objectBounds + first resize', () => {
  it('TC-10 implicit-size sticky falls back to STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    // Before any resize: no explicit width/height.
    const before = snapshot(doc)[0];
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({
      x: before.x,
      y: before.y,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    // First resize writes both width and height, turning it explicit.
    const updates = updatesIn(doc, () => {
      expect(
        resizeObjects(doc, new Map([[id, { x: 10, y: 20, width: 250, height: 250 }]])),
      ).toBe(1);
    });
    expect(updates).toBe(1);

    const after = snapshot(doc)[0];
    expect(after).toMatchObject({ x: 10, y: 20, width: 250, height: 250 });
    expect(objectBounds(after)).toEqual({ x: 10, y: 20, width: 250, height: 250 });
  });
});
