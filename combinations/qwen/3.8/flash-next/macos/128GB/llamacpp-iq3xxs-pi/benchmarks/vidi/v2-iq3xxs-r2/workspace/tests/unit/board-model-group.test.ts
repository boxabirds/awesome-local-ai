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
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  initDoc,
  isObjectTypeKnown,
  markObjectTypeKnown,
  moveObject,
  moveObjects,
  objectBounds,
  objectsInRect,
  objectSnapshots,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { unionRects, type Rect } from '../../src/shared/geometry';

/**
 * Story 7, `sel.geometry_ops` at the model boundary: the generic group operations every
 * object type uses. A real `Y.Doc` again, because "one transaction per call" and
 * "a missing id is skipped" are Yjs statements, not maths statements.
 */

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` and report the `update` events it produced (1 = one transaction). */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', listener);
  }
}

/** Create `count` stickies at the given world points; returns their ids in order. */
function createAt(doc: Y.Doc, points: Array<{ x: number; y: number }>): string[] {
  return points.map((at) => {
    const id = createSticky(doc, at);
    if (typeof id !== 'string') throw new Error(`fixture: no sticky at ${JSON.stringify(at)}`);
    return id;
  });
}

/** The raw `objects` map, to write the documents the model alone cannot produce. */
function rawObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function find(id: string, objects: readonly ObjectSnapshot[]): ObjectSnapshot {
  const found = objects.find((object) => object.id === id);
  if (!found) throw new Error(`no object with id ${id}`);
  return found;
}

describe('objectSnapshots and objectBounds (TC-10)', () => {
  it('TC-10: a sticky note made before this story still has a size', () => {
    const doc = newDoc();
    const [id] = createAt(doc, [{ x: 0, y: 0 }]);
    // Story 2 wrote no width/height at all, and nothing migrated them.
    expect(rawObjects(doc).get(id)?.get('width')).toBeUndefined();
    expect(rawObjects(doc).get(id)?.get('height')).toBeUndefined();

    expect(objectBounds(find(id, objectSnapshots(doc)))).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it('TC-10: the first resize makes the size explicit, in one transaction', () => {
    const doc = newDoc();
    const [id] = createAt(doc, [{ x: 0, y: 0 }]);
    const rects = new Map<string, Rect>([
      [id, { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD }],
    ]);

    const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, rects));
    expect(result).toBe(1);
    expect(updates).toBe(1);

    const item = rawObjects(doc).get(id);
    expect(item?.get('width')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(item?.get('height')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(objectBounds(find(id, objectSnapshots(doc)))).toEqual({
      x: 0,
      y: 0,
      width: STICKY_MIN_SIZE_WORLD,
      height: STICKY_MIN_SIZE_WORLD,
    });
    // The note is still the same note: its text survived being resized.
    getStickyText(doc, id)?.insert(0, 'Headline');
    expect(snapshot(doc).find((note) => note.id === id)?.text).toBe('Headline');
  });

  it('keeps every field the story 2 snapshot carried', () => {
    const doc = newDoc();
    const [id] = createAt(doc, [{ x: 20, y: 20 }]);
    getStickyText(doc, id)?.insert(0, 'Keep me');
    const note = snapshot(doc).find((entry) => entry.id === id);
    expect(note?.color).toBe('yellow');
    expect(note?.text).toBe('Keep me');
    expect(note?.z).toBe(1);
    expect(note?.type).toBe('sticky');
    // A sticky's snapshot carries its size now, so later object types read it too.
    expect(note?.width).toBe(STICKY_SIZE_WORLD);
    expect(note?.height).toBe(STICKY_SIZE_WORLD);
  });
});

describe('moveObjects (TC-05, TC-09)', () => {
  it('TC-05: moves every object it was given, skips the ones that are gone', () => {
    const doc = newDoc();
    const [a, b, c] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 800, y: 0 },
    ]);
    deleteObject(doc, b); // deleted by somebody else while we had it selected

    const positions = new Map([
      [a, { x: 10, y: 20 }],
      [b, { x: 30, y: 40 }],
      [c, { x: 50, y: 60 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    // One transaction for the whole group, so other people see one change.
    expect(updates).toBe(1);

    const after = objectSnapshots(doc);
    expect(find(a, after)).toMatchObject({ x: 10, y: 20 });
    expect(find(c, after)).toMatchObject({ x: 50, y: 60 });
  });

  it('TC-09: a non-finite position writes nothing at all', () => {
    const doc = newDoc();
    const [a, b] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    const before = doc.toJSON();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const positions = new Map([
        [a, { x: bad, y: 0 }],
        [b, { x: 1, y: 1 }],
      ]);
      const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    expect(doc.toJSON()).toEqual(before);
  });

  it('TC-09: an empty id list is not a transaction', () => {
    const doc = newDoc();
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, new Map()));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  it('reports 0 when nothing needed writing, and carries LOCAL_ORIGIN when it did', () => {
    const doc = newDoc();
    const [a] = createAt(doc, [{ x: 0, y: 0 }]);
    const current = find(a, objectSnapshots(doc));
    const same = new Map([[a, { x: current.x, y: current.y }]]);
    const idle = withUpdateCount(doc, () => moveObjects(doc, same));
    expect(idle.result).toBe(0);
    expect(idle.updates).toBe(0);

    const origins: unknown[] = [];
    const originListener = (_update: Uint8Array, origin: unknown): void => {
      origins.push(origin);
    };
    doc.on('update', originListener);
    const moved = moveObjects(doc, new Map([[a, { x: current.x + 1, y: current.y }]]));
    doc.off('update', originListener);
    expect(moved).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('story 2 single-object calls are the same code path', () => {
    const doc = newDoc();
    const [a] = createAt(doc, [{ x: 0, y: 0 }]);
    expect(moveObject(doc, a, 5, 5)).toBe(true);
    expect(moveObject(doc, 'missing', 6, 6)).toBe(false);
    expect(moveObject(doc, a, Number.NaN, 6)).toBe(false);
    expect(find(a, objectSnapshots(doc))).toMatchObject({ x: 5, y: 5 });
  });
});

describe('resizeObjects (TC-03, TC-09)', () => {
  it('resizes a group in one transaction, skipping missing ids', () => {
    const doc = newDoc();
    const [a, b] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    deleteObject(doc, b);
    const rects = new Map<string, Rect>([
      [a, { x: 0, y: 0, width: 300, height: 300 }],
      [b, { x: 0, y: 0, width: 100, height: 100 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => resizeObjects(doc, rects));
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(objectBounds(find(a, objectSnapshots(doc)))).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
  });

  it('TC-09: a non-finite or zero-sized rect writes nothing', () => {
    const doc = newDoc();
    const [a] = createAt(doc, [{ x: 0, y: 0 }]);
    const before = doc.toJSON();
    const bad: Rect[] = [
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: -10, height: 100 },
    ];
    for (const rect of bad) {
      const { result, updates } = withUpdateCount(doc, () =>
        resizeObjects(doc, new Map([[a, rect]])),
      );
      expect(result).toBe(0);
      expect(updates).toBe(0);
    }
    expect(doc.toJSON()).toEqual(before);
  });

  it('leaves an unchanged size uncounted and untransacted', () => {
    const doc = newDoc();
    const [a] = createAt(doc, [{ x: 0, y: 0 }]);
    const current = objectBounds(find(a, objectSnapshots(doc)));
    const { result, updates } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map([[a, current]])),
    );
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('bringObjectsToFront (TC-06)', () => {
  it('TC-06: lifts a whole selection above everything unselected, keeping its own order', () => {
    const doc = newDoc();
    // Three overlapping notes selected, two notes elsewhere that must stay below.
    const [s1, s2, s3] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    const [u1, u2] = createAt(doc, [
      { x: 900, y: 0 },
      { x: 900, y: 0 },
    ]);
    expect(objectSnapshots(doc).map((object) => object.z)).toEqual([1, 2, 3, 4, 5]);

    // Lift the three in the order the selection holds them (s1 lowest, s3 highest).
    const { result, updates } = withUpdateCount(doc, () =>
      bringObjectsToFront(doc, [s1, s2, s3]),
    );
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const after = objectSnapshots(doc);
    const zOf = (id: string): number => find(id, after).z;
    // Above every unselected object…
    expect(Math.min(zOf(s1), zOf(s2), zOf(s3))).toBeGreaterThan(Math.max(zOf(u1), zOf(u2)));
    // …and still in the order they were stacked in.
    expect(zOf(s1)).toBeLessThan(zOf(s2));
    expect(zOf(s2)).toBeLessThan(zOf(s3));
    // Untouched objects keep their z.
    expect(zOf(u1)).toBe(4);
    expect(zOf(u2)).toBe(5);
  });

  it('skips ids that are gone, and does nothing when the selection is already on top', () => {
    const doc = newDoc();
    const [a, b] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    const { result } = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, 'missing']));
    expect(result).toBe(1);
    // The one object that was lifted is now above the one that was not asked about.
    const lifted = objectSnapshots(doc);
    expect(find(a, lifted).z).toBeGreaterThan(find(b, lifted).z);

    const top = objectSnapshots(doc).reduce((best, object) => (object.z > best.z ? object : best));
    const idle = withUpdateCount(doc, () => bringObjectsToFront(doc, [top.id]));
    // Already the top object: nothing to write, so nothing is synced.
    expect(idle.result).toBe(0);
    expect(idle.updates).toBe(0);
  });

  it('an empty id list is not a transaction', () => {
    const doc = newDoc();
    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, []));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('deleteObjects (TC-31 model side)', () => {
  it('removes a whole selection in one transaction and skips ids that are gone', () => {
    const doc = newDoc();
    const [a, b, c] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 800, y: 0 },
    ]);
    deleteObject(doc, b);
    const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, [a, b, c]));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(objectSnapshots(doc)).toEqual([]);
  });

  it('an empty id list is not a transaction', () => {
    const doc = newDoc();
    const { result, updates } = withUpdateCount(doc, () => deleteObjects(doc, []));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('objectsInRect (TC-07)', () => {
  it('TC-07: selects only what lies entirely inside the marquee', () => {
    const doc = newDoc();
    const [inside, partly, outside] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 2_000, y: 2_000 },
    ]);
    const objects = objectSnapshots(doc);
    // The notes are 200 wide: the first ends at 100, the second runs from 50 to 250.
    const marquee: Rect = { x: -100, y: -100, width: 200, height: 200 };
    expect(objectBounds(find(inside, objects))).toMatchObject({ x: -100, y: -100 });
    expect(objectsInRect(objects, marquee)).toEqual([inside]);
    expect(objectsInRect(objects, marquee)).not.toContain(partly);
    expect(objectsInRect(objects, marquee)).not.toContain(outside);
  });

  it('an empty marquee selects nothing', () => {
    const doc = newDoc();
    createAt(doc, [{ x: 0, y: 0 }]);
    expect(objectsInRect(objectSnapshots(doc), { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });
});

describe('allObjectIds and the object types this build knows (TC-08)', () => {
  it('TC-08: an object of a type nobody registered is not selectable', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    if (typeof sticky !== 'string') throw new Error('fixture failed');
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      rawObjects(doc).set('shape-1', shape);
    });

    expect(objectSnapshots(doc)).toHaveLength(2);
    expect(allObjectIds(objectSnapshots(doc))).toEqual([sticky]);
    // The renderer still paints it (it has bounds), but nothing can be selected on it.
    expect(isObjectTypeKnown('shape')).toBe(false);
    expect(isObjectTypeKnown('sticky')).toBe(true);
  });

  it('a type this build declares becomes known and selectable', () => {
    const doc = newDoc();
    doc.transact(() => {
      const box = new Y.Map<unknown>();
      box.set('type', 'testbox');
      box.set('x', 0);
      box.set('y', 0);
      box.set('z', 1);
      box.set('width', 120);
      box.set('height', 80);
      rawObjects(doc).set('box-1', box);
    });
    expect(allObjectIds(objectSnapshots(doc))).toEqual([]);

    markObjectTypeKnown('testbox');
    const [box] = objectSnapshots(doc);
    expect(allObjectIds(objectSnapshots(doc))).toEqual(['box-1']);
    expect(objectBounds(box as ObjectSnapshot)).toEqual({ x: 0, y: 0, width: 120, height: 80 });
  });

  it('the marquee skips unknown types too', () => {
    const doc = newDoc();
    doc.transact(() => {
      const ghost = new Y.Map<unknown>();
      ghost.set('type', 'ghost');
      ghost.set('x', 0);
      ghost.set('y', 0);
      ghost.set('z', 1);
      ghost.set('width', 10);
      ghost.set('height', 10);
      rawObjects(doc).set('ghost-1', ghost);
    });
    expect(objectsInRect(objectSnapshots(doc), { x: -100, y: -100, width: 500, height: 500 })).toEqual(
      [],
    );
  });
});

describe('the size limits the model and the registry share', () => {
  it('the settings story 7 names are the ones the PRD gives', () => {
    expect(STICKY_MIN_SIZE_WORLD).toBe(50);
    expect(MAX_OBJECT_SIZE_WORLD).toBe(20_000);
    expect(STICKY_SIZE_WORLD).toBe(200);
  });

  it('unionRects over a selection is what the handles are drawn around', () => {
    const doc = newDoc();
    const [a, b] = createAt(doc, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    const bounds = unionRects(objectSnapshots(doc).map(objectBounds));
    expect(bounds?.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(bounds?.width).toBe(400 + STICKY_SIZE_WORLD);
    expect(objectSnapshots(doc).map((object) => object.id).sort()).toEqual([a, b].sort());
  });
});
