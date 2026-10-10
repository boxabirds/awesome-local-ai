/**
 * Group operations on the board document (story 7, TC-05 to TC-10).
 *
 * These are the two things every selection gesture ends in: one transaction
 * that moves/resize/deletes a *list* of objects, and the rectangle maths that
 * decides which objects a gesture means. The reason they are tested here, on a
 * real `Y.Doc` rather than against a mock, is that the whole story rests on
 * "a person who moved six notes at once sent one update" — and the only way to
 * say that is to count the updates a document produces.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  bringToFront,
  deleteObject,
  deleteObjects,
  getStickyText,
  moveObject,
  moveObjects,
  objectBounds,
  objectsInRect,
  objectSnapshots,
  resizeObjects,
  snapshot,
  OBJECTS_KEY,
  STICKY_TYPE,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { rectContains, scaleWithin } from '../../src/shared/geometry';
import type { Point, Rect } from '../../src/shared/geometry';

/** Drop a note so its top-left corner — what the board stores — is at `x,y`. */
const drop = (doc: Y.Doc, x: number, y: number): string => {
  let id = '';
  doc.transact(() => {
    const centre = { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 };
    const created = createSticky(doc, centre);
    if (typeof created !== 'string') throw new Error('the board refused a note');
    id = created;
  });
  return id;
};

const entries = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);

const stored = (doc: Y.Doc, id: string): Record<string, unknown> => {
  const entry = entries(doc).get(id);
  if (!entry) throw new Error(`${id} is not on the board`);
  return entry.toJSON();
};

const positions = (doc: Y.Doc, ids: readonly string[]): Array<{ x: number; y: number }> =>
  ids.map((id) => ({ x: stored(doc, id).x as number, y: stored(doc, id).y as number }));

const zOf = (doc: Y.Doc, id: string): number => stored(doc, id).z as number;

/** Count the updates a document would put on the wire. */
function countUpdates(doc: Y.Doc, run: () => void): number {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return updates;
}

/** An object of a type this build does not know, as a later story would add. */
function plantUnknownType(doc: Y.Doc, id: string, type: string, x: number, y: number): void {
  const objects = entries(doc);
  doc.transact(() => {
    const shape = new Y.Map<unknown>();
    shape.set('type', type);
    shape.set('x', x);
    shape.set('y', y);
    shape.set('z', 100);
    shape.set('createdAt', 10);
    shape.set('width', STICKY_SIZE_WORLD);
    shape.set('height', STICKY_SIZE_WORLD);
    objects.set(id, shape);
  });
}

describe('moveObjects (sel.group_move)', () => {
  it('TC-05: moving a group writes every position in exactly one update', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    const c = drop(doc, 600, 0);
    deleteObject(doc, b); // deleted between gesture start and now: skipped

    const moved = new Map<string, Point>([
      [a, { x: 40, y: 20 }],
      [b, { x: 340, y: 20 }],
      [c, { x: 640, y: 20 }],
    ]);

    const updates = countUpdates(doc, () => {
      expect(moveObjects(doc, moved)).toBe(2);
    });
    expect(updates).toBe(1);
    expect(positions(doc, [a, c])).toEqual([
      { x: 40, y: 20 },
      { x: 640, y: 20 },
    ]);
    expect(snapshot(doc).map((note) => note.id)).toEqual([a, c]);
  });

  it('TC-09: a position that is not a number writes nothing, and neither does an empty list', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const before = stored(doc, a);

    const nonsense = new Map<string, Point>([[a, { x: Number.NaN, y: 5 }]]);
    expect(countUpdates(doc, () => expect(moveObjects(doc, nonsense)).toBe(0))).toBe(0);
    const infinity = new Map<string, Point>([[a, { x: 5, y: Number.POSITIVE_INFINITY }]]);
    expect(countUpdates(doc, () => expect(moveObjects(doc, infinity)).toBe(0))).toBe(0);
    expect(countUpdates(doc, () => expect(moveObjects(doc, new Map())).toBe(0))).toBe(0);
    // Unknown ids alone are not a reason to refuse the call, but there is
    // nothing to write, so nothing happens.
    const missing = new Map<string, Point>([['gone', { x: 9, y: 9 }]]);
    expect(countUpdates(doc, () => expect(moveObjects(doc, missing)).toBe(0))).toBe(0);

    expect(stored(doc, a)).toEqual(before);
  });

  it('a position nobody moved is not written, and costs no traffic', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const moved = new Map<string, Point>([[a, { x: 0, y: 0 }]]);
    expect(countUpdates(doc, () => expect(moveObjects(doc, moved)).toBe(0))).toBe(0);
  });

  it('an object another person deleted mid-gesture is skipped without stopping the rest', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    deleteObject(doc, b);
    const moved = new Map<string, Point>([
      [a, { x: 10, y: 10 }],
      [b, { x: 310, y: 10 }],
    ]);
    expect(moveObjects(doc, moved)).toBe(1);
    expect(positions(doc, [a])).toEqual([{ x: 10, y: 10 }]);
  });

  it('moveObject is the same write with one id (story 2 keeps working)', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    expect(moveObject(doc, a, 12, 13)).toBe(true);
    expect(positions(doc, [a])).toEqual([{ x: 12, y: 13 }]);
    expect(moveObject(doc, 'gone', 1, 1)).toBe(false);
    expect(moveObject(doc, a, Number.NaN, 1)).toBe(false);
    expect(moveObject(doc, a, 12, 13)).toBe(false); // already there: no transaction
  });
});

