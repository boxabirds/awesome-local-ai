import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  deleteObject,
  snapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  getObjectsMap,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/** Counts Y.Doc `update` events: one per successful transaction, none for a rejection. */
function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

/** Create a note whose top-left lands exactly on (x, y). */
function createAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
}

/** Put an object of an arbitrary type into the document, as a newer client would. */
function putRawObject(doc: Y.Doc, id: string, type: string, x: number, y: number, z: number): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', type);
    m.set('x', x);
    m.set('y', y);
    m.set('z', z);
    m.set('createdAt', 0);
    getObjectsMap(doc).set(id, m);
  });
}

describe('board.model group ops — objectBounds', () => {
  it('TC-10: a note without a stored size reads as STICKY_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    const id = createAt(doc, 10, 20);
    doc.transact(() => {
      const m = getObjectsMap(doc).get(id)!;
      m.delete('width');
      m.delete('height');
    });

    const obj = snapshot(doc)[0];
    expect(obj.width).toBeUndefined();
    expect(objectBounds(obj)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });

  it('reads a stored size when there is one', () => {
    const doc = new Y.Doc();
    const id = createAt(doc, 0, 0);
    expect(objectBounds(snapshot(doc)[0])).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    expect(
      resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 320, height: 260 }]])),
    ).toBe(1);
    expect(objectBounds(snapshot(doc)[0])).toEqual({ x: 0, y: 0, width: 320, height: 260 });
  });
});

describe('board.model group ops — moveObjects', () => {
  it('TC-05: an id deleted while the gesture runs is skipped, in one transaction', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const b = createAt(doc, 300, 0);
    const c = createAt(doc, 600, 0);
    deleteObject(doc, b);
    const stop = updateCounter(doc);

    const positions = new Map([
      [a, { x: 40, y: 50 }],
      [b, { x: 40, y: 50 }],
      [c, { x: 40, y: 50 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(2);
    expect(stop()).toBe(1);

    const after = snapshot(doc);
    expect(after).toHaveLength(2);
    expect(after.map((n) => [n.x, n.y])).toEqual([
      [40, 50],
      [40, 50],
    ]);
  });

  it('keeps the relative layout of a group move', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const b = createAt(doc, 300, 100);
    const before = snapshot(doc);

    moveObjects(
      doc,
      new Map([
        [a, { x: 0 + 25, y: 0 - 40 }],
        [b, { x: 300 + 25, y: 100 - 40 }],
      ]),
    );

    const after = snapshot(doc);
    expect(after[1].x - after[0].x).toBeCloseTo(before[1].x - before[0].x, 9);
    expect(after[1].y - after[0].y).toBeCloseTo(before[1].y - before[0].y, 9);
  });

  it('leaves size, colour, text and stacking order alone', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const before = snapshot(doc)[0];
    moveObjects(doc, new Map([[a, { x: 12, y: 34 }]]));
    const after = snapshot(doc)[0];
    expect(after.width).toBe(before.width);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
  });

  it('TC-09: non-finite positions and an empty map write nothing and open no transaction', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const b = createAt(doc, 300, 0);
    const before = snapshot(doc)[0];
    const beforeB = snapshot(doc).find((n) => n.id === b)!;
    const stop = updateCounter(doc);

    const nanPosition = new Map<string, Point>([[a, { x: Number.NaN, y: 0 }]]);
    const infinitePosition = new Map<string, Point>([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]);
    // One invalid position rejects the whole call: the valid entry is not written either.
    const mixedWithValid = new Map<string, Point>([
      [a, { x: 5, y: 5 }],
      [b, { x: Number.NaN, y: 0 }],
    ]);

    expect(moveObjects(doc, nanPosition)).toBe(0);
    expect(moveObjects(doc, infinitePosition)).toBe(0);
    expect(moveObjects(doc, mixedWithValid)).toBe(0);
    expect(moveObjects(doc, new Map<string, Point>())).toBe(0);

    const after = snapshot(doc).find((n) => n.id === a)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(snapshot(doc).find((n) => n.id === b)!.x).toBe(beforeB.x);
    expect(stop()).toBe(0);
  });

  it('writes no transaction when every object already sits where asked', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const stop = updateCounter(doc);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: 0 }]]))).toBe(0);
    expect(stop()).toBe(0);
  });

  it('story 2 moveObject is the single-object form of moveObjects', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const stop = updateCounter(doc);
    expect(moveObject(doc, a, 7, 9)).toBe(true);
    expect(moveObject(doc, a, 7, 9)).toBe(false);
    expect(moveObject(doc, 'gone', 1, 1)).toBe(false);
    expect(stop()).toBe(1);
  });
});

