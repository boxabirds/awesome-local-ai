import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Objects map of a doc, typed loosely for test setup of raw schema. */
function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Count how many `update` events a doc emits while `fn` runs. */
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

function firstNote(doc: Y.Doc): StickySnapshot {
  const s = snapshot(doc);
  if (s.length === 0) throw new Error('expected at least one note');
  return s[0]!;
}

describe('board.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('initDoc sets meta.schemaVersion once', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    // Calling again does not bump or clear it and emits no update.
    expect(updatesDuring(doc, () => initDoc(doc))).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('TC-01 createSticky on an empty doc yields one yellow note centred on the point', () => {
    const point = { x: 0, y: 0 };
    let id = '';
    const updates = updatesDuring(doc, () => {
      id = createSticky(doc, point);
    });
    expect(updates).toBe(1);
    expect(objectsMap(doc).size).toBe(1);

    const note = firstNote(doc);
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    // Centred: top-left = point - size/2.
    expect(note.x).toBe(point.x - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(point.y - STICKY_SIZE_WORLD / 2);
  });

  it('TC-02 createSticky stacks above existing notes at z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    updatesDuring(doc, () => createSticky(doc, { x: 1000, y: 0 }));
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);
  });

  it('TC-03 moveObject updates only x and y', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = firstNote(doc);
    const updates = updatesDuring(doc, () => {
      expect(moveObject(doc, id, 10, -20)).toBe(true);
    });
    expect(updates).toBe(1);
    const after = firstNote(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    const updates = updatesDuring(doc, () => {
      expect(moveObject(doc, 'missing', 5, 5)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(0);
  });

  it('TC-05 setStickyColor applies a valid colour and leaves everything else', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    moveObject(doc, id, 33, 44);
    const before = firstNote(doc);
    const updates = updatesDuring(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });
    expect(updates).toBe(1);
    const after = firstNote(doc);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06 setStickyColor with an unknown colour returns false and writes nothing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesDuring(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(firstNote(doc).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-07 deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesDuring(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(objectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    const updates = updatesDuring(doc, () => {
      expect(deleteObject(doc, 'missing')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront lifts a non-topmost note to maxZ + 1', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);
    const updates = updatesDuring(doc, () => {
      expect(bringToFront(doc, a)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
  });

  it('TC-10 bringToFront on the already-topmost note is a no-op with no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });
    const updates = updatesDuring(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-11 snapshot breaks z ties by id and is stable across calls', () => {
    const idHigh = createSticky(doc, { x: 0, y: 0 });
    const idLow = createSticky(doc, { x: 0, y: 500 });
    // Force equal z (as concurrent clients could produce after story 3 syncs).
    doc.transact(() => {
      objectsMap(doc).get(idHigh)!.set('z', 7);
      objectsMap(doc).get(idLow)!.set('z', 7);
    });
    const first = snapshot(doc).map((n) => n.id);
    const expected = [idLow, idHigh].sort();
    expect(first).toEqual(expected);
    expect(snapshot(doc).map((n) => n.id)).toEqual(expected);
  });

  it('TC-12 snapshot skips objects of an unknown type without throwing', () => {
    createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 1);
      objectsMap(doc).set('shape-1', shape);
    });
    let s: readonly StickySnapshot[] = [];
    expect(() => {
      s = snapshot(doc);
    }).not.toThrow();
    expect(s).toHaveLength(1);
    expect(s[0]!.type).toBe('sticky');
  });

  it('TC-39 non-finite coordinates are rejected with no write and no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const cases: number[][] = [
      [Number.NaN, 5],
      [5, Number.NaN],
      [Number.POSITIVE_INFINITY, 5],
      [5, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of cases) {
      const updates = updatesDuring(doc, () => {
        expect(moveObject(doc, id, x, y)).toBe(false);
      });
      expect(updates).toBe(0);
    }
    // createSticky with a non-finite point yields no new object.
    const beforeSize = objectsMap(doc).size;
    const updates = updatesDuring(doc, () => {
      const r = createSticky(doc, { x: Number.NaN, y: 0 });
      expect(r).toBeFalsy();
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(beforeSize);
  });

  it('getStickyText returns the note Y.Text and undefined for a stale id', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  it('every preset colour name is accepted by setStickyColor', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    (Object.keys(STICKY_COLORS) as StickyColor[]).forEach((color) => {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(firstNote(doc).color).toBe(color);
    });
  });
});
