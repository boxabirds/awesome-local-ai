import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  objectExists,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

/**
 * Every case runs against a real `Y.Doc`: Yjs is deterministic in-process, so
 * mocking it would hide the merge/observe behaviour story 3 relies on.
 */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` and count the `update` events it produced (1 = one transaction). */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  try {
    const result = fn();
    return { result, updates };
  } finally {
    doc.off('update', listener);
  }
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function notes(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

function only(doc: Y.Doc): StickySnapshot {
  const list = notes(doc);
  if (list.length !== 1) throw new Error(`expected exactly one object, got ${list.length}`);
  return list[0] as StickySnapshot;
}

function createTwo(doc: Y.Doc): [string, string] {
  const a = createSticky(doc, { x: 0, y: 0 });
  const b = createSticky(doc, { x: 0, y: 0 });
  if (typeof a !== 'string' || typeof b !== 'string') throw new Error('fixture failed');
  return [a, b];
}

describe('initDoc', () => {
  it('writes meta.schemaVersion once and leaves it alone afterwards', () => {
    const doc = new Y.Doc();
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined();
    const first = withUpdateCount(doc, () => initDoc(doc));
    expect(first.result).toBeUndefined();
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

    const second = withUpdateCount(doc, () => initDoc(doc));
    expect(second.result).toBeUndefined();
    expect(second.updates).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});

describe('createSticky (TC-01, TC-02)', () => {
  it('TC-01: creates the first note centred on the point, yellow, empty text, z 1', () => {
    const doc = newDoc();
    expect(notes(doc)).toHaveLength(0);

    const { result: id, updates } = withUpdateCount(doc, () =>
      createSticky(doc, { x: 0, y: 0 }),
    );
    expect(typeof id).toBe('string');
    expect(updates).toBe(1);
    expect(objectsOf(doc).size).toBe(1);

    const note = only(doc);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.color).toBe('yellow');
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // The point is the note's centre, so the top-left is half a note away.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(note.id).toBe(id);
  });

  it('TC-02: the next note stacks on top (z 1, 2 -> new z 3)', () => {
    const doc = newDoc();
    createTwo(doc);
    expect(
      notes(doc)
        .slice()
        .sort((a, b) => a.z - b.z)
        .map((n) => n.z),
    ).toEqual([1, 2]);

    const { result: third, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 5, y: 5 }));
    expect(typeof third).toBe('string');
    expect(updates).toBe(1);
    const created = notes(doc).find((n) => n.id === third);
    expect(created?.z).toBe(3);
  });

  it('creates a note in the requested colour and rejects an unknown one', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet' as StickyColor);
    expect(typeof id).toBe('string');
    expect(only(doc).color).toBe('violet');
    const before = objectsOf(doc).size;
    const rejected = withUpdateCount(doc, () =>
      createSticky(doc, { x: 0, y: 0 }, 'teal' as StickyColor),
    );
    expect(rejected.result).toBe(false);
    expect(rejected.updates).toBe(0);
    expect(objectsOf(doc).size).toBe(before);
  });
});

describe('moveObject (TC-03, TC-04, TC-39)', () => {
  it('TC-03: writes the new position in one transaction and changes nothing else', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    const before = notes(doc).find((n) => n.id === id);
    if (!before) throw new Error('fixture lost the note');
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = notes(doc).find((n) => n.id === id);
    expect(after?.x).toBe(10);
    expect(after?.y).toBe(-20);
    expect(after?.color).toBe(before.color);
    expect(after?.z).toBe(before.z);
    expect(after?.createdAt).toBe(before.createdAt);
    expect(after?.text).toBe('Faster onboarding');
  });

  it('TC-04: a stale id returns false and emits no update', () => {
    const doc = newDoc();
    const [, gone] = createTwo(doc);
    deleteObject(doc, gone);
    const before = doc.toJSON();

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, gone, 1, 2));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(doc.toJSON()).toEqual(before);
  });

  it('TC-39: NaN or Infinity coordinates are rejected and never written', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    const before = notes(doc).find((n) => n.id === id);
    expect(objectExists(doc, id)).toBe(true);

    for (const coordinate of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const moved = withUpdateCount(doc, () => moveObject(doc, id, coordinate, 0));
      expect(moved.result).toBe(false);
      expect(moved.updates).toBe(0);
      const movedOther = withUpdateCount(doc, () => moveObject(doc, id, 0, coordinate));
      expect(movedOther.result).toBe(false);
      expect(movedOther.updates).toBe(0);
    }
    for (const coordinate of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const created = withUpdateCount(doc, () => createSticky(doc, { x: coordinate, y: 0 }));
      expect(created.result).toBe(false);
      expect(created.updates).toBe(0);
      const createdY = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: coordinate }));
      expect(createdY.result).toBe(false);
      expect(createdY.updates).toBe(0);
    }

    const after = notes(doc).find((n) => n.id === id);
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(notes(doc).some((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y))).toBe(false);
  });
});

describe('setStickyColor (TC-05, TC-06)', () => {
  it('TC-05: changes only the colour', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    getStickyText(doc, id)?.insert(0, 'Retro item');
    moveObject(doc, id, 30, 40);
    bringToFront(doc, id);
    const before = notes(doc).find((n) => n.id === id);

    const { result, updates } = withUpdateCount(doc, () =>
      setStickyColor(doc, id, 'green'),
    );
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = notes(doc).find((n) => n.id === id);
    expect(after?.color).toBe('green');
    expect(STICKY_COLORS[after?.color as StickyColor]).toBe('#C5E1A5');
    expect(after?.text).toBe(before?.text);
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z);
    expect(after?.createdAt).toBe(before?.createdAt);
  });

  it('TC-06: an unknown colour returns false, changes nothing and emits no update', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    const before = doc.toJSON();

    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(notes(doc).find((n) => n.id === id)?.color).toBe('yellow');
    expect(doc.toJSON()).toEqual(before);
  });

  it('a stale id returns false with no update', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    deleteObject(doc, id);
    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'blue'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('deleteObject (TC-07, TC-08)', () => {
  it('TC-07: removes the note in one transaction', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    expect(notes(doc)).toHaveLength(2);

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(notes(doc)).toHaveLength(1);
    expect(objectExists(doc, id)).toBe(false);
    expect(objectsOf(doc).has(id)).toBe(false);
  });

  it('TC-08: a stale id returns false and emits no update', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    deleteObject(doc, id);
    const before = doc.toJSON();

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(doc.toJSON()).toEqual(before);
  });
});

describe('bringToFront (TC-09, TC-10)', () => {
  it('TC-09: the bottom note of three becomes the top note (z 1 -> 4)', () => {
    const doc = newDoc();
    const ids = [
      createSticky(doc, { x: 0, y: 0 }),
      createSticky(doc, { x: 0, y: 0 }),
      createSticky(doc, { x: 0, y: 0 }),
    ].map((id) => {
      if (typeof id !== 'string') throw new Error('fixture failed');
      return id;
    });
    expect(notes(doc).map((n) => n.z)).toEqual([1, 2, 3]);
    const bottom = ids[0] as string;
    expect(notes(doc)[0]?.id).toBe(bottom);

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, bottom));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(notes(doc).map((n) => n.z)).toEqual([2, 3, 4]);
    const moved = notes(doc).find((n) => n.id === bottom);
    expect(moved?.z).toBe(4);
    // Position, colour and text are untouched by a stacking change.
    expect(moved?.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(moved?.color).toBe('yellow');
  });

  it('TC-10: the topmost note returns false and emits no update', () => {
    const doc = newDoc();
    const ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 0, y: 0 })].map(
      (id) => {
        if (typeof id !== 'string') throw new Error('fixture failed');
        return id;
      },
    );
    const top = ids[1] as string;
    const before = doc.toJSON();

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(notes(doc).find((n) => n.id === top)?.z).toBe(2);
    expect(doc.toJSON()).toEqual(before);
  });

  it('a stale id returns false with no update', () => {
    const doc = newDoc();
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('snapshot ordering and forward compatibility (TC-11, TC-12)', () => {
  it('TC-11: equal z is broken by id, stably across calls', () => {
    const doc = newDoc();
    // Force equal z the way story 3 sync can produce it: write the field directly.
    const objects = objectsOf(doc);
    const ids = ['c-id', 'a-id', 'b-id'];
    doc.transact(() => {
      for (const id of ids) {
        const item = new Y.Map<unknown>();
        item.set('type', 'sticky');
        item.set('x', 0);
        item.set('y', 0);
        item.set('color', 'yellow');
        item.set('text', new Y.Text(''));
        item.set('z', 7);
        item.set('createdAt', 1);
        objects.set(id, item);
      }
    });

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a-id', 'b-id', 'c-id']);
    expect(second).toEqual(first);
  });

  it('orders by z then id', () => {
    const doc = newDoc();
    createTwo(doc);
    const list = notes(doc);
    expect(list.map((n) => n.z)).toEqual([1, 2]);
    expect(list[1]?.z).toBe(2);
  });

  it('TC-12: an object of an unknown type is skipped without throwing', () => {
    const doc = newDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    expect(typeof stickyId).toBe('string');
    const objects = objectsOf(doc);
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      objects.set('shape-1', shape);
    });

    expect(objects.size).toBe(2);
    const list = notes(doc);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(stickyId);
  });

  it('getStickyText returns the note text and undefined for a stale id', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    text?.insert(0, 'Faster onboarding');
    expect(notes(doc).find((n) => n.id === id)?.text).toBe('Faster onboarding');
    deleteObject(doc, id);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('snapshot changes are seen through observeDeep', () => {
    const doc = newDoc();
    const [id] = createTwo(doc);
    const text = getStickyText(doc, id);
    const seen: number[] = [];
    const observer = (): void => {
      seen.push(snapshot(doc).filter((n) => n.text.length > 0).length);
    };
    objectsOf(doc).observeDeep(observer);
    text?.insert(0, 'hello');
    objectsOf(doc).unobserveDeep(observer);
    expect(seen).toEqual([1]);
  });

  it('every successful mutation carries LOCAL_ORIGIN as its transaction origin', () => {
    const doc = newDoc();
    const origins: unknown[] = [];
    const listener = (_update: Uint8Array, origin: unknown): void => {
      origins.push(origin);
    };
    doc.on('update', listener);
    const id = createSticky(doc, { x: 0, y: 0 });
    if (typeof id !== 'string') throw new Error('fixture failed');
    moveObject(doc, id, 1, 1);
    setStickyColor(doc, id, 'orange');
    bringToFront(doc, id);
    // Text edits carry the origin the caller passes (see `applyTextDiff`).
    const text = getStickyText(doc, id);
    doc.transact(() => text?.insert(0, 'x'), LOCAL_ORIGIN);
    deleteObject(doc, id);
    doc.off('update', listener);
    expect(origins).toHaveLength(5);
    expect(origins.every((origin) => origin === LOCAL_ORIGIN)).toBe(true);
  });
});
