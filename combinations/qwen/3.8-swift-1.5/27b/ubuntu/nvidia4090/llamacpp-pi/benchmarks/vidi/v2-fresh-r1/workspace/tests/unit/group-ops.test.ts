// TC-06 to TC-09: group board-model operations (move, resize, z-order, delete).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';

function makeDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeSticky(doc: Y.Doc, at: Point, extra?: Record<string, unknown>): string {
  const id = createSticky(doc, at);
  if (extra) {
    doc.transact(() => {
      const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
      for (const [k, v] of Object.entries(extra)) obj.set(k, v);
    });
  }
  return id;
}

function getObj(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

describe('TC-06 moveObjects', () => {
  it('moves all selected objects in a single transaction', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const b = makeSticky(doc, { x: 200, y: 0 });

    const updates: number[] = [];
    doc.on('update', () => updates.push(1));

    const n = moveObjects(doc, new Map([
      [a, { x: 10, y: 20 }],
      [b, { x: 210, y: 20 }],
    ]));

    expect(n).toBe(2);
    expect(getObj(doc, a).get('x')).toBe(10);
    expect(getObj(doc, a).get('y')).toBe(20);
    expect(getObj(doc, b).get('x')).toBe(210);
    expect(updates).toHaveLength(1); // single update
  });

  it('empty map → 0 updates, no transaction', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const updates: number[] = [];
    doc.on('update', () => updates.push(1));
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(updates).toHaveLength(0);
    expect(getObj(doc, a).get('x')).toBe(-100); // createSticky centres at point
  });

  it('non-finite position → 0 updates', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const updates: number[] = [];
    doc.on('update', () => updates.push(1));
    expect(moveObjects(doc, new Map([[a, { x: NaN, y: 5 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 5, y: Infinity }]]))).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('stale ids are skipped without failing the rest', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const n = moveObjects(doc, new Map([
      [a, { x: 5, y: 5 }],
      ['nonexistent-id', { x: 99, y: 99 }],
    ]));
    expect(n).toBe(1);
    expect(getObj(doc, a).get('x')).toBe(5);
  });
});

describe('TC-07 objectsInRect (marquee selection)', () => {
  it('selects only objects fully inside the rect', () => {
    const doc = makeDoc();
    // note A: fully inside; note B: straddles the right edge; note C: outside
    const a = makeSticky(doc, { x: 100, y: 100 }); // 200×200 at (0,0)..(200,200)
    const b = makeSticky(doc, { x: 250, y: 100 }); // (150,0)..(350,200): straddles x=300
    const c = makeSticky(doc, { x: 400, y: 400 }); // outside
    const snap = snapshot(doc);

    const rect: Rect = { x: -10, y: -10, width: 310, height: 220 };
    expect(objectsInRect(snap, rect)).toEqual([a]);
  });

  it('object touching the boundary from inside is included', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 100, y: 100 }); // (0,0)..(200,200)
    const snap = snapshot(doc);
    const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(objectsInRect(snap, rect)).toEqual([a]);
  });

  it('object touching the boundary from outside is excluded', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 100, y: 100 }); // (0,0)..(200,200)
    const snap = snapshot(doc);
    const rect: Rect = { x: 0, y: 0, width: 199, height: 200 };
    expect(objectsInRect(snap, rect)).toEqual([]);
  });

  it('empty rect selects nothing', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    expect(objectsInRect(snap, { x: 500, y: 500, width: 0, height: 0 })).not.toContain(a);
  });
});

