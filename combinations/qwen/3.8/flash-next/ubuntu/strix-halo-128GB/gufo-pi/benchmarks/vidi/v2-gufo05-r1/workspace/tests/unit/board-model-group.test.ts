/**
 * Generic group operations on the board document (`sel.geometry_ops`, TC-05 to
 * TC-10).
 *
 * A real `Y.Doc` again: these functions are the write path every gesture ends up
 * on, and the count they return plus the number of update events they produce is
 * what story 3 syncs and story 8 will undo. The error paths matter as much as the
 * happy ones — an invalid value must not reach the wire at all.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObject,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';

function updateCounter(doc: Y.Doc): () => number {
  let count = 0;
  const origins: unknown[] = [];
  doc.on('update', (_update: unknown, origin: unknown) => {
    count += 1;
    origins.push(origin);
  });
  const counter = () => count;
  counter.origins = origins;
  return counter;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function byId(doc: Y.Doc, id: string) {
  return snapshot(doc).find((note) => note.id === id);
}

/** Put an object of a type this build does not know into the document. */
function insertUnknownObject(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 10);
    shape.set('y', 20);
    objectsMap(doc).set(id, shape);
  });
}

function positions(entries: readonly (readonly [string, Point])[]): Map<string, Point> {
  return new Map(entries);
}

function rects(entries: readonly (readonly [string, Rect])[]): Map<string, Rect> {
  return new Map(entries);
}

describe('objectBounds', () => {
  it('is the rectangle the object itself carries when the size is explicit', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 110, y: 120 });
    resizeObjects(doc, rects([[id, { x: 10, y: 20, width: 320, height: 240 }]]));

    const note = byId(doc, id)!;
    expect(objectBounds(note)).toEqual({ x: 10, y: 20, width: 320, height: 240 });
    // The snapshot carries the size, so nothing has to guess it a second time.
    expect(note.width).toBe(320);
    expect(note.height).toBe(240);
  });
});

describe('TC-07 objectsInRect', () => {
  let doc: Y.Doc;
  let inside: string;
  let partial: string;
  let outside: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    // A 200-unit note fully inside a marquee of 0,0 → 500,500; one that hangs over
    // its right edge; one that is nowhere near it.
    inside = createSticky(doc, { x: 200, y: 200 }); // 100..300
    partial = createSticky(doc, { x: 450, y: 200 }); // 350..550 — 50 units outside
    outside = createSticky(doc, { x: 2000, y: 2000 });
  });

  it('TC-07 selects the object entirely inside and not the one merely touched', () => {
    const found = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 500, height: 500 });
    expect(found).toEqual([inside]);
    expect(found).not.toContain(partial);
    expect(found).not.toContain(outside);
  });

  it('selects every object the rectangle encloses, in snapshot order', () => {
    const found = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 3000, height: 3000 });
    expect(found).toEqual([inside, partial, outside]);
  });

  it('selects nothing for a rectangle that touches an object from outside', () => {
    // Its right edge is exactly the note's left edge: touching is not enclosing.
    expect(objectsInRect(snapshot(doc), { x: -100, y: 100, width: 200, height: 200 })).toEqual([]);
  });

  it('selects nothing for an empty document', () => {
    const empty = new Y.Doc();
    initDoc(empty);
    expect(objectsInRect(snapshot(empty), { x: 0, y: 0, width: 500, height: 500 })).toEqual([]);
  });
});

describe('TC-08 allObjectIds', () => {
  it('names every selectable object and skips a type this build does not know', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const first = createSticky(doc, { x: 0, y: 0 });
    insertUnknownObject(doc, 'shape-1');
    const second = createSticky(doc, { x: 300, y: 0 });

    expect(allObjectIds(snapshot(doc))).toEqual([first, second]);
  });

  it('is empty for an empty board, so select-all has nothing to do', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(allObjectIds(snapshot(doc))).toEqual([]);
  });
});

