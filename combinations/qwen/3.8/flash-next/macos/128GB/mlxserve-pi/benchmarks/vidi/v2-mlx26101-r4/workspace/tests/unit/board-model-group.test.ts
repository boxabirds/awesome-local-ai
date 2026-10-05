/**
 * Unit tests for the group operations on the board document
 * (`sel.group_model` and `sel.geometry_ops`, TC-05 to TC-10) — the model-level
 * guarantee that a group behaves as one thing: one transaction, missing objects
 * skipped, stacking kept, and nothing written that was refused.
 *
 * Run against a real `Y.Doc`, as the story-2 model tests are: the document is the
 * store under test, and "exactly one update event" is the whole story of whether a
 * drag syncs once or sixty times a second.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  bringToFront,
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
import type { Rect } from '../../src/shared/geometry';
import { DEFAULT_STICKY_COLOR, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** A fresh, initialised document, the way `useBoardDoc` leaves it. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** Starts counting `update` events; returns a reader of the count. */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

/** Every origin that ever opened a transaction on this document, in order. */
function originsOf(doc: Y.Doc): unknown[] {
  const origins: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
  return origins;
}

/** A raw object inserted without the model, to reach states it cannot create. */
function seedObject(
  doc: Y.Doc,
  id: string,
  fields: {
    type?: string;
    x?: number;
    y?: number;
    z?: number;
    width?: number;
    height?: number;
  } = {},
): Y.Map<unknown> {
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    const type = fields.type ?? 'sticky';
    object.set('type', type);
    object.set('x', fields.x ?? 0);
    object.set('y', fields.y ?? 0);
    object.set('z', fields.z ?? 1);
    if (fields.width !== undefined) object.set('width', fields.width);
    if (fields.height !== undefined) object.set('height', fields.height);
    if (type === 'sticky') {
      object.set('color', DEFAULT_STICKY_COLOR);
      object.set('text', new Y.Text(''));
    }
    object.set('createdAt', 1_700_000_000_000);
    objectsOf(doc).set(id, object);
  });
  return object;
}

/** Five notes in a row, 100 units apart, as in the PRD's cluster. */
function cluster(doc: Y.Doc): string[] {
  return ['a', 'b', 'c', 'd', 'e'].map((letter) =>
    createSticky(doc, { x: (letter.charCodeAt(0) - 'a'.charCodeAt(0)) * 300, y: 0 }),
  );
}

/** The `y` each note in a snapshot sits at, keyed by id. */
function positionsOf(doc: Y.Doc): Map<string, { x: number; y: number; width: number; height: number; z: number }> {
  return new Map(
    snapshot(doc).map((note) => [
      note.id,
      { x: note.x, y: note.y, width: note.width, height: note.height, z: note.z },
    ]),
  );
}

