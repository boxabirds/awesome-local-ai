import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => updates++;
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function seeded(count: number): { doc: Y.Doc; ids: string[] } {
  const doc = freshDoc();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, { x: i * 1000, y: 0 });
    if (typeof id !== 'string') throw new Error('seed failed');
    ids.push(id);
  }
  return { doc, ids };
}

function positions(entries: [string, Point][]): Map<string, Point> {
  return new Map(entries);
}

function rects(entries: [string, Rect][]): Map<string, Rect> {
  return new Map(entries);
}

describe('board.model group operations', () => {
  // TC-05: one of three deleted remotely -> 2 applied, one update event.
  it('TC-05: moveObjects skips remotely deleted ids and emits one update', () => {
    const { doc, ids } = seeded(3);
    deleteObject(doc, ids[1]!);
    let applied = 0;
    const updates = countUpdates(doc, () => {
      applied = moveObjects(
        doc,
        positions([
          [ids[0]!, { x: 50, y: 60 }],
          [ids[1]!, { x: 50, y: 60 }],
          [ids[2]!, { x: 50, y: 60 }],
        ]),
      );
    });
    expect(applied).toBe(2);
    expect(updates).toBe(1);
  });

  it('moveObjects with an empty map returns 0 and emits no update', () => {
    const { doc } = seeded(2);
    expect(countUpdates(doc, () => moveObjects(doc, positions([])))).toBe(0);
    expect(moveObjects(doc, positions([]))).toBe(0);
  });

  // TC-06: three overlapping notes raised above unselected, relative z kept.
  it('TC-06: bringObjectsToFront raises the group above unselected objects', () => {
    const doc = freshDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 }) as string;
    const mid = createSticky(doc, { x: 0, y: 0 }) as string;
    const top = createSticky(doc, { x: 0, y: 0 }) as string;
    const unselected = createSticky(doc, { x: 0, y: 0 }) as string;
    // z order: bottom 1, mid 2, top 3, unselected 4.
    const changed = bringObjectsToFront(doc, [bottom, top, mid]);
    const notes = snapshot(doc);
    const z = (id: string) => notes.find((n) => n.id === id)!.z;
    expect(z(bottom)).toBeLessThan(z(mid));
    expect(z(mid)).toBeLessThan(z(top));
    expect(z(bottom)).toBeGreaterThan(z(unselected));
    expect(changed).toBe(3);
    // already at the front: no further update
    expect(countUpdates(doc, () => bringObjectsToFront(doc, [bottom, mid, top]))).toBe(0);
  });

  it('bringObjectsToFront with no live ids returns 0 and emits no update', () => {
    const { doc } = seeded(1);
    expect(countUpdates(doc, () => bringObjectsToFront(doc, ['missing']))).toBe(0);
  });

  // TC-07: fully / partly / outside -> only the fully inside object.
  it('TC-07: objectsInRect selects only fully enclosed objects', () => {
    const doc = freshDoc();
    const inside = createSticky(doc, { x: 200, y: 200 }) as string; // 100..300
    const partly = createSticky(doc, { x: 290, y: 200 }) as string; // 190..390 crosses right edge
    const outside = createSticky(doc, { x: 500, y: 500 }) as string;
    const marquee: Rect = { x: 100, y: 100, width: 150, height: 150 }; // 100..250
    expect(objectsInRect(snapshot(doc), marquee)).toEqual([]);
    const wide: Rect = { x: 99, y: 99, width: 202, height: 202 }; // 99..301 encloses only `inside`
    expect(objectsInRect(snapshot(doc), wide)).toEqual([inside]);
    expect(objectsInRect(snapshot(doc), { x: -1000, y: -1000, width: 4000, height: 4000 })).toEqual(
      expect.arrayContaining([inside, partly, outside]),
    );
  });

  // TC-08: unknown type present in the doc is excluded from select-all.
  it('TC-08: allObjectIds excludes unknown types', () => {
    const { doc, ids } = seeded(2);
    const shape = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>('objects').set('future-shape', shape);
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    shape.set('z', 99);
    shape.set('createdAt', 1);
    const all = allObjectIds(snapshot(doc));
    expect(all.sort()).toEqual([...ids].sort());
    expect(all).not.toContain('future-shape');
  });

  // TC-09: non-finite coordinates reject the whole call.
  it('TC-09: moveObjects rejects non-finite positions with 0 applied and no transaction', () => {
    const { doc, ids } = seeded(2);
    for (const bad of [NaN, Infinity, -Infinity]) {
      let applied = -1;
      const updates = countUpdates(doc, () => {
        applied = moveObjects(doc, positions([[ids[0]!, { x: bad, y: 0 }]]));
      });
      expect(applied).toBe(0);
      expect(updates).toBe(0);
    }
    // a single bad entry rejects the entire batch
    const applied = moveObjects(
      doc,
      positions([
        [ids[0]!, { x: 1, y: 1 }],
        [ids[1]!, { x: NaN, y: 0 }],
      ]),
    );
    expect(applied).toBe(0);
  });

  it('TC-09 variant: resizeObjects rejects non-finite rect fields', () => {
    const { doc, ids } = seeded(1);
    let applied = -1;
    const updates = countUpdates(doc, () => {
      applied = resizeObjects(doc, rects([[ids[0]!, { x: 0, y: 0, width: Infinity, height: 100 }]]));
    });
    expect(applied).toBe(0);
    expect(updates).toBe(0);
  });

  // TC-10: implicit size fallback, first resize persists width and height.
  it('TC-10: objectBounds falls back to STICKY_SIZE_WORLD; resize writes both fields', () => {
    const { doc, ids } = seeded(1);
    const note = snapshot(doc)[0]!;
    expect(note.width).toBeUndefined();
    expect(objectBounds(note)).toEqual({
      x: note.x,
      y: note.y,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    const applied = resizeObjects(doc, rects([[ids[0]!, { x: 10, y: 20, width: 250, height: 150 }]]));
    expect(applied).toBe(1);
    const resized = snapshot(doc)[0]!;
    expect(resized.width).toBe(250);
    expect(resized.height).toBe(150);
    expect(objectBounds(resized)).toEqual({ x: 10, y: 20, width: 250, height: 150 });
  });

  it('resizeObjects skips missing ids', () => {
    const { doc, ids } = seeded(1);
    const applied = resizeObjects(
      doc,
      rects([
        [ids[0]!, { x: 0, y: 0, width: 120, height: 120 }],
        ['missing', { x: 0, y: 0, width: 100, height: 100 }],
      ]),
    );
    expect(applied).toBe(1);
  });

  it('deleteObjects removes several in one transaction and skips stale ids', () => {
    const { doc, ids } = seeded(3);
    let removed = 0;
    const updates = countUpdates(doc, () => {
      removed = deleteObjects(doc, [ids[0]!, 'missing', ids[2]!]);
    });
    expect(removed).toBe(2);
    expect(updates).toBe(1);
    expect(allObjectIds(snapshot(doc))).toEqual([ids[1]]);
    expect(deleteObjects(doc, [])).toBe(0);
  });
});