describe('moveObjects', () => {
  let doc: Y.Doc;
  let ids: string[];

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ids = [
      createSticky(doc, { x: 0, y: 0 }),
      createSticky(doc, { x: 300, y: 0 }),
      createSticky(doc, { x: 600, y: 0 }),
    ];
  });

  it('moves every object to its absolute position in one transaction', () => {
    const updates = updateCounter(doc);
    const changed = moveObjects(
      doc,
      positions([
        [ids[0]!, { x: 0, y: 0 }],
        [ids[1]!, { x: 400, y: 50 }],
        [ids[2]!, { x: 800, y: 100 }],
      ]),
    );
    expect(changed).toBe(3);
    expect(byId(doc, ids[1]!)).toMatchObject({ x: 400, y: 50 });
    expect(byId(doc, ids[2]!)).toMatchObject({ x: 800, y: 100 });
    expect(updates()).toBe(1);
  });

  // TC-05
  it('TC-05 skips an object deleted in the meantime and still moves the rest, once', () => {
    deleteObject(doc, ids[1]!);
    // Counted from here: the delete has its own update, the move must have exactly
    // one for two objects.
    const updates = updateCounter(doc);
    const changed = moveObjects(
      doc,
      positions([
        [ids[0]!, { x: 10, y: 10 }],
        [ids[1]!, { x: 20, y: 20 }],
        [ids[2]!, { x: 30, y: 30 }],
      ]),
    );
    expect(changed).toBe(2);
    expect(byId(doc, ids[0]!)).toMatchObject({ x: 10, y: 10 });
    expect(byId(doc, ids[2]!)).toMatchObject({ x: 30, y: 30 });
    expect(updates()).toBe(1);
  });

  // TC-09 (error path)
  it('TC-09 writes nothing for a position that is not a number, and for no ids at all', () => {
    const updates = updateCounter(doc);
    expect(moveObjects(doc, positions([[ids[0]!, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, positions([[ids[0]!, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(moveObjects(doc, positions([[ids[0]!, { x: Number.NEGATIVE_INFINITY, y: 5 }]]))).toBe(0);
    // One bad position among good ones rejects the whole call: a gesture must not
    // half-apply a frame.
    expect(
      moveObjects(
        doc,
        positions([
          [ids[0]!, { x: 5, y: 5 }],
          [ids[1]!, { x: Number.NaN, y: 0 }],
        ]),
      ),
    ).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates()).toBe(0);
    expect(byId(doc, ids[0]!)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2 });
  });

  it('marks its transaction LOCAL_ORIGIN and leaves colour and text alone', () => {
    const origins: unknown[] = [];
    doc.on('update', (_update: unknown, origin: unknown) => origins.push(origin));
    const text = snapshot(doc).find((note) => note.id === ids[0]!)!;
    moveObjects(doc, positions([[ids[0]!, { x: 12, y: 34 }]]));
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const after = byId(doc, ids[0]!);
    expect(after?.text).toBe(text.text);
    expect(after?.color).toBe(text.color);
    expect(after?.z).toBe(text.z);
  });

  it('reports no change when every id is stale', () => {
    const updates = updateCounter(doc);
    expect(moveObjects(doc, positions([['gone', { x: 0, y: 0 }]]))).toBe(0);
    expect(updates()).toBe(0);
  });
});

describe('resizeObjects', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 100, y: 100 });
  });

  it('writes position, width and height in one transaction', () => {
    const updates = updateCounter(doc);
    expect(
      resizeObjects(doc, rects([[id, { x: 10, y: 20, width: 400, height: 400 }]])),
    ).toBe(1);
    expect(byId(doc, id)).toMatchObject({ x: 10, y: 20, width: 400, height: 400 });
    expect(updates()).toBe(1);
  });

  // TC-10
  it('TC-10 makes a note that had no stored size explicit, keeping both fields', () => {
    // A note saved before story 7: no `width`, no `height`.
    expect(objectsMap(doc).get(id)?.has('width')).toBe(false);
    expect(objectBounds(byId(doc, id)!)).toEqual({
      x: 0,
      y: 0,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const updates = updateCounter(doc);
    resizeObjects(doc, rects([[id, { x: 0, y: 0, width: 300, height: 300 }]]));
    expect(objectsMap(doc).get(id)?.get('width')).toBe(300);
    expect(objectsMap(doc).get(id)?.get('height')).toBe(300);
    expect(objectBounds(byId(doc, id)!)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(updates()).toBe(1);
  });

  it('skips stale ids and refuses a rectangle that is not finite or is negative', () => {
    const updates = updateCounter(doc);
    expect(
      resizeObjects(
        doc,
        rects([
          ['gone', { x: 0, y: 0, width: 100, height: 100 }],
          [id, { x: 0, y: 0, width: -10, height: 100 }],
          [id, { x: Number.NaN, y: 0, width: 100, height: 100 }],
          [id, { x: 0, y: 0, width: 100, height: Number.POSITIVE_INFINITY }],
        ]),
      ),
    ).toBe(0);
    expect(updates()).toBe(0);
    expect(byId(doc, id)).toMatchObject({ width: STICKY_SIZE_WORLD });
  });

  it('keeps a note resizable down to STICKY_MIN_SIZE_WORLD (the model does not clamp)', () => {
    // The clamp lives in `clampScale`; the model writes what it is told, so the
    // limit is one decision made in one place.
    resizeObjects(
      doc,
      rects([[id, { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD }]]),
    );
    expect(objectBounds(byId(doc, id)!)).toEqual({
      x: 0,
      y: 0,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
  });
});

describe('bringObjectsToFront', () => {
  let doc: Y.Doc;
  let selected: string[];
  let other: string[];

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    // Two clusters that overlap: the three selected notes are the bottom of the
    // board, the two others are above them.
    selected = [
      createSticky(doc, { x: 0, y: 0 }),
      createSticky(doc, { x: 60, y: 60 }),
      createSticky(doc, { x: 120, y: 120 }),
    ];
    other = [createSticky(doc, { x: 30, y: 30 }), createSticky(doc, { x: 90, y: 90 })];
  });

  // TC-06
  it('TC-06 lifts three selected notes above two unselected ones, keeping their own order', () => {
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, selected)).toBe(3);

    const order = snapshot(doc).map((note) => note.id);
    // Every selected note is drawn after every unselected one…
    const positionsOf = selected.map((id) => order.indexOf(id));
    const othersAbove = other.map((id) => order.indexOf(id));
    expect(Math.min(...positionsOf)).toBeGreaterThan(Math.max(...othersAbove));
    // …and they are still in the order they were in among themselves.
    expect(positionsOf).toEqual([...positionsOf].sort((left, right) => left - right));
    expect(updates()).toBe(1);
  });

  it('does nothing when the selection is already on top, in the same order', () => {
    bringObjectsToFront(doc, selected);
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, selected)).toBe(0);
    expect(updates()).toBe(0);
  });

  it('ignores ids that are not there and reports how many it moved', () => {
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, ['gone', selected[0]!])).toBe(1);
    expect(updates()).toBe(1);
  });

  it('does nothing for an empty id list', () => {
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(updates()).toBe(0);
  });
});

describe('deleteObjects', () => {
  let doc: Y.Doc;
  let ids: string[];

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 300, y: 0 })];
  });

  it('removes every object it is given in one transaction', () => {
    const updates = updateCounter(doc);
    expect(deleteObjects(doc, ids)).toBe(2);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates()).toBe(1);
  });

  it('skips ids that are already gone and says how many it removed', () => {
    const updates = updateCounter(doc);
    expect(deleteObjects(doc, ['gone', ids[0]!])).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(updates()).toBe(1);
  });

  it('writes nothing for an empty list', () => {
    const updates = updateCounter(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(2);
  });
});

describe('story 2 single-object functions over the group versions', () => {
  it('moveObject writes the same document as moveObjects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(moveObject(doc, id, 5, 6)).toBe(true);
    expect(byId(doc, id)).toMatchObject({ x: 5, y: 6 });
    expect(moveObject(doc, 'gone', 1, 1)).toBe(false);
    expect(moveObject(doc, id, Number.NaN, 1)).toBe(false);
  });

  it('deleteObject removes one object and reports a stale id', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(deleteObject(doc, id)).toBe(true);
    expect(deleteObject(doc, id)).toBe(false);
  });
});
