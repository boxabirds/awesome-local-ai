/**
 * Whole-selection writes on a real document (`sel.geometry_ops`).
 *
 * Unit level against a real `Y.Doc`, because that is what these functions are
 * for: how many objects a call actually changed, how many transactions it
 * opened, which objects it refused to touch and what it left exactly as it was.
 *
 * Specs: spec/stories/007-select-move-resize-and-delete-several-objects-at-o/
 * design.md, sel.geometry_ops (TC-05 to TC-10).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  bringToFront,
  getStickyText,
  moveObject,
  moveObjects,
  objectBounds,
  objectMinSize,
  objectsInRect,
  registerObjectTypeModel,
  resizeObjects,
  resizeSelection,
  selectionBounds,
  snapshot,
  snapshotObjects,
  type BoardObject,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';

/** The kind these tests register for themselves; stories 9-12 do the same. */
const BOX = 'testbox';
registerObjectTypeModel(BOX, 10);

const NOTE = STICKY_SIZE_WORLD;

const freshDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

/** Count `update` events emitted *after* this call (mutations only). */
const updateCounter = (doc: Y.Doc): (() => number) => {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
};

const objects = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const fields = (doc: Y.Doc, id: string): Record<string, unknown> => {
  const object = objects(doc).get(id);
  if (!object) throw new Error(`no object ${id}`);
  return Object.fromEntries(object.entries());
};

/** Put an object of a known kind in the document the way a later story would. */
const writeObject = (
  doc: Y.Doc,
  id: string,
  type: string,
  x: number,
  y: number,
  z: number,
  width?: number,
  height?: number,
): string => {
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', type);
    object.set('x', x);
    object.set('y', y);
    object.set('z', z);
    object.set('createdAt', 1);
    if (width !== undefined) object.set('width', width);
    if (height !== undefined) object.set('height', height);
    objects(doc).set(id, object);
  });
  return id;
};

const noteAt = (doc: Y.Doc, x: number, y: number, z?: number): string => {
  const id = createSticky(doc, { x: x + NOTE / 2, y: y + NOTE / 2 });
  if (z !== undefined) objects(doc).get(id)?.set('z', z);
  return id;
};

const snapshotOf = (doc: Y.Doc): readonly BoardObject[] => snapshotObjects(doc);


const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe('board.model: objectBounds (TC-10, an object that never said its size)', () => {
  // TC-10: a note written before this story has no width or height at all.
  it('TC-10 reads the note size for an object with no size written', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(fields(doc, id).width).toBeUndefined();
    expect(fields(doc, id).height).toBeUndefined();
    const snap = snapshot(doc);
    expect(snap[0]?.width).toBeUndefined();
    expect(objectBounds(snap[0] as ObjectSnapshot)).toEqual(
      rect(-NOTE / 2, -NOTE / 2, NOTE, NOTE),
    );
  });

  it('reads the size an object does carry, and the default for nonsense', () => {
    const doc = freshDoc();
    const id = writeObject(doc, 'box-1', BOX, 10, 20, 1, 120, 60);
    expect(objectBounds(snapshotOf(doc)[0] as ObjectSnapshot)).toEqual(rect(10, 20, 120, 60));
    expect(id).toBe('box-1');

    const broken = writeObject(doc, 'box-2', BOX, Number.NaN, 5, 2, Number.NaN, -3);
    const object = snapshotOf(doc).find((entry) => entry.id === broken) as ObjectSnapshot;
    expect(objectBounds(object)).toEqual(rect(0, 5, NOTE, NOTE));
  });

  it('caps an impossible size at MAX_OBJECT_SIZE_WORLD', () => {
    const doc = freshDoc();
    writeObject(doc, 'huge', BOX, 0, 0, 1, MAX_OBJECT_SIZE_WORLD * 10, 10);
    expect(objectBounds(snapshotOf(doc)[0] as ObjectSnapshot).width).toBe(
      MAX_OBJECT_SIZE_WORLD,
    );
  });
});