describe('board.model moveObjects', () => {
  it('TC-05: moves the two that are still there and reports nothing about the one deleted', () => {
    const doc = newDoc();
    const [a, b, gone] = cluster(doc);
    deleteObject(doc, gone!);

    const updates = countUpdates(doc);
    const applied = moveObjects(
      doc,
      new Map([
        [a!, { x: 0, y: 100 }],
        [b!, { x: 300, y: 100 }],
        [gone!, { x: 600, y: 100 }],
      ]),
    );

    expect(applied).toBe(2);
    // One transaction for the group, so undo takes the whole move back at once.
    expect(updates()).toBe(1);
    const moved = snapshot(doc)
      .filter((note) => note.id === a || note.id === b)
      .map((note) => [note.id, note.x, note.y]);
    expect(moved).toEqual([
      [a, 0, 100],
      [b, 300, 100],
    ]);
    // The note nobody asked about is where it always was.
    expect(snapshot(doc)).toHaveLength(4);
  });

  it('writes the whole group in one origin-tagged transaction', () => {
    const doc = newDoc();
    const [a, b] = cluster(doc);
    const origins = originsOf(doc);

    moveObjects(doc, new Map([[a!, { x: 5, y: 5 }], [b!, { x: 10, y: 5 }]]));

    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('TC-05a: keeps the offsets between objects, so the layout is kept', () => {
    const doc = newDoc();
    cluster(doc);
    const before = positionsOf(doc);
    const ids = [...before.keys()];

    // One delta for all five: the gaps between them are exactly what they were.
    moveObjects(
      doc,
      new Map(ids.map((id) => [id, { x: before.get(id)!.x + 40, y: before.get(id)!.y - 25 }])),
    );

    const after = positionsOf(doc);
    const gaps = (positions: Map<string, { x: number }>): number[] =>
      ids.slice(1).map((id, index) => positions.get(id)!.x - positions.get(ids[index]!)!.x);
    expect(gaps(after)).toEqual(gaps(before));
    expect(ids.map((id) => after.get(id)!.x)).toEqual(ids.map((id) => before.get(id)!.x + 40));
    expect(ids.map((id) => after.get(id)!.y)).toEqual(ids.map((id) => before.get(id)!.y - 25));
  });

  it('TC-09: refuses a position that is not a place, leaving every object where it was', () => {
    const doc = newDoc();
    const [a, b] = cluster(doc);
    const before = snapshot(doc);
    const updates = countUpdates(doc);

    // One bad position refuses the whole call: half a group moved is a group with
    // something in the wrong place.
    expect(
      moveObjects(
        doc,
        new Map([
          [a!, { x: 50, y: 50 }],
          [b!, { x: Number.NaN, y: 0 }],
        ]),
      ),
    ).toBe(0);
    expect(moveObjects(doc, new Map([[a!, { x: Number.POSITIVE_INFINITY, y: 0 }]]))).toBe(0);
    // Nothing asked for is nothing applied.
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([['never-existed', { x: 1, y: 1 }]]))).toBe(0);

    expect(updates()).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });

  it('opens no transaction for positions the objects already have', () => {
    const doc = newDoc();
    const [a] = cluster(doc);
    const at = snapshot(doc).find((note) => note.id === a)!;
    const updates = countUpdates(doc);

    expect(moveObjects(doc, new Map([[a!, { x: at.x, y: at.y }]]))).toBe(0);
    expect(updates()).toBe(0);
  });
});

