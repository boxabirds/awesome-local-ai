import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  bringObjectsToFront,
  bringToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  isStickySnapshot,
  moveObject,
  moveObjects,
  objectBounds,
  objectSnapshots,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { unionRects, type Rect } from '../../src/shared/geometry';

/**
 * Unit tests for the generic group operations story 7 added to the board model
 * (anchor `sel.geometry_ops`). A real `Y.Doc` is the store under test, and every
 * mutation test also counts `update` events: one transaction per successful
 * group operation, none for a rejected or pointless one.
 */

interface UpdateCounter {
  count(): number;
  origins(): unknown[];
  reset(): void;
}

function watchUpdates(doc: Y.Doc): UpdateCounter {
  const events: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    events.push(origin);
  });
  return {
    count: () => events.length,
    origins: () => [...events],
    reset: () => {
      events.length = 0;
    },
  };
}

function freshDoc(): { doc: Y.Doc; updates: UpdateCounter } {
  const doc = new Y.Doc();
  initDoc(doc);
  const updates = watchUpdates(doc);
  return { doc, updates };
}

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const boundsOf = (doc: Y.Doc, id: string): Rect => {
  const found = snapshot(doc).find((note) => note.id === id);
  if (!found) {
    throw new Error(`${id} is not on the board`);
  }
  return objectBounds(found);
};

/** A hand-built snapshot entry, as a later story's object type would appear. */
const snapshotEntry = (
  id: string,
  type: string,
  x: number,
  y: number,
  width = STICKY_SIZE_WORLD,
  height = width,
  z = 1,
): ObjectSnapshot => Object.freeze({ id, type, x, y, z, createdAt: 0, width, height });

describe('sel.geometry_ops - objectBounds (TC-10)', () => {
  // TC-10
  it('TC-10 a sticky note created before story 7 has no stored size and reads as STICKY_SIZE_WORLD', () => {
    const { doc } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const note = snapshot(doc)[0]!;
    expect(note.width).toBeUndefined();
    expect(note.height).toBeUndefined();
    expect(objectBounds(note)).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    // The story 2 note keeps the size it already had (compatibility).
    expect(boundsOf(doc, id).width).toBe(STICKY_SIZE_WORLD);
  });

  it('objectSnapshots lists every object a client can render, sticky-only snapshot unchanged', () => {
    const { doc } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    doc.transact(() => {
      // A type nothing on this board knows about: skipped, exactly as story 2
      // skipped it.
      objectsOf(doc).set(
        'shape-1',
        new Y.Map<unknown>([
          ['type', 'shape'],
          ['x', 5],
          ['y', 6],
          ['z', 9],
        ]),
      );
    });

    const objects = objectSnapshots(doc);
    expect(objects.map((obj) => obj.id)).toEqual([id]);
    expect(isStickySnapshot(objects[0]!)).toBe(true);
    expect(snapshot(doc).map((note) => note.id)).toEqual([id]);
  });
});

describe('sel.geometry_ops - moveObjects (TC-05, TC-09)', () => {
  // TC-05 (error path: an id deleted by someone else is skipped)
  it('TC-05 moving three notes where one was deleted remotely changes two, in one transaction', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 300, y: 0 })!;
    const c = createSticky(doc, { x: 0, y: 300 })!;
    updates.reset();

    deleteObject(doc, b); // deleted elsewhere, mid-gesture
    updates.reset();

    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 20 }],
      [b, { x: 310, y: 20 }],
      [c, { x: 10, y: 320 }],
    ]);
    expect(moveObjects(doc, positions)).toBe(2);
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);
    expect(snapshot(doc).map((note) => [note.id, note.x, note.y])).toEqual([
      [a, 10, 20],
      [c, 10, 320],
    ]);
  });

  it('moveObjects writes absolute positions, so two clients converge on the same result', () => {
    const { doc } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 300, y: 0 })!;
    const start = new Map<string, Rect>([
      [a, boundsOf(doc, a)],
      [b, boundsOf(doc, b)],
    ]);
    // Every frame re-writes `start + delta`, never "current + this frame".
    for (const delta of [10, 40, 300]) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const [id, rect] of start) {
        positions.set(id, { x: rect.x + delta, y: rect.y + delta / 2 });
      }
      moveObjects(doc, positions);
    }
    expect(snapshot(doc).map((note) => [note.x, note.y])).toEqual([
      [200, 50],
      [500, 50],
    ]);
  });

  it('moveObjects that would change nothing writes nothing', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const rect = boundsOf(doc, a);
    updates.reset();
    expect(moveObjects(doc, new Map([[a, { x: rect.x, y: rect.y }]]))).toBe(0);
    expect(updates.count()).toBe(0);
  });

  // TC-09 (error path)
  it('TC-09 non-finite positions and empty id lists are refused with 0 and no transaction', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    updates.reset();
    const before = Y.encodeStateAsUpdate(doc);

    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[a, { x: 0, y: Number.NaN }]]))).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([['missing', { x: 1, y: 1 }]]))).toBe(0);
    expect(updates.count()).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('moveObjects writes once for the whole group and keeps every other field', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 }, 'pink')!;
    const b = createSticky(doc, { x: 300, y: 0 })!;
    updates.reset();
    const changed = moveObjects(
      doc,
      new Map([
        [a, { x: 10, y: 10 }],
        [b, { x: 310, y: 10 }],
      ]),
    );
    expect(changed).toBe(2);
    expect(updates.count()).toBe(1);
    const [first, second] = snapshot(doc);
    expect(first!.color).toBe('pink');
    expect(second!.z).toBeGreaterThan(first!.z);
  });

  it('moveObject is the single-object wrapper over moveObjects', () => {
    const { doc } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    expect(moveObject(doc, a, 12, 34)).toBe(true);
    expect(snapshot(doc)[0]!.x).toBe(12);
    expect(moveObject(doc, a, 12, 34)).toBe(false); // a no-op is still a no-op
    expect(moveObject(doc, 'no-such-id', 1, 2)).toBe(false);
  });
});

