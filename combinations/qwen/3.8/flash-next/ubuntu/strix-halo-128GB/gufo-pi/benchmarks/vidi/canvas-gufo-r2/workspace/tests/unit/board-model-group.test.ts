/**
 * Board-model generic group-operation unit tests (TC-05 to TC-10).
 * Real Y.Doc. Each mutating test asserts the number of `update` events.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectBounds,
  objectsInRect,
  allObjectIds,
  snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function mkNote(objects: Y.Map<Y.Map<unknown>>, id: string, x: number, y: number, z: number) {
  const m = new Y.Map<unknown>();
  m.set('type', 'sticky');
  m.set('x', x);
  m.set('y', y);
  m.set('color', 'yellow');
  m.set('z', z);
  m.set('createdAt', 1);
  m.set('text', new Y.Text());
  objects.set(id, m);
  return m;
}

describe('board-model group operations', () => {
  let doc: Y.Doc;
  let updateCount: number;

  beforeEach(() => {
    doc = new Y.Doc();
    updateCount = 0;
    doc.on('update', () => updateCount++);
  });

  it('TC-05: moveObjects with 1 of 3 ids deleted returns 2 and emits exactly 1 update', () => {
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    mkNote(objects, 'a', 0, 0, 1);
    mkNote(objects, 'b', 0, 0, 2);
    mkNote(objects, 'c', 0, 0, 3);
    updateCount = 0;
    const moved = moveObjects(
      doc,
      new Map([
        ['a', { x: 10, y: 10 }],
        ['b', { x: 20, y: 20 }],
        ['gone', { x: 30, y: 30 }],
      ]),
    );
    expect(moved).toBe(2);
    expect(updateCount).toBe(1);
    const s = snapshot(doc);
    expect(s.find((n) => n.id === 'a')!.x).toBe(10);
    expect(s.find((n) => n.id === 'b')!.y).toBe(20);
    expect(s.find((n) => n.id === 'c')!.x).toBe(0);
  });

  it('TC-06: bringObjectsToFront raises 3 overlapping selected above 2 unselected, relative order kept', () => {
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    // unselected higher z (currently on top)
    mkNote(objects, 'u1', 0, 0, 5);
    mkNote(objects, 'u2', 0, 0, 6);
    // selected lower z, must be raised above the unselected pair
    mkNote(objects, 's1', 0, 0, 1);
    mkNote(objects, 's2', 0, 0, 2);
    mkNote(objects, 's3', 0, 0, 3);
    updateCount = 0;
    const changed = bringObjectsToFront(doc, ['s1', 's2', 's3']);
    expect(changed).toBe(3);
    const snaps = snapshot(doc);
    const z = (id: string) => snaps.find((n) => n.id === id)!.z;
    // Every selected above every unselected.
    expect(Math.min(z('s1'), z('s2'), z('s3'))).toBeGreaterThan(Math.max(z('u1'), z('u2')));
    // Relative order preserved: s1 (lowest originally) < s2 < s3 (highest originally).
    expect(z('s1')).toBeLessThan(z('s2'));
    expect(z('s2')).toBeLessThan(z('s3'));
  });

  it('TC-07: objectsInRect returns only fully-inside objects (A), not partly (B) or outside (C)', () => {
    const A = { id: 'A', type: 'sticky' as const, x: 10, y: 10, color: 'yellow' as const, text: '', z: 1, createdAt: 1, width: 50, height: 50 };
    const B = { id: 'B', type: 'sticky' as const, x: 80, y: 80, color: 'yellow' as const, text: '', z: 2, createdAt: 1, width: 100, height: 100 };
    const C = { id: 'C', type: 'sticky' as const, x: 500, y: 500, color: 'yellow' as const, text: '', z: 3, createdAt: 1, width: 100, height: 100 };
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(objectsInRect([A, B, C], rect)).toEqual(['A']);
  });

  it('TC-08: allObjectIds excludes unknown object types', () => {
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    createSticky(doc, { x: 0, y: 0 });
    // Insert an unknown-type object directly.
    const unknown = new Y.Map<unknown>();
    unknown.set('type', 'shape');
    unknown.set('x', 0);
    unknown.set('y', 0);
    objects.set('shape1', unknown);
    const ids = allObjectIds(snapshot(doc));
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain('shape1');
  });

  it('TC-09: non-finite positions and empty list -> 0 moved, no transaction', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    expect(moveObjects(doc, new Map([[id, { x: NaN, y: 0 }]]))).toBe(0);
    expect(moveObjects(doc, new Map([[id, { x: 0, y: Infinity }]]))).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: Infinity, height: 10 }]]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(updateCount).toBe(0);
  });

  it('TC-10: sticky without width/height reads STICKY_SIZE_WORLD; first resizeObjects writes both fields', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc).find((n) => n.id === id)!;
    expect(before.width).toBeUndefined();
    const bounds = objectBounds(before);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    updateCount = 0;
    const changed = resizeObjects(
      doc,
      new Map([[id, { x: 5, y: 5, width: 300, height: 300 }]]),
    );
    expect(changed).toBe(1);
    expect(updateCount).toBe(1);
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.width).toBe(300);
    expect(after.height).toBe(300);
    expect(after.x).toBe(5);
    expect(after.y).toBe(5);
  });

  it('extra: resizeObjects skips missing ids but writes present ones in one update', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 100, y: 100 });
    updateCount = 0;
    const changed = resizeObjects(
      doc,
      new Map([
        [a, { x: 1, y: 1, width: 120, height: 120 }],
        ['missing', { x: 0, y: 0, width: 50, height: 50 }],
      ]),
    );
    expect(changed).toBe(1);
    expect(updateCount).toBe(1);
    void getStickyText;
  });

  it('extra: deleteObjects removes present ids in one transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    const changed = deleteObjects(doc, [a, 'missing', b]);
    expect(changed).toBe(2);
    expect(updateCount).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });
});
