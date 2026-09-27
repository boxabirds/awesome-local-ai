// Story 7 — generic group operations in board-model (sel.geometry_ops).
// Real Y.Doc, no mocks: the transaction count IS the contract (one user action
// == one update event), and remote convergence depends on it.

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  declareObjectType,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
});

function objects(): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

interface MakeOpts {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z?: number;
  text?: string;
}

/** Plant an object with an exact id / size / z (the fixtures the group ops are
 * specified against need deterministic stacking and legacy no-size records). */
function make(id: string, opts: MakeOpts = {}): void {
  const ymap = new Y.Map<unknown>();
  ymap.set('type', opts.type ?? 'sticky');
  ymap.set('x', opts.x ?? 0);
  ymap.set('y', opts.y ?? 0);
  if (opts.width !== undefined) ymap.set('width', opts.width);
  if (opts.height !== undefined) ymap.set('height', opts.height);
  ymap.set('color', 'yellow');
  ymap.set('text', new Y.Text(opts.text ?? ''));
  ymap.set('z', opts.z ?? 1);
  ymap.set('createdAt', 1);
  doc.transact(() => {
    objects().set(id, ymap);
  }, LOCAL_ORIGIN);
  updates = 0;
}

function row(id: string): ObjectSnapshot | undefined {
  return snapshot(doc).find((o) => o.id === id);
}

function raw(id: string): Y.Map<unknown> | undefined {
  return objects().get(id);
}

describe('objectBounds', () => {
  it('TC-10a an object without width/height reads as STICKY_SIZE_WORLD', () => {
    make('legacy', { x: 10, y: 20 });
    const obj = row('legacy')!;
    expect(obj.width).toBeUndefined();
    expect(objectBounds(obj)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });

  it('an explicit size is read verbatim', () => {
    make('sized', { x: 1, y: 2, width: 400, height: 250 });
    expect(objectBounds(row('sized')!)).toEqual({ x: 1, y: 2, width: 400, height: 250 });
  });
});

describe('moveObjects', () => {
  it('TC-05 an id deleted by someone else is skipped: 2 of 3 written, ONE update event', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const c = createSticky(doc, { x: 600, y: 0 });
    deleteObjects(doc, [b]);
    updates = 0;

    const changed = moveObjects(
      doc,
      new Map([
        [a, { x: 10, y: 20 }],
        [b, { x: 30, y: 40 }], // gone from the doc: skipped
        [c, { x: 50, y: 60 }],
      ]),
    );
    expect(changed).toBe(2);
    expect(updates).toBe(1);
    expect(row(a)!.x).toBe(10);
    expect(row(c)!.y).toBe(60);
  });

  it('writes absolute positions for the whole selection in one transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    updates = 0;
    expect(
      moveObjects(
        doc,
        new Map([
          [a, { x: -500, y: 7 }],
          [b, { x: -400, y: 7 }],
        ]),
      ),
    ).toBe(2);
    expect(updates).toBe(1);
    expect(row(a)!.x).toBe(-500);
    expect(row(b)!.x).toBe(-400);
  });

  it('TC-09 NaN / Infinity positions: 0 written and NO transaction (error path)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    updates = 0;
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]]))).toBe(0);
    expect(updates).toBe(0);
    expect(row(a)!.x).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-09 an empty id list writes nothing and opens no transaction', () => {
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(updates).toBe(0);
  });

  it('an unknown id is skipped and produces no transaction', () => {
    expect(moveObjects(doc, new Map([['nope', { x: 1, y: 1 }]]))).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('resizeObjects', () => {
  it('TC-10b the first resize writes BOTH width and height on a legacy note', () => {
    make('legacy', { x: 0, y: 0, z: 1 });
    expect(raw('legacy')!.has('width')).toBe(false);
    expect(raw('legacy')!.has('height')).toBe(false);

    const changed = resizeObjects(doc, new Map([['legacy', { x: 0, y: 0, width: 400, height: 400 }]]));
    expect(changed).toBe(1);
    expect(updates).toBe(1);
    expect(raw('legacy')!.get('width')).toBe(400);
    expect(raw('legacy')!.get('height')).toBe(400);
    expect(objectBounds(row('legacy')!)).toEqual({ x: 0, y: 0, width: 400, height: 400 });
  });

  it('resizes several objects in one transaction and keeps other fields', () => {
    const a = createSticky(doc, { x: 0, y: 0 }, 'pink');
    const b = createSticky(doc, { x: 300, y: 0 });
    getStickyText(doc, a)!.insert(0, 'kept');
    updates = 0;
    const changed = resizeObjects(
      doc,
      new Map([
        [a, { x: 0, y: 0, width: 400, height: 400 }],
        [b, { x: 400, y: 0, width: 400, height: 400 }],
      ]),
    );
    expect(changed).toBe(2);
    expect(updates).toBe(1);
    expect(row(a)!.color).toBe('pink');
    expect(row(a)!.text).toBe('kept');
  });

  it('TC-09 a non-finite or non-positive rect refuses the whole call (error path)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    updates = 0;
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: -1, height: 10 }]]))).toBe(0);
    // One invalid target must not let the valid one through either.
    expect(
      resizeObjects(
        doc,
        new Map([
          [a, { x: 0, y: 0, width: 100, height: 100 }],
          [b, { x: NaN, y: 0, width: 100, height: 100 }],
        ]),
      ),
    ).toBe(0);
    expect(updates).toBe(0);
    expect(row(b)!.width).toBe(STICKY_SIZE_WORLD);
  });

  it('a size clamp at STICKY_MIN_SIZE_WORLD is representable exactly', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD }]]));
    expect(objectBounds(row(a)!).width).toBe(STICKY_MIN_SIZE_WORLD);
  });
});