describe('board.model: objectsInRect (TC-07, the marquee rule)', () => {
  // TC-07: fully inside counts; half inside and outside do not.
  it('TC-07 names only the objects lying wholly inside', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 250, 100);
    const c = noteAt(doc, 900, 900);
    const box = rect(-10, -10, 310, 310);
    const inside = objectsInRect(snapshotOf(doc), box);
    expect(inside).toEqual([a]);
    expect(inside).not.toContain(b);
    expect(inside).not.toContain(c);
  });

  it('takes an object right up to the edge, and none of an empty rectangle', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    expect(objectsInRect(snapshotOf(doc), rect(0, 0, NOTE, NOTE))).toEqual([a]);
    expect(objectsInRect(snapshotOf(doc), rect(100, 100, 0, 0))).toEqual([]);
  });

  it('reports objects in render order, and nothing of an unusable rectangle', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    const wide = rect(-100, -100, 1_000, 1_000);
    expect(objectsInRect(snapshotOf(doc), wide)).toEqual([a, b]);
    expect(objectsInRect(snapshotOf(doc), rect(0, 0, Number.NaN, 100))).toEqual([]);
  });

  it('leaves an object of an unknown kind out of the board altogether', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    writeObject(doc, 'from-the-future', 'whiteboard-thing', 10, 10, 9, 20, 20);
    // Nothing on this screen draws it, so nothing on this screen selects it.
    expect(objectsInRect(snapshotOf(doc), rect(-1_000, -1_000, 10_000, 10_000))).toEqual([a]);
  });
});

describe('board.model: allObjectIds (TC-08, select all)', () => {
  // TC-08: an object of a kind nobody has registered is not selectable.
  it('TC-08 leaves out objects of an unknown kind', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 400, 0);
    writeObject(doc, 'mystery', 'shape', 10, 10, 5, 20, 20);
    const ids = allObjectIds(snapshotOf(doc));
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain('mystery');
  });

  it('includes objects of every registered kind and nothing on an empty board', () => {
    const doc = freshDoc();
    expect(allObjectIds(snapshotOf(doc))).toEqual([]);
    const a = noteAt(doc, 0, 0);
    const box = writeObject(doc, 'box-1', BOX, 0, 0, 2, 100, 100);
    expect(allObjectIds(snapshotOf(doc))).toEqual([a, box]);
  });

  it('has a minimum size per kind, the default being none', () => {
    expect(objectMinSize('sticky')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(objectMinSize(BOX)).toBe(10);
    expect(objectMinSize('shape')).toBe(0);
  });
});

