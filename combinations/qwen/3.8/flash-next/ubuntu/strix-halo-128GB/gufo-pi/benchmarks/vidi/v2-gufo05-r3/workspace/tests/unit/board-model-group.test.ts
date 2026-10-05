import { describe, expect, it } from 'vitest';
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
  registerKnownObjectType,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/** Count the `update` events a doc emits while `fn` runs. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const listener = () => {
    n += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return n;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function raw(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = objectsMap(doc).get(id);
  if (!m) throw new Error(`no object with id ${id}`);
  return m;
}

/** Write an object of a type this build does not know, straight into the doc. */
function seedUnknown(doc: Y.Doc, id: string, type: string, x: number, y: number, z: number) {
  const shape = new Y.Map<unknown>();
  shape.set('type', type);
  shape.set('x', x);
  shape.set('y', y);
  shape.set('z', z);
  objectsMap(doc).set(id, shape);
}

describe('board.model: moveObjects (TC-05, TC-09)', () => {
  it('TC-05 an id deleted by somebody else mid-gesture is skipped, in one update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const c = createSticky(doc, { x: 600, y: 0 });
    deleteObject(doc, b);

    let applied = 0;
    const updates = countUpdates(doc, () => {
      applied = moveObjects(
        doc,
        new Map([
          [a, { x: 10, y: 20 }],
          [b, { x: 310, y: 20 }],
          [c, { x: 610, y: 20 }],
        ]),
      );
    });

    expect(applied).toBe(2);
    expect(updates).toBe(1);
    expect([raw(doc, a).get('x'), raw(doc, a).get('y')]).toEqual([10, 20]);
    expect([raw(doc, c).get('x'), raw(doc, c).get('y')]).toEqual([610, 20]);
  });

  it('TC-09 non-finite positions write nothing at all, in any transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];

    for (const bad of [
      new Map([[a, { x: Number.NaN, y: 0 }]]),
      new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]),
      // A bad position for one object rejects the whole group: a half-applied
      // move would leave a cluster torn apart.
      new Map([
        [a, { x: 50, y: 50 }],
        ['ghost', { x: Number.NaN, y: 0 }],
      ] as [string, { x: number; y: number }][]),
    ]) {
      let applied = 1;
      const updates = countUpdates(doc, () => {
        applied = moveObjects(doc, bad);
      });
      expect(applied).toBe(0);
      expect(updates).toBe(0);
    }

    expect(snapshot(doc)[0]).toMatchObject({ x: before.x, y: before.y });
  });

  it('an empty map, a stale id and an unchanged position each write nothing', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const at = { x: 0 - STICKY_SIZE_WORLD / 2, y: 0 - STICKY_SIZE_WORLD / 2 };

    for (const positions of [
      new Map<string, { x: number; y: number }>(),
      new Map([['gone', { x: 5, y: 5 }]]),
      new Map([[a, at]]),
    ]) {
      let applied = 1;
      const updates = countUpdates(doc, () => {
        applied = moveObjects(doc, positions);
      });
      expect(applied).toBe(0);
      expect(updates).toBe(0);
    }
  });

  it('moveObject is the single-object wrapper of moveObjects', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    expect(moveObject(doc, a, 12, 34)).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 12, y: 34 });
    // Same value again: nothing to write.
    expect(moveObject(doc, a, 12, 34)).toBe(false);
    expect(moveObject(doc, 'gone', 1, 1)).toBe(false);
  });
});

