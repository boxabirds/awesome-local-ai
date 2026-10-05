/**
 * Story 7 unit tests for the generic group operations in `board-model`
 * (`sel.geometry_ops`): TC-05 to TC-10 against a real Y.Doc.
 *
 * As in story 2, the document is the store under test, so nothing is mocked and
 * every mutation is checked for what it wrote *and* for how many `update` events it
 * cost: a group operation that opened one transaction per object would flood the
 * wire in story 3, and one that opened a transaction to write nothing would be
 * traffic for no change.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  bringToFront,
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
  type ObjectSnapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { rect } from '../helpers/rect';

/** Watch `doc`'s update events; `count()` is how many fired since the call. */
function watchUpdates(doc: Y.Doc): { count(): number; stop(): number } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  return {
    count: () => updates,
    stop: () => {
      doc.off('update', listener);
      return updates;
    }
  };
}

function docWithNotes(n: number): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (let index = 0; index < n; index += 1) ids.push(createSticky(doc, { x: index * 300, y: 0 }));
  return { doc, ids };
}

function byId(doc: Y.Doc): Map<string, StickySnapshot> {
  return new Map(snapshot(doc).map((note) => [note.id, note]));
}

function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> {
  const object = doc.getMap('objects').get(id);
  if (!(object instanceof Y.Map)) throw new Error(`object ${id} is missing from the document`);
  return object as Y.Map<unknown>;
}

describe('moveObjects (sel.group_move, sel.nudge)', () => {
  it('TC-05: an object deleted by somebody else mid-gesture is skipped, in one transaction', () => {
    const { doc, ids } = docWithNotes(3);
    deleteObject(doc, ids[1] as string);

    const positions = new Map([
      [ids[0] as string, { x: 40, y: 50 }],
      [ids[1] as string, { x: 40, y: 50 }],
      [ids[2] as string, { x: 40, y: 50 }]
    ]);
    const updates = watchUpdates(doc);
    expect(moveObjects(doc, positions)).toBe(2);
    updates.stop();

    const notes = byId(doc);
    expect(notes.get(ids[0] as string)?.x).toBe(40);
    expect(notes.get(ids[2] as string)?.y).toBe(50);
  });

  it('every selected object moves to its own absolute position', () => {
    const { doc, ids } = docWithNotes(2);
    const updates = watchUpdates(doc);
    const changed = moveObjects(
      doc,
      new Map([
        [ids[0] as string, { x: 0, y: 0 }],
        [ids[1] as string, { x: 300, y: -600 }]
      ])
    );
    expect(changed).toBe(2);
    expect(updates.stop()).toBe(1);
    const notes = byId(doc);
    expect([notes.get(ids[0] as string)?.x, notes.get(ids[0] as string)?.y]).toEqual([0, 0]);
    expect([notes.get(ids[1] as string)?.x, notes.get(ids[1] as string)?.y]).toEqual([300, -600]);
  });

  it('TC-09: a non-finite position writes nothing and costs no transaction', () => {
    const { doc, ids } = docWithNotes(2);
    const before = byId(doc);
    const updates = watchUpdates(doc);

    for (const bad of [
      new Map([[ids[0] as string, { x: Number.NaN, y: 0 }]]),
      new Map([[ids[0] as string, { x: 0, y: Number.POSITIVE_INFINITY }]]),
      // One bad id among good ones still refuses the whole call: a selection that
      // moved halfway is worse than one that stayed put.
      new Map([
        [ids[0] as string, { x: 10, y: 10 }],
        [ids[1] as string, { x: Number.NaN, y: 10 }]
      ])
    ]) {
      expect(moveObjects(doc, bad)).toBe(0);
    }

    // An empty selection and ids that are not in the document: nothing to write.
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([['no-such-id', { x: 1, y: 1 }]]))).toBe(0);
    expect(updates.stop()).toBe(0);
    expect(byId(doc)).toEqual(before);
  });

  it('moveObject is the single-object wrapper of moveObjects (story 2 contract)', () => {
    const { doc, ids } = docWithNotes(1);
    expect(moveObject(doc, ids[0] as string, 12, 34)).toBe(true);
    expect(byId(doc).get(ids[0] as string)?.x).toBe(12);
    expect(moveObject(doc, 'no-such-id', 1, 1)).toBe(false);
    expect(moveObject(doc, ids[0] as string, Number.NaN, 1)).toBe(false);
  });
});

