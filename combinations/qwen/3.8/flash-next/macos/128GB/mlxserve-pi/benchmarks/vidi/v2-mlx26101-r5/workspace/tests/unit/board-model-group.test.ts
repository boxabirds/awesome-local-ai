/**
 * Unit tests for the group operations of the board document model (design capability
 * `sel.geometry_ops` / `grp.delete`, cases TC-05 to TC-10).
 *
 * As in story 2, every test runs against a real `Y.Doc` and counts `update` events: a group
 * operation is one transaction or it is a storm of updates on the wire.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  allObjectIds,
  bringObjectsToFront,
  bringToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  OBJECTS_MAP,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  isStickySnapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';

/** Counts `update` events on a doc (attach after `initDoc` to ignore setup). */
function recordUpdates(doc: Y.Doc): { count(): number; origins(): unknown[]; reset(): void } {
  const origins: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    origins.push(origin);
  });
  return {
    count: () => origins.length,
    origins: () => [...origins],
    reset: () => {
      origins.length = 0;
    },
  };
}

/** Writes an object the way a story we have not written yet would: without going through us. */
function writeForeignObject(
  doc: Y.Doc,
  id: string,
  type: string,
  x: number,
  y: number,
  z: number,
): void {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const map = new Y.Map<unknown>();
  map.set('type', type);
  map.set('x', x);
  map.set('y', y);
  map.set('z', z);
  map.set('createdAt', 1000 + z);
  objects.set(id, map);
}

/** A board with a version on it, which is what every board starts life as. */
function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * A note centred on a point — the point a pointer was on, which is what `createSticky` is given, not
 * the top-left of the box it ends up drawing. It answers `false` when it could not write, so the
 * fixture says so too rather than carrying a `false` into an assertion about positions.
 *
 * Every coordinate in this file is the stored top-left unless it says otherwise: a note written at
 * (0, 0) is a 200-unit box that runs from (-100, -100) to (100, 100).
 */
function noteAt(doc: Y.Doc, x: number, y: number): string {
  const id = createSticky(doc, { x, y });
  if (id === false) throw new Error('the fixture could not write a note');
  return id;
}

/** The id at a position in a list the fixture knows the length of. */
function at(ids: readonly string[], index: number): string {
  const id = ids[index];
  if (id === undefined) throw new Error('the fixture ran out of objects');
  return id;
}

/**
 * A note, with the fields only a note has. Story 7 made the snapshot answer for every object, so a
 * test that wants a note's colour or text says which object it means.
 */
const noteWithText = (id: string, objects: readonly ObjectSnapshot[]): StickySnapshot => {
  const found = objects.find((object) => object.id === id);
  if (!found || !isStickySnapshot(found)) throw new Error(`${id} is not a note in the snapshot`);
  return found;
};

/** The snapshot entry of one id. */
const find = (id: string, objects: readonly ObjectSnapshot[]): ObjectSnapshot => {
  const found = objects.find((object) => object.id === id);
  if (!found) throw new Error(`${id} is not in the snapshot`);
  return found;
};

