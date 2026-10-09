import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObject,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

// Places a sticky so its top-left corner sits at (left, top) at a given z base.
function place(doc: Y.Doc, left: number, top: number): string {
  const id = createSticky(doc, { x: left + STICKY_SIZE_WORLD / 2, y: top + STICKY_SIZE_WORLD / 2 });
  if (id === false) throw new Error('create failed');
  return id;
}

function entry(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

function boundsOf(doc: Y.Doc, id: string): Rect {
  const map = new Map(snapshot(doc).map((o) => [o.id, o]));
  const obj = map.get(id) as ObjectSnapshot;
  return objectBounds(obj);
}

describe('board-model group operations', () => {
  test('TC-05 moveObjects with one object deleted remotely → 2 applied, a single update event', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 0, 0);
    const b = place(doc, 300, 0);
    const c = place(doc, 600, 0);
    // "Remotely": delete c in a transaction with a different origin.
    doc.transact(() => {
      doc.getMap('objects').delete(c);
    }, 'remote');
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const applied = moveObjects(
      doc,
      new Map([
        [a, { x: 50, y: 60 }],
        [b, { x: 350, y: 60 }],
        [c, { x: 650, y: 60 }]
      ])
    );
    expect(applied).toBe(2);
    expect(updates).toBe(1);
    expect(boundsOf(doc, a)).toEqual({ x: 50, y: 60, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(boundsOf(doc, b).x).toBe(350);
  });

  test('TC-06 bringObjectsToFront raises 3 above an unselected note keeping relative stacking', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // z order by creation: a(1) u(2) b(3) c(4).
    const a = place(doc, 0, 0);
    const u = place(doc, 50, 0);
    const b = place(doc, 100, 0);
    const c = place(doc, 150, 0);
    const changed = bringObjectsToFront(doc, [a, b, c]);
    expect(changed).toBeGreaterThan(0);
    const zs = snapshot(doc);
    const z = (id: string) => zs.find((o) => o.id === id)!.z;
    expect(z(a)).toBeGreaterThan(z(u));
    expect(z(b)).toBeGreaterThan(z(u));
    expect(z(c)).toBeGreaterThan(z(u));
    expect(z(a)).toBeLessThan(z(b));
    expect(z(b)).toBeLessThan(z(c));
    // Idempotent: raising again changes nothing.
    expect(bringObjectsToFront(doc, [a, b, c])).toBe(0);
  });

  test('TC-07 objectsInRect selects only fully-contained objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 100, 100); // fully inside
    place(doc, 150, 100); // right half outside
    place(doc, 500, 500); // fully outside
    const rect: Rect = { x: 50, y: 50, width: 260, height: 300 };
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });

  test('TC-08 allObjectIds excludes unknown types (in the doc and in hand-built snapshots)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 0, 0);
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 9);
      doc.getMap('objects').set('shape-1', shape);
    }, 'remote');
    expect(allObjectIds(snapshot(doc))).toEqual([a]);
    const handBuilt: ObjectSnapshot[] = [
      { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0, width: 200, height: 200 },
      { id: 's', type: 'shape', x: 0, y: 0, z: 2, createdAt: 0, width: 200, height: 200 }
    ];
    expect(allObjectIds(handBuilt)).toEqual(['a']);
  });

  test('TC-09 non-finite positions and missing ids apply nothing and open no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 0, 0);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(
      moveObjects(
        doc,
        new Map([
          [a, { x: Number.NaN, y: 5 }],
          ['nope', { x: 1, y: 1 }],
          [a, { x: 1, y: Number.POSITIVE_INFINITY }]
        ])
      )
    ).toBe(0);
    expect(updates).toBe(0);
    expect(boundsOf(doc, a).x).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(resizeObjects(doc, new Map([['nope', { x: 0, y: 0, width: 10, height: 10 }]]))).toBe(0);
    expect(deleteObjects(doc, ['nope'])).toBe(0);
    expect(updates).toBe(0);
  });

  test('TC-09b moveObject single op keeps its semantics for finite input', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 0, 0);
    expect(moveObject(doc, a, 5, 5)).toBe(true);
    expect(moveObject(doc, a, Number.NaN, 5)).toBe(false);
  });

  test('TC-10 legacy sticky without width/height: bounds read STICKY_SIZE_WORLD, first resize writes both', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 0, 0);
    // Simulate a story-2 document: strip the story-7 fields.
    doc.transact(() => {
      const e = entry(doc, a);
      e.delete('width');
      e.delete('height');
    }, 'remote');
    expect(objectBounds(snapshot(doc)[0])).toEqual({
      x: 0,
      y: 0,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD
    });
    const applied = resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 300, height: 250 }]]));
    expect(applied).toBe(1);
    expect(boundsOf(doc, a)).toEqual({ x: 0, y: 0, width: 300, height: 250 });
    expect(entry(doc, a).get('width')).toBe(300);
    expect(entry(doc, a).get('height')).toBe(250);
  });

  test('TC-10b deleteObjects removes all present ids in one transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = place(doc, 0, 0);
    const b = place(doc, 300, 0);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(deleteObjects(doc, [a, b, 'missing'])).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