describe('resizeObjects (sel.resize, sel.size_limits)', () => {
  it('a note created from now on carries its own size', () => {
    const { doc, ids } = docWithNotes(1);
    const note = byId(doc).get(ids[0] as string) as StickySnapshot;
    expect(note.width).toBe(STICKY_SIZE_WORLD);
    expect(note.height).toBe(STICKY_SIZE_WORLD);
  });

  it('TC-10: a note made before story 7 renders at STICKY_SIZE_WORLD until it is resized', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    // A note written by an earlier build: no size fields at all.
    rawObject(doc, id).delete('width');
    rawObject(doc, id).delete('height');
    const note = byId(doc).get(id) as StickySnapshot;
    expect(note.width).toBeUndefined();
    expect(note.height).toBeUndefined();
    expect(objectBounds(note)).toEqual(rect(note.x, note.y, STICKY_SIZE_WORLD, STICKY_SIZE_WORLD));

    expect(resizeObjects(doc, new Map([[id, rect(note.x, note.y, 400, 400)]]))).toBe(1);
    const grown = byId(doc).get(id) as StickySnapshot;
    // The first resize makes the size explicit: both fields are written.
    expect(rawObject(doc, id).get('width')).toBe(400);
    expect(rawObject(doc, id).get('height')).toBe(400);
    expect(grown.width).toBe(400);
    expect(grown.height).toBe(400);
    expect(objectBounds(grown)).toEqual(rect(note.x, note.y, 400, 400));
  });

  it('a group resize writes every rect in one transaction', () => {
    const { doc, ids } = docWithNotes(2);
    const before = byId(doc);
    const a = before.get(ids[0] as string) as StickySnapshot;
    const b = before.get(ids[1] as string) as StickySnapshot;
    const updates = watchUpdates(doc);
    const changed = resizeObjects(
      doc,
      new Map([
        [a.id, rect(a.x * 2, a.y * 2, 400, 400)],
        [b.id, rect(b.x * 2, b.y * 2, 400, 400)]
      ])
    );
    expect(changed).toBe(2);
    expect(updates.stop()).toBe(1);
    const after = byId(doc);
    expect([after.get(a.id)?.x, after.get(a.id)?.y]).toEqual([a.x * 2, a.y * 2]);
    expect(after.get(b.id)?.width).toBe(400);
  });

  it('TC-09: a non-finite or zero-sized rect writes nothing (error path)', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    const before = byId(doc);
    const updates = watchUpdates(doc);

    expect(resizeObjects(doc, new Map([[id, rect(0, 0, Number.NaN, 300)]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[id, rect(0, 0, -10, 300)]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[id, rect(Number.POSITIVE_INFINITY, 0, 300, 300)]]))).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(resizeObjects(doc, new Map([['no-such-id', rect(0, 0, 300, 300)]]))).toBe(0);
    expect(updates.stop()).toBe(0);
    expect(byId(doc)).toEqual(before);
  });
});

describe('bringObjectsToFront (sel.group_move stacking)', () => {
  it('TC-06: the selection goes above everything unselected and keeps its own order', () => {
    const { doc } = docWithNotes(5);
    const notes = snapshot(doc);
    const selected = notes.slice(0, 3).map((note) => note.id);
    const unselected = notes.slice(3).map((note) => note.id);
    const unselectedBefore = new Map(notes.slice(3).map((note) => [note.id, note.z]));

    const updates = watchUpdates(doc);
    expect(bringObjectsToFront(doc, selected)).toBeGreaterThan(0);
    updates.stop();

    const after = byId(doc);
    const topOfUnselected = Math.max(...unselected.map((id) => after.get(id)?.z ?? 0));
    const selectedZ = selected.map((id) => after.get(id)?.z ?? 0);
    for (const z of selectedZ) expect(z).toBeGreaterThan(topOfUnselected);
    // Their order among themselves is the order they were in.
    expect(selectedZ).toEqual([...selectedZ].sort((a, b) => a - b));
    expect((selectedZ[1] as number) > (selectedZ[0] as number)).toBe(true);
    expect((selectedZ[2] as number) > (selectedZ[1] as number)).toBe(true);
    // Nobody else moved.
    for (const id of unselected) expect(after.get(id)?.z).toBe(unselectedBefore.get(id));
  });

  it('a selection that is already on top writes nothing', () => {
    const { doc } = docWithNotes(3);
    const notes = snapshot(doc);
    const top = [notes[2]!.id, notes[1]!.id];
    const updates = watchUpdates(doc);
    expect(bringObjectsToFront(doc, top)).toBe(0);
    expect(updates.stop()).toBe(0);
  });

  it('an empty selection, and ids that are not on the board, change nothing', () => {
    const { doc } = docWithNotes(2);
    const before = JSON.stringify(snapshot(doc));
    const updates = watchUpdates(doc);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['no-such-id'])).toBe(0);
    expect(updates.stop()).toBe(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
  });

  it('bringToFront is the single-object wrapper of bringObjectsToFront', () => {
    const { doc } = docWithNotes(2);
    const notes = snapshot(doc);
    const bottom = notes[0] as StickySnapshot;
    const top = notes[1] as StickySnapshot;
    expect(bringToFront(doc, bottom.id)).toBe(true);
    expect((byId(doc).get(bottom.id) as StickySnapshot).z).toBeGreaterThan((top.z as number) + 0);
    // Already on top: no write, so no traffic.
    expect(bringToFront(doc, bottom.id)).toBe(false);
    expect(bringToFront(doc, 'no-such-id')).toBe(false);
  });
});

