// Story 7, sel.geometry_ops — generic group operations on board-model against
// a real Y.Doc (TC-05 to TC-10).
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
  objectsSnapshot,
  objectBounds,
  objectsInRect,
  allObjectIds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsMapOf,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import {
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config.ts';
import { clampScale, scaleWithin, type Rect } from '../../src/shared/geometry.ts';

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const cb = () => {
    n++;
  };
  doc.on('update', cb);
  try {
    fn();
  } finally {
    doc.off('update', cb);
  }
  return n;
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function newSticky(doc: Y.Doc, x: number, y: number, text = ''): string {
  const id = createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  if (text) getStickyText(doc, id)?.insert(0, text);
  return id;
}

function byId(doc: Y.Doc, id: string): ObjectSnapshot {
  const o = objectsSnapshot(doc).find((s) => s.id === id);
  if (!o) throw new Error(`object ${id} missing`);
  return o;
}

describe('board-model moveObjects (TC-05)', () => {
  // TC-05: 3 ids, 1 deleted mid-batch by someone else -> moves the 2 that are
  // still there, in exactly ONE transaction (one update event).
  it('TC-05 skips a remotely deleted id and writes the rest in one update', () => {
    const doc = newDoc();
    const a = newSticky(doc, 0, 0, 'a');
    const b = newSticky(doc, 300, 0, 'b');
    const c = newSticky(doc, 0, 300, 'c');
    deleteObjects(doc, [b]); // vanished between selection and the gesture frame

    const updates = countUpdates(doc, () => {
      const moved = moveObjects(
        doc,
        new Map([
          [a, { x: 10, y: 20 }],
          [b, { x: 9, y: 9 }],
          [c, { x: 30, y: 40 }],
        ]),
      );
      expect(moved).toBe(2);
    });
    expect(updates).toBe(1);
    expect(byId(doc, a).x).toBe(10);
    expect(byId(doc, a).y).toBe(20);
    expect(byId(doc, c).x).toBe(30);
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('moveObjects leaves other fields untouched and runs with LOCAL_ORIGIN', () => {
    const doc = newDoc();
    const id = newSticky(doc, 0, 0, 'keep me');
    const before = byId(doc, id);
    let seenOrigin: unknown = 'unset';
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      seenOrigin = origin;
    });
    expect(moveObjects(doc, new Map([[id, { x: 5, y: -5 }]]))).toBe(1);
    expect(seenOrigin).toBe(LOCAL_ORIGIN);
    const after = byId(doc, id);
    expect(after.text).toBe(before.text);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
  });

  // TC-09 (error path): non-finite positions and an empty id list write nothing.
  it('TC-09 rejects non-finite positions and an empty batch with no transaction', () => {
    const doc = newDoc();
    const id = newSticky(doc, 0, 0);
    const updates = countUpdates(doc, () => {
      expect(
        moveObjects(doc, new Map([[id, { x: Number.NaN, y: 1 }]])),
      ).toBe(0);
      expect(
        moveObjects(doc, new Map([[id, { x: 1, y: Number.POSITIVE_INFINITY }]])),
      ).toBe(0);
      expect(moveObjects(doc, new Map())).toBe(0);
    });
    expect(updates).toBe(0);
    expect(byId(doc, id).x).toBe(0); // the fixture centred it on (100, 100)
  });
});

describe('board-model resizeObjects (TC-10)', () => {
  // TC-10: a sticky created before this story has no width/height;
  // objectBounds reads STICKY_SIZE_WORLD for it, and the FIRST resize writes
  // both fields explicitly (additive migration, no rewrite pass).
  it('TC-10 implicit size falls back to STICKY_SIZE_WORLD and the first resize persists both fields', () => {
    const doc = newDoc();
    const id = newSticky(doc, 0, 0);
    const raw = objectsMapOf(doc).get(id)!;
    expect(raw.get('width')).toBeUndefined();
    expect(raw.get('height')).toBeUndefined();

    const bounds = objectBounds(byId(doc, id));
    expect(bounds).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });

    const updates = countUpdates(doc, () => {
      const n = resizeObjects(
        doc,
        new Map([[id, { x: -10, y: -20, width: 300, height: 300 }]]),
      );
      expect(n).toBe(1);
    });
    expect(updates).toBe(1);
    expect(raw.get('width')).toBe(300);
    expect(raw.get('height')).toBe(300);
    const after = byId(doc, id);
    expect(after.x).toBe(-10);
    expect(after.y).toBe(-20);
    expect(objectBounds(after)).toEqual({ x: -10, y: -20, width: 300, height: 300 });
  });

  it('resizeObjects writes exactly one update for a whole group', () => {
    const doc = newDoc();
    const a = newSticky(doc, 0, 0);
    const b = newSticky(doc, 400, 0);
    const updates = countUpdates(doc, () => {
      const n = resizeObjects(
        doc,
        new Map([
          [a, { x: 0, y: 0, width: 400, height: 400 }],
          [b, { x: 600, y: 0, width: 400, height: 400 }],
        ]),
      );
      expect(n).toBe(2);
    });
    expect(updates).toBe(1);
  });

  it('resizeObjects skips invalid rects and stale ids', () => {
    const doc = newDoc();
    const id = newSticky(doc, 0, 0);
    const updates = countUpdates(doc, () => {
      expect(
        resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: Number.NaN, height: 10 }]])),
      ).toBe(0);
      expect(
        resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 0, height: 10 }]])),
      ).toBe(0);
      expect(
        resizeObjects(
          doc,
          new Map([['nope', { x: 0, y: 0, width: 10, height: 10 }]]),
        ),
      ).toBe(0);
    });
    expect(updates).toBe(0);
  });

  // The resize limit path end to end: clampScale + scaleWithin + resizeObjects
  // stop at the sticky minimum without distorting the layout.
  it('a group resize clamps at STICKY_MIN_SIZE_WORLD for every object', () => {
    const doc = newDoc();
    const a = newSticky(doc, 0, 0);
    const b = newSticky(doc, 300, 0);
    const ra = objectBounds(byId(doc, a));
    const rb = objectBounds(byId(doc, b));
    const box: Rect = { x: 0, y: 0, width: 500, height: 200 };
    const clamped = clampScale(
      { x: 0.02, y: 0.02 },
      [ra, rb],
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      20_000,
    );
    const to: Rect = { x: 0, y: 0, width: box.width * clamped.x, height: box.height * clamped.y };
    const n = resizeObjects(
      doc,
      new Map([
        [a, scaleWithin(ra, box, to)],
        [b, scaleWithin(rb, box, to)],
      ]),
    );
    expect(n).toBe(2);
    expect(byId(doc, a).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(byId(doc, b).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });
});

