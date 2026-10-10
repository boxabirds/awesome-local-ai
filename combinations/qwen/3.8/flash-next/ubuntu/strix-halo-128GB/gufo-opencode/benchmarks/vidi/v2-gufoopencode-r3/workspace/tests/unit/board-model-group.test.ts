import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
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
  snapshotAll,
  bringToFront as bringToFrontWrapper,
  LOCAL_ORIGIN
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function docWithNotes(count: number): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(createSticky(doc, { x: i * 100, y: i * 100 }));
  }
  return { doc, ids };
}

function addRawObject(doc: Y.Doc, type: string, x: number, y: number): string {
  const id = `raw-${type}-${x}-${y}`;
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', type);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('z', 1);
    doc.getMap('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  fn();
  doc.off('update', listener);
  return updates;
}

describe('group operations: moveObjects', () => {
  // TC-05
  test('TC-05 skips a deleted id, returns 2 and emits exactly one update event', () => {
    const { doc, ids } = docWithNotes(3);
    deleteObject(doc, ids[1]);
    let updates = 0;
    const listener = () => {
      updates += 1;
    };
    doc.on('update', listener);
    const changed = moveObjects(
      doc,
      new Map([
        [ids[0], { x: 10, y: 20 }],
        [ids[1], { x: 30, y: 40 }], // deleted: skipped
        [ids[2], { x: 50, y: 60 }]
      ])
    );
    doc.off('update', listener);
    expect(changed).toBe(2);
    expect(updates).toBe(1);
    const snap = snapshotAll(doc);
    expect(snap.find((o) => o.id === ids[0])).toMatchObject({ x: 10, y: 20 });
    expect(snap.find((o) => o.id === ids[2])).toMatchObject({ x: 50, y: 60 });
  });

  // TC-09 (error path)
  test('TC-09 non-finite positions and empty id list apply nothing, no transaction', () => {
    const { doc, ids } = docWithNotes(1);
    expect(moveObjects(doc, new Map([[ids[0], { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[ids[0], { x: 0, y: Infinity }]]))).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([[ids[0], { x: 5, y: 5 }]]))).toBe(1);
    // Positions were not touched by the rejected calls.
    const [before] = snapshotAll(doc);
    const updates = countUpdates(doc, () => {
      expect(moveObjects(doc, new Map([[ids[0], { x: NaN, y: 0 }]]))).toBe(0);
    });
    expect(updates).toBe(0);
    expect(snapshotAll(doc)[0]).toEqual(before);
  });

  test('writes are absolute: moving to the current position changes nothing', () => {
    const { doc, ids } = docWithNotes(1);
    const [note] = snapshotAll(doc);
    expect(moveObjects(doc, new Map([[ids[0], { x: note.x, y: note.y }]]))).toBe(0);
  });
});

describe('group operations: bringObjectsToFront', () => {
  // TC-06
  test('TC-06 raises all selected above every unselected, keeping relative order', () => {
    const { doc, ids } = docWithNotes(5); // z 1..5 in creation order
    const selected = [ids[0], ids[2], ids[4]]; // z 1, 3, 5
    const unselected = [ids[1], ids[3]]; // z 2, 4
    const changed = bringObjectsToFront(doc, selected);
    expect(changed).toBeGreaterThan(0);
    const byId = new Map(snapshotAll(doc).map((o) => [o.id, o.z]));
    const maxUnselected = Math.max(...unselected.map((id) => byId.get(id)!));
    for (const id of selected) expect(byId.get(id)!).toBeGreaterThan(maxUnselected);
    // Relative order among the selected ones is preserved.
    expect(byId.get(ids[0])! < byId.get(ids[2])!).toBe(true);
    expect(byId.get(ids[2])! < byId.get(ids[4])!).toBe(true);
  });

  test('empty id list and stale ids are no-ops without a transaction', () => {
    const { doc } = docWithNotes(2);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['missing'])).toBe(0);
    expect(countUpdates(doc, () => bringObjectsToFront(doc, []))).toBe(0);
  });

  test('single-object wrapper keeps story 2 semantics', () => {
    const { doc, ids } = docWithNotes(3);
    const first = snapshotAll(doc)[0];
    expect(moveObject(doc, first.id, 1, 1)).toBe(true);
    const top = snapshotAll(doc).at(-1)!;
    expect(countUpdates(doc, () => bringToFrontWrapper(doc, top.id))).toBe(0);
    expect(bringToFrontWrapper(doc, 'missing')).toBe(false);
    void ids;
  });
});

