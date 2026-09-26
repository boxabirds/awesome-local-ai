import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObjects,
  deleteObjects,
  resizeObjects,
  bringObjectsToFront,
  allObjectIds,
  objectBounds,
  objectsInRect,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => updates += 1);
});

function reset() {
  updates = 0;
}

function obj(id: string): Y.Map<unknown> {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

describe('board-model group operations', () => {
  it('empty group: moveObjects / deleteObjects / resizeObjects are no-ops', () => {
    reset();
    expect(moveObjects(doc, [], 5, 5)).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(updates).toBe(0);
  });

  it('three stickies move as ONE transaction (one update)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    const c = createSticky(doc, { x: 0, y: 500 });
    reset();
    const moved = moveObjects(doc, [a, b, c], 10, 20);
    expect(moved).toBe(3);
    expect(updates).toBe(1);
    expect(obj(a).get('x')).toBeCloseTo(10 - STICKY_SIZE_WORLD / 2 + 0);
  });

  it('group keeps relative offsets (no collapse to one position)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const beforeA = obj(a).get('x') as number;
    const beforeB = obj(b).get('x') as number;
    moveObjects(doc, [a, b], 100, 0);
    expect((obj(a).get('x') as number) - beforeA).toBeCloseTo(100);
    expect((obj(b).get('x') as number) - beforeB).toBeCloseTo(100);
    // Still 400 apart, i.e. they did not collapse onto each other.
    expect((obj(b).get('x') as number) - (obj(a).get('x') as number)).toBeCloseTo(400);
  });

  it('a stale id does not block the valid ones', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    reset();
    const moved = moveObjects(doc, [a, 'ghost', b], 5, 5);
    expect(moved).toBe(2);
    expect(updates).toBe(1);
  });

  it('deleteObjects removes the group in one transaction', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    reset();
    expect(deleteObjects(doc, [a, 'ghost', b])).toBe(2);
    expect(updates).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('non-finite move delta writes nothing', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(moveObjects(doc, [a], Number.NaN, 0)).toBe(0);
    expect(moveObjects(doc, [a], Infinity, 0)).toBe(0);
    expect(updates).toBe(0);
  });

  it('resizeObjects clamps to the minimum and never writes a negative size', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    reset();
    // A collapsed rect (below the min side) is dropped, not stored as negative.
    const changed = resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: -50, height: -50 }]]));
    expect(changed).toBe(0);
    expect(updates).toBe(0);
    const o = obj(a);
    expect((o.get('width') as number) ?? STICKY_SIZE_WORLD).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);

    // A valid grow is written.
    reset();
    const grown = resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 300, height: 250 }]]));
    expect(grown).toBe(1);
    expect(obj(a).get('width')).toBe(300);
    expect(obj(a).get('height')).toBe(250);
  });

  it('allObjectIds / objectBounds / objectsInRect skip unknown types', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    doc.transact(() => objects.set('shape-1', shape));

    expect(allObjectIds(doc)).toEqual([a]);
    expect(objectBounds(doc, a)).not.toBeNull();
    expect(objectBounds(doc, 'shape-1')).toBeNull();
    expect(objectsInRect(doc, { x: -200, y: -200, width: 1000, height: 1000 })).toEqual([a]);
    // A rect that does not fully enclose the note selects nothing.
    expect(objectsInRect(doc, { x: 0, y: 0, width: 1000, height: 1000 })).toEqual([]);
  });

  it('TC-07: a marquee selects only the note lying entirely inside it', () => {
    // createSticky centres the note, so a note "at" {x,y} spans +/-100 around it.
    const a = createSticky(doc, { x: 0, y: 0 }); // -100..100 -> fully inside
    const b = createSticky(doc, { x: 250, y: 0 }); // 150..350 -> only partly inside
    const c = createSticky(doc, { x: 2000, y: 2000 }); // outside entirely
    const hits = objectsInRect(doc, { x: -200, y: -200, width: 400, height: 400 });
    expect(hits).toEqual([a]);
    expect(hits).not.toContain(b);
    expect(hits).not.toContain(c);
  });

  it('TC-09: a malformed marquee rect selects nothing', () => {
    createSticky(doc, { x: 0, y: 0 });
    expect(objectsInRect(doc, { x: 0, y: 0, width: NaN, height: 100 })).toEqual([]);
    expect(objectsInRect(doc, { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });

  it('bringObjectsToFront lifts the group above the rest and keeps its own order', () => {
    const a = createSticky(doc, { x: 1000, y: 0 }); // z 1
    const b = createSticky(doc, { x: 1500, y: 0 }); // z 2
    const other = createSticky(doc, { x: 0, y: 0 }); // z 3, never selected
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    reset();
    const raised = bringObjectsToFront(doc, [a, b]);
    expect(raised).toBe(2);
    expect(updates).toBe(1);
    const zOf = (id: string) => objects.get(id)!.get('z') as number;
    // Both selected notes now sit above the unselected one...
    expect(zOf(a)).toBeGreaterThan(zOf(other));
    expect(zOf(b)).toBeGreaterThan(zOf(other));
    // ...and their relative stacking order is untouched.
    expect(zOf(b) - zOf(a)).toBe(1);
  });

  it('bringObjectsToFront is a no-op for a group already on top (no update)', () => {
    createSticky(doc, { x: 0, y: 0 }); // z 1
    const a = createSticky(doc, { x: 500, y: 0 }); // z 2
    const b = createSticky(doc, { x: 900, y: 0 }); // z 3, already above `other`
    reset();
    expect(bringObjectsToFront(doc, [a, b])).toBe(0);
    expect(updates).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, ['ghost'])).toBe(0);
    expect(updates).toBe(0);
  });
});
