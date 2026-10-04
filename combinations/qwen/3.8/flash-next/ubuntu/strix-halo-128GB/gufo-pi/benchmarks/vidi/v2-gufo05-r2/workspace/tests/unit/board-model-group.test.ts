import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  moveObject,
  moveObjects,
  objectBounds,
  objectSnapshots,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';

/** Run `fn`, counting how many `update` events the doc emits. */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', observer);
  }
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function fields(doc: Y.Doc, id: string): Record<string, unknown> {
  const entry = objectsMap(doc).get(id);
  if (!entry) throw new Error(`object ${id} is missing`);
  const out: Record<string, unknown> = {};
  entry.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function entryOf(doc: Y.Doc, id: string, over: Partial<ObjectSnapshot> = {}): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set('type', over.type ?? 'sticky');
  entry.set('x', over.x ?? 0);
  entry.set('y', over.y ?? 0);
  entry.set('z', over.z ?? 1);
  if (over.width !== undefined) entry.set('width', over.width);
  if (over.height !== undefined) entry.set('height', over.height);
  objectsMap(doc).set(id, entry);
  return entry;
}

describe('board.model — objectSnapshots and objectBounds', () => {
  it('reports every object, known type or not, sorted by (z, id)', () => {
    const doc = new Y.Doc();
    const b = createSticky(doc, { x: 300, y: 0 });
    const a = createSticky(doc, { x: 0, y: 0 });
    entryOf(doc, 'a-widget', { type: 'widget', x: 10, y: 20, z: 0 });

    // z order: a-widget 0, the first note 1, the second note 2.
    expect(objectSnapshots(doc).map((obj) => obj.id)).toEqual(['a-widget', b, a]);
    // `snapshot` keeps reporting notes only, exactly as before story 7.
    expect(snapshot(doc).map((note) => note.id)).toEqual([b, a]);
  });

  it('TC-10: a note created before this story reads at STICKY_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const obj = objectSnapshots(doc).find((entry) => entry.id === id)!;
    expect(obj.width).toBeUndefined();
    expect(obj.height).toBeUndefined();
    expect(objectBounds(obj)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('reads an explicit width and height back out', () => {
    const doc = new Y.Doc();
    entryOf(doc, 'sized', { width: 120, height: 80, x: 5, y: 6 });
    const obj = objectSnapshots(doc)[0]!;
    expect(objectBounds(obj)).toEqual({ x: 5, y: 6, width: 120, height: 80 });
  });
});

describe('board.model — moveObjects', () => {
  it('TC-05: writes the ids that are still there in exactly one update', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const c = createSticky(doc, { x: 0, y: 300 });
    deleteObject(doc, b); // deleted by somebody else mid-gesture

    const positions = new Map<string, Point>([
      [a, { x: 10, y: 20 }],
      [b, { x: 310, y: 20 }],
      [c, { x: 10, y: 320 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(fields(doc, a).x).toBe(10);
    expect(fields(doc, c).y).toBe(320);
  });

  it('TC-09: one non-finite position refuses the whole group, and an empty map writes nothing', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const before = JSON.stringify(fields(doc, a)) + JSON.stringify(fields(doc, b));

    for (const bad of [NaN, Infinity, -Infinity]) {
      const positions = new Map<string, Point>([
        [a, { x: 5, y: 5 }],
        [b, { x: bad, y: 5 }],
      ]);
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    const empty = withUpdateCount(doc, () => moveObjects(doc, new Map()));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);
    // Only ids that do not exist: still no transaction.
    const stale = withUpdateCount(doc, () =>
      moveObjects(doc, new Map([['missing', { x: 1, y: 1 }]])),
    );
    expect(stale.result).toBe(0);
    expect(stale.updates).toBe(0);
    expect(JSON.stringify(fields(doc, a)) + JSON.stringify(fields(doc, b))).toBe(before);
  });

  it('moveObject is the single-object wrapper of moveObjects', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(moveObject(doc, id, 3, 4)).toBe(true);
    expect(fields(doc, id).x).toBe(3);
    expect(moveObject(doc, 'missing', 3, 4)).toBe(false);
  });
});

describe('board.model — resizeObjects', () => {
  it('TC-10: the first resize writes both width and height', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(fields(doc, id).width).toBeUndefined();
    const rects = new Map<string, Rect>([
      [id, { x: -100, y: -100, width: 400, height: 400 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, rects));
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(fields(doc, id)).toMatchObject({ x: -100, y: -100, width: 400, height: 400 });
  });

  it('skips missing ids, and refuses non-finite or empty boxes without a transaction', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });

    const rects = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 300, height: 300 }],
      ['missing', { x: 0, y: 0, width: 300, height: 300 }],
    ]);
    expect(withUpdateCount(doc, () => resizeObjects(doc, rects)).result).toBe(1);
    const before = JSON.stringify(fields(doc, a));

    for (const bad of [
      { x: NaN, y: 0, width: 300, height: 300 },
      { x: 0, y: 0, width: Infinity, height: 300 },
      { x: 0, y: 0, width: 300, height: 0 },
    ]) {
      const { result, updates } = withUpdateCount(doc, () =>
        resizeObjects(doc, new Map([['missing', bad]])),
      );
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    const empty = withUpdateCount(doc, () => resizeObjects(doc, new Map()));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);
    expect(JSON.stringify(fields(doc, a))).toBe(before);
  });
});