describe('objectsInRect (sel.marquee)', () => {
  it('TC-07: only an object lying entirely inside the rectangle is selected', () => {
    const { doc } = docWithNotes(3);
    const notes = snapshot(doc);
    // Lay them out: A fully inside the box, B overhanging its right edge, C elsewhere.
    moveObjects(
      doc,
      new Map([
        [notes[0]!.id, { x: 100, y: 100 }],
        [notes[1]!.id, { x: 900, y: 100 }],
        [notes[2]!.id, { x: 5000, y: 5000 }]
      ])
    );

    const box = rect(0, 0, 1000, 1000);
    expect(objectsInRect(snapshot(doc), box)).toEqual([notes[0]!.id]);
    // A box big enough for all three takes all three, in document order.
    expect(objectsInRect(snapshot(doc), rect(0, 0, 6000, 6000))).toEqual(notes.map((note) => note.id));
    expect(objectsInRect([], box)).toEqual([]);
  });

  it('a note that has been resized is measured at its real size', () => {
    const { doc } = docWithNotes(1);
    const id = (snapshot(doc)[0] as StickySnapshot).id;
    moveObjects(doc, new Map([[id, { x: 0, y: 0 }]]));
    resizeObjects(doc, new Map([[id, rect(0, 0, 1000, 1000)]]));
    // The note now reaches past a 500-unit box, so the box no longer selects it.
    expect(objectsInRect(snapshot(doc), rect(0, 0, 500, 500))).toEqual([]);
    expect(objectsInRect(snapshot(doc), rect(0, 0, 1000, 1000))).toEqual([id]);
  });
});

describe('allObjectIds (sel.all)', () => {
  it('TC-08: an object of a type this build does not know is left out', () => {
    const { doc } = docWithNotes(2);
    const unknown: ObjectSnapshot = { id: 'shape-1', type: 'shape', x: 0, y: 0, z: 1 };
    const ids = allObjectIds([...snapshot(doc), unknown]);
    expect(ids).toEqual(snapshot(doc).map((note) => note.id));
    expect(ids).not.toContain('shape-1');
    expect(allObjectIds([])).toEqual([]);
  });
});

describe('deleteObjects (sel.group_delete)', () => {
  it('removes every selected object in one transaction', () => {
    const { doc } = docWithNotes(3);
    const notes = snapshot(doc);
    const updates = watchUpdates(doc);
    expect(deleteObjects(doc, [notes[0]!.id, notes[1]!.id, 'no-such-id'])).toBe(2);
    expect(updates.stop()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([notes[2]!.id]);
  });

  it('an empty selection and stale ids delete nothing and cost no transaction', () => {
    const { doc } = docWithNotes(2);
    const before = JSON.stringify(snapshot(doc));
    const updates = watchUpdates(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['no-such-id'])).toBe(0);
    expect(deleteObjects(doc, ['', ''])).toBe(0);
    expect(updates.stop()).toBe(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
  });
});

describe('limits are the same numbers everywhere', () => {
  it('the settings the gesture and the registry both read are the design values', () => {
    expect(STICKY_MIN_SIZE_WORLD).toBe(50);
    expect(MAX_OBJECT_SIZE_WORLD).toBe(20_000);
  });
});
