// Story 7, contract `sel.geometry_ops` (board-model half) — unit tests
// TC-05..TC-10 against a real Y.Doc: the generic group operations every later
// object type reuses. Only Yjs is real here; there is no DOM.

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  createObject,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectSnapshots,
  snapshot,
  bringToFront,
  deleteObject,
  BOARD_MODEL_TYPES,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import {
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
} from '../../src/shared/config.ts';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** How many Y.Doc "update" events `fn` emits. */
function updatesOf(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const h = () => {
    n++;
  };
  doc.on('update', h);
  try {
    fn();
  } finally {
    doc.off('update', h);
  }
  return n;
}

function byId(snap: readonly ObjectSnapshot[], id: string): ObjectSnapshot {
  const o = snap.find((s) => s.id === id);
  if (!o) throw new Error(`object ${id} missing from snapshot`);
  return o;
}

/** Drop a row straight into the document, the way a foreign writer would. */
function rawObject(doc: Y.Doc, id: string, props: Record<string, unknown>): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    for (const [k, v] of Object.entries(props)) o.set(k, v);
    objects.set(id, o);
  }, LOCAL_ORIGIN);
}

let doc: Y.Doc;
beforeEach(() => {
  doc = freshDoc();
});

describe('board.model.group', () => {
  it('TC-05 moveObjects writes 2 of 3 ids when one was deleted, in exactly 1 update', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    const c = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, c); // deleted by someone else mid-gesture

    const positions = new Map([
      [a, { x: 10, y: 20 }],
      [b, { x: 30, y: 40 }],
      [c, { x: 50, y: 60 }],
    ]);
    let n = -1;
    const u = updatesOf(doc, () => {
      n = moveObjects(doc, positions);
    });
    expect(n).toBe(2); // the missing id is skipped, not an error
    expect(u).toBe(1); // and the two writes are one transaction
    const s = snapshot(doc);
    expect(byId(s, a).x).toBe(10);
    expect(byId(s, a).y).toBe(20);
    expect(byId(s, b).x).toBe(30);
    expect(s.find((o) => o.id === c)).toBeUndefined();
  });

  it('TC-06 bringObjectsToFront raises 3 selected above 2 unselected and keeps their order', () => {
    // Two notes stay unselected; three overlap each other and are selected.
    const u1 = createSticky(doc, { x: 0, y: 0 });
    const u2 = createSticky(doc, { x: 0, y: 0 });
    const s1 = createSticky(doc, { x: 40, y: 40 });
    const s2 = createSticky(doc, { x: 60, y: 60 });
    const s3 = createSticky(doc, { x: 80, y: 80 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3, 4, 5]);

    // Move the bottom two selected notes to the back, so the selection is not
    // already in front (a realistic "drag the middle of the pile" state).
    rawObject(doc, s1, { type: 'sticky', x: 40, y: 40, z: 1, createdAt: 1, color: 'yellow', text: '' });
    rawObject(doc, s2, { type: 'sticky', x: 60, y: 60, z: 3, createdAt: 1, color: 'yellow', text: '' });
    rawObject(doc, u1, { type: 'sticky', x: 0, y: 0, z: 6, createdAt: 1, color: 'yellow', text: '' });
    rawObject(doc, u2, { type: 'sticky', x: 0, y: 0, z: 7, createdAt: 1, color: 'yellow', text: '' });
    // Now: s1 z1, s2 z3, s3 z5, u1 z6, u2 z7.

    let n = -1;
    const u = updatesOf(doc, () => {
      n = bringObjectsToFront(doc, [s3, s2, s1]); // deliberately unsorted input
    });
    expect(n).toBe(3);
    expect(u).toBe(1);
    const s = snapshot(doc);
    const maxUnselected = Math.max(byId(s, u1).z, byId(s, u2).z);
    const zs = [byId(s, s1).z, byId(s, s2).z, byId(s, s3).z];
    expect(Math.min(...zs)).toBeGreaterThan(maxUnselected); // above every unselected
    // Their relative order is the one they had: s1 < s2 < s3.
    expect(zs[0]).toBeLessThan(zs[1]);
    expect(zs[1]).toBeLessThan(zs[2]);
    expect(zs).toEqual([maxUnselected + 1, maxUnselected + 2, maxUnselected + 3]);
    expect(maxUnselected).toBe(7);
  });

  it('TC-06b bringObjectsToFront is a no-op (0, no update) when the selection is already in front', () => {
    createSticky(doc, { x: 0, y: 0 }); // z 1
    const top = createSticky(doc, { x: 0, y: 0 }); // z 2
    let n = -1;
    const u = updatesOf(doc, () => {
      n = bringObjectsToFront(doc, [top]);
    });
    expect(n).toBe(0);
    expect(u).toBe(0);
    // and the story 2 single-object wrapper reports it the same way
    expect(bringToFront(doc, top)).toBe(false);
  });

  it('TC-07 objectsInRect selects the object fully inside only, never one it partly covers', () => {
    const a = createSticky(doc, { x: 100, y: 100 }); // top-left (0, 0), 200x200
    const b = createSticky(doc, { x: 290, y: 100 }); // top-left (190, 0) → crosses the box
    const c = createSticky(doc, { x: 900, y: 900 }); // far outside
    const box = { x: -20, y: -20, width: 220, height: 220 }; // reaches exactly a's bottom-right
    expect(objectBounds(byId(objectSnapshots(doc), a))).toEqual({
      x: 0,
      y: 0,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    expect(objectsInRect(objectSnapshots(doc), box)).toEqual([a]);
    expect(objectsInRect(objectSnapshots(doc), box)).not.toContain(b);
    expect(objectsInRect(objectSnapshots(doc), box)).not.toContain(c);
    // A box that encloses everything selects everything.
    expect(objectsInRect(objectSnapshots(doc), { x: -100, y: -100, width: 2000, height: 2000 })).toEqual(
      [a, b, c],
    );
  });

  it('TC-08 allObjectIds takes every selectable object and skips a type nobody registered', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    const future = createObject(doc, 'testbox', { x: 0, y: 0 }, { width: 10, height: 10 });
    rawObject(doc, 'weird', { type: 'not-a-type', x: 0, y: 0, z: 9 });
    expect(BOARD_MODEL_TYPES.has('sticky')).toBe(true);
    // With only board-model's own types known: the stickies.
    expect(allObjectIds(objectSnapshots(doc))).toEqual([a, b]);
    // With a wider registry: the testbox joins, the unregistered type never does.
    expect(allObjectIds(objectSnapshots(doc), new Set(['sticky', 'testbox']))).toEqual([
      a,
      b,
      future,
    ]);
    expect(allObjectIds([], new Set(['sticky']))).toEqual([]);
  });

  it('TC-09 non-finite positions and empty id lists write nothing', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = { ...snapshot(doc)[0]! };

    const badPositions: readonly (readonly [string, ReadonlyMap<string, { x: number; y: number }>])[] = [
      ['NaN x', new Map([[a, { x: NaN, y: 1 }]])],
      ['Infinity y', new Map([[a, { x: 1, y: Infinity }]])],
      [
        'one bad id of many',
        new Map([
          [a, { x: 1, y: 1 }],
          ['gone', { x: NaN, y: 0 }],
        ]),
      ],
    ];
    for (const [name, positions] of badPositions) {
      let n = -1;
      const u = updatesOf(doc, () => {
        n = moveObjects(doc, positions);
      });
      expect(n, name).toBe(0);
      expect(u, name).toBe(0);
    }
    // Empty lists: no transaction at all.
    for (const call of [
      () => moveObjects(doc, new Map()),
      () => resizeObjects(doc, new Map()),
      () => deleteObjects(doc, []),
      () => bringObjectsToFront(doc, []),
    ]) {
      let n: unknown = null;
      const u = updatesOf(doc, () => {
        n = call();
      });
      expect(u).toBe(0);
      expect(n).toBe(0);
    }
    // A bad rect rejects the whole resize, not part of it.
    const b = createSticky(doc, { x: 0, y: 0 });
    let n = -1;
    const u = updatesOf(doc, () => {
      n = resizeObjects(doc, new Map([
        [a, { x: 0, y: 0, width: 100, height: 100 }],
        [b, { x: 0, y: 0, width: Infinity, height: 100 }],
      ]));
    });
    expect(n).toBe(0);
    expect(u).toBe(0);
    expect(snapshot(doc).find((s) => s.id === a)!.width).toBeUndefined();
    expect(snapshot(doc)[0]).toEqual(before);
  });

  it('TC-10 a sticky without width/height bounds at STICKY_SIZE_WORLD; the first resize writes both', () => {
    const id = createSticky(doc, { x: 400, y: 300 });
    const snap = objectSnapshots(doc);
    const obj = byId(snap, id);
    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();
    expect(objectBounds(obj)).toEqual({
      x: 300,
      y: 200,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    // The first resize persists an explicit size, at exactly the old size when
    // the object is not actually resized.
    let n = -1;
    const u = updatesOf(doc, () => {
      n = resizeObjects(doc, new Map([[id, { x: 300, y: 200, width: 400, height: 400 }]]));
    });
    expect(n).toBe(1);
    expect(u).toBe(1);
    const after = byId(objectSnapshots(doc), id);
    expect(after.width).toBe(400);
    expect(after.height).toBe(400);
    expect(objectBounds(after)).toEqual({ x: 300, y: 200, width: 400, height: 400 });
    // The size limits in the config are consistent with the note's default size.
    expect(STICKY_MIN_SIZE_WORLD).toBeLessThan(STICKY_SIZE_WORLD);
    expect(MAX_OBJECT_SIZE_WORLD).toBeGreaterThan(STICKY_SIZE_WORLD);
  });

  it('a stored non-positive or non-finite size is ignored by objectBounds', () => {
    rawObject(doc, 'odd', { type: 'sticky', x: 5, y: 6, z: 1, createdAt: 1, width: 0, height: -3 });
    expect(objectBounds(byId(objectSnapshots(doc), 'odd'))).toEqual({
      x: 5,
      y: 6,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('createObject writes an explicit size and on top of the pile; objectSnapshots keeps render order', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const box = createObject(doc, 'testbox', { x: 7, y: 9 }, { width: 40, height: 25 });
    const snap = objectSnapshots(doc);
    expect(snap.map((o) => o.id)).toEqual([a, box]);
    expect(objectBounds(byId(snap, box))).toEqual({ x: 7, y: 9, width: 40, height: 25 });
    // Sticky-only snapshot still ignores foreign types (story 2's rule).
    expect(snapshot(doc).map((o) => o.id)).toEqual([a]);
  });

  it('deleteObjects removes several ids in one update and skips missing ones', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    let n = -1;
    const u = updatesOf(doc, () => {
      n = deleteObjects(doc, [a, 'missing', b]);
    });
    expect(n).toBe(2);
    expect(u).toBe(1);
    expect(objectSnapshots(doc)).toHaveLength(0);
  });
});
