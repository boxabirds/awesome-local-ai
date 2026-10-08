// Story 7 unit tests, task 6 (TC-01 to TC-10): geometry helpers and the
// generic group operations in board-model, against a real Y.Doc.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  anchoredBox,
  clampScale,
  normalizeRect,
  resizeRect,
  scaleWithin,
  unionRects,
} from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  objectsSnapshot,
  registerKnownObjectType,
  resizeObjects,
} from '../../src/shared/board-model';

function docWithNotes(n: number): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    ids.push(createSticky(doc, { x: 100 * i, y: 0 })!);
  }
  return { doc, ids };
}

describe('geometry (story 7)', () => {
  it('TC-01: resizeRect se handle with aspect lock grows the box proportionally', () => {
    // 200x200 box, se handle, delta (100, 40): the wider delta wins and the
    // box stays square (300x300), anchored at the nw corner.
    const start = { x: 0, y: 0, width: 200, height: 200 };
    const box = resizeRect(start, 'se', { x: 100, y: 40 }, true);
    expect(box.width).toBeCloseTo(300, 9);
    expect(box.height).toBeCloseTo(300, 9);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });

  it('TC-02: shrinking below the minimum side is clamped at STICKY_MIN_SIZE_WORLD', () => {
    // A scale of 0.249 would put the 200-unit notes at 49.8 < 50: clamped to
    // 50x50 (boundary: exactly 0.25 passes, 0.25 - epsilon does not).
    const rects = [{ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD }];
    const at = clampScale({ x: 0.25, y: 0.25 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(at.x).toBeCloseTo(0.25, 9);
    expect(at.y).toBeCloseTo(0.25, 9);
    const below = clampScale({ x: 0.249, y: 0.249 }, rects, [STICKY_MIN_SIZE_WORLD], MAX_OBJECT_SIZE_WORLD);
    expect(below.x).toBeCloseTo(0.25, 9);
    expect(below.y).toBeCloseTo(0.25, 9);
    // The anchored box at the clamped scale is exactly 50x50.
    const box = anchoredBox(
      { x: 0, y: 0, width: 200, height: 200 },
      'se',
      200 * below.x,
      200 * below.y,
    );
    expect(box.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);
    expect(box.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 9);
  });

  it('TC-03: clampScale stops uniformly at the first object hitting the maximum size', () => {
    // Two rects: a 100-unit and a 200-unit object. A uniform scale of 200
    // would push the 200-unit object to 40000 > MAX (20000): the scale is
    // pulled back uniformly so the 200-unit object lands exactly on MAX, and
    // the relative layout (2x) is preserved.
    const rects = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 300, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD },
    ];
    const clamped = clampScale(
      { x: 200, y: 200 },
      rects,
      [STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    expect(clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / STICKY_SIZE_WORLD, 9); // 100
    expect(clamped.y).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / STICKY_SIZE_WORLD, 9);
    // The smaller object ends at half the max side — the 2x ratio preserved.
    expect(100 * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD / 2, 9);
    expect(STICKY_SIZE_WORLD * clamped.x).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 9);
  });

  it('TC-04: scaleInto maps child rects into the final box, gaps included (x2 width)', () => {
    // Two 200-unit notes 100 apart; the box doubles in width: the notes
    // become 400 wide and the gap 200.
    const childA = { x: 0, y: 0, width: 200, height: 200 };
    const childB = { x: 300, y: 0, width: 200, height: 200 };
    const from = unionRects([childA, childB])!;
    const to = { x: 0, y: 0, width: from.width * 2, height: from.height };
    const a2 = scaleWithin(childA, from, to);
    const b2 = scaleWithin(childB, from, to);
    expect(a2.width).toBeCloseTo(400, 9);
    expect(b2.width).toBeCloseTo(400, 9);
    expect(b2.x - (a2.x + a2.width)).toBeCloseTo(200, 9); // gap doubled
  });

  it('normalizeRect handles reversed corners (dragging up-left)', () => {
    const r = normalizeRect({ x: 100, y: 100 }, { x: 40, y: 60 });
    expect(r).toEqual({ x: 40, y: 60, width: 60, height: 40 });
  });

  it('unionRects returns null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });
});

describe('group operations (story 7)', () => {
  it('TC-05: moveObjects skips ids deleted remotely and reports one transaction per call', () => {
    const { doc, ids } = docWithNotes(3);
    doc.transact(() => {
      doc.getMap('objects').delete(ids[1]); // a colleague deleted note 2
    });
    const updateCount = { n: 0 };
    doc.on('update', () => {
      updateCount.n += 1;
    });
    const applied = moveObjects(
      doc,
      new Map([
        [ids[0], { x: 10, y: 20 }],
        [ids[1], { x: 30, y: 40 }], // missing: skipped
        [ids[2], { x: 50, y: 60 }],
      ]),
    );
    expect(applied).toBe(2);
    expect(updateCount.n).toBe(1); // one transaction for the whole group
    const snap = objectsSnapshot(doc);
    expect(snap.find((o) => o.id === ids[0])!.x).toBe(10);
    expect(snap.find((o) => o.id === ids[2])!.x).toBe(50);
  });

  it('TC-06: bringObjectsToFront raises the selection above unselected, keeping relative order', () => {
    const { doc, ids } = docWithNotes(5);
    // ids are created in order, so z = 1..5 (a and c overlap in z-order
    // terms: selected ids[0], ids[2], ids[4] over unselected ids[1], ids[3]).
    const changed = bringObjectsToFront(doc, [ids[0], ids[2], ids[4]]);
    expect(changed).toBe(3);
    const snap = objectsSnapshot(doc);
    const z = (id: string) => snap.find((o) => o.id === id)!.z;
    // Every selected note is above every unselected note…
    expect(z(ids[0])).toBeGreaterThan(z(ids[1]));
    expect(z(ids[0])).toBeGreaterThan(z(ids[3]));
    expect(z(ids[2])).toBeGreaterThan(z(ids[3]));
    expect(z(ids[4])).toBeGreaterThan(z(ids[1]));
    // …and the selected relative order (by their previous z) is preserved.
    expect(z(ids[0])).toBeLessThan(z(ids[2]));
    expect(z(ids[2])).toBeLessThan(z(ids[4]));
    // Idempotent: raising an already-topmost selection changes nothing.
    expect(bringObjectsToFront(doc, [ids[0], ids[2], ids[4]])).toBe(0);
  });

  it('TC-07: objectsInRect selects only fully-inside objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A fully inside, B partly (right half outside), C outside.
    // createSticky centres on `at`, so top-left (tx, ty) = at − (100, 100).
    const a = createSticky(doc, { x: 100, y: 100 })!; // spans 0..200
    const b = createSticky(doc, { x: 150, y: 100 })!; // spans 50..250
    const c = createSticky(doc, { x: 500, y: 100 })!; // spans 400..600
    const snap = objectsSnapshot(doc);
    const inside = objectsInRect(snap, { x: -10, y: -10, width: 220, height: 220 });
    expect(inside).toContain(a);
    expect(inside).not.toContain(b); // partly inside: negative
    expect(inside).not.toContain(c);
    expect(inside).toHaveLength(1);
  });

  it('TC-08: allObjectIds skips unknown types (forward compatibility)', () => {
    const { doc, ids } = docWithNotes(2);
    const map = doc.getMap('objects');
    const updates = { n: 0 };
    doc.on('update', () => {
      updates.n += 1;
    });
    const unknown = new Y.Map<unknown>();
    unknown.set('type', 'shape'); // a future story's type
    unknown.set('x', 0);
    unknown.set('y', 0);
    unknown.set('z', 100);
    doc.transact(() => {
      map.set('shape-1', unknown);
    });
    expect(allObjectIds(objectsSnapshot(doc))).toEqual(ids); // only known types
    // Unknown types are invisible to selection: prune-style setMany of all
    // ids can never include them.
    expect(objectsInRect(objectsSnapshot(doc), { x: -1e9, y: -1e9, width: 2e9, height: 2e9 })).toEqual(
      ids,
    );
  });

  it('TC-09: non-finite positions and empty id lists are refused without a transaction', () => {
    const { doc, ids } = docWithNotes(1);
    const updates = { n: 0 };
    doc.on('update', () => {
      updates.n += 1;
    });
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(moveObjects(doc, new Map([[ids[0], { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[ids[0], { x: 0, y: Number.POSITIVE_INFINITY }]]))).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(
      resizeObjects(
        doc,
        new Map([[ids[0], { x: 0, y: 0, width: Number.NaN, height: 100 }]]),
      ),
    ).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(updates.n).toBe(0); // nothing was written
    const snap = objectsSnapshot(doc);
    expect(snap[0].x).toBe(-100); // createSticky centred the note on (0,0)
  });

  it('TC-10: stickies without width/height read STICKY_SIZE_WORLD; the first resize writes both', () => {
    const { doc, ids } = docWithNotes(1);
    const before = objectsSnapshot(doc)[0];
    expect(before.width).toBeUndefined();
    expect(before.height).toBeUndefined();
    expect(objectBounds(before)).toEqual({
      x: -100,
      y: -100,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    const applied = resizeObjects(
      doc,
      new Map([[ids[0], { x: 10, y: 20, width: 150, height: 150 }]]),
    );
    expect(applied).toBe(1);
    const after = objectsSnapshot(doc)[0];
    expect(after.width).toBe(150); // explicit fields now persisted
    expect(after.height).toBe(150);
    expect(objectBounds(after)).toEqual({ x: 10, y: 20, width: 150, height: 150 });
  });

  it('registerKnownObjectType makes a new type visible to the snapshot', () => {
    registerKnownObjectType('shape');
    const { doc } = docWithNotes(0);
    const map = doc.getMap('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 5);
    shape.set('y', 6);
    shape.set('z', 1);
    shape.set('width', 40);
    shape.set('height', 30);
    // Story 10: a shape snapshot needs the full shape schema to be visible.
    shape.set('kind', 'rect');
    shape.set('fill', 'white');
    shape.set('stroke', 'dark');
    shape.set('label', new Y.Text());
    doc.transact(() => {
      map.set('shape-1', shape);
    });
    const snap = objectsSnapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe('shape-1');
    expect(snap[0].width).toBe(40);
  });
});