describe('TC-05 moveObjects: a group of objects in one transaction', () => {
  let doc: Y.Doc;
  let updates: ReturnType<typeof recordUpdates>;
  let ids: string[];

  beforeEach(() => {
    doc = board();
    updates = recordUpdates(doc);
    ids = [0, 1, 2].map((n) => noteAt(doc, n * 300, 0));
    updates.reset();
  });

  it('moves all three at once and writes one update', () => {
    const positions = new Map<string, Point>(ids.map((id, n) => [id, { x: 1000 + n * 300, y: 500 }]));
    expect(moveObjects(doc, positions)).toBe(3);
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);
    expect(snapshot(doc).map((object) => [object.x, object.y])).toEqual([
      [1000, 500],
      [1300, 500],
      [1600, 500],
    ]);
  });

  it('reports the objects it could not find and still moves the rest', () => {
    deleteObject(doc, at(ids, 1));
    updates.reset();
    const positions = new Map<string, Point>(ids.map((id, n) => [id, { x: n * 100, y: 0 }]));
    expect(moveObjects(doc, positions)).toBe(2);
    expect(updates.count()).toBe(1);
  });

  it('writes nothing when nothing moved', () => {
    const still: [string, Point][] = snapshot(doc).map((object) => [object.id, { x: object.x, y: object.y }]);
    expect(moveObjects(doc, new Map(still))).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('takes an absolute position, so a second client applying it lands in the same place', () => {
    const positions = new Map<string, Point>([[at(ids, 0), { x: -450.5, y: 12.25 }]]);
    moveObjects(doc, positions);
    const moved = find(at(ids, 0), snapshot(doc));
    expect(moved.x).toBe(-450.5);
    expect(moved.y).toBe(12.25);
  });
});

describe('TC-06 bringObjectsToFront: the dragged group above everything else', () => {
  let doc: Y.Doc;
  let updates: ReturnType<typeof recordUpdates>;
  let ids: string[];

  beforeEach(() => {
    doc = board();
    updates = recordUpdates(doc);
    // Five overlapping notes, one per stacking level.
    ids = [0, 1, 2, 3, 4].map((n) => noteAt(doc, n * 20, 0));
    updates.reset();
  });

  it('lifts three selected notes over the two that stayed', () => {
    const selected = ids.slice(0, 3);
    expect(bringObjectsToFront(doc, selected)).toBe(3);
    expect(updates.count()).toBe(1);
    const objects = snapshot(doc);
    const stayed = objects.filter((object) => !selected.includes(object.id));
    const lifted = objects.filter((object) => selected.includes(object.id));
    for (const note of lifted) {
      for (const other of stayed) expect(note.z).toBeGreaterThan(other.z);
    }
  });

  it('keeps the order the selection had among itself', () => {
    const selected = [at(ids, 0), at(ids, 1), at(ids, 2)];
    bringObjectsToFront(doc, selected);
    const objects = snapshot(doc);
    const z = selected.map((id) => find(id, objects).z);
    // Still in the order they had: the note that was on top of the three stays on top.
    expect(z).toEqual([...z].sort((p, q) => p - q));
    expect(new Set(z).size).toBe(3);
  });

  it('is one call, one transaction, for a group drag', () => {
    bringObjectsToFront(doc, ids);
    // Every note was already on top in the same order: nothing to write.
    expect(updates.count()).toBe(0);
  });

  it('ignores ids that are gone and says how many it actually moved', () => {
    deleteObject(doc, at(ids, 1));
    updates.reset();
    expect(bringObjectsToFront(doc, [at(ids, 0), at(ids, 1), at(ids, 2)])).toBe(2);
    expect(updates.count()).toBe(1);
  });

  it('leaves an empty selection alone', () => {
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('still does what a single-object story asked for', () => {
    // Story 2's function is the same rule with one id in it.
    bringToFront(doc, at(ids, 0));
    expect(find(at(ids, 0), snapshot(doc)).z).toBeGreaterThan(find(at(ids, 4), snapshot(doc)).z);
  });
});

describe('TC-07 objectsInRect: entirely inside, or not at all', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  let c: string;
  let objects: readonly ObjectSnapshot[];

  beforeEach(() => {
    doc = board();
    // A runs (-100,-100)→(100,100), B runs (50,-100)→(250,100) and sticks out of anything that
    // holds A, C is a note on the far side of the board.
    a = noteAt(doc, 0, 0);
    b = noteAt(doc, 150, 0);
    c = noteAt(doc, 900, 900);
    objects = snapshot(doc);
  });

  it('returns the one note that lies wholly inside the marquee', () => {
    // The marquee runs (-150,-150)→(150,150): A is inside it, B's right edge is at 250 and C is miles off.
    expect(objectsInRect(objects, { x: -150, y: -150, width: 300, height: 300 })).toEqual([a]);
  });

  it('returns nothing for a marquee that only covers half of a note', () => {
    // The marquee runs to x = 50, which is A's middle: a note the marquee is standing on is not in it.
    expect(objectsInRect(objects, { x: -150, y: -150, width: 200, height: 300 })).toEqual([]);
  });

  it('keeps the stacking order of what it found', () => {
    expect(objectsInRect(objects, { x: -1000, y: -1000, width: 4000, height: 4000 })).toEqual([
      a,
      b,
      c,
    ]);
  });

  it('grabs the note whose edge the marquee touches, and leaves the one that sticks out', () => {
    // The marquee's right edge is exactly A's right edge, so A is in — touching is inside, which is
    // what a marquee that stops on a note's border means to a user — and B, which runs to 250, is not.
    expect(objectsInRect(objects, { x: -1000, y: -1000, width: 1100, height: 2200 })).toEqual([a]);
  });

  it('says nothing is selected when there are no objects', () => {
    expect(objectsInRect([], { x: 0, y: 0, width: 1000, height: 1000 })).toEqual([]);
  });

  it('is an empty selection for a marquee with no area', () => {
    expect(objectsInRect(objects, { x: 0, y: 0, width: 0, height: 500 })).toEqual([]);
  });
});

describe('TC-08 allObjectIds: select all does not pick up what this build cannot draw', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = board();
    writeForeignObject(doc, 'mystery-1', 'mystery', 10, 10, 1);
  });

  it('skips an object whose type is not in the registry', () => {
    const sticky = noteAt(doc, 0, 0);
    const objects = snapshot(doc);
    // The unknown object is still on the board — it is in the snapshot.
    expect(objects.map((object) => object.id)).toContain('mystery-1');
    expect(allObjectIds(objects)).toEqual([sticky]);
  });

  it('is empty when the only thing on the board is a type we do not know', () => {
    expect(allObjectIds(snapshot(doc))).toEqual([]);
  });
});