describe('board.model — bringObjectsToFront', () => {
  it('TC-06: a selected group lands above everything unselected, keeping its own order', () => {
    const doc = new Y.Doc();
    const low = createSticky(doc, { x: 0, y: 0 }); // z 1
    const keep1 = createSticky(doc, { x: 700, y: 0 }); // z 2
    const middle = createSticky(doc, { x: 300, y: 0 }); // z 3
    const keep2 = createSticky(doc, { x: 900, y: 0 }); // z 4
    const high = createSticky(doc, { x: 600, y: 0 }); // z 5

    const { result, updates } = withUpdateCount(doc, () =>
      bringObjectsToFront(doc, [high, low, middle]),
    );
    expect(result).toBe(3);
    expect(updates).toBe(1);
    const z = (id: string): number => fields(doc, id).z as number;
    const unselectedMax = Math.max(z(keep1), z(keep2));
    expect(z(low)).toBeGreaterThan(unselectedMax);
    expect(z(middle)).toBeGreaterThan(unselectedMax);
    expect(z(high)).toBeGreaterThan(unselectedMax);
    // Relative order inside the group is the one it had before.
    expect(z(low)).toBeLessThan(z(middle));
    expect(z(middle)).toBeLessThan(z(high));
  });

  it('is idempotent, ignores unknown ids, and writes nothing when nothing changes', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    bringObjectsToFront(doc, [a, b]);
    const again = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, b]));
    expect(again.result).toBe(0);
    expect(again.updates).toBe(0);
    const stale = withUpdateCount(doc, () => bringObjectsToFront(doc, ['missing']));
    expect(stale.result).toBe(0);
    expect(stale.updates).toBe(0);
    const empty = withUpdateCount(doc, () => bringObjectsToFront(doc, []));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);
  });
});

describe('board.model — deleteObjects', () => {
  it('removes the ids that exist in one update and reports how many', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 0, y: 300 });
    const { result, updates } = withUpdateCount(doc, () =>
      deleteObjects(doc, [a, b, 'missing', a]),
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    const empty = withUpdateCount(doc, () => deleteObjects(doc, []));
    expect(empty.result).toBe(0);
    expect(empty.updates).toBe(0);
  });
});

describe('board.model — objectsInRect', () => {
  it('TC-07: only the object lying entirely inside is returned', () => {
    const doc = new Y.Doc();
    const inside = entryOf(doc, 'inside', { x: 100, y: 100, width: 200, height: 200 }).get('x');
    expect(inside).toBe(100);
    entryOf(doc, 'partly', { x: 250, y: 100, width: 200, height: 200 });
    entryOf(doc, 'outside', { x: 900, y: 900, width: 200, height: 200 });

    const marquee: Rect = { x: 50, y: 50, width: 300, height: 300 };
    expect(objectsInRect(objectSnapshots(doc), marquee)).toEqual(['inside']);
    // A rectangle that only touches an object's edge from outside selects nothing.
    expect(objectsInRect(objectSnapshots(doc), { x: 0, y: 0, width: 100, height: 300 })).toEqual(
      [],
    );
  });

  it('skips object types that cannot be selected', () => {
    const doc = new Y.Doc();
    entryOf(doc, 'note', { type: 'sticky', x: 0, y: 0, width: 100, height: 100 });
    // 'widget' stands for any type this model does not know (story 10 filled in
    // the 'shape' this test used before shapes were a thing).
    entryOf(doc, 'widget', { type: 'widget', x: 0, y: 0, width: 100, height: 100 });
    expect(objectsInRect(objectSnapshots(doc), { x: 0, y: 0, width: 500, height: 500 })).toEqual([
      'note',
    ]);
    expect(
      objectsInRect(
        objectSnapshots(doc),
        { x: 0, y: 0, width: 500, height: 500 },
        (type) => type === 'widget',
      ),
    ).toEqual(['widget']);
  });

  it('an implicit-size note is measured at STICKY_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(objectsInRect(objectSnapshots(doc), { x: -100, y: -100, width: 200, height: 200 })).toEqual(
      [id],
    );
    expect(objectsInRect(objectSnapshots(doc), { x: -100, y: -100, width: 100, height: 100 })).toEqual(
      [],
    );
  });
});

describe('board.model — allObjectIds', () => {
  it('TC-08: an object of an unknown type is not selectable', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    entryOf(doc, 'a-widget', { type: 'widget' });

    const ids = allObjectIds(objectSnapshots(doc));
    expect(ids.sort()).toEqual([a, b].sort());

    // A caller-supplied predicate (the client's registry) decides instead.
    const widgets = allObjectIds(objectSnapshots(doc), (type) => type === 'widget');
    expect(widgets).toEqual(['a-widget']);
    expect(allObjectIds([])).toEqual([]);
  });
});

describe('board.model — size limits are wired to the settings', () => {
  it('the minimum is below the maximum, and both bound a sticky note', () => {
    expect(STICKY_MIN_SIZE_WORLD).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
    expect(STICKY_MIN_SIZE_WORLD).toBeLessThan(STICKY_SIZE_WORLD);
  });
});