describe('board-model bringObjectsToFront (TC-06)', () => {
  // TC-06: 3 overlapping selected notes over 2 unselected: after the call all
  // selected z are above every unselected z, and the selected relative order
  // is unchanged.
  it('TC-06 raises the group above the unselected and keeps the relative order', () => {
    const doc = newDoc();
    const s1 = newSticky(doc, 0, 0); // z 1
    const u1 = newSticky(doc, 1000, 0); // z 2 (unselected)
    const s2 = newSticky(doc, 10, 0); // z 3
    const u2 = newSticky(doc, 2000, 0); // z 4 (unselected)
    const s3 = newSticky(doc, 20, 0); // z 5

    const updates = countUpdates(doc, () => {
      const n = bringObjectsToFront(doc, [s3, s1, s2]);
      expect(n).toBe(3);
    });
    expect(updates).toBe(1);

    const zs = (ids: string[]) => ids.map((id) => byId(doc, id).z);
    const sel = zs([s1, s2, s3]);
    const unsel = zs([u1, u2]);
    expect(Math.min(...sel)).toBeGreaterThan(Math.max(...unsel));
    // relative order among selected preserved (s1 below s2 below s3)
    expect(sel[0]).toBeLessThan(sel[1]);
    expect(sel[1]).toBeLessThan(sel[2]);
    // unselected untouched
    expect(unsel).toEqual([2, 4]);
  });

  it('bringing an already-topmost group to the front changes nothing', () => {
    const doc = newDoc();
    const u = newSticky(doc, 0, 0); // z 1
    const a = newSticky(doc, 10, 0); // z 2 (already on top)
    const updates = countUpdates(doc, () => {
      expect(bringObjectsToFront(doc, [a])).toBe(0);
    });
    expect(updates).toBe(0);
    expect(byId(doc, a).z).toBe(2);
    void u;
  });

  it('empty or stale id lists bring nothing to the front with no transaction', () => {
    const doc = newDoc();
    newSticky(doc, 0, 0);
    const updates = countUpdates(doc, () => {
      expect(bringObjectsToFront(doc, [])).toBe(0);
      expect(bringObjectsToFront(doc, ['missing'])).toBe(0);
    });
    expect(updates).toBe(0);
  });
});