describe('board.model: resizeObjects (TC-10)', () => {
  it('TC-10 an old note reads the default size, and the first resize writes both fields', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 400, y: 300 });
    const before = snapshot(doc)[0];
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({
      x: 400 - STICKY_SIZE_WORLD / 2,
      y: 300 - STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    expect(raw(doc, id).has('width')).toBe(false);

    const x = 100;
    const y = 50;
    let applied = 0;
    const updates = countUpdates(doc, () => {
      applied = resizeObjects(doc, new Map([[id, { x, y, width: 320, height: 320 }]]));
    });

    expect(applied).toBe(1);
    expect(updates).toBe(1);
    const after = snapshot(doc)[0];
    expect(after).toMatchObject({ x, y, width: 320, height: 320 });
    expect(objectBounds(after)).toEqual({ x, y, width: 320, height: 320 });
    // Colour, text and stacking survive a resize.
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
  });

  it('a group resize writes every object in one transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    let applied = 0;
    const updates = countUpdates(doc, () => {
      applied = resizeObjects(
        doc,
        new Map([
          [a, { x: 0, y: 0, width: 400, height: 400 }],
          [b, { x: 600, y: 0, width: 400, height: 400 }],
          ['gone', { x: 0, y: 0, width: 10, height: 10 }],
        ]),
      );
    });
    expect(applied).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n) => n.width)).toEqual([400, 400]);
  });

  it('non-finite or non-positive sizes, and empty maps, write nothing', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];

    for (const rects of [
      new Map<string, { x: number; y: number; width: number; height: number }>(),
      new Map([['gone', { x: 0, y: 0, width: 10, height: 10 }]]),
      new Map([[id, { x: 0, y: 0, width: 0, height: 100 }]]),
      new Map([[id, { x: 0, y: 0, width: -5, height: 100 }]]),
      new Map([[id, { x: 0, y: 0, width: Number.NaN, height: 100 }]]),
      new Map([[id, { x: Number.NaN, y: 0, width: 100, height: 100 }]]),
    ]) {
      let applied = 1;
      const updates = countUpdates(doc, () => {
        applied = resizeObjects(doc, rects);
      });
      expect(applied).toBe(0);
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)[0]).toEqual(before);
  });
});

describe('board.model: bringObjectsToFront (TC-06)', () => {
  const zOf = (doc: Y.Doc, id: string) => Number(raw(doc, id).get('z'));
  const order = (doc: Y.Doc) => snapshot(doc).map((n) => n.id);

  it('TC-06 the whole selection lands above every unselected object, in its own order', () => {
    const doc = new Y.Doc();
    // Five notes, z 1..5.
    const ids = [0, 1, 2, 3, 4].map((i) => createSticky(doc, { x: i * 40, y: i * 40 }));
    const [one, two, three, four, five] = ids;
    expect(order(doc)).toEqual(ids);

    let raised = 0;
    const updates = countUpdates(doc, () => {
      // Select the bottom three and drag them: 4 and 5 stay where they are.
      raised = bringObjectsToFront(doc, [three, one, two]);
    });

    expect(raised).toBe(3);
    expect(updates).toBe(1);
    // Above every unselected object (highest is 5).
    expect([zOf(doc, one), zOf(doc, two), zOf(doc, three)]).toEqual([6, 7, 8]);
    // Their relative order is the one they had: one, two, three.
    expect(order(doc)).toEqual([four, five, one, two, three]);
    // The unselected objects keep their own z.
    expect([zOf(doc, four), zOf(doc, five)]).toEqual([4, 5]);
  });

  it('a selection that is already in front writes nothing', () => {
    const doc = new Y.Doc();
    const [, b] = [0, 1].map((i) => createSticky(doc, { x: i * 40, y: 0 }));
    let raised = 1;
    const updates = countUpdates(doc, () => {
      raised = bringObjectsToFront(doc, [b]);
    });
    expect(raised).toBe(0);
    expect(updates).toBe(0);
  });

  it('an empty selection and unknown ids write nothing', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    for (const ids of [[], ['gone']]) {
      let raised = 1;
      const updates = countUpdates(doc, () => {
        raised = bringObjectsToFront(doc, ids);
      });
      expect(raised).toBe(0);
      expect(updates).toBe(0);
    }
  });
});

