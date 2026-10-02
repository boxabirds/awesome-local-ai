import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectsInRect,
  allObjectIds,
  objectBounds,
  allObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

/** Run `fn` and count how many `update` events the doc emits. */
function withUpdateCount(doc: Y.Doc, fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: unknown;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeNote(doc: Y.Doc, at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  expect(id, 'createSticky should succeed').not.toBe(false);
  return id as string;
}

function objMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = doc.getMap('objects').get(id);
  expect(m, `object ${id} should exist`).toBeInstanceOf(Y.Map);
  return m as Y.Map<unknown>;
}

/**
 * Story 7 (sel.geometry_ops): generic group operations against a real Y.Doc.
 * TC-05 to TC-10.
 */
describe('board-model group operations (sel.geometry_ops)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-05
  it('TC-05: moveObjects with 1 of 3 ids deleted remotely → returns 2, exactly 1 update event', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 100, y: 0 });
    const c = makeNote(doc, { x: 200, y: 0 });
    // Someone else deletes b.
    deleteObjects(doc, [b]);

    const positions = new Map<string, { x: number; y: number }>([
      [a, { x: 10, y: 20 }],
      [b, { x: 110, y: 20 }],
      [c, { x: 210, y: 20 }],
    ]);
    const { result, updates } = withUpdateCount(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2); // missing id skipped
    expect(updates).toBe(1); // one transaction
    expect(objMap(doc, a).get('x')).toBe(10);
    expect(objMap(doc, a).get('y')).toBe(20);
    expect(objMap(doc, c).get('x')).toBe(210);
    expect(snapshot(doc)).toHaveLength(2);
  });

  // TC-06
  it('TC-06: bringObjectsToFront raises 3 overlapping selected above 2 unselected, relative z preserved', () => {
    // Create 5 notes: z 1..5. Select the three lowest (z 1,2,3) — they
    // overlap in position.
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 0, y: 0 });
    const c = makeNote(doc, { x: 0, y: 0 });
    const d = makeNote(doc, { x: 500, y: 500 }); // z 4
    const e = makeNote(doc, { x: 600, y: 600 }); // z 5

    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [a, b, c]));
    expect(result).toBe(3);
    expect(updates).toBe(1);

    const za = objMap(doc, a).get('z') as number;
    const zb = objMap(doc, b).get('z') as number;
    const zc = objMap(doc, c).get('z') as number;
    const zd = objMap(doc, d).get('z') as number;
    const ze = objMap(doc, e).get('z') as number;
    // All selected are above every unselected.
    expect(za).toBeGreaterThan(Math.max(zd, ze));
    expect(zb).toBeGreaterThan(Math.max(zd, ze));
    expect(zc).toBeGreaterThan(Math.max(zd, ze));
    // Relative order among the selected is preserved (a was below b, b below c).
    expect(za).toBeLessThan(zb);
    expect(zb).toBeLessThan(zc);
    // They are the three topmost.
    const allZ = snapshot(doc).map((s) => s.z).sort((x, y) => x - y);
    expect([za, zb, zc].sort((x, y) => x - y)).toEqual(allZ.slice(-3));
  });

  it('bringObjectsToFront with no z changes → 0, no transaction', () => {
    makeNote(doc, { x: 0, y: 0 });
    const top = makeNote(doc, { x: 100, y: 100 }); // top is topmost
    const { result, updates } = withUpdateCount(doc, () => bringObjectsToFront(doc, [top]));
    expect(result).toBe(0);
    expect(updates).toBe(0);
  });

  // TC-07
  it('TC-07: objectsInRect → A fully inside, B partly, C outside → [A]', () => {
    // 200×200 stickies. A spans (10..210, 10..210); B spans (200..400, 10..210)
    // and crosses the marquee's right edge at x=220; C spans (500..700, …).
    const a = makeNote(doc, { x: 110, y: 110 }); // top-left (10,10)
    const b = makeNote(doc, { x: 0, y: 0 });
    moveObjects(doc, new Map([[b, { x: 200, y: 10 }]]));
    const c = makeNote(doc, { x: 0, y: 0 });
    moveObjects(doc, new Map([[c, { x: 500, y: 10 }]]));

    const marquee: Rect = { x: 0, y: 0, width: 220, height: 220 };
    const snaps = snapshot(doc);
    const ids = objectsInRect(snaps, marquee);
    expect(ids).toEqual([a]); // B is only partly inside → not selected
  });

  // TC-08
  it('TC-08: allObjectIds excludes unknown types', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const mystery = new Y.Map<unknown>();
    mystery.set('type', 'shape');
    mystery.set('x', 0);
    mystery.set('y', 0);
    mystery.set('z', 99);
    objects.set('shape-1', mystery);

    const all = allObjects(doc);
    expect(all).toHaveLength(2);
    const ids = allObjectIds(all);
    expect(ids).toEqual([a]); // the unknown type is not selectable
  });

  // TC-09
  it('TC-09: NaN/Infinity positions and empty id lists → 0 applied, no transaction', () => {
    const a = makeNote(doc, { x: 100, y: 100 }); // top-left (0,0)

    // Empty map.
    expect(withUpdateCount(doc, () => moveObjects(doc, new Map())).result).toBe(0);
    expect(withUpdateCount(doc, () => moveObjects(doc, new Map())).updates).toBe(0);
    expect(withUpdateCount(doc, () => resizeObjects(doc, new Map())).result).toBe(0);
    expect(withUpdateCount(doc, () => deleteObjects(doc, [])).result).toBe(0);

    // Non-finite positions reject the WHOLE call, even for valid ids.
    const bad = new Map<string, { x: number; y: number }>([
      [a, { x: 1, y: 2 }],
      ['nope', { x: NaN, y: 0 }],
    ]);
    const r1 = withUpdateCount(doc, () => moveObjects(doc, bad));
    expect(r1.result).toBe(0);
    expect(r1.updates).toBe(0);
    expect(objMap(doc, a).get('x')).toBe(0); // nothing written

    const bad2 = new Map<string, { x: number; y: number }>([[a, { x: Infinity, y: 0 }]]);
    const r2 = withUpdateCount(doc, () => moveObjects(doc, bad2));
    expect(r2.result).toBe(0);
    expect(r2.updates).toBe(0);

    // Non-finite rect rejects the whole resize call.
    const badRect = new Map<string, Rect>([[a, { x: 0, y: 0, width: 100, height: NaN }]]);
    const r3 = withUpdateCount(doc, () => resizeObjects(doc, badRect));
    expect(r3.result).toBe(0);
    expect(r3.updates).toBe(0);
  });

  // TC-10
  it('TC-10: sticky without width/height uses STICKY_SIZE_WORLD; first resizeObjects writes both fields', () => {
    const a = makeNote(doc, { x: 50, y: 50 }); // top-left (-50,-50)
    const snap = snapshot(doc).find((s) => s.id === a)!;
    expect(snap.width).toBeUndefined();
    expect(snap.height).toBeUndefined();
    // objectBounds falls back to the default sticky size.
    expect(objectBounds(snap)).toEqual({
      x: -50,
      y: -50,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });

    // First resize writes both fields, turning the implicit size explicit.
    const { result, updates } = withUpdateCount(doc, () =>
      resizeObjects(doc, new Map([[a, { x: 5, y: 6, width: 250, height: 250 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    const m = objMap(doc, a);
    expect(m.get('width')).toBe(250);
    expect(m.get('height')).toBe(250);
    expect(m.get('x')).toBe(5);
    expect(m.get('y')).toBe(6);
    expect(objectBounds(snapshot(doc).find((s) => s.id === a)!)).toEqual({
      x: 5,
      y: 6,
      width: 250,
      height: 250,
    });
  });

  // deleteObjects: skips missing ids, one transaction, returns count.
  it('deleteObjects removes the given ids and skips missing ones', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 1, y: 1 });
    const { result, updates } = withUpdateCount(doc, () =>
      deleteObjects(doc, [a, 'ghost', b]),
    );
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
