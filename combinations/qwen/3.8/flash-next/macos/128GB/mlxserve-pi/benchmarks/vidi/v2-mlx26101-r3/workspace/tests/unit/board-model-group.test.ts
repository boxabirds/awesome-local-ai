import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  OBJECTS_MAP,
  STICKY_TYPE,
  allObjectIds,
  bringToFront,
  bringObjectsToFront,
  canReadObjectType,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  moveObject,
  moveObjects,
  objectBounds,
  objectsInRect,
  registerObjectReader,
  resizeObjects,
  selectionBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';

/**
 * Board model group operations (TC-05 to TC-10 of story 7), against a real Y.Doc.
 *
 * These are the operations the selection acts on: move, resize, restack, delete, and the three
 * read helpers the marquee and the overlay are built from. What is tested here is the shape of
 * the contract the UI relies on - one transaction per action, stale ids skipped rather than
 * fatal, nothing written when there is nothing to write - because every one of those is a
 * promise the collaborative side of the app (stories 3 and 4) keeps to other people.
 */

interface Counted<T> {
  result: T;
  updates: number;
}

/** Run `run` while counting the doc's `update` events. */
function countUpdates<T>(doc: Y.Doc, run: () => T): Counted<T> {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function rawObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

/** A note placed by hand, at a known position and stacking order. */
function placeNote(doc: Y.Doc, x: number, y: number, z?: number): string {
  const id = createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  if (z !== undefined) {
    doc.transact(() => {
      rawObjects(doc).get(id)?.set('z', z);
    });
  }
  return id;
}

/** Write an object of a type this client has never heard of. */
function insertRaw(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, value);
    }
    rawObjects(doc).set(id, map);
  });
}

function fieldsOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return rawObjects(doc).get(id);
}

function placed(doc: Y.Doc): { a: string; b: string; c: string } {
  return {
    a: placeNote(doc, 0, 0, 1),
    b: placeNote(doc, 300, 0, 2),
    c: placeNote(doc, 0, 300, 3),
  };
}

function box(x: number, y: number, width = STICKY_SIZE_WORLD, height = STICKY_SIZE_WORLD): Rect {
  return { x, y, width, height };
}