describe('sel.geometry_ops - resizeObjects (TC-10)', () => {
  // TC-10
  it('TC-10 the first resize writes width and height, so the size is now explicit', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    expect(snapshot(doc)[0]!.width).toBeUndefined();
    updates.reset();

    const changed = resizeObjects(doc, new Map([[id, { x: -10, y: -20, width: 320, height: 320 }]]));
    expect(changed).toBe(1);
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);

    const note = snapshot(doc)[0]!;
    expect(note.width).toBe(320);
    expect(note.height).toBe(320);
    expect(note.x).toBe(-10);
    expect(note.y).toBe(-20);
    // A sticky note is square, and both fields are stored so every client draws
    // the same size.
    expect(note.width).toBe(note.height);
  });

  it('resizeObjects refuses non-finite rects and empty maps with 0 and no transaction', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    updates.reset();
    const before = Y.encodeStateAsUpdate(doc);

    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: Number.NaN, height: 300 }]]))).toBe(0);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 300, height: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(resizeObjects(doc, new Map([['no-such-id', { x: 0, y: 0, width: 300, height: 300 }]]))).toBe(0);
    expect(updates.count()).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(snapshot(doc)[0]!.width).toBeUndefined();
  });

  it('resizeObjects skips ids that no longer exist', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 300, y: 0 })!;
    deleteObject(doc, b);
    updates.reset();

    const changed = resizeObjects(
      doc,
      new Map([
        [a, { x: 0, y: 0, width: 400, height: 400 }],
        [b, { x: 400, y: 0, width: 400, height: 400 }],
      ]),
    );
    expect(changed).toBe(1);
    expect(updates.count()).toBe(1);
  });

  it('resizeObjects that changes nothing writes nothing', () => {
    const { doc, updates } = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    // Once a size is stored, asking for exactly that size is a no-op. (The
    // resize that stores it for the first time is TC-10, not this case.)
    resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 240, height: 240 }]]));
    updates.reset();
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 240, height: 240 }]]))).toBe(0);
    expect(updates.count()).toBe(0);
  });
});

describe('sel.geometry_ops - bringObjectsToFront (TC-06)', () => {
  // TC-06
  it('TC-06 a group of three is raised above the two it is dragged over, keeping its own order', () => {
    const { doc, updates } = freshDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 })!;
    const unselected1 = createSticky(doc, { x: 40, y: 40 })!;
    const middle = createSticky(doc, { x: 80, y: 80 })!;
    const unselected2 = createSticky(doc, { x: 120, y: 120 })!;
    const top = createSticky(doc, { x: 160, y: 160 })!;
    updates.reset();

    expect(bringObjectsToFront(doc, [bottom, middle, top])).toBe(3);
    expect(updates.count()).toBe(1);

    const byId = new Map(snapshot(doc).map((note) => [note.id, note.z]));
    const unselected = [byId.get(unselected1)!, byId.get(unselected2)!];
    const selected = [byId.get(bottom)!, byId.get(middle)!, byId.get(top)!];
    // Everything selected is above everything unselected ...
    for (const z of selected) {
      for (const other of unselected) {
        expect(z).toBeGreaterThan(other);
      }
    }
    // ... and the group kept its internal stacking order.
    expect(selected).toEqual([...selected].sort((one, other) => one - other));
    expect(byId.get(bottom)).toBeLessThan(byId.get(middle)!);
    expect(byId.get(middle)).toBeLessThan(byId.get(top)!);
  });

  it('bringObjectsToFront on a group that is already on top writes nothing', () => {
    const { doc, updates } = freshDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 })!;
    const a = createSticky(doc, { x: 40, y: 40 })!;
    const b = createSticky(doc, { x: 80, y: 80 })!;
    updates.reset();

    expect(bringObjectsToFront(doc, [a, b])).toBe(0);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc).map((note) => note.id)).toEqual([bottom, a, b]);
  });

  it('bringObjectsToFront with nothing to raise or an empty list does nothing', () => {
    const { doc, updates } = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['no-such-id'])).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('bringToFront is the single-object wrapper over bringObjectsToFront', () => {
    const { doc } = freshDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 })!;
    createSticky(doc, { x: 40, y: 40 });
    expect(bringToFront(doc, bottom)).toBe(true);
    expect(snapshot(doc)[0]!.id).not.toBe(bottom);
    expect(bringToFront(doc, bottom)).toBe(false);
  });
});