describe('board.model: moveObjects (TC-05, TC-09)', () => {
  const positions = (entries: readonly (readonly [string, Point])[]): ReadonlyMap<string, Point> =>
    new Map(entries);

  // TC-05: one of three is gone: two move, in one transaction.
  it('TC-05 moves what is still there and says how many it changed', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    const c = noteAt(doc, 600, 0);
    expect(deleteObject(doc, c)).toBe(true);

    const updates = updateCounter(doc);
    const changed = moveObjects(
      doc,
      positions([
        [a, { x: 100, y: 100 }],
        [b, { x: 400, y: 100 }],
        [c, { x: 700, y: 100 }],
      ]),
    );
    expect(changed).toBe(2);
    expect(updates()).toBe(1);
    expect(fields(doc, a).x).toBe(100);
    expect(fields(doc, b).x).toBe(400);
    expect(objects(doc).has(c)).toBe(false);
  });

  it('keeps every other field of a moved object', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'green');
    const before = fields(doc, id);
    moveObjects(doc, positions([[id, { x: 20, y: 30 }]]));
    const after = fields(doc, id);
    expect(after.x).toBe(20);
    expect(after.y).toBe(30);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect((after.text as Y.Text).toString()).toBe('');
  });

  it('writes nothing when an object of an unknown kind is in the group', () => {
    const doc = freshDoc();
    writeObject(doc, 'mystery', 'shape', 1, 2, 1, 20, 20);
    const updates = updateCounter(doc);
    expect(moveObjects(doc, positions([['mystery', { x: 9, y: 9 }]]))).toBe(0);
    expect(updates()).toBe(0);
    expect(fields(doc, 'mystery').x).toBe(1);
  });

  // TC-09: values that are not numbers are refused, and nothing is written.
  it('TC-09 refuses positions that are not numbers and opens no transaction', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const before = fields(doc, a);
    const updates = updateCounter(doc);
    expect(moveObjects(doc, positions([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, positions([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(moveObjects(doc, positions([[a, { x: Number.NEGATIVE_INFINITY, y: Number.NaN }]]))).toBe(0);
    expect(updates()).toBe(0);
    expect(fields(doc, a)).toEqual(before);
  });

  it('TC-09 writes nothing for nobody', () => {
    const doc = freshDoc();
    noteAt(doc, 0, 0);
    const updates = updateCounter(doc);
    expect(moveObjects(doc, new Map<string, Point>())).toBe(0);
    expect(moveObjects(doc, positions([['gone', { x: 1, y: 1 }]]))).toBe(0);
    expect(updates()).toBe(0);
  });

  it('does not rewrite an object already where it was asked to be', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    moveObjects(doc, positions([[a, { x: 5, y: 5 }]]));
    const updates = updateCounter(doc);
    expect(moveObjects(doc, positions([[a, { x: 5, y: 5 }]]))).toBe(0);
    expect(updates()).toBe(0);
  });

  it('moves objects of any registered kind, notes and others together', () => {
    const doc = freshDoc();
    const note = noteAt(doc, 0, 0);
    const box = writeObject(doc, 'box-1', BOX, 500, 0, 2, 100, 100);
    const changed = moveObjects(
      doc,
      positions([
        [note, { x: 1, y: 2 }],
        [box, { x: 3, y: 4 }],
      ]),
    );
    expect(changed).toBe(2);
    expect(fields(doc, box).x).toBe(3);
  });
});

describe('board.model: resizeObjects (TC-10, TC-02, sel.size_limits)', () => {
  const sizes = (entries: readonly (readonly [string, Rect])[]): ReadonlyMap<string, Rect> =>
    new Map(entries);

  // TC-10: the first resize is what writes a note's width and height.
  it('TC-10 turns an object with no size into one with both fields written', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(fields(doc, id).width).toBeUndefined();
    const updates = updateCounter(doc);
    const changed = resizeObjects(doc, sizes([[id, rect(-100, -100, 400, 400)]]));
    expect(changed).toBe(1);
    expect(updates()).toBe(1);
    expect(fields(doc, id)).toMatchObject({ width: 400, height: 400, x: -100, y: -100 });
    expect(objectBounds(snapshot(doc)[0] as ObjectSnapshot)).toEqual(rect(-100, -100, 400, 400));
  });

  it('stops a size below the kind minimum and above the maximum', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    resizeObjects(doc, sizes([[note, rect(0, 0, 1, 1)]]));
    expect(fields(doc, note)).toMatchObject({
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
    resizeObjects(doc, sizes([[note, rect(0, 0, MAX_OBJECT_SIZE_WORLD * 4, 100)]]));
    expect(fields(doc, note).width).toBe(MAX_OBJECT_SIZE_WORLD);
    // A kind with no minimum of its own is still capped.
    const box = writeObject(doc, 'box-1', BOX, 0, 0, 1, 100, 100);
    resizeObjects(doc, sizes([[box, rect(0, 0, 2, 2)]]));
    expect(fields(doc, box)).toMatchObject({ width: 10, height: 10 });
  });

  it('refuses sizes that are not numbers and objects of unknown kinds', () => {
    const doc = freshDoc();
    const note = noteAt(doc, 0, 0);
    writeObject(doc, 'mystery', 'shape', 0, 0, 1, 100, 100);
    const before = fields(doc, note);
    const updates = updateCounter(doc);
    expect(resizeObjects(doc, sizes([[note, rect(0, 0, Number.NaN, 300)]]))).toBe(0);
    expect(resizeObjects(doc, sizes([[note, rect(0, 0, 300, Number.POSITIVE_INFINITY)]]))).toBe(0);
    expect(resizeObjects(doc, sizes([['mystery', rect(0, 0, 300, 300)]]))).toBe(0);
    expect(resizeObjects(doc, sizes([]))).toBe(0);
    expect(updates()).toBe(0);
    expect(fields(doc, note)).toEqual(before);
    expect(fields(doc, 'mystery').width).toBe(100);
  });

  it('leaves an object already the size it was asked for alone', () => {
    const doc = freshDoc();
    const box = writeObject(doc, 'box-1', BOX, 0, 0, 1, 100, 100);
    const updates = updateCounter(doc);
    expect(resizeObjects(doc, sizes([[box, rect(0, 0, 100, 100)]]))).toBe(0);
    expect(updates()).toBe(0);
  });

  it('changes only the objects still on the board, in one transaction', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    deleteObject(doc, b);
    const updates = updateCounter(doc);
    expect(
      resizeObjects(
        doc,
        sizes([
          [a, rect(0, 0, 300, 300)],
          [b, rect(300, 0, 300, 300)],
        ]),
      ),
    ).toBe(1);
    expect(updates()).toBe(1);
  });
});

describe('board.model: resizeSelection (the whole selection at one scale)', () => {
  it('scales every object by the box and keeps their relative places', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, NOTE + 100, 0);
    const sizes = resizeSelection(snapshotOf(doc), [a, b], 'e', { x: 500, y: 0 }, false);
    if (!sizes) throw new Error('nothing was resized');
    const grownA = sizes.get(a);
    const grownB = sizes.get(b);
    if (!grownA || !grownB) throw new Error('an object was left out');
    // The box is 500 wide, twice that is 1,000: each note 400, the gap 200.
    expect(grownA.width).toBeCloseTo(400, 6);
    expect(grownB.x - (grownA.x + grownA.width)).toBeCloseTo(200, 6);
    // An unlocked selection on an edge handle does not change heights.
    expect(grownA.height).toBeCloseTo(NOTE, 6);
  });

  it('keeps the ratio of a selection that contains a sticky note', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const sizes = resizeSelection(snapshotOf(doc), [a], 'se', { x: 100, y: 40 }, true);
    const grown = sizes?.get(a);
    if (!grown) throw new Error('nothing was resized');
    expect(grown.width).toBeCloseTo(300, 6);
    expect(grown.height).toBeCloseTo(300, 6);
  });

  it('is null for a selection with nothing on the board in it', () => {
    const doc = freshDoc();
    expect(resizeSelection(snapshotOf(doc), [], 'e', { x: 10, y: 10 }, false)).toBeNull();
    expect(resizeSelection(snapshotOf(doc), ['gone'], 'e', { x: 10, y: 10 }, false)).toBeNull();
  });
});

