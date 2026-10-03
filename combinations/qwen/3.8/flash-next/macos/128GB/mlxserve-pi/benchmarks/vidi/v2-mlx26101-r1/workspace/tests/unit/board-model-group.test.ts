import { beforeEach, describe, expect, it } from 'vitest';
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
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function updatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

function put(doc: Y.Doc, id: string, type: string, x: number, y: number, z: number) {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', type);
    m.set('x', x);
    m.set('y', y);
    m.set('z', z);
    m.set('createdAt', 0);
    if (type === 'sticky') {
      m.set('color', 'yellow');
      m.set('text', new Y.Text(''));
    }
    objectsMap(doc).set(id, m);
  });
}

describe('board.model.group', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-05: moveObjects with a mid-flight remote delete skips the gone id, opens
  // exactly one transaction.
  it('TC-05 moveObjects skips an id deleted mid-selection and emits one update', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    const c = createSticky(doc, { x: 1000, y: 0 });

    // b is deleted by a remote user first (its own update); then the group move
    // runs against the now-stale selection of three ids.
    objectsMap(doc).delete(b);
    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 100, y: 100 }],
      [b, { x: 600, y: 100 }],
      [c, { x: 1100, y: 100 }],
    ]);
    let moved = 0;
    const updates = updatesDuring(doc, () => {
      moved = moveObjects(doc, positions);
    });
    expect(moved).toBe(2);
    expect(updates).toBe(1);
    const s = snapshot(doc);
    expect(s).toHaveLength(2);
    expect(s.find((n) => n.id === a)?.x).toBe(100);
    expect(s.find((n) => n.id === c)?.x).toBe(1100);
  });

  // TC-06: bringObjectsToFront raises a 3-note selection above 2 unselected ones,
  // preserving the selection's own stacking order.
  it('TC-06 bringObjectsToFront lifts the selection above the rest, order kept', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const c = createSticky(doc, { x: 20, y: 20 });
    const d = createSticky(doc, { x: 30, y: 30 });
    const e = createSticky(doc, { x: 40, y: 40 });
    const z = (id: string) => snapshot(doc).find((n) => n.id === id)!.z;

    // Selection {d, e, a} (created lowest to highest) over unselected {b, c}.
    const raised = bringObjectsToFront(doc, [d, e, a]);
    expect(raised).toBe(3);
    const maxUnselected = Math.max(z(b), z(c));
    for (const id of [a, d, e]) expect(z(id)).toBeGreaterThan(maxUnselected);
    // Relative order among the selection follows creation (a < d < e).
    expect(z(a)).toBeLessThan(z(d));
    expect(z(d)).toBeLessThan(z(e));
  });

  it('bringObjectsToFront is a no-op (0) when the selection is already topmost', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    // b is already on top; raising b alone changes nothing.
    const updates = updatesDuring(doc, () => {
      expect(bringObjectsToFront(doc, [b])).toBe(0);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(1);
    expect(snapshot(doc).find((n) => n.id === b)!.z).toBe(2);
  });

  // TC-07: objectsInRect selects only fully-inside objects.
  it('TC-07 objectsInRect returns only the fully-inside object', () => {
    const a = createSticky(doc, { x: 100, y: 100 }); // 0..200 fully inside
    const b = createSticky(doc, { x: 180, y: 100 }); // 80..280 partly inside
    const c = createSticky(doc, { x: 500, y: 500 }); // entirely outside
    const rect = { x: -10, y: -10, width: 210, height: 220 };
    expect(objectsInRect(snapshot(doc), rect)).toEqual([a]);
    expect(objectsInRect(snapshot(doc), rect)).not.toContain(b);
    expect(objectsInRect(snapshot(doc), rect)).not.toContain(c);
  });

  // TC-08: allObjectIds excludes an unknown type.
  it('TC-08 allObjectIds excludes objects of an unknown type', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    put(doc, 'mystery', 'shape', 0, 0, 5);
    const ids = allObjectIds([
      ...snapshot(doc),
      // The raw snapshot skips unknown types, so hand one in the way a future
      // generic snapshot would surface it.
      { id: 'mystery', type: 'shape', x: 0, y: 0, z: 5, createdAt: 0 },
    ]);
    expect(ids).toContain(a);
    expect(ids).not.toContain('mystery');
  });

  // TC-09: non-finite positions and an empty selection change nothing.
  it('TC-09 rejects non-finite positions and empty id lists with no transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const cases: [number, number][] = [
      [Number.NaN, 5],
      [5, Number.NaN],
      [Number.POSITIVE_INFINITY, 5],
      [5, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of cases) {
      const updates = updatesDuring(doc, () => {
        expect(moveObjects(doc, new Map([[a, { x, y }]]))).toBe(0);
      });
      expect(updates).toBe(0);
    }
    expect(
      updatesDuring(doc, () => {
        expect(moveObjects(doc, new Map())).toBe(0);
        expect(deleteObjects(doc, [])).toBe(0);
        expect(resizeObjects(doc, new Map())).toBe(0);
        expect(bringObjectsToFront(doc, [])).toBe(0);
      }),
    ).toBe(0);
  });

  it('moveObjects refuses to write a non-finite rect via resizeObjects too', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesDuring(doc, () => {
      expect(
        resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 100 }]])),
      ).toBe(0);
    });
    expect(updates).toBe(0);
  });

  // TC-10: a sticky without width/height reads STICKY_SIZE_WORLD, and the first
  // resize writes both fields.
  it('TC-10 implicit-size sticky reads STICKY_SIZE_WORLD and resize writes both fields', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc).find((n) => n.id === id)!;
    expect(before.width).toBeUndefined();
    expect(objectBounds(before).width).toBe(STICKY_SIZE_WORLD);
    expect(objectBounds(before).height).toBe(STICKY_SIZE_WORLD);

    const updates = updatesDuring(doc, () => {
      expect(
        resizeObjects(
          doc,
          new Map([[id, { x: 0, y: 0, width: 320, height: 320 }]]),
        ),
      ).toBe(1);
    });
    expect(updates).toBe(1);
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.width).toBe(320);
    expect(after.height).toBe(320);
    expect(objectBounds(after).width).toBe(320);
    expect(objectBounds(after).height).toBe(320);
  });

  it('objectBounds honours an explicit minimum for a smaller object', () => {
    // Sanity that objectBounds does not invent a size when one is present.
    const id = createSticky(doc, { x: 0, y: 0 });
    resizeObjects(doc, new Map([[id, { x: 1, y: 2, width: STICKY_MIN_SIZE_WORLD, height: 80 }]]));
    const s = snapshot(doc).find((n) => n.id === id)!;
    expect(objectBounds(s)).toEqual({
      x: 1,
      y: 2,
      width: STICKY_MIN_SIZE_WORLD,
      height: 80,
    });
  });
});