describe('board.model.moveObjects (sel.group_move)', () => {
  it('TC-05 moves the objects that are still there and reports how many it moved', () => {
    const doc = newDoc();
    const { a, b, c } = placed(doc);
    deleteObject(doc, c); // A peer deleted one of the three while the pointer was down.

    const moved = countUpdates(doc, () =>
      moveObjects(
        doc,
        new Map<string, Point>(
          (
            [
              [a, { x: 20, y: 10 }],
              [b, { x: 320, y: 10 }],
              [c, { x: 20, y: 310 }],
            ] as const
          ).map(([id, point]) => [id, point]),
        ),
      ),
    );
    expect(moved.result).toBe(2);
    // One update for the whole group: nine objects moved together, one message goes out.
    expect(moved.updates).toBe(1);
    expect(snapshot(doc).map((object) => [object.id, object.x, object.y])).toEqual([
      [a, 20, 10],
      [b, 320, 10],
    ]);
  });

  it('TC-05b moves nothing and says so when the group is empty or already there', () => {
    const doc = newDoc();
    const { a } = placed(doc);
    expect(countUpdates(doc, () => moveObjects(doc, new Map())).result).toBe(0);
    // The note is already where it is being asked to go, so a drag that ends where it began
    // costs nothing - which is what stops a click on a note from becoming sync traffic.
    expect(countUpdates(doc, () => moveObjects(doc, new Map([[a, { x: 0, y: 0 }]]))).result).toBe(0);
    expect(countUpdates(doc, () => moveObjects(doc, new Map([[a, { x: 0, y: 0 }]]))).updates).toBe(0);
    // Ids nobody has heard of are skipped, and a group of them is still nothing.
    expect(countUpdates(doc, () => moveObjects(doc, new Map([['gone', { x: 1, y: 1 }]]))).result).toBe(0);
    // The single-object form is the same function, so it keeps the same silence.
    expect(moveObject(doc, a, 0, 0)).toBe(false);
  });

  it('TC-05c leaves the other objects and the text of the moved ones alone', () => {
    const doc = newDoc();
    const { a, b } = placed(doc);
    moveObjects(doc, new Map([[a, { x: 40, y: 40 }]]));
    const after = snapshot(doc);
    expect(after.find((object) => object.id === b)).toMatchObject({ x: 300, y: 0, z: 2 });
    expect(after.find((object) => object.id === a)).toMatchObject({
      color: DEFAULT_STICKY_COLOR,
      type: STICKY_TYPE,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });
});

describe('board.model.resizeObjects (sel.group_resize)', () => {
  it('TC-10 writes the size a note made before story 7 never had, in one update', () => {
    const doc = newDoc();
    const { a, b } = placed(doc);
    // A note from before sizes existed has no width or height in the document at all.
    expect(fieldsOf(doc, a)?.has('width')).toBe(false);
    expect(objectBounds(snapshot(doc).find((object) => object.id === a)!)).toEqual(
      box(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD),
    );

    const resized = countUpdates(doc, () =>
      resizeObjects(
        doc,
        new Map<string, Rect>([
          [a, box(0, 0, 400, 400)],
          [b, box(300, 0, 400, 400)],
        ]),
      ),
    );
    expect(resized.result).toBe(2);
    expect(resized.updates).toBe(1);
    expect(fieldsOf(doc, a)?.get('width')).toBe(400);
    expect(fieldsOf(doc, a)?.get('height')).toBe(400);
    expect(snapshot(doc).find((object) => object.id === a)).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
  });

  it('TC-10b skips ids that went away and resizes the rest', () => {
    const doc = newDoc();
    const { a, b, c } = placed(doc);
    deleteObject(doc, b);
    expect(
      resizeObjects(
        doc,
        new Map<string, Rect>([
          [a, box(1, 1, 260, 260)],
          [b, box(301, 1, 260, 260)],
          [c, box(1, 301, 260, 260)],
        ]),
      ),
    ).toBe(2);
    expect(snapshot(doc).map((object) => object.width)).toEqual([260, 260]);
  });

  it('TC-09 rejects a box that is not a box, and writes nothing when it does', () => {
    const doc = newDoc();
    const { a, b } = placed(doc);
    const bad: Rect[] = [
      box(0, 0, Number.NaN, 400),
      box(0, 0, 400, Number.POSITIVE_INFINITY),
      box(Number.NaN, 0, 400, 400),
      box(0, 0, 0, 400),
      box(0, 0, 400, -20),
    ];
    for (const rect of bad) {
      const attempt = countUpdates(doc, () =>
        resizeObjects(
          doc,
          new Map<string, Rect>([
            [a, rect],
            [b, box(300, 0, 500, 500)],
          ]),
        ),
      );
      // All or nothing: a group resize that cannot be honoured does not half-happen.
      expect(attempt.result).toBe(0);
      expect(attempt.updates).toBe(0);
    }
    expect(snapshot(doc).map((object) => [object.x, object.y, object.width])).toEqual([
      [0, 0, STICKY_SIZE_WORLD],
      [300, 0, STICKY_SIZE_WORLD],
      [0, 300, STICKY_SIZE_WORLD],
    ]);
  });

  it('writes a size once, then stays silent while the boxes do not change', () => {
    const doc = newDoc();
    const { a } = placed(doc);
    const first = countUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, box(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD)]])),
    );
    // The note had no width or height in the document, so writing the size it already had by
    // default is still a change to the document, and it is worth the one update.
    expect(first.result).toBe(1);
    expect(first.updates).toBe(1);
    // Now the boxes are the ones the object is already in: a drag of a handle that comes back
    // to where it started costs nothing.
    const same = countUpdates(doc, () =>
      resizeObjects(doc, new Map([[a, box(0, 0, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD)]])),
    );
    expect(same.result).toBe(0);
    expect(same.updates).toBe(0);
  });
});