describe('TC-08 selection helpers', () => {
  it('allObjectIds returns every snapshot id (unknown types excluded by snapshot)', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const b = makeSticky(doc, { x: 300, y: 0 });
    // Inject an unknown object type directly into the doc.
    doc.transact(() => {
      const unknown = new Y.Map();
      unknown.set('type', 'mystery');
      unknown.set('x', 0);
      unknown.set('y', 0);
      doc.getMap('objects').set('mystery-id', unknown);
    });
    const snap = snapshot(doc);
    expect(allObjectIds(snap).sort()).toEqual([a, b].sort());
    expect(allObjectIds(snap)).not.toContain('mystery-id');
  });

  it('objectBounds falls back to sticky size when width/height absent', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 10, y: 20 });
    const snap = snapshot(doc);
    expect(objectBounds(snap[0])).toEqual({ x: -90, y: -80, width: 200, height: 200 });
  });

  it('objectBounds uses explicit width/height when present', () => {
    const doc = makeDoc();
    makeSticky(doc, { x: 10, y: 20 }, { width: 120, height: 60 });
    const snap = snapshot(doc);
    expect(objectBounds(snap[0])).toEqual({ x: -90, y: -80, width: 120, height: 60 });
  });
});

describe('TC-09 bringObjectsToFront', () => {
  it('raises the whole group above all unselected objects, preserving order', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 }); // z=1
    const b = makeSticky(doc, { x: 300, y: 0 }); // z=2
    const c = makeSticky(doc, { x: 600, y: 0 }); // z=3
    const d = makeSticky(doc, { x: 900, y: 0 }); // z=4 (unselected topmost)

    const n = bringObjectsToFront(doc, [a, b]);
    expect(n).toBe(2);
    const za = getObj(doc, a).get('z') as number;
    const zb = getObj(doc, b).get('z') as number;
    const zd = getObj(doc, d).get('z') as number;
    expect(za).toBe(zd + 1); // group sits just above the unselected top
    expect(zb).toBe(za + 1); // relative order preserved
  });

  it('returns 0 when the group is already topmost', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const b = makeSticky(doc, { x: 300, y: 0 }); // topmost
    expect(bringObjectsToFront(doc, [b])).toBe(0);
    expect(bringObjectsToFront(doc, [a, b])).toBe(0);
  });

  it('stale ids are skipped; empty list → 0', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 }); // z=1
    makeSticky(doc, { x: 300, y: 0 }); // z=2 (topmost)
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['nope'])).toBe(0);
    expect(bringObjectsToFront(doc, [a, 'nope'])).toBe(1);
    expect(getObj(doc, a).get('z')).toBe(3);
  });
});

describe('group delete and resize', () => {
  it('deleteObjects removes all given ids in one transaction', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const b = makeSticky(doc, { x: 300, y: 0 });
    const c = makeSticky(doc, { x: 600, y: 0 });

    const updates: number[] = [];
    doc.on('update', () => updates.push(1));
    expect(deleteObjects(doc, [a, b, 'stale-id'])).toBe(2);
    expect(updates).toHaveLength(1);
    expect(snapshot(doc).map((o) => o.id)).toEqual([c]);
  });

  it('deleteObjects: empty list → 0', () => {
    const doc = makeDoc();
    makeSticky(doc, { x: 0, y: 0 });
    expect(deleteObjects(doc, [])).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('resizeObjects sets x/y/width/height for every object in one transaction', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    const b = makeSticky(doc, { x: 300, y: 0 });

    const updates: number[] = [];
    doc.on('update', () => updates.push(1));
    const n = resizeObjects(doc, new Map([
      [a, { x: 5, y: 6, width: 150, height: 150 }],
      [b, { x: 305, y: 6, width: 150, height: 150 }],
    ]));
    expect(n).toBe(2);
    expect(updates).toHaveLength(1);
    const oa = getObj(doc, a);
    expect({ x: oa.get('x'), y: oa.get('y'), w: oa.get('width'), h: oa.get('height') })
      .toEqual({ x: 5, y: 6, w: 150, h: 150 });
  });

  it('resizeObjects: non-finite rect → 0 updates', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    expect(resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 100 }]]))).toBe(0);
  });

  it('resizeObjects: stale ids skipped', () => {
    const doc = makeDoc();
    const a = makeSticky(doc, { x: 0, y: 0 });
    expect(resizeObjects(doc, new Map([
      [a, { x: 1, y: 1, width: 80, height: 80 }],
      ['stale', { x: 0, y: 0, width: 80, height: 80 }],
    ]))).toBe(1);
  });
});
