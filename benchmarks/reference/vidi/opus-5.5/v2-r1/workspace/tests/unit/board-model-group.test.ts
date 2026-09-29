// sel.geometry_ops: group operations on a real Y.Doc (TC-05 to TC-10).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  type ObjectSnapshot,
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  objectsSnapshot,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T) {
  const origins: unknown[] = [];
  const onUpdate = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', onUpdate);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', onUpdate);
  }
}

/** Sticky with its top-left at (x, y). */
function stickyAt(doc: Y.Doc, x: number, y: number) {
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 }) as string;
}

const byId = (doc: Y.Doc, id: string) => objectsSnapshot(doc).find((o) => o.id === id)!;

describe('board-model group operations', () => {
  it('TC-05 moveObjects with one of three ids deleted remotely moves 2 in one update', () => {
    const doc = newDoc();
    const [a, b, c] = [stickyAt(doc, 0, 0), stickyAt(doc, 300, 0), stickyAt(doc, 600, 0)];
    deleteObjects(doc, [b]);
    const positions = new Map([
      [a, { x: 10, y: 20 }],
      [b, { x: 310, y: 20 }],
      [c, { x: 610, y: 20 }],
    ]);
    const { result, updates, origins } = countUpdates(doc, () => moveObjects(doc, positions));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(byId(doc, a)).toMatchObject({ x: 10, y: 20 });
    expect(byId(doc, c)).toMatchObject({ x: 610, y: 20 });
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('TC-06 bringObjectsToFront raises 3 overlapping notes above the rest, keeping their order', () => {
    const doc = newDoc();
    const ids = [0, 1, 2, 3, 4].map((i) => stickyAt(doc, i * 50, 0));
    // z: 1..5. Select ids[0], ids[2], ids[3] (z 1, 3, 4); unselected z 2 and 5.
    const selected = [ids[3], ids[0], ids[2]];
    const { result, updates } = countUpdates(doc, () => bringObjectsToFront(doc, selected));
    expect(result).toBe(3);
    expect(updates).toBe(1);
    const order = snapshot(doc).map((n) => n.id);
    expect(order).toEqual([ids[1], ids[4], ids[0], ids[2], ids[3]]);
    expect(byId(doc, ids[0]).z).toBe(6);
    // Already on top: nothing is written.
    expect(countUpdates(doc, () => bringObjectsToFront(doc, selected))).toMatchObject({
      result: 0,
      updates: 0,
    });
  });

  it('TC-07 objectsInRect: fully inside yes; partly inside, touching from outside and outside no', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    stickyAt(doc, 250, 0); // B: half inside
    stickyAt(doc, 1000, 1000); // C: outside
    stickyAt(doc, 350, 300); // D: touches the rect's corner from outside
    const rect = { x: -10, y: -10, width: 360, height: 310 };
    expect(objectsInRect(objectsSnapshot(doc), rect)).toEqual([a]);
  });

  it('TC-08 allObjectIds excludes objects of an unknown type', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'hexagon');
      shape.set('x', 0);
      shape.set('y', 0);
      doc.getMap('objects').set('shape-1', shape);
    });
    const objects = objectsSnapshot(doc);
    expect(objects.map((o) => o.id)).toContain('shape-1');
    expect(allObjectIds(objects)).toEqual([a]);
    expect(allObjectIds(objects, (t) => t === 'hexagon')).toEqual(['shape-1']);
    expect(allObjectIds([])).toEqual([]);
  });

  it('TC-09 non-finite values and empty id lists write nothing and return 0', () => {
    const doc = newDoc();
    const a = stickyAt(doc, 0, 0);
    const b = stickyAt(doc, 300, 0);
    const calls: [string, () => number][] = [
      ['move NaN', () => moveObjects(doc, new Map([[a, { x: NaN, y: 0 }], [b, { x: 1, y: 1 }]]))],
      ['move Infinity', () => moveObjects(doc, new Map([[a, { x: 0, y: Infinity }]]))],
      ['move empty', () => moveObjects(doc, new Map())],
      [
        'resize NaN',
        () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: NaN, height: 10 }]])),
      ],
      [
        'resize -Infinity',
        () => resizeObjects(doc, new Map([[a, { x: -Infinity, y: 0, width: 10, height: 10 }]])),
      ],
      ['resize zero', () => resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 0, height: 10 }]]))],
      ['resize empty', () => resizeObjects(doc, new Map())],
      ['front empty', () => bringObjectsToFront(doc, [])],
      ['delete empty', () => deleteObjects(doc, [])],
      ['delete missing', () => deleteObjects(doc, ['nope'])],
    ];
    for (const [, call] of calls) {
      expect(countUpdates(doc, call)).toMatchObject({ result: 0, updates: 0 });
    }
    expect(byId(doc, a)).toMatchObject({ x: 0, y: 0 });
    expect(byId(doc, b)).toMatchObject({ x: 300, y: 0 });
  });

  it('TC-10 a sticky without width/height is STICKY_SIZE_WORLD; the first resize writes both', () => {
    const doc = newDoc();
    doc.transact(() => {
      const note = new Y.Map<unknown>();
      note.set('type', 'sticky');
      note.set('x', 10);
      note.set('y', 20);
      note.set('color', 'yellow');
      note.set('text', new Y.Text('old'));
      note.set('z', 1);
      note.set('createdAt', 1);
      doc.getMap('objects').set('legacy', note);
    });
    const obj = byId(doc, 'legacy');
    expect(objectBounds(obj)).toEqual({ x: 10, y: 20, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    const map = doc.getMap('objects').get('legacy') as Y.Map<unknown>;
    expect(map.has('width')).toBe(false);
    const { result, updates } = countUpdates(doc, () =>
      resizeObjects(doc, new Map([['legacy', { x: 0, y: 0, width: 300, height: 300 }]])),
    );
    expect(result).toBe(1);
    expect(updates).toBe(1);
    expect(map.get('width')).toBe(300);
    expect(map.get('height')).toBe(300);
    expect(byId(doc, 'legacy')).toMatchObject({ x: 0, y: 0, width: 300, height: 300, text: 'old' });
  });

  it('new stickies store their size; deleteObjects removes several in one update', () => {
    const doc = newDoc();
    const ids = [stickyAt(doc, 0, 0), stickyAt(doc, 300, 0), stickyAt(doc, 600, 0)];
    const map = doc.getMap('objects').get(ids[0]) as Y.Map<unknown>;
    expect(map.get('width')).toBe(STICKY_SIZE_WORLD);
    const { result, updates } = countUpdates(doc, () => deleteObjects(doc, [ids[0], ids[2], 'gone']));
    expect(result).toBe(2);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n: ObjectSnapshot) => n.id)).toEqual([ids[1]]);
  });
});