describe('sel.geometry_ops - marquee and select all (TC-07, TC-08)', () => {
  // TC-07 (negative: partly inside is not selected)
  it('TC-07 objectsInRect selects only what lies entirely inside the rectangle', () => {
    const { doc } = freshDoc();
    const inside = createSticky(doc, { x: 0, y: 0 })!;
    const outside = createSticky(doc, { x: 2_000, y: 2_000 })!;
    const partly = createSticky(doc, { x: 300, y: 0 })!;
    const notes = snapshot(doc);

    // A rectangle that fully covers `inside` and clips `partly`.
    const marquee: Rect = { x: -200, y: -200, width: 400, height: 400 };
    expect(objectsInRect(notes, marquee)).toEqual([inside]);
    expect(objectsInRect(notes, marquee)).not.toContain(partly);
    expect(objectsInRect(notes, marquee)).not.toContain(outside);

    // A rectangle that covers everything selects everything.
    const all = unionRects(notes.map(objectBounds))!;
    expect(objectsInRect(notes, all).sort()).toEqual([inside, outside, partly].sort());

    // Nothing inside an empty rectangle.
    expect(objectsInRect(notes, { x: 500, y: 500, width: 0, height: 0 })).toEqual([]);
  });

  // TC-08 (negative: an unknown type is not selectable)
  it('TC-08 allObjectIds skips a type the board does not know', () => {
    const notes: readonly ObjectSnapshot[] = [
      snapshotEntry('sticky-1', 'sticky', 0, 0),
      snapshotEntry('shape-1', 'shape', 100, 0),
      snapshotEntry('sticky-2', 'sticky', 200, 0),
    ];
    expect(allObjectIds(notes)).toEqual(['sticky-1', 'sticky-2']);
    expect(allObjectIds([])).toEqual([]);
  });

  it('allObjectIds of a real board is every sticky note on it', () => {
    const { doc } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 300, y: 0 })!;
    expect(allObjectIds(snapshot(doc))).toEqual([a, b]);
  });
});

describe('sel.geometry_ops - deleteObjects (sel.group_delete)', () => {
  it('deleteObjects removes the whole selection in one transaction', () => {
    const { doc, updates } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 300, y: 0 })!;
    const kept = createSticky(doc, { x: 600, y: 0 })!;
    updates.reset();

    expect(deleteObjects(doc, [a, b, 'no-such-id'])).toBe(2);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([kept]);
  });

  it('deleteObjects with nothing to delete writes nothing', () => {
    const { doc, updates } = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(deleteObjects(doc, [])).toBe(0);
    expect(deleteObjects(doc, ['no-such-id'])).toBe(0);
    expect(updates.count()).toBe(0);
  });

  it('deleteObject is the single-object wrapper over deleteObjects', () => {
    const { doc } = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 })!;
    expect(deleteObject(doc, a)).toBe(true);
    expect(deleteObject(doc, a)).toBe(false);
  });
});

describe('sel.geometry_ops - the size limits a group resize must respect', () => {
  it('STICKY_MIN_SIZE_WORLD and MAX_OBJECT_SIZE_WORLD are the named limits', () => {
    expect(STICKY_MIN_SIZE_WORLD).toBe(50);
    expect(MAX_OBJECT_SIZE_WORLD).toBe(20_000);
    expect(STICKY_MIN_SIZE_WORLD).toBeLessThan(STICKY_SIZE_WORLD);
    expect(STICKY_SIZE_WORLD).toBeLessThan(MAX_OBJECT_SIZE_WORLD);
  });
});
