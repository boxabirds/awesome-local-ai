import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  snapshotObjects,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
} from '../../src/shared/board-model';

function makeDoc(): Y.Doc {
  const d = new Y.Doc();
  initDoc(d);
  return d;
}

/** Creates n stickies in a row and returns their ids. */
function makeNotes(n: number): { doc: Y.Doc; ids: string[] } {
  const d = makeDoc();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = createSticky(d, { x: i * 300, y: 0 }, 'yellow');
    if (id) ids.push(id);
  }
  return { doc: d, ids };
}

/** Counts Y.Doc update events fired while `fn` runs (a no-op transact fires none). */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const onUpdate = () => {
    updates++;
  };
  doc.on('update', onUpdate);
  try {
    fn();
  } finally {
    doc.off('update', onUpdate);
  }
  return updates;
}

describe('board-model group operations (story 7)', () => {
  it('TC-04: moveObjects — empty map → 0, no transaction', () => {
    const { doc } = makeNotes(2);
    expect(countUpdates(doc, () => expect(moveObjects(doc, new Map())).toBe(0))).toBe(0);
  });

  it('TC-04: moveObjects — moves the listed ids, skips missing ones, returns the count', () => {
    const { doc, ids } = makeNotes(3);
    const positions = new Map<string, { x: number; y: number }>([
      [ids[0], { x: 11, y: 22 }],
      [ids[2], { x: 33, y: 44 }],
      ['nope', { x: 5, y: 6 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(2);
    const byId = new Map(snapshotObjects(doc).map((o) => [o.id, o]));
    expect(byId.get(ids[0])!.x).toBe(11);
    expect(byId.get(ids[0])!.y).toBe(22);
    expect(byId.get(ids[2])!.x).toBe(33);
    // ids[1] untouched (created centred on x=300 → left edge 200)
    expect(byId.get(ids[1])!.x).toBe(200);
  });

  it('TC-04: moveObjects — non-finite position → 0, no transaction, nothing written', () => {
    const { doc, ids } = makeNotes(2);
    const positions = new Map<string, { x: number; y: number }>([[ids[0], { x: NaN, y: 1 }]]);
    expect(countUpdates(doc, () => expect(moveObjects(doc, positions)).toBe(0))).toBe(0);
    expect(snapshot(doc)[0].x).toBe(-100); // created centred on (0,0) → left -100
  });

  it('TC-05: resizeObjects — writes x, y, width, height and returns the count', () => {
    const { doc, ids } = makeNotes(1);
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      [ids[0], { x: 15, y: 25, width: 200, height: 150 }],
    ]);
    expect(resizeObjects(doc, rects)).toBe(1);
    const obj = snapshotObjects(doc)[0];
    expect(obj.x).toBe(15);
    expect(obj.y).toBe(25);
    expect(obj.width).toBe(200);
    expect(obj.height).toBe(150);
    // explicit fields now exist on the Y.Map (the first resize made them explicit)
    const rawObj = doc.getMap('objects').get(ids[0]) as Y.Map<unknown>;
    expect(rawObj.has('width')).toBe(true);
    expect(rawObj.has('height')).toBe(true);
  });

  it('TC-05: resizeObjects — empty map and non-finite rect → 0, no transaction', () => {
    const { doc, ids } = makeNotes(1);
    expect(
      countUpdates(doc, () =>
        expect(
          resizeObjects(doc, new Map([[ids[0], { x: NaN, y: 2, width: 10, height: 10 }]])),
        ).toBe(0),
      ),
    ).toBe(0);
    expect(snapshotObjects(doc)[0].width).toBeUndefined();
  });

  it('TC-06: bringObjectsToFront — raises above all unselected objects, keeps relative order', () => {
    const { doc, ids } = makeNotes(3);
    // ids: z 1, 2, 3. Add an unselected note on top (z 5).
    const top = createSticky(doc, { x: 900, y: 0 }, 'pink');
    const before = new Map(snapshotObjects(doc).map((o) => [o.id, o.z]));
    expect(before.get(top!)).toBe(4); // z sequence 1, 2, 3, 4

    expect(bringObjectsToFront(doc, [ids[1], ids[0]])).toBe(2);
    const after = new Map(snapshotObjects(doc).map((o) => [o.id, o.z]));
    // relative order preserved: ids[0] was below ids[1] → stays below, both above z 4
    expect(after.get(ids[0])!).toBe(5);
    expect(after.get(ids[1])!).toBe(6);
    expect(after.get(top!)).toBe(4);
    expect(after.get(ids[2])!).toBe(3);
  });

  it('TC-06: bringObjectsToFront — no-op (0, no transaction) when already on top / empty / missing', () => {
    const { doc, ids } = makeNotes(2);
    // ids[1] (z 2) is topmost: single-selection already on top
    expect(countUpdates(doc, () => expect(bringObjectsToFront(doc, [ids[1]])).toBe(0))).toBe(0);
    expect(countUpdates(doc, () => expect(bringObjectsToFront(doc, [])).toBe(0))).toBe(0);
    expect(countUpdates(doc, () => expect(bringObjectsToFront(doc, ['ghost'])).toBe(0))).toBe(0);
  });

  it('TC-07: deleteObjects — removes the listed ids, skips missing, empty list → 0', () => {
    const { doc, ids } = makeNotes(3);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, [ids[0], ids[2], 'nope'])).toBe(2);
    const remaining = new Set(snapshotObjects(doc).map((o) => o.id));
    expect(remaining.has(ids[0])).toBe(false);
    expect(remaining.has(ids[1])).toBe(true);
    expect(remaining.has(ids[2])).toBe(false);
  });

  it('TC-08: objectsInRect — only fully-inside objects (a note touching the edge is excluded)', () => {
    const { doc } = makeNotes(0);
    const a = createSticky(doc, { x: 150, y: 150 }); // centred → left 50..250
    createSticky(doc, { x: 550, y: 150 }); // 450..650 (outside the rects)
    createSticky(doc, { x: 250, y: 550 }); // below (outside the rects)
    const rect = { x: 50, y: 50, width: 250, height: 250 }; // 50..300
    expect(objectsInRect(snapshotObjects(doc), rect)).toEqual([a!]);
    // a note that touches the rect's edge from outside is excluded:
    const rect2 = { x: 60, y: 50, width: 190, height: 250 }; // 60..250 — a's left edge (50) is outside
    expect(objectsInRect(snapshotObjects(doc), rect2)).toEqual([]);
    const none = { x: 320, y: 320, width: 10, height: 10 };
    expect(objectsInRect(snapshotObjects(doc), none)).toEqual([]);
  });

  it('TC-09: allObjectIds — includes registered types, excludes unknown types', () => {
    const { doc } = makeNotes(2);
    const objects = doc.getMap('objects');
    const mystery = new Y.Map<unknown>();
    mystery.set('type', 'fancy-unknown');
    mystery.set('x', 0);
    mystery.set('y', 0);
    mystery.set('z', 99);
    mystery.set('createdAt', 0);
    objects.set('mystery', mystery);
    const snap = snapshotObjects(doc);
    expect(snap).toHaveLength(3);
    const ids = allObjectIds(snap);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id !== 'mystery')).toBe(true);
  });

  it('TC-10: snapshotObjects — skips objects without a type field, sorts by (z, id)', () => {
    const doc = makeDoc();
    const objects = doc.getMap('objects');
    const notype = new Y.Map<unknown>();
    notype.set('x', 0);
    notype.set('y', 0);
    notype.set('z', 1);
    notype.set('createdAt', 0);
    objects.set('notype', notype); // no type → skipped
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    // swap z so the id order differs from the z order
    (objects.get(b!) as Y.Map<unknown>).set('z', 1);
    (objects.get(a!) as Y.Map<unknown>).set('z', 2);
    const snap = snapshotObjects(doc);
    expect(snap.map((o) => o.id)).toEqual([b!, a!]);
    expect(snap.every((o) => o.id !== 'notype')).toBe(true);
    // objectBounds falls back to 200×200 for stickies without explicit size
    // (created centred on (0,0) → left-top (-100,-100))
    expect(objectBounds(snap[0])).toEqual({ x: -100, y: -100, width: 200, height: 200 });
  });
});
