import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

/** Count the `update` events a call emits on the document. */
const withUpdateCount = <T>(doc: Y.Doc, run: () => T): { result: T; updates: number } => {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
};

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const byId = (doc: Y.Doc, id: string): StickySnapshot => {
  const found = snapshot(doc).find((note) => note.id === id);
  if (!found) throw new Error(`snapshot is missing note ${id}`);
  return found;
};

/** Insert a raw object straight into the document (for schema-level fixtures). */
const putRaw = (
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
): void => {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'text') {
        const ytext = new Y.Text(String(value ?? ''));
        map.set(key, ytext);
      } else {
        map.set(key, value);
      }
    }
    objectsMap(doc).set(id, map);
  });
};

describe('board.model: create', () => {
  it('TC-01 creates the first note centred on the point, yellow, empty, z 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const { result: id, updates } = withUpdateCount(doc, () =>
      createSticky(doc, { x: 300, y: 200 }),
    );

    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    const note = byId(doc, id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred: top-left is the point minus half the note size.
    expect(note.x).toBeCloseTo(300 - STICKY_SIZE_WORLD / 2, 9);
    expect(note.y).toBeCloseTo(200 - STICKY_SIZE_WORLD / 2, 9);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('');
  });

  it('TC-01b uses the given colour when one is supplied', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue');
    expect(byId(doc, id).color).toBe('blue');
  });

  it('TC-02 stacks a new note on top of existing ones (z = maxZ + 1)', () => {
    const doc = new Y.Doc();
    putRaw(doc, 'a', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 1, createdAt: 1 });
    putRaw(doc, 'b', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 2, createdAt: 2 });

    const { result: id, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 10, y: 10 }));
    expect(updates).toBe(1);
    expect(byId(doc, id).z).toBe(3);
  });

  it('TC-39 rejects non-finite coordinates without writing', () => {
    const doc = new Y.Doc();
    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      const { result, updates } = withUpdateCount(doc, () => createSticky(doc, point));
      expect(result).toBe('');
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);

    const id = createSticky(doc, { x: 0, y: 0 });
    const nonFinite: [number, number][] = [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of nonFinite) {
      const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, x, y));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(byId(doc, id).x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 9);
  });

  it('initDoc sets meta.schemaVersion exactly once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect((doc.getMap('meta').get('schemaVersion') as number)).toBe(1);

    const { updates } = withUpdateCount(doc, () => initDoc(doc));
    expect(updates).toBe(0);
    expect((doc.getMap('meta').get('schemaVersion') as number)).toBe(1);
  });
});

describe('board.model: move', () => {
  it('TC-03 moveObject updates only x and y', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'green');
    getStickyText(doc, id)?.insert(0, 'hello');
    const before = byId(doc, id);

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = byId(doc, id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, 'missing', 1, 2));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: colour', () => {
  it('TC-05 setStickyColor changes only the colour', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 5, y: 6 });
    getStickyText(doc, id)?.insert(0, 'keep me');
    const before = byId(doc, id);

    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = byId(doc, id);
    expect(after.color).toBe('green');
    expect(STICKY_COLORS[after.color as StickyColor]).toBe('#C5E1A5');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06 setStickyColor with an unknown colour returns false and writes nothing', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });

    for (const bad of ['teal', '', 'Yellow', 'rgb(1,2,3)', '#FFF59D']) {
      const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, bad));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(byId(doc, id).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('setStickyColor on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, 'missing', 'pink'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: delete', () => {
  it('TC-07 deleteObject removes the note', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: stacking', () => {
  it('TC-09 bringToFront moves the bottom note of three to the top', () => {
    const doc = new Y.Doc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(byId(doc, bottom).z).toBe(1);

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, bottom));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(byId(doc, bottom).z).toBe(4);
    expect(snapshot(doc)[snapshot(doc).length - 1]?.id).toBe(bottom);
  });

  it('TC-10 bringToFront on the topmost note is a no-op with no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(byId(doc, top).z).toBe(2);
  });

  it('TC-10b bringToFront on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11 equal z values are ordered by id, stable across calls', () => {
    const doc = new Y.Doc();
    putRaw(doc, 'zzz', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 7, createdAt: 1 });
    putRaw(doc, 'aaa', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 7, createdAt: 2 });
    putRaw(doc, 'mmm', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: '', z: 7, createdAt: 3 });

    const order = snapshot(doc).map((note) => note.id);
    expect(order).toEqual(['aaa', 'mmm', 'zzz']);
    expect(snapshot(doc).map((note) => note.id)).toEqual(order);
  });
});

describe('board.model: read', () => {
  it('TC-12 objects with an unknown type are skipped without throwing', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    putRaw(doc, 'shape-1', { type: 'shape', x: 0, y: 0, z: 5 });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(id);
  });

  it('snapshot returns text read from Y.Text and returns a new immutable array each call', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');

    const first = snapshot(doc);
    expect(first[0]?.text).toBe('Faster onboarding');
    expect(snapshot(doc)).not.toBe(first);
    expect(snapshot(doc)).toEqual(first);
  });

  it('mutations run with LOCAL_ORIGIN so listeners can filter echo', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_update, origin) => {
      origins.push(origin);
    });
    createSticky(doc, { x: 0, y: 0 });
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});