describe('bringObjectsToFront (sel.group_move)', () => {
  it('TC-06: a group drag puts every dragged note above everything it does not contain', () => {
    const doc = new Y.Doc();
    const dragged = [drop(doc, 0, 0), drop(doc, 100, 0), drop(doc, 200, 0)];
    const untouched = [drop(doc, 5000, 0), drop(doc, 5500, 0)];

    expect(countUpdates(doc, () => expect(bringObjectsToFront(doc, dragged)).toBe(3))).toBe(1);

    const highestUnselected = Math.max(...untouched.map((id) => zOf(doc, id)));
    for (const id of dragged) expect(zOf(doc, id)).toBeGreaterThan(highestUnselected);
    // Their order among themselves is the order they were in.
    const zBefore = dragged.map((id) => zOf(doc, id));
    expect([...zBefore].sort((l, r) => l - r)).toEqual(zBefore);
    // The notes nobody touched kept their own stacking.
    expect(untouched.map((id) => zOf(doc, id))).toEqual([4, 5]);
  });

  it('a selection already above everything is left alone, without a transaction', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    const before = zOf(doc, b);
    expect(countUpdates(doc, () => expect(bringObjectsToFront(doc, [b])).toBe(0))).toBe(0);
    expect(zOf(doc, b)).toBe(before);
    expect(countUpdates(doc, () => expect(bringObjectsToFront(doc, [])).toBe(0))).toBe(0);
    // An id nobody has is not a reason to fail.
    expect(bringObjectsToFront(doc, ['gone', b])).toBe(0);
    // bringToFront, the single-object version story 2 used, still works.
    expect(bringToFront(doc, a)).toBe(true);
    expect(bringToFront(doc, a)).toBe(false);
  });
});