describe('board.model: objectsInRect (TC-07) and allObjectIds (TC-08)', () => {
  it('TC-07 only an object lying entirely inside the rectangle is selected', () => {
    const doc = new Y.Doc();
    // A (fully inside), B (half inside), C (outside).
    const a = createSticky(doc, { x: 200, y: 200 });
    const b = createSticky(doc, { x: 400, y: 200 });
    const c = createSticky(doc, { x: 1200, y: 900 });

    // Notes are STICKY_SIZE_WORLD squares centred on the creation point, so A
    // spans 100..300, B spans 300..500 and C spans 1100..1300 on both axes.
    const marquee = { x: 50, y: 50, width: 330, height: 330 };
    expect(objectsInRect(snapshot(doc), marquee)).toEqual([a]);

    // B, which the same rectangle cuts in half, is selected once it is inside.
    expect(objectsInRect(snapshot(doc), { x: 50, y: 50, width: 460, height: 330 })).toEqual([
      a,
      b,
    ]);
    // C only touches the edge from outside at x = 1100 ... which is not inside.
    expect(objectsInRect(snapshot(doc), { x: 50, y: 50, width: 1050, height: 1050 })).toEqual([
      a,
      b,
    ]);
    expect(objectsInRect(snapshot(doc), { x: 1100, y: 800, width: 200, height: 200 })).toEqual(
      [c],
    );

    // A box that covers everything selects everything, in render order.
    const list = snapshot(doc);
    expect(objectsInRect(list, { x: -1000, y: -1000, width: 5000, height: 5000 })).toEqual(
      list.map((n) => n.id),
    );
    // An empty rectangle selects nothing.
    expect(objectsInRect(list, { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(objectsInRect([], marquee)).toEqual([]);
  });

  it('TC-08 select all skips an object of a type this build does not know', () => {
    const doc = new Y.Doc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    seedUnknown(doc, 'shape-1', 'shape', 0, 0, 5);

    // Neither the snapshot nor the id list offers the unknown object.
    expect(snapshot(doc).map((n) => n.id)).toEqual([sticky]);
    expect(allObjectIds(snapshot(doc))).toEqual([sticky]);
    // ... and the filter is the model's own, not just the snapshot's.
    const hand: ObjectSnapshot[] = [
      { id: sticky, type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 },
      { id: 'shape-1', type: 'shape', x: 0, y: 0, z: 5, createdAt: 0 },
    ];
    expect(allObjectIds(hand)).toEqual([sticky]);
    // The marquee refuses it too.
    expect(objectsInRect(hand, { x: -1000, y: -1000, width: 5000, height: 5000 })).toEqual([
      sticky,
    ]);
  });

  it('a type the client registry declares known becomes selectable', () => {
    // A name no other suite uses, so registering it cannot leak into them.
    registerKnownObjectType('unit-test-shape');
    const hand: ObjectSnapshot[] = [
      { id: 'shape-1', type: 'shape', x: 0, y: 0, z: 1, createdAt: 0 },
      { id: 'unit-1', type: 'unit-test-shape', x: 0, y: 0, z: 2, createdAt: 0 },
    ];
    expect(allObjectIds(hand)).toEqual(['unit-1']);
    expect(objectsInRect(hand, { x: -1000, y: -1000, width: 5000, height: 5000 })).toEqual([
      'unit-1',
    ]);
  });
});

describe('board.model: deleteObjects', () => {
  it('deletes the whole selection in one transaction and reports the count', () => {
    const doc = new Y.Doc();
    const [a, , c] = [0, 1, 2].map((i) => createSticky(doc, { x: i * 40, y: 0 }));
    const b = snapshot(doc)[1].id;

    let deleted = 0;
    const updates = countUpdates(doc, () => {
      deleted = deleteObjects(doc, [a, c, a, 'gone']);
    });

    expect(deleted).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n) => n.id)).toEqual([b]);
  });

  it('an empty selection and a stale id write nothing', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    for (const ids of [[], ['gone']]) {
      let deleted = 1;
      const updates = countUpdates(doc, () => {
        deleted = deleteObjects(doc, ids);
      });
      expect(deleted).toBe(0);
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('a note at the minimum size keeps its size after every group operation', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD }]]));
    moveObjects(doc, new Map([[id, { x: 10, y: 10 }]]));
    bringObjectsToFront(doc, [id]);
    expect(snapshot(doc)[0]).toMatchObject({
      x: 10,
      y: 10,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
  });
});