describe('bringObjectsToFront', () => {
  it('TC-06 three selected notes go above two unselected ones, relative order kept', () => {
    make('u1', { z: 1 });
    make('s1', { z: 2 });
    make('s2', { z: 4 });
    make('u2', { z: 5 });
    make('s3', { z: 6 });
    updates = 0;

    // s3 is already the topmost object, but it sits BELOW the slots s1 and s2 are
    // given, so keeping it there would invert the selection's order: all three are
    // restacked, in one transaction.
    expect(bringObjectsToFront(doc, ['s1', 's2', 's3'])).toBe(3);
    expect(updates).toBe(1);

    const order = snapshot(doc).map((o) => o.id);
    // Unselected stay at the bottom, in their own order.
    expect(order.slice(0, 2)).toEqual(['u1', 'u2']);
    // Selected are above them, in their previous relative order.
    expect(order.slice(2)).toEqual(['s1', 's2', 's3']);
  });

  it('is idempotent: raising an already-raised selection writes nothing', () => {
    make('u1', { z: 1 });
    make('s1', { z: 2 });
    bringObjectsToFront(doc, ['s1']);
    updates = 0;
    expect(bringObjectsToFront(doc, ['s1'])).toBe(0);
    expect(updates).toBe(0);
  });

  it('missing ids are skipped', () => {
    make('s1', { z: 1 });
    make('u1', { z: 2 });
    updates = 0;
    expect(bringObjectsToFront(doc, ['s1', 'ghost'])).toBe(1);
    expect(row('s1')!.z).toBe(3);
  });
});

describe('deleteObjects', () => {
  it('removes the whole selection in one transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    updates = 0;
    expect(deleteObjects(doc, [a, b, 'ghost'])).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('objectsInRect / allObjectIds', () => {
  it('TC-07 only objects ENTIRELY inside the rect are returned (B partly inside is negative)', () => {
    make('A', { x: 100, y: 100, width: 200, height: 200, z: 1 });
    make('B', { x: 250, y: 100, width: 200, height: 200, z: 2 });
    make('C', { x: 900, y: 900, width: 200, height: 200, z: 3 });
    const ids = objectsInRect(snapshot(doc), { x: 50, y: 50, width: 300, height: 300 });
    expect(ids).toEqual(['A']);
  });

  it('an object exactly on the rect edge counts as inside', () => {
    make('edge', { x: 50, y: 50, width: 100, height: 100, z: 1 });
    expect(objectsInRect(snapshot(doc), { x: 50, y: 50, width: 100, height: 100 })).toEqual(['edge']);
  });

  it('a legacy object (no size) is measured at STICKY_SIZE_WORLD', () => {
    make('legacy', { x: 0, y: 0, z: 1 });
    expect(objectsInRect(snapshot(doc), { x: -1, y: -1, width: 300, height: 300 })).toEqual(['legacy']);
  });

  it('TC-08 allObjectIds skips an object of an undeclared type', () => {
    make('a', { z: 1 });
    make('b', { z: 2 });
    make('mystery', { type: 'mystery-shape', x: 0, y: 0, z: 3 });
    // Not in the snapshot at all (forward-compatibility rule)…
    expect(snapshot(doc).map((o) => o.id)).toEqual(['a', 'b']);
    // …and allObjectIds refuses it even when handed a snapshot that contains it.
    const withMystery: ObjectSnapshot[] = [
      ...snapshot(doc),
      { id: 'mystery', type: 'mystery-shape', x: 0, y: 0, z: 3, createdAt: 1 },
    ];
    expect(allObjectIds(withMystery)).toEqual(['a', 'b']);
    expect(objectsInRect(withMystery, { x: -1000, y: -1000, width: 10_000, height: 10_000 })).toEqual(['a', 'b']);
  });

  it('declaring a type makes its objects selectable (the hook stories 9–12 use)', () => {
    declareObjectType('unitbox');
    make('box', { type: 'unitbox', x: 0, y: 0, width: 40, height: 30, z: 1 });
    expect(allObjectIds(snapshot(doc))).toEqual(['box']);
    make('ghost', { type: 'not-declared', x: 0, y: 0, z: 2 });
    expect(allObjectIds(snapshot(doc))).toEqual(['box']);
  });

  it('moveObjects refuses to move an undeclared object (error path)', () => {
    make('mystery', { type: 'mystery-shape', x: 0, y: 0, z: 1 });
    updates = 0;
    expect(moveObjects(doc, new Map([['mystery', { x: 5, y: 5 }]]))).toBe(0);
    expect(deleteObjects(doc, ['mystery'])).toBe(0);
    expect(updates).toBe(0);
  });
});