describe('board.model.bringObjectsToFront (sel.group_front)', () => {
  it('TC-06 puts every selected object above every object that stayed behind', () => {
    const doc = newDoc();
    // Three overlapping notes below two that stay where they are.
    const low1 = placeNote(doc, 100, 100, 1);
    const low2 = placeNote(doc, 120, 120, 2);
    const low3 = placeNote(doc, 140, 140, 3);
    const keep1 = placeNote(doc, 600, 100, 4);
    const keep2 = placeNote(doc, 620, 120, 5);

    const raised = countUpdates(doc, () =>
      bringObjectsToFront(doc, [low3, low1, low2]),
    );
    expect(raised.result).toBe(3);
    expect(raised.updates).toBe(1);

    const byId = new Map(snapshot(doc).map((object) => [object.id, object]));
    for (const id of [low1, low2, low3]) {
      expect(byId.get(id)!.z).toBeGreaterThan(byId.get(keep2)!.z);
    }
    // Their order among themselves is the order they were already in, not the order they were
    // named in - which is what keeps a group from shuffling itself when it is picked up.
    expect(byId.get(low1)!.z).toBeLessThan(byId.get(low2)!.z);
    expect(byId.get(low2)!.z).toBeLessThan(byId.get(low3)!.z);
    expect(byId.get(keep1)!.z).toBe(4);
    expect(byId.get(keep2)!.z).toBe(5);
    expect(snapshot(doc).map((object) => object.id)).toEqual([keep1, keep2, low1, low2, low3]);
  });

  it('TC-06b keeps a selection that is already on top where it is', () => {
    const doc = newDoc();
    const { a, b, c } = placed(doc);
    const attempt = countUpdates(doc, () => bringObjectsToFront(doc, [b, c]));
    expect(attempt.result).toBe(0);
    expect(attempt.updates).toBe(0);
    expect(snapshot(doc).map((object) => object.z)).toEqual([1, 2, 3]);
    // The single-object form agrees, so a drag of the top note costs no traffic (story 2 TC-39).
    expect(countUpdates(doc, () => bringToFront(doc, a)).updates).toBe(1);
  });

  it('TC-06c never pushes an object backwards on its way to the front', () => {
    const doc = newDoc();
    const bottom = placeNote(doc, 0, 0, 1);
    const between = placeNote(doc, 20, 20, 5);
    const top = placeNote(doc, 10, 10, 9);
    // The object that stays behind is at 5, so the one that was below it goes to 6 - and the
    // one already above everything is left at 9 rather than pulled down to 7.
    expect(bringObjectsToFront(doc, [bottom, top])).toBe(1);
    const byId = new Map(snapshot(doc).map((object) => [object.id, object]));
    expect(byId.get(top)!.z).toBe(9);
    expect(byId.get(bottom)!.z).toBe(6);
    expect(byId.get(between)!.z).toBe(5);
  });

  it('says nothing when the objects it was asked about are gone', () => {
    const doc = newDoc();
    const { a } = placed(doc);
    expect(countUpdates(doc, () => bringObjectsToFront(doc, [])).result).toBe(0);
    expect(countUpdates(doc, () => bringObjectsToFront(doc, [`${a}-not-here`])).result).toBe(0);
  });
});

describe('board.model.objectsInRect (sel.marquee)', () => {
  it('TC-07 takes the objects the box holds completely', () => {
    const doc = newDoc();
    const inside = placeNote(doc, 100, 100);
    const straddling = placeNote(doc, 250, 100);
    const outside = placeNote(doc, 900, 900);

    const picked = objectsInRect(snapshot(doc), box(0, 0, 350, 350));
    expect(picked).toEqual([inside]);
    // The one that hangs over the right edge is out even though its middle is in, and the one
    // nowhere near the box is out for the ordinary reason.
    expect(picked).not.toContain(straddling);
    expect(picked).not.toContain(outside);
  });

  it('TC-07b counts an object that sits exactly on the edge as inside (boundary)', () => {
    const doc = newDoc();
    const edge = placeNote(doc, 100, 100);
    // The box's right edge is the object's right edge exactly.
    expect(objectsInRect(snapshot(doc), box(100, 100, 200, 200))).toEqual([edge]);
    // One unit over the line and it is out.
    expect(objectsInRect(snapshot(doc), box(100, 100, 199, 200))).toEqual([]);
  });

  it('TC-07c returns the ids in draw order, and none at all for a box that is not one', () => {
    const doc = newDoc();
    const first = placeNote(doc, 0, 0, 1);
    const second = placeNote(doc, 10, 0, 2);
    expect(objectsInRect(snapshot(doc), box(-100, -100, 1000, 1000))).toEqual([first, second]);
    expect(objectsInRect(snapshot(doc), box(0, 0, Number.NaN, 100))).toEqual([]);
    expect(objectsInRect([], box(0, 0, 100, 100))).toEqual([]);
    // A drag that never moved is a click, not a selection.
    expect(objectsInRect(snapshot(doc), box(5, 5, 0, 0))).toEqual([]);
  });
});

