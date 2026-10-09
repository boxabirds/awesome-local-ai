import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
} from '../../src/shared/config';

// Counts Y.Doc `update` events emitted while running fn.
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const listener = () => updates++;
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function seeded(count: number): { doc: Y.Doc; ids: string[] } {
  const doc = freshDoc();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, { x: i * 1000, y: 0 });
    if (typeof id !== 'string') throw new Error('seed failed');
    ids.push(id);
  }
  return { doc, ids };
}

describe('board.model', () => {
  it('initDoc sets meta.schemaVersion exactly once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    expect(countUpdates(doc, () => initDoc(doc))).toBe(0);
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('TC-01: createSticky on an empty doc adds one yellow note centred on the point with z 1', () => {
    const doc = freshDoc();
    let id = '';
    const updates = countUpdates(doc, () => {
      const result = createSticky(doc, { x: 0, y: 0 });
      if (typeof result !== 'string') throw new Error('expected id');
      id = result;
    });
    expect(updates).toBe(1);
    expect(objectsMap(doc).size).toBe(1);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    const note = snap[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred: top-left = point - half size.
    expect(note.x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
  });

  it('TC-02: createSticky after notes with z 1 and 2 gets z 3', () => {
    const { doc, ids } = seeded(2);
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
    countUpdates(doc, () => createSticky(doc, { x: 50, y: 50 }));
    const snap = snapshot(doc);
    expect(snap).toHaveLength(3);
    expect(snap[2]!.id).not.toBe(ids[0]);
    expect(snap[2]!.z).toBe(3);
  });

  it('TC-03: moveObject updates x,y and leaves every other field unchanged', () => {
    const { doc, ids } = seeded(1);
    const before = snapshot(doc)[0]!;
    setStickyColor(doc, ids[0]!, 'green');
    const text = getStickyText(doc, ids[0]!);
    text!.insert(0, 'hello');

    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, ids[0]!, 10, -20)).toBe(true);
    });
    expect(updates).toBe(1);
    const after = snapshot(doc)[0]!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe('green');
    expect(after.text).toBe('hello');
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 (negative): moveObject on a stale id returns false and emits no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, 'missing-id', 1, 2)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-05: setStickyColor green changes only the colour', () => {
    const { doc, ids } = seeded(1);
    moveObject(doc, ids[0]!, 7, 9);
    const text = getStickyText(doc, ids[0]!);
    text!.insert(0, 'keep me');
    const before = snapshot(doc)[0]!;

    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, ids[0]!, 'green')).toBe(true);
    });
    expect(updates).toBe(1);
    const after = snapshot(doc)[0]!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("TC-06 (negative): setStickyColor with an unknown colour returns false and writes nothing", () => {
    const { doc, ids } = seeded(1);
    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, ids[0]!, 'teal')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-07: deleteObject removes the note', () => {
    const { doc, ids } = seeded(1);
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, ids[0]!)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(objectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 (negative): deleteObject on a stale id returns false and emits no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, 'missing-id')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-09: bringToFront on the bottom note of three raises z 1 to 4', () => {
    const { doc, ids } = seeded(3);
    const before = snapshot(doc);
    expect(before.map((n) => n.z)).toEqual([1, 2, 3]);

    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, before[0]!.id)).toBe(true);
    });
    expect(updates).toBe(1);
    const after = snapshot(doc);
    const moved = after.find((n) => n.id === ids[0])!;
    expect(moved.z).toBe(4);
    expect(after[2]!.id).toBe(ids[0]);
  });

  it('TC-10 (negative): bringToFront on the topmost note emits no update', () => {
    const { doc } = seeded(3);
    const top = snapshot(doc)[2]!;
    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, top.id)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-10b (negative): bringToFront on a stale id returns false and emits no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, 'missing-id')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-11: notes with equal z sort by id as a stable tie-break', () => {
    const { doc, ids } = seeded(2);
    // Force equal z through the raw document (simulates story 3 merges).
    doc.transact(() => {
      objectsMap(doc).get(ids[0]!)!.set('z', 5);
      objectsMap(doc).get(ids[1]!)!.set('z', 5);
    });
    const expected = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((n) => n.id)).toEqual(expected);
    expect(second.map((n) => n.id)).toEqual(expected);
  });

  it("TC-12: snapshot skips objects with an unknown type without throwing", () => {
    const { doc } = seeded(1);
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 1);
      objectsMap(doc).set('shape-1', shape);
    });
    let snap: readonly StickySnapshot[] = [];
    expect(() => {
      snap = snapshot(doc);
    }).not.toThrow();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.type).toBe('sticky');
  });

  it('TC-39 (negative): non-finite coordinates are rejected without any update', () => {
    const { doc, ids } = seeded(0);
    const cases: Array<[number, number]> = [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of cases) {
      const updates = countUpdates(doc, () => {
        expect(moveObject(doc, 'any-id', x, y)).toBe(false);
        expect(createSticky(doc, { x, y })).toBe(false);
      });
      expect(updates).toBe(0);
    }
    expect(objectsMap(doc).size).toBe(0);
    void ids;
  });

  it('getStickyText returns the Y.Text of a sticky and undefined for stale ids', () => {
    const { doc, ids } = seeded(1);
    const text = getStickyText(doc, ids[0]!);
    expect(text).toBeInstanceOf(Y.Text);
    expect(getStickyText(doc, 'missing-id')).toBeUndefined();
  });

  it('every colour in STICKY_COLORS is accepted by setStickyColor', () => {
    const { doc, ids } = seeded(1);
    for (const name of Object.keys(STICKY_COLORS)) {
      expect(setStickyColor(doc, ids[0]!, name)).toBe(true);
      expect(snapshot(doc)[0]!.color).toBe(name);
    }
  });
});