describe('board.model: selectionBounds', () => {
  it('is the smallest box around the selected objects, or null', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 400);
    expect(selectionBounds(snapshotOf(doc), [a, b])).toEqual(rect(0, 0, 500, 600));
    expect(selectionBounds(snapshotOf(doc), [a])).toEqual(rect(0, 0, NOTE, NOTE));
    expect(selectionBounds(snapshotOf(doc), ['gone'])).toBeNull();
  });
});

describe('board.model: bringObjectsToFront (TC-06, stacking)', () => {
  // TC-06: the selection goes above everything else, its own order kept.
  it('TC-06 lifts a selection above unselected objects and keeps its inside order', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0, 1);
    const b = noteAt(doc, 40, 0, 2);
    const c = noteAt(doc, 80, 0, 3);
    const unselectedTop = noteAt(doc, 440, 0, 5);
    const updates = updateCounter(doc);
    const changed = bringObjectsToFront(doc, [c, a, b]);
    expect(changed).toBe(3);
    expect(updates()).toBe(1);
    const z = (id: string): number => Number(fields(doc, id).z);
    // Above every object that was not part of the selection.
    expect(z(a)).toBeGreaterThan(z(unselectedTop));
    expect(z(b)).toBeGreaterThan(z(unselectedTop));
    expect(z(c)).toBeGreaterThan(z(unselectedTop));
    // And still in the order they were in relative to each other.
    expect([z(a), z(b), z(c)]).toEqual([6, 7, 8]);
  });

  it('raises in snapshot order whatever order the ids came in', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0, 1);
    const b = noteAt(doc, 40, 0, 2);
    bringObjectsToFront(doc, [b, a]);
    const z = (id: string): number => Number(fields(doc, id).z);
    expect(z(a)).toBeLessThan(z(b));
  });

  it('does nothing for a selection that is already all at the front', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0, 1);
    const b = noteAt(doc, 40, 0, 2);
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, [a, b])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['gone'])).toBe(0);
    expect(updates()).toBe(0);
  });

  it('lifts objects of every registered kind and leaves unknown kinds be', () => {
    const doc = freshDoc();
    const note = noteAt(doc, 0, 0, 3);
    const box = writeObject(doc, 'box-1', BOX, 0, 0, 1, 100, 100);
    const leftOut = noteAt(doc, 600, 0, 5);
    expect(bringObjectsToFront(doc, [box, note])).toBe(2);
    const z = (id: string): number => Number(fields(doc, id).z);
    expect(z(box)).toBeGreaterThan(z(leftOut));
    expect(z(box)).toBeLessThan(z(note));
    writeObject(doc, 'mystery', 'shape', 0, 0, 0, 10, 10);
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, ['mystery'])).toBe(0);
    expect(updates()).toBe(0);
  });

  it('writes nothing when the selection is already above everything else', () => {
    const doc = freshDoc();
    const leftOut = noteAt(doc, 0, 0, 1);
    const high = noteAt(doc, 300, 0, 4);
    const low = noteAt(doc, 600, 0, 3);
    const updates = updateCounter(doc);
    expect(bringObjectsToFront(doc, [high, low])).toBe(0);
    expect(updates()).toBe(0);
    expect(Number(fields(doc, high).z)).toBe(4);
    expect(Number(fields(doc, leftOut).z)).toBe(1);
  });
});

