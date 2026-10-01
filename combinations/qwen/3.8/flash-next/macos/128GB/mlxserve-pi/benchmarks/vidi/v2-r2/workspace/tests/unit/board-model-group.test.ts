// Group document operations: moveObjects, resizeObjects, bringObjectsToFront,
// deleteObjects, objectsInRect, allObjectIds, objectBounds (TC-05 through TC-10).

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
} from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { putRawObject, rawObject, rawObjects } from '../helpers/yjs';

const ORIGIN = 'yellow';

function docWith(positions: [x: number, y: number][]): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = positions.map(([x, y]) => createSticky(doc, { x, y }, ORIGIN));
  return { doc, ids };
}

describe('board-model group operations', () => {
  // TC-05
  it('moveObjects writes every existing object in one transaction, skipping removed ids', () => {
    const { doc, ids } = docWith([[0, 0], [100, 0], [200, 0]]);
    deleteObject(doc, ids[2]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const moved = moveObjects(
      doc,
      new Map([
        [ids[0], { x: 10, y: 20 }],
        [ids[1], { x: 110, y: 120 }],
        [ids[2], { x: 210, y: 220 }],
      ]),
    );

    expect(moved).toBe(2);
    expect(updates).toBe(1);
    const after = snapshot(doc);
    expect(after.map((n) => [n.x, n.y])).toEqual([
      [10, 20],
      [110, 120],
    ]);
  });

  // TC-05, the group op keeps the single-object contract of one write per change
  it('moveObjects opens no transaction when every position already says that', () => {
    const { doc, ids } = docWith([[7, 8]]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const already = snapshot(doc)[0];
    expect(moveObjects(doc, new Map([[ids[0], { x: already.x, y: already.y }]]))).toBe(0);
    expect(updates).toBe(0);
  });

  // TC-05 (relative layout, the D5 dimension of the group op)
  it('moveObjects shifts a whole selection by the same amount, layout kept', () => {
    const { doc, ids } = docWith([[0, 0], [300, 400]]);

    moveObjects(
      doc,
      new Map([
        [ids[0], { x: 10, y: 10 }],
        [ids[1], { x: 310, y: 410 }],
      ]),
    );

    const after = snapshot(doc);
    expect(after[1].x - after[0].x).toBe(300);
    expect(after[1].y - after[0].y).toBe(400);
  });

  // TC-06
  it('bringObjectsToFront lifts the whole selection above the rest, relative order kept', () => {
    const { doc, ids } = docWith([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]]);
    // ids 0, 2 and 4 are the selection; 1 and 3 stay behind
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const raised = bringObjectsToFront(doc, [ids[4], ids[2], ids[0]]);

    const objects = rawObjects(doc);
    const z = (id: string): number => (objects.get(id) as Y.Map<unknown>).get('z') as number;
    expect(raised).toBe(3);
    expect(updates).toBe(1);
    // the unselected ceiling is 4 (id 3); ranks are kept among the raised
    expect(z(ids[0])).toBe(5);
    expect(z(ids[2])).toBe(6);
    expect(z(ids[4])).toBe(7);
    expect(z(ids[1])).toBe(2);
    expect(z(ids[3])).toBe(4);
  });

  it('bringObjectsToFront writes nothing when the selection is already on top in order', () => {
    const { doc, ids } = docWith([[0, 0], [10, 0], [20, 0]]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    expect(bringObjectsToFront(doc, [ids[1], ids[2]])).toBe(0);
    expect(updates).toBe(0);
  });

  it('bringObjectsToFront skips missing ids', () => {
    const { doc, ids } = docWith([[0, 0], [10, 0]]);

    expect(bringObjectsToFront(doc, [ids[0], 'gone'])).toBe(1);
    expect(rawObjects(doc).has('gone')).toBe(false);
  });

  // TC-08
  it('allObjectIds excludes types this model does not know', () => {
    const { doc, ids } = docWith([[0, 0], [100, 0]]);
    // a shape object written straight into the map: present, but unknown here
    const objects = rawObjects(doc);
    const shape = new Y.Map<unknown>();
    shape.set('id', 'shape-1');
    shape.set('type', 'shape-1');
    shape.set('x', 500);
    shape.set('y', 0);
    shape.set('z', 9);
    objects.set('shape-1', shape);

    const all: ObjectSnapshot[] = [
      ...snapshot(doc),
      { id: 'shape-1', type: 'shape-1', x: 500, y: 0, z: 9 },
    ];

    expect(allObjectIds(all)).toEqual(ids);
    expect(allObjectIds([])).toEqual([]);
  });

  it('objectsInRect returns only the ids fully enclosed, in snapshot order', () => {
    const doc = new Y.Doc();
    // raw positions, so the maths is about containment only
    putRawObject(doc, 'A', { x: 0, y: 0 });
    putRawObject(doc, 'B', { x: 300, y: 0 });
    putRawObject(doc, 'C', { x: 40, y: 40 });
    putRawObject(doc, 'D', { x: 500, y: 500 });
    const snap = snapshot(doc);
    const idOf = (n: number) => snap[n].id;

    // the first note exactly: its right and bottom edges touch the marquee
    expect(objectsInRect(snap, { x: 0, y: 0, width: 200, height: 200 })).toEqual([idOf(0)]);
    // A, B and C are inside; D only touches from outside
    expect(objectsInRect(snap, { x: 0, y: 0, width: 500, height: 500 })).toEqual([
      idOf(0),
      idOf(1),
      idOf(2),
    ]);
    // a marquee that cuts B (it ends at 500) is not a selection
    expect(objectsInRect(snap, { x: 0, y: 0, width: 300, height: 300 })).toEqual([idOf(0), idOf(2)]);
    // touching the marquee from outside selects nothing
    expect(objectsInRect(snap, { x: -50, y: -50, width: 100, height: 100 })).toEqual([]);
    expect(objectsInRect(snap, { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    // a non-finite rect encloses nothing
    expect(objectsInRect(snap, { x: NaN, y: 0, width: 1000, height: 1000 })).toEqual([]);
    expect(objectsInRect([], { x: 0, y: 0, width: 500, height: 500 })).toEqual([]);
  });

  // TC-09
  it('rejects a non-finite move or resize with zero applied and no transaction', () => {
    const { doc, ids } = docWith([[0, 0], [100, 0]]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const before = JSON.stringify(snapshot(doc));

    expect(moveObjects(doc, new Map([[ids[0], { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[ids[0], { x: 5, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(
      resizeObjects(
        doc,
        new Map([
          [ids[0], { x: 5, y: 0, width: 300, height: 300 }],
          [ids[1], { x: 5, y: 0, width: NaN, height: 300 }],
        ]),
      ),
    ).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['never-existed'])).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);

    expect(updates).toBe(0);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
  });

  it('resizeObjects skips ids removed mid-gesture and writes the rest in one transaction', () => {
    const { doc, ids } = docWith([[0, 0], [100, 0]]);
    deleteObject(doc, ids[1]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const resized = resizeObjects(
      doc,
      new Map([
        [ids[0], { x: -50, y: -50, width: 300, height: 300 }],
        [ids[1], { x: 0, y: 0, width: 400, height: 400 }],
      ]),
    );

    expect(resized).toBe(1);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]).toMatchObject({ x: -50, y: -50, width: 300, height: 300 });
  });

  // TC-10
  it('objectBounds reads the size, defaulting to STICKY_SIZE_WORLD; the first resize writes both fields', () => {
    const { doc, ids } = docWith([[104, 106]]);
    const stored = { x: 104 - STICKY_SIZE_WORLD / 2, y: 106 - STICKY_SIZE_WORLD / 2 };
    // nothing stored yet: the implicit size
    expect(objectBounds(snapshot(doc)[0])).toEqual({
      ...stored,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    resizeObjects(doc, new Map([[ids[0], { ...stored, x: stored.x + 1, y: stored.y + 1, width: 250, height: 250 }]]));

    const raw = rawObject(doc, ids[0]);
    expect(raw?.get('width')).toBe(250);
    expect(raw?.get('height')).toBe(250);
    expect(objectBounds(snapshot(doc)[0])).toEqual({
      x: stored.x + 1,
      y: stored.y + 1,
      width: 250,
      height: 250,
    });
  });

  it('objectBounds of a half-stored object falls back per axis', () => {
    const { doc } = docWith([]);
    const objects = rawObjects(doc);
    const raw = new Y.Map<unknown>();
    raw.set('id', 'half');
    raw.set('type', 'sticky');
    raw.set('x', 0);
    raw.set('y', 0);
    raw.set('z', 1);
    raw.set('width', 120);
    objects.set('half', raw);

    expect(objectBounds({ id: 'half', type: 'sticky', x: 0, y: 0, z: 1, width: 120 })).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('deleteObjects removes every existing id in one transaction', () => {
    const { doc, ids } = docWith([[0, 0], [10, 0], [20, 0]]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    expect(deleteObjects(doc, [ids[0], 'gone', ids[2]])).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[1]]);
  });

  // the story-2 single-object wrappers keep their exact semantics
  it('keeps the single-object semantics through the group implementations', () => {
    const { doc, ids } = docWith([[0, 0]]);

    expect(moveObject(doc, ids[0], 5, 5)).toBe(true);
    expect(moveObject(doc, ids[0], 5, 5)).toBe(true); // already there, still true
    expect(moveObject(doc, 'gone', 5, 5)).toBe(false);
    expect(moveObject(doc, ids[0], Number.NaN, 5)).toBe(false);

    expect(bringToFront(doc, ids[0])).toBe(false); // the only note is already top
    createSticky(doc, { x: 9, y: 9 }, ORIGIN);
    expect(bringToFront(doc, ids[0])).toBe(true);

    expect(deleteObject(doc, ids[0])).toBe(true);
    expect(deleteObject(doc, ids[0])).toBe(false);

    // a sticky that lost its text stays unreadable to the single-object door
    const other = snapshot(doc)[0].id;
    const raw = rawObject(doc, other);
    raw?.delete('text');
    expect(moveObject(doc, other, 1, 1)).toBe(false);
  });

  it('resizeObjects on a sticky with no stored size writes width and height only, min respected by callers', () => {
    const { doc, ids } = docWith([[0, 0]]);

    resizeObjects(doc, new Map([[ids[0], { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD }]]));

    expect(rawObject(doc, ids[0])?.get('width')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(snapshot(doc)[0].width).toBe(STICKY_MIN_SIZE_WORLD);
  });
});