describe('board.model group ops — resizeObjects', () => {
  it('TC-10: the first resize of a legacy note writes both width and height', () => {
    const doc = new Y.Doc();
    const id = createAt(doc, 0, 0);
    doc.transact(() => {
      const m = getObjectsMap(doc).get(id)!;
      m.delete('width');
      m.delete('height');
    });
    const stop = updateCounter(doc);

    expect(resizeObjects(doc, new Map([[id, { x: 5, y: 6, width: 240, height: 240 }]]))).toBe(1);
    expect(stop()).toBe(1);

    const m = getObjectsMap(doc).get(id)!;
    expect(m.get('width')).toBe(240);
    expect(m.get('height')).toBe(240);
    expect(m.get('x')).toBe(5);
    expect(m.get('y')).toBe(6);
  });

  it('TC-09: a non-finite or empty rect list writes nothing', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const before = snapshot(doc)[0];
    const stop = updateCounter(doc);

    const nanWidth = new Map<string, Rect>([[a, { x: 0, y: 0, width: Number.NaN, height: 100 }]]);
    const zeroWidth = new Map<string, Rect>([[a, { x: 0, y: 0, width: 0, height: 100 }]]);
    const infiniteX = new Map<string, Rect>([[a, { x: Number.POSITIVE_INFINITY, y: 0, width: 100, height: 100 }]]);

    expect(resizeObjects(doc, nanWidth)).toBe(0);
    expect(resizeObjects(doc, zeroWidth)).toBe(0);
    expect(resizeObjects(doc, infiniteX)).toBe(0);
    expect(resizeObjects(doc, new Map<string, Rect>())).toBe(0);

    expect(snapshot(doc)[0]).toEqual(before);
    expect(stop()).toBe(0);
  });

  it('skips ids that are gone', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    expect(
      resizeObjects(doc, new Map([
        [a, { x: 0, y: 0, width: 120, height: 120 }],
        ['gone', { x: 0, y: 0, width: 120, height: 120 }],
      ])),
    ).toBe(1);
  });
});