describe('group operations: objectsInRect / allObjectIds', () => {
  // TC-07
  test('TC-07 fully inside → selected; partly inside and outside → not (negative)', () => {
    const { doc, ids } = docWithNotes(3);
    // A at (0,0) world centre → box −100..100; fully inside the marquee.
    // B at (250,0) → box 150..350 → partly inside (marquee ends at 300).
    // C at (600,0) → box 500..700 → outside.
    moveObjects(
      doc,
      new Map([
        [ids[0], { x: -100, y: -100 }],
        [ids[1], { x: 150, y: -100 }],
        [ids[2], { x: 500, y: -100 }]
      ])
    );
    const marquee = { x: -200, y: -200, width: 500, height: 400 };
    expect(objectsInRect(snapshotAll(doc), marquee)).toEqual([ids[0]]);
  });

  // TC-08
  test('TC-08 unknown types are skipped by allObjectIds and objectsInRect', () => {
    const { doc, ids } = docWithNotes(1);
    const widget = addRawObject(doc, 'widget', -100, -100);
    const snap = snapshotAll(doc);
    expect(snap.some((o) => o.id === widget)).toBe(true); // present, just not selectable
    const all = allObjectIds(snap);
    expect(all).toEqual([ids[0]]);
    expect(all).not.toContain(widget);
    expect(objectsInRect(snap, { x: -200, y: -200, width: 400, height: 400 })).toEqual([ids[0]]);
  });
});

describe('group operations: deleteObjects', () => {
  test('removes present ids, skips stale ones, one transaction', () => {
    const { doc, ids } = docWithNotes(3);
    const updates = countUpdates(doc, () => {
      expect(deleteObjects(doc, [ids[0], 'missing', ids[1]])).toBe(2);
    });
    expect(updates).toBe(1);
    expect(snapshotAll(doc).map((o) => o.id)).toEqual([ids[2]]);
    expect(deleteObjects(doc, ['missing'])).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
  });
});

describe('group operations: resizeObjects', () => {
  // TC-10
  test('TC-10 implicit-size sticky reads STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const { doc, ids } = docWithNotes(1);
    const [note] = snapshotAll(doc);
    expect(note.width).toBeUndefined();
    expect(objectBounds(note)).toEqual({ x: note.x, y: note.y, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    const changed = resizeObjects(doc, new Map([[ids[0], { x: note.x, y: note.y, width: 300, height: 250 }]]));
    expect(changed).toBe(1);
    const [resized] = snapshotAll(doc);
    expect(resized.width).toBe(300);
    expect(resized.height).toBe(250);
    expect(objectBounds(resized)).toEqual({ x: note.x, y: note.y, width: 300, height: 250 });
    expect(snapshot(doc)[0]).toMatchObject({ width: 300, height: 250 });
  });

  test('non-finite or non-positive sizes apply nothing, no transaction', () => {
    const { doc, ids } = docWithNotes(1);
    const [note] = snapshotAll(doc);
    const bad = [
      new Map([[ids[0], { x: note.x, y: note.y, width: NaN, height: 100 }]]),
      new Map([[ids[0], { x: note.x, y: note.y, width: 100, height: Infinity }]]),
      new Map([[ids[0], { x: note.x, y: note.y, width: -5, height: 100 }]]),
      new Map([[ids[0], { x: note.x, y: NaN, width: 100, height: 100 }]])
    ];
    for (const rects of bad) {
      expect(resizeObjects(doc, rects)).toBe(0);
      expect(snapshotAll(doc)[0]).toEqual(note);
    }
    expect(countUpdates(doc, () => resizeObjects(doc, new Map()))).toBe(0);
  });
});