describe('board-model marquee and select-all reads (TC-07, TC-08)', () => {
  function seeded(): { doc: Y.Doc; a: string; b: string; c: string } {
    const doc = newDoc();
    // A fully inside the marquee, B half inside, C outside.
    const a = newSticky(doc, 100, 100); // bounds 100..300 (with size 200 offset -200/+...)
    const b = newSticky(doc, 250, 100);
    const c = newSticky(doc, 900, 900);
    return { doc, a, b, c };
  }

  // TC-07: only objects ENTIRELY inside the rectangle are selected (B, touched
  // but not enclosed, is the negative).
  it('TC-07 selects only the object fully inside the rectangle', () => {
    const { doc, a, b, c } = seeded();
    const snap = objectsSnapshot(doc);
    // Rectangle enclosing A's full bounds (A top-left = 0,0 world) but only
    // half of B.
    const rect: Rect = { x: -1, y: -1, width: 302, height: 302 };
    const ids = objectsInRect(snap, rect);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
    expect(ids).toEqual([a]);
  });

  it('objectsInRect returns every fully-inside object in snapshot order', () => {
    const { doc, a, b, c } = seeded();
    const snap = objectsSnapshot(doc);
    const ids = objectsInRect(snap, { x: -100, y: -100, width: 2000, height: 2000 });
    expect(ids).toEqual(expect.arrayContaining([a, b, c]));
    expect(ids).toHaveLength(3);
    // a degenerate / non-finite rect selects nothing
    expect(objectsInRect(snap, { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(
      objectsInRect(snap, { x: Number.NaN, y: 0, width: 100, height: 100 }),
    ).toEqual([]);
  });

  // TC-08: an object of an unknown type in the doc is not selectable.
  it('TC-08 allObjectIds excludes objects of unknown types', () => {
    const { doc, a, b, c } = seeded();
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape'); // a type from a future story, unknown to this build
    obj.set('x', 1);
    obj.set('y', 2);
    obj.set('z', 9);
    objectsMapOf(doc).set('shape-1', obj);

    const snap = objectsSnapshot(doc);
    const ids = allObjectIds(snap);
    expect(ids).toEqual(expect.arrayContaining([a, b, c]));
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain('shape-1');
  });

  it('allObjectIds on an empty board selects nothing', () => {
    const doc = newDoc();
    expect(allObjectIds(objectsSnapshot(doc))).toEqual([]);
  });
});

describe('board-model deleteObjects', () => {
  it('deletes a group in one update and skips stale ids', () => {
    const doc = newDoc();
    const a = newSticky(doc, 0, 0);
    const b = newSticky(doc, 100, 0);
    newSticky(doc, 200, 0);
    const updates = countUpdates(doc, () => {
      expect(deleteObjects(doc, [a, 'missing', b])).toBe(2);
    });
    expect(updates).toBe(1);
    expect(objectsSnapshot(doc)).toHaveLength(1);
    // empty list / all-stale deletes nothing
    const updates2 = countUpdates(doc, () => {
      expect(deleteObjects(doc, [])).toBe(0);
      expect(deleteObjects(doc, ['gone', 'missing'])).toBe(0);
    });
    expect(updates2).toBe(0);
  });

  it('deleting a note removes its Y.Text content with it', () => {
    const doc = newDoc();
    const id = newSticky(doc, 0, 0, 'retro content');
    deleteObjects(doc, [id]);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsMapOf(doc).has(id)).toBe(false);
  });
});