describe('TC-09 a position that is not a number is never written', () => {
  let doc: Y.Doc;
  let updates: ReturnType<typeof recordUpdates>;
  let id: string;

  beforeEach(() => {
    doc = board();
    updates = recordUpdates(doc);
    id = noteAt(doc, 5, 7);
    updates.reset();
  });

  it.each<[string, Point]>([
    ['NaN x', { x: Number.NaN, y: 0 }],
    ['NaN y', { x: 0, y: Number.NaN }],
    ['Infinity x', { x: Number.POSITIVE_INFINITY, y: 0 }],
    ['Infinity y', { x: 0, y: Number.POSITIVE_INFINITY }],
  ])('moveObjects with %s writes nothing', (_name, position) => {
    expect(moveObjects(doc, new Map<string, Point>([[id, position]]))).toBe(0);
    expect(updates.count()).toBe(0);
    // Where it was put, still: (5, 7) is the point it was centred on, so the box sits at -95, -93.
    expect(find(id, snapshot(doc))).toMatchObject({ x: -95, y: -93 });
  });

  it('writes nothing for an empty list of positions', () => {
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('writes nothing for an empty list of ids', () => {
    expect(deleteObjects(doc, [])).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('does not delete an object it does not know about', () => {
    expect(deleteObjects(doc, ['never-existed'])).toBe(0);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('leaves the good objects alone in a batch that has one bad position in it', () => {
    const other = noteAt(doc, 0, 0);
    updates.reset();
    expect(
      moveObjects(
        doc,
        new Map<string, Point>([
          [id, { x: 40, y: 40 }],
          [other, { x: Number.NaN, y: 0 }],
        ]),
      ),
    ).toBe(1);
    expect(updates.count()).toBe(1);
    expect(find(id, snapshot(doc)).x).toBe(40);
    // The note whose bad position was skipped has not moved from where the fixture put it.
    expect(find(other, snapshot(doc)).x).toBe(-100);
  });
});

describe('TC-10 size fields: absent means the size the object was born with', () => {
  let doc: Y.Doc;
  let updates: ReturnType<typeof recordUpdates>;
  let id: string;

  beforeEach(() => {
    doc = board();
    updates = recordUpdates(doc);
    id = noteAt(doc, -100, 50);
    updates.reset();
  });

  it('reads STICKY_SIZE_WORLD for a note written before story 7', () => {
    const note = find(id, snapshot(doc));
    expect(note.width).toBeUndefined();
    expect(note.height).toBeUndefined();
    expect(objectBounds(note)).toEqual({
      x: -200,
      y: -50,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('writes both fields on the first resize, and nothing else', () => {
    const rect: Rect = { x: -100, y: 50, width: 260, height: 140 };
    expect(resizeObjects(doc, new Map<string, Rect>([[id, rect]]))).toBe(1);
    expect(updates.count()).toBe(1);
    const note = noteWithText(id, snapshot(doc));
    expect(note).toMatchObject({ x: -100, y: 50, width: 260, height: 140 });
    expect(note.text).toBe('');
  });

  it('writes nothing when the rectangle is already the size it has', () => {
    // A note that has never had a size written down is not "already that size": the first resize is
    // the one that writes the fields, and only the second one has nothing left to say.
    const first = objectBounds(find(id, snapshot(doc)));
    resizeObjects(doc, new Map<string, Rect>([[id, first]]));
    updates.reset();
    const note = objectBounds(find(id, snapshot(doc)));
    expect(note).toEqual({ x: -200, y: -50, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(resizeObjects(doc, new Map<string, Rect>([[id, note]]))).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('refuses a rectangle that is not a number', () => {
    expect(
      resizeObjects(doc, new Map<string, Rect>([[id, { x: 0, y: 0, width: Number.NaN, height: 10 }]])),
    ).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('skips an id that is no longer on the board', () => {
    deleteObject(doc, id);
    updates.reset();
    expect(resizeObjects(doc, new Map<string, Rect>([[id, { x: 0, y: 0, width: 10, height: 10 }]]))).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('keeps the width and height of an object that has them, for a move', () => {
    resizeObjects(doc, new Map<string, Rect>([[id, { x: -100, y: 50, width: 300, height: 120 }]]));
    updates.reset();
    moveObjects(doc, new Map<string, Point>([[id, { x: 0, y: 0 }]]));
    const note = find(id, snapshot(doc));
    expect(note).toMatchObject({ x: 0, y: 0, width: 300, height: 120 });
  });

  it('deletes a group of objects and reports what was there', () => {
    const other = noteAt(doc, 0, 0);
    updates.reset();
    expect(deleteObjects(doc, [id, other, 'gone'])).toBe(2);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