describe('board.model group ops — bringObjectsToFront', () => {
  it('TC-06: the selection lands above every unselected object, own order kept', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0); // z 1
    const b = createAt(doc, 10, 0); // z 2
    const c = createAt(doc, 20, 0); // z 3
    const d = createAt(doc, 30, 0); // z 4
    const e = createAt(doc, 40, 0); // z 5

    expect(bringObjectsToFront(doc, [c, a, b])).toBe(3);

    const ordered = snapshot(doc);
    expect(ordered.map((n) => n.id)).toEqual([d, e, a, b, c]);
    expect(ordered.map((n) => n.z)).toEqual([4, 5, 6, 7, 8]);
  });

  it('raises a single object above the others and is a no-op when already on top', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const top = createAt(doc, 10, 0);
    const stop = updateCounter(doc);

    expect(bringToFront(doc, a)).toBe(true);
    expect(snapshot(doc).map((n) => n.z)).toEqual([2, 3]);
    expect(bringToFront(doc, a)).toBe(false); // already in front of everything
    expect(bringToFront(doc, 'stale')).toBe(false);
    expect(bringToFront(doc, top)).toBe(true); // 'top' was buried by the move above
    expect(stop()).toBe(2);
  });

  it('an empty id list writes nothing', () => {
    const doc = new Y.Doc();
    createAt(doc, 0, 0);
    const stop = updateCounter(doc);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board.model group ops — deleteObjects', () => {
  it('removes several objects in one transaction', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const b = createAt(doc, 300, 0);
    createAt(doc, 600, 0);
    const stop = updateCounter(doc);

    expect(deleteObjects(doc, [a, b, a, 'gone'])).toBe(2);
    expect(stop()).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('an empty list or only stale ids writes nothing', () => {
    const doc = new Y.Doc();
    createAt(doc, 0, 0);
    const stop = updateCounter(doc);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['gone'])).toBe(0);
    expect(stop()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('board.model group ops — marquee and select all', () => {
  it('TC-07: only objects lying entirely inside the rectangle are returned', () => {
    const doc = new Y.Doc();
    const inside = createAt(doc, 100, 100); // 100..300
    createAt(doc, 250, 100); // straddles the right edge at 300
    createAt(doc, 900, 900); // far outside

    const ids = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 300, height: 400 });
    expect(ids).toEqual([inside]);
  });

  it('TC-07: an object touching the edge from inside is selected, one touching from outside is not', () => {
    const doc = new Y.Doc();
    const touchingInside = createAt(doc, 0, 0); // 0..200 inside a 0..200 box
    const outside = createAt(doc, 200, 0); // 200..400
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 200, height: 200 })).toEqual([touchingInside]);
    expect(objectsInRect(snapshot(doc), { x: 200, y: 0, width: 200, height: 200 })).toEqual([outside]);
  });

  it('a rectangle of zero size selects nothing', () => {
    const doc = new Y.Doc();
    createAt(doc, 0, 0);
    expect(objectsInRect(snapshot(doc), { x: 100, y: 100, width: 0, height: 0 })).toEqual([]);
  });

  it('TC-08: allObjectIds skips a type this build does not know', () => {
    const doc = new Y.Doc();
    const sticky = createAt(doc, 0, 0);
    putRawObject(doc, 'mystery-1', 'mystery', 0, 0, 9);

    const snap = snapshot(doc);
    expect(snap.map((o) => o.id)).toEqual([sticky]);
    expect(allObjectIds(snap)).toEqual([sticky]);
    // The guard holds for a hand-built snapshot too.
    const handmade: ObjectSnapshot[] = [
      { id: 'known', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 },
      { id: 'unknown', type: 'mystery', x: 0, y: 0, z: 2, createdAt: 0 },
    ];
    expect(allObjectIds(handmade)).toEqual(['known']);
  });
});

describe('board.model group ops — transaction origin', () => {
  it('every group mutation uses LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    const a = createAt(doc, 0, 0);
    const b = createAt(doc, 300, 0);
    createAt(doc, 600, 0);
    const origins: unknown[] = [];
    const handler = (_updates: unknown, origin: unknown) => origins.push(origin);
    doc.on('update', handler);

    moveObjects(doc, new Map([[a, { x: 1, y: 1 }]]));
    resizeObjects(doc, new Map([[b, { x: 0, y: 0, width: 150, height: 150 }]]));
    bringObjectsToFront(doc, [a, b]);
    deleteObjects(doc, [a]);

    doc.off('update', handler);
    expect(origins).toHaveLength(4);
    for (const origin of origins) expect(origin).toBe(LOCAL_ORIGIN);
  });
});

describe('board.model — story 2 compatibility', () => {
  it('snapshot still reports the sticky fields story 2 relies on', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue');
    const obj = snapshot(doc)[0];
    expect(obj.id).toBe(id);
    expect(obj.type).toBe('sticky');
    expect(obj.color).toBe('blue');
    expect(obj.text).toBe('');
    expect(obj.z).toBe(1);
  });

  it('a legacy note keeps working after the group operations touched it', () => {
    const doc = new Y.Doc();
    const id = createAt(doc, 0, 0);
    doc.transact(() => {
      const m = getObjectsMap(doc).get(id)!;
      m.delete('width');
      m.delete('height');
    });
    moveObjects(doc, new Map([[id, { x: 10, y: 10 }]]));
    expect(objectBounds(snapshot(doc)[0])).toEqual({ x: 10, y: 10, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(snapshot(doc)[0].z).toBe(1);
  });
});