describe('objectsInRect (sel.marquee)', () => {
  it('TC-07: only the object lying entirely inside is selected', () => {
    const doc = new Y.Doc();
    const inside = drop(doc, 0, 0); // 0,0 → 200,200
    const partly = drop(doc, 300, 0); // reaches 500: past the box's right edge
    const outside = drop(doc, 1000, 1000);
    const touching = drop(doc, 400, 0); // its left edge touches the box's right edge

    const rect: Rect = { x: 0, y: 0, width: 400, height: 400 };
    expect(objectsInRect(objectSnapshots(doc), rect)).toEqual([inside]);
    // …and that is the same answer rectContains gives, object by object.
    const notes = objectSnapshots(doc);
    expect(
      notes.filter((object) => rectContains(rect, objectBounds(object))).map((object) => object.id),
    ).toEqual([inside]);
    expect(notes.map((object) => object.id)).toContain(touching);
    expect(objectsInRect(notes, rect)).not.toContain(outside);
    expect(objectsInRect(notes, rect)).not.toContain(partly);
    expect(objectsInRect(notes, rect)).not.toContain(touching);
  });

  it('an empty rectangle and an empty selection say so', () => {
    const doc = new Y.Doc();
    drop(doc, 0, 0);
    expect(objectsInRect(objectSnapshots(doc), { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(objectsInRect([], { x: 0, y: 0, width: 400, height: 400 })).toEqual([]);
  });
});

describe('allObjectIds and objectSnapshots (sel.all, sel.all_types)', () => {
  it('TC-08: select-all never claims an object of an unknown type', () => {
    const doc = new Y.Doc();
    const sticky = drop(doc, 0, 0);
    plantUnknownType(doc, 'shape-1', 'shape', 500, 0);

    // The renderer still needs to see every object it can draw.
    expect(new Set(objectSnapshots(doc).map((object) => object.id))).toEqual(new Set(['shape-1', sticky]));
    // The model can read stickies; a type it cannot read is not selectable.
    expect(allObjectIds(objectSnapshots(doc))).toEqual([sticky]);

    // A build that knows the other type (its registry does, in the component
    // tests) may select it: the predicate is what "this build knows" means.
    const knowsShapes = (type: string): boolean => type === STICKY_TYPE || type === 'shape';
    expect(new Set(allObjectIds(objectSnapshots(doc), knowsShapes))).toEqual(
      new Set(['shape-1', sticky]),
    );

    // `snapshot` itself stays sticky-only, which is why the app's existing note
    // views did not change when the generic view appeared beside it.
    expect(snapshot(doc).map((note) => note.id)).toEqual([sticky]);
  });

  it('an empty board has nothing to select', () => {
    const doc = new Y.Doc();
    expect(objectSnapshots(doc)).toEqual([]);
    expect(allObjectIds(objectSnapshots(doc))).toEqual([]);
  });
});

describe('objectBounds and resizeObjects (TC-10, sel.resize)', () => {
  it('TC-10: an unresized note keeps its default size; the first resize writes both sides', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const [note] = snapshot(doc);

    expect(note?.width).toBeUndefined();
    expect(note?.height).toBeUndefined();
    expect(objectBounds(note!)).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(stored(doc, a)).not.toHaveProperty('width');

    const rects = new Map<string, Rect>([[a, { x: 10, y: 20, width: 300, height: 300 }]]);
    expect(countUpdates(doc, () => expect(resizeObjects(doc, rects)).toBe(1))).toBe(1);

    expect(stored(doc, a).width).toBe(300);
    expect(stored(doc, a).height).toBe(300);
    const [grown] = snapshot(doc);
    expect(objectBounds(grown!)).toEqual({ x: 10, y: 20, width: 300, height: 300 });
  });

  it('a rectangle that is not a rectangle is refused, in full, with no transaction', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    const before = [stored(doc, a), stored(doc, b)];

    const nonsense = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 400, height: 400 }],
      [b, { x: 0, y: 0, width: 0, height: 400 }], // not a box
    ]);
    expect(countUpdates(doc, () => expect(resizeObjects(doc, nonsense)).toBe(0))).toBe(0);
    const nan = new Map<string, Rect>([[a, { x: Number.NaN, y: 0, width: 400, height: 400 }]]);
    expect(countUpdates(doc, () => expect(resizeObjects(doc, nan)).toBe(0))).toBe(0);
    expect(countUpdates(doc, () => expect(resizeObjects(doc, new Map())).toBe(0))).toBe(0);

    expect([stored(doc, a), stored(doc, b)]).toEqual(before);
  });

  it('resizing what is left of a group is one update, and skips what another person deleted', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    deleteObject(doc, b);
    const rects = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 100, height: 100 }],
      [b, { x: 300, y: 0, width: 100, height: 100 }],
    ]);
    expect(countUpdates(doc, () => expect(resizeObjects(doc, rects)).toBe(1))).toBe(1);
    expect(objectBounds(snapshot(doc)[0]!).width).toBe(100);
  });

  it('scaleWithin is what keeps the layout of a group while it is resized', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    const notes = objectSnapshots(doc);
    const from = { x: 0, y: 0, width: 500, height: 200 };
    const to = { x: 0, y: 0, width: 1000, height: 400 };
    const rects = new Map<string, Rect>(
      notes.map((note): [string, Rect] => [note.id, scaleWithin(objectBounds(note), from, to)]),
    );
    expect(resizeObjects(doc, rects)).toBe(2);
    const grown = objectSnapshots(doc);
    expect(grown.map((object) => objectBounds(object))).toEqual([
      { x: 0, y: 0, width: 400, height: 400 },
      { x: 600, y: 0, width: 400, height: 400 },
    ]);
    expect(grown.map((object) => object.id)).toEqual([a, b]);
  });
});

describe('deleteObjects (sel.group_delete)', () => {
  it('TC-05 shape: one update for the whole deletion, missing ids skipped', () => {
    const doc = new Y.Doc();
    const a = drop(doc, 0, 0);
    const b = drop(doc, 300, 0);
    const c = drop(doc, 600, 0);
    getStickyText(doc, c)!.insert(0, 'keep me');

    const deleted = countUpdates(doc, () => expect(deleteObjects(doc, [a, 'gone', b])).toBe(2));
    expect(deleted).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([c]);
    expect(getStickyText(doc, c)!.toString()).toBe('keep me');
    expect(countUpdates(doc, () => expect(deleteObjects(doc, [])).toBe(0))).toBe(0);
    expect(countUpdates(doc, () => expect(deleteObjects(doc, ['gone'])).toBe(0))).toBe(0);
  });

  it('deleting an object of an unknown type is allowed: it is on the board', () => {
    const doc = new Y.Doc();
    plantUnknownType(doc, 'shape-1', 'shape', 0, 0);
    expect(deleteObjects(doc, ['shape-1'])).toBe(1);
    expect(objectSnapshots(doc)).toEqual([]);
  });
});