describe('board.model: deleteObjects (sel.group_delete)', () => {
  it('removes every object still there in one transaction', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    noteAt(doc, 600, 0);
    const updates = updateCounter(doc);
    expect(deleteObjects(doc, [a, b, 'gone'])).toBe(2);
    expect(updates()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toHaveLength(1);
  });

  it('writes nothing for an empty list or nobody there', () => {
    const doc = freshDoc();
    noteAt(doc, 0, 0);
    const updates = updateCounter(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['gone', 'also-gone'])).toBe(0);
    expect(updates()).toBe(0);
  });

  it('leaves unselected objects and their text alone', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    getStickyText(doc, b)?.insert(0, 'stays');
    deleteObjects(doc, [a]);
    expect(snapshot(doc).map((note) => note.text)).toEqual(['stays']);
  });
});

describe('board.model: story 2 single-object functions still behave', () => {
  it('moves, raises and deletes one note as before', () => {
    const doc = freshDoc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    expect(moveObject(doc, a, 12, 34)).toBe(true);
    expect(fields(doc, a).x).toBe(12);
    expect(bringToFront(doc, a)).toBe(true);
    expect(Number(fields(doc, a).z)).toBeGreaterThan(Number(fields(doc, b).z));
    expect(bringToFront(doc, a)).toBe(false);
    expect(deleteObject(doc, a)).toBe(true);
    expect(snapshot(doc).map((note) => note.id)).toEqual([b]);
  });
});
