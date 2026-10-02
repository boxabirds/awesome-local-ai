import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  deleteObjects,
  objectBounds,
  objectsInRect,
  allObjectIds,
  snapshot,
  getObjectsMap,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/** Counts Y.Doc `update` events (1 per successful transaction, 0 for rejections). */
function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board-model group — moveObjects', () => {
  it('TC-05 moves present ids, skips a deleted one, one transaction', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });
    deleteObjects(doc, [b]);
    const stop = updateCounter(doc);

    const n = moveObjects(
      doc,
      new Map([
        [a, { x: 10, y: 10 }],
        [b, { x: 20, y: 20 }],
        [c, { x: 30, y: 30 }],
      ]),
    );

    expect(n).toBe(2);
    expect(stop()).toBe(1);
    const notes = snapshot(doc);
    expect(notes.find((x) => x.id === a)?.x).toBe(10);
    expect(notes.find((x) => x.id === c)?.x).toBe(30);
  });

  it('TC-09 rejects non-finite positions and empty maps with 0 and no transaction', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const stop = updateCounter(doc);

    expect(moveObjects(doc, new Map([[a, { x: Number.NaN, y: 0 }]]))).toBe(0);
    expect(
      moveObjects(doc, new Map([[a, { x: 0, y: Number.POSITIVE_INFINITY }]])),
    ).toBe(0);
    expect(moveObjects(doc, new Map())).toBe(0);

    expect(snapshot(doc)[0].x).toBe(before.x);
    expect(stop()).toBe(0);
  });

  it('writing an unchanged position changes nothing (0, no transaction)', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const pos = { x: snapshot(doc)[0].x, y: snapshot(doc)[0].y };
    const stop = updateCounter(doc);
    expect(moveObjects(doc, new Map([[a, pos]]))).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — resizeObjects', () => {
  it('TC-10 implicit-size sticky: objectBounds uses STICKY_SIZE_WORLD; first resize writes both fields', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const note = snapshot(doc)[0];
    const bounds = objectBounds(note);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.height).toBe(STICKY_SIZE_WORLD);
    expect(getObjectsMap(doc).get(id)!.get('width')).toBeUndefined();

    const stop = updateCounter(doc);
    const n = resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 300, height: 300 }]]));
    expect(n).toBe(1);
    expect(stop()).toBe(1);
    expect(getObjectsMap(doc).get(id)!.get('width')).toBe(300);
    expect(getObjectsMap(doc).get(id)!.get('height')).toBe(300);
    expect(objectBounds(snapshot(doc)[0]).width).toBe(300);
  });

  it('rejects non-positive or non-finite rects with 0 and no transaction', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 0, height: 100 }]]))).toBe(0);
    expect(
      resizeObjects(doc, new Map([[id, { x: Number.NaN, y: 0, width: 100, height: 100 }]])),
    ).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — bringObjectsToFront', () => {
  it('TC-06 raises selected above unselected, preserving relative order', () => {
    const doc = newDoc();
    // z order: s1(1) s2(2) u1(3) s3(4) u2(5)
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 10, y: 0 });
    const u1 = createSticky(doc, { x: 20, y: 0 });
    const s3 = createSticky(doc, { x: 30, y: 0 });
    const u2 = createSticky(doc, { x: 40, y: 0 });
    const stop = updateCounter(doc);

    expect(bringObjectsToFront(doc, [s1, s2, s3])).toBe(3);

    const ordered = snapshot(doc);
    const z = (id: string) => ordered.find((n) => n.id === id)!.z;
    // Both unselected stay below every selected object.
    expect(z(s1)).toBeGreaterThan(z(u2));
    expect(z(s2)).toBeGreaterThan(z(u2));
    expect(z(s3)).toBeGreaterThan(z(u2));
    // Relative order among selected preserved: s1 < s2 < s3.
    expect(z(s1)).toBeLessThan(z(s2));
    expect(z(s2)).toBeLessThan(z(s3));
    expect(stop()).toBe(1);
  });

  it('no-op when the selection is already on top in order', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    // a(1) below b(2); raising [b] alone keeps z unchanged (2 == maxUnselected 1 + 1).
    const stop = updateCounter(doc);
    expect(bringObjectsToFront(doc, [b])).toBe(0);
    expect(stop()).toBe(0);
  });

  it('empty list returns 0 with no transaction', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(stop()).toBe(0);
  });
});

describe('board-model group — deleteObjects', () => {
  it('removes every present id in one transaction and skips missing ones', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    createSticky(doc, { x: 20, y: 0 });
    const stop = updateCounter(doc);

    expect(deleteObjects(doc, [a, b, 'missing'])).toBe(2);
    expect(snapshot(doc)).toHaveLength(1);
    expect(stop()).toBe(1);
  });
});

describe('board-model group — marquee + select-all helpers', () => {
  it('TC-07 objectsInRect returns only the fully-inside object', () => {
    const doc = newDoc();
    // A fully inside the marquee, B partly, C outside (STICKY_SIZE_WORLD = 200).
    const a = createSticky(doc, { x: 500, y: 500 }); // top-left 400..600 (all inside 0..1000)
    const b = createSticky(doc, { x: 1000, y: 500 }); // 900..1100 → partly outside
    const c = createSticky(doc, { x: 2000, y: 2000 }); // far outside
    const ids = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 1000, height: 1000 });
    expect(ids).toEqual([a]);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
  });

  it('TC-08 allObjectIds skips an object of unknown type', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 3);
      shape.set('y', 4);
      shape.set('z', 9);
      getObjectsMap(doc).set('shape-1', shape);
    });
    const ids = allObjectIds(snapshot(doc));
    expect(ids).toEqual([a]);
  });
});