describe('board.model resizeObjects', () => {
  it('TC-10: writes both fields of a note that stored no size, at its real position', () => {
    const doc = newDoc();
    // createSticky is given the centre, and stores the top-left.
    const id = createSticky(doc, { x: 140, y: 160 });
    const raw = objectsOf(doc).get(id)!;
    expect(raw.has('width')).toBe(false);
    expect(raw.has('height')).toBe(false);
    // Which is the same size the snapshot reports.
    expect(objectBounds(snapshot(doc)[0]!)).toEqual({
      x: 40,
      y: 60,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    const updates = countUpdates(doc);
    expect(resizeObjects(doc, new Map([[id, { x: 40, y: 60, width: 500, height: 300 }]]))).toBe(1);
    expect(updates()).toBe(1);

    expect(raw.get('width')).toBe(500);
    expect(raw.get('height')).toBe(300);
    expect(objectBounds(snapshot(doc)[0]!)).toEqual({ x: 40, y: 60, width: 500, height: 300 });
  });

  it('keeps a group resized as a layout', () => {
    const doc = newDoc();
    const [a, b] = cluster(doc);
    // Two notes 300 apart, resized from a box twice as wide: the gap doubles with them.
    expect(
      resizeObjects(
        doc,
        new Map([
          [a!, { x: 0, y: 0, width: 400, height: 200 }],
          [b!, { x: 600, y: 0, width: 400, height: 200 }],
        ]),
      ),
    ).toBe(2);

    expect(snapshot(doc)
      .filter((note) => note.id === a || note.id === b)
      .map((note) => [note.x, note.width])).toEqual([
      [0, 400],
      [600, 400],
    ]);
  });

  it('refuses a rect that is not a rectangle, and asks for no transaction at all', () => {
    const doc = newDoc();
    const [a] = cluster(doc);
    const before = snapshot(doc);
    const updates = countUpdates(doc);

    for (const rect of [
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 100, height: -1 },
    ] as Rect[]) {
      expect(resizeObjects(doc, new Map([[a!, rect]]))).toBe(0);
    }
    expect(resizeObjects(doc, new Map())).toBe(0);

    expect(updates()).toBe(0);
    expect(snapshot(doc)).toEqual(before);
  });

  it('skips ids that are gone and writes nothing that has not changed', () => {
    const doc = newDoc();
    const [a] = cluster(doc);
    const at = objectBounds(snapshot(doc)[0]!);
    // The first resize of a note written without a size does write, because a stored
    // size of the default is a fact the board did not hold before.
    expect(
      resizeObjects(
        doc,
        new Map([
          [a!, at],
          ['never-existed', { x: 0, y: 0, width: 100, height: 100 }],
        ]),
      ),
    ).toBe(1);

    const updates = countUpdates(doc);
    expect(
      resizeObjects(
        doc,
        new Map([
          [a!, at],
          ['never-existed', { x: 0, y: 0, width: 100, height: 100 }],
        ]),
      ),
    ).toBe(0);
    expect(updates()).toBe(0);
  });

  it('resizes an object of a type this build cannot render, because a size is a size', () => {
    const doc = newDoc();
    seedObject(doc, 'shape-1', { type: 'shape', x: 0, y: 0, width: 100, height: 100 });

    expect(resizeObjects(doc, new Map([['shape-1', { x: 0, y: 0, width: 300, height: 200 }]]))).toBe(1);
    expect(objectsOf(doc).get('shape-1')!.get('width')).toBe(300);
    // It is still not selectable: the board cannot draw it.
    expect(allObjectIds(snapshot(doc))).toEqual([]);
  });
});

describe('board.model bringObjectsToFront', () => {
  it('TC-06: raises three selected notes above two unselected, keeping their own order', () => {
    const doc = newDoc();
    const ids = ['u1', 's1', 'u2', 's2', 's3'];
    ids.forEach((id, index) => seedObject(doc, id, { z: index + 1 }));

    const updates = countUpdates(doc);
    expect(bringObjectsToFront(doc, ['s1', 's2', 's3'])).toBe(3);
    expect(updates()).toBe(1);

    const byId = positionsOf(doc);
    // The unselected notes are where they were; the selection sits above both of them,
    // in the order it already had.
    expect(byId.get('u1')!.z).toBe(1);
    expect(byId.get('u2')!.z).toBe(3);
    expect([byId.get('s1')!.z, byId.get('s2')!.z, byId.get('s3')!.z]).toEqual([4, 5, 6]);

    // What the screen paints, bottom first.
    expect(snapshot(doc).map((note) => note.id)).toEqual(['u1', 'u2', 's1', 's2', 's3']);
  });

  it('changes nothing when the selection is already in front of everything', () => {
    const doc = newDoc();
    seedObject(doc, 'a', { z: 1 });
    seedObject(doc, 'b', { z: 2 });
    seedObject(doc, 'c', { z: 3 });
    const updates = countUpdates(doc);

    expect(bringObjectsToFront(doc, ['b', 'c'])).toBe(0);
    expect(updates()).toBe(0);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
  });

  it('raises a selection above an object of a type it cannot render, so nothing hides under it', () => {
    const doc = newDoc();
    seedObject(doc, 'shape-1', { type: 'shape', z: 9 });
    seedObject(doc, 'note-1', { z: 1 });

    expect(bringObjectsToFront(doc, ['note-1'])).toBe(1);
    expect(objectsOf(doc).get('note-1')!.get('z')).toBe(10);
  });

  it('asks for nothing when there is nothing selected, or only ids that are gone', () => {
    const doc = newDoc();
    seedObject(doc, 'a', { z: 1 });
    const updates = countUpdates(doc);

    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['never-existed'])).toBe(0);
    expect(updates()).toBe(0);
  });

  it('TC-06a: the story-2 single-object raise is the same operation with one id', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 0 });

    expect(bringToFront(doc, top)).toBe(false);
    const updates = countUpdates(doc);
    expect(bringToFront(doc, first)).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc).map((note) => note.z)).toEqual([2, 3]);
  });
});