describe('board.model.allObjectIds and unknown types (sel.object_registry)', () => {
  it('TC-08 lists the objects it can draw and no others', () => {
    const doc = newDoc();
    const note = placeNote(doc, 0, 0, 1);
    insertRaw(doc, 'frame-1', { type: 'frame', x: 0, y: 0, width: 400, height: 400, z: 2 });

    const ids = allObjectIds(snapshot(doc));
    expect(ids).toEqual([note]);
    // The unknown object is still in the document, unread and untouched: the next person who
    // knows what a frame is will find it there.
    expect(rawObjects(doc).has('frame-1')).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);
    expect(deleteObjects(doc, ['frame-1'])).toBe(0);
  });

  it('TC-08b reads an object of a type registered by whoever is drawing it', () => {
    const doc = newDoc();
    registerObjectReader('connector');
    insertRaw(doc, 'conn-1', {
      type: 'connector',
      x: 12,
      y: 20,
      width: 30,
      height: 40,
      z: 4,
      createdAt: 7,
    });
    const read = snapshot(doc).find((object) => object.id === 'conn-1');
    expect(read).toMatchObject({ type: 'connector', x: 12, y: 20, width: 30, height: 40, z: 4 });
    expect(allObjectIds(snapshot(doc))).toEqual(['conn-1']);
    // An object with no type of its own is not somebody's connector.
    insertRaw(doc, 'anon', { x: 0, y: 0, z: 1 });
    expect(snapshot(doc).some((object) => object.id === 'anon')).toBe(false);
    expect(canReadObjectType('connector')).toBe(true);
    expect(canReadObjectType('frame')).toBe(false);
    expect(canReadObjectType(undefined)).toBe(false);
  });

  it('TC-08c falls back to the defaults it is allowed to assume', () => {
    const doc = newDoc();
    registerObjectReader('widget');
    insertRaw(doc, 'widget-1', { type: 'widget', x: 0, y: 0, z: 0 });
    const read = snapshot(doc).find((object) => object.id === 'widget-1') as ObjectSnapshot;
    expect(read).toMatchObject({
      x: 0,
      y: 0,
      // An object with no size of its own is drawn at the size this client has, which is the
      // sticky note's: there is nothing else it could guess.
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
      z: 0,
      color: DEFAULT_STICKY_COLOR,
      text: '',
    });
    // A note-shaped object of a readable type keeps its own text and colour.
    insertRaw(doc, 'widget-2', {
      type: 'widget',
      x: 1,
      y: 2,
      z: 3,
      width: 5,
      height: 6,
      color: 'violet',
    });
    expect(snapshot(doc).find((object) => object.id === 'widget-2')).toMatchObject({
      width: 5,
      height: 6,
      color: 'violet',
      text: '',
    });
  });
});

describe('board.model.deleteObjects (sel.delete)', () => {
  it('TC-05a deletes a group in one update and skips what is already gone', () => {
    const doc = newDoc();
    const { a, b, c } = placed(doc);
    const survivor = placeNote(doc, 900, 900, 9);
    deleteObject(doc, c); // Someone else got there first with one of the three.
    const deleted = countUpdates(doc, () => deleteObjects(doc, [a, b, c, 'gone']));
    expect(deleted.result).toBe(2);
    expect(deleted.updates).toBe(1);
    expect(snapshot(doc).map((object) => object.id)).toEqual([survivor]);
  });

  it('does not count the same id twice, and never invents an update', () => {
    const doc = newDoc();
    const { a, b } = placed(doc);
    expect(deleteObjects(doc, [a, a, b])).toBe(2);
    expect(countUpdates(doc, () => deleteObjects(doc, [])).result).toBe(0);
    expect(countUpdates(doc, () => deleteObjects(doc, [a])).result).toBe(0);
    expect(countUpdates(doc, () => deleteObjects(doc, [a])).updates).toBe(0);
  });

  it('leaves the objects it was not asked about exactly as they were', () => {
    const doc = newDoc();
    const { a, b, c } = placed(doc);
    const before = snapshot(doc).find((object) => object.id === c);
    deleteObjects(doc, [a, b]);
    expect(snapshot(doc)).toEqual([before]);
  });
});

describe('board.model.selectionBounds (sel.group_resize)', () => {
  it('TC-10a makes one box around the whole selection', () => {
    const doc = newDoc();
    const { a, b, c } = placed(doc);
    expect(selectionBounds(snapshot(doc), [a, b])).toEqual(box(0, 0, 500, 200));
    expect(selectionBounds(snapshot(doc), [a, b, c])).toEqual(box(0, 0, 500, 500));
    // An id that is not on the board is not allowed to make the box bigger.
    expect(selectionBounds(snapshot(doc), [a, 'gone'])).toEqual(box(0, 0, 200, 200));
  });

  it('has no box for an empty selection (error path)', () => {
    const doc = newDoc();
    placed(doc);
    expect(selectionBounds(snapshot(doc), [])).toBeNull();
    expect(selectionBounds(snapshot(doc), ['gone'])).toBeNull();
    expect(selectionBounds([], [STICKY_TYPE])).toBeNull();
  });

  it('holds objects of sizes the board has never seen before', () => {
    const doc = newDoc();
    const { a, b } = placed(doc);
    resizeObjects(
      doc,
      new Map<string, Rect>([
        [a, box(-100, -50, 40, STICKY_MIN_SIZE_WORLD)],
        [b, box(300, 0, 600, 20)],
      ]),
    );
    expect(selectionBounds(snapshot(doc), [a, b])).toEqual(box(-100, -50, 1000, 70));
  });
});