describe('board.model deleteObjects', () => {
  it('deletes the whole selection in one transaction and skips ids that are gone', () => {
    const doc = newDoc();
    const ids = cluster(doc);
    const updates = countUpdates(doc);

    expect(deleteObjects(doc, [ids[0]!, ids[1]!, 'never-existed'])).toBe(2);
    expect(updates()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([ids[2], ids[3], ids[4]]);
  });

  it('asks for nothing when the list is empty or every id is stale', () => {
    const doc = newDoc();
    cluster(doc);
    const updates = countUpdates(doc);

    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['never-existed'])).toBe(0);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(5);
  });

  it('TC-30a: a colleague can delete every object while five are selected', () => {
    const doc = newDoc();
    const ids = cluster(doc);
    // The other end of the same document, as a colleague's client holds it.
    const theirs = newDoc();
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(doc));

    // The selection is local state, so it survives every object in it disappearing;
    // pruning it to nothing is the client's job, and the document simply has nothing.
    expect(deleteObjects(doc, ids)).toBe(5);
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(doc));

    expect(snapshot(theirs)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model objectsInRect and allObjectIds', () => {
  /** Three notes in a row at 0, 300 and 600, each 200 wide. */
  function row(doc: Y.Doc): void {
    ['a', 'b', 'c'].forEach((letter) =>
      seedObject(doc, `note-${letter}`, { x: (letter.charCodeAt(0) - 97) * 300, y: 0 }),
    );
  }

  it('TC-07: selects only the objects that lie entirely inside the rectangle', () => {
    const doc = newDoc();
    row(doc);
    const notes = snapshot(doc);
    const [a, b, c] = notes.map((note) => note.id);

    // A box that covers the first note and half of the second.
    expect(objectsInRect(notes, { x: -10, y: -10, width: 420, height: 220 })).toEqual([a]);
    // A box around the first two entirely.
    expect(objectsInRect(notes, { x: -10, y: -10, width: 520, height: 220 })).toEqual([a, b]);
    // Edges included: a box exactly around all three takes all three.
    expect(objectsInRect(notes, { x: 0, y: 0, width: 800, height: 200 })).toEqual([a, b, c]);
    // A box that only touches the first note from outside takes nothing.
    expect(objectsInRect(notes, { x: -300, y: 0, width: 300, height: 200 })).toEqual([]);
    // A box of no size cannot contain an object that has a size, and neither can a box
    // that is not a box.
    expect(objectsInRect(notes, { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(objectsInRect([], { x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
    expect(objectsInRect(notes, { x: Number.NaN, y: 0, width: 100, height: 100 })).toEqual([]);
  });

  it('TC-08: leaves an object of an unknown type out of select-all', () => {
    const doc = newDoc();
    seedObject(doc, 'note-1', {});
    seedObject(doc, 'shape-1', { type: 'shape', width: 100, height: 100 });
    seedObject(doc, 'drawing-1', { type: 'drawing' });

    const notes = snapshot(doc);
    expect(allObjectIds(notes)).toEqual(['note-1']);
    // and it is not offered as something the marquee could select either.
    expect(objectsInRect(notes, { x: -1000, y: -1000, width: 4000, height: 4000 })).toEqual(['note-1']);
    // The document really does hold what the board cannot select.
    expect(objectsOf(doc).size).toBe(3);
  });

  it('reports the size a note of a story-2 board occupies from the setting', () => {
    const doc = newDoc();
    // A board written before story 7: no widths stored anywhere. createSticky takes
    // the centre, so this note's top-left is 10, 20.
    createSticky(doc, { x: 110, y: 120 });
    expect(objectsOf(doc).get(snapshot(doc)[0]!.id)!.has('width')).toBe(false);
    expect(objectBounds(snapshot(doc)[0]!)).toEqual({
      x: 10,
      y: 20,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    // The minimum the board accepts is a size a note can actually be resized to.
    expect(STICKY_MIN_SIZE_WORLD).toBeLessThan(STICKY_SIZE_WORLD);
  });
});
