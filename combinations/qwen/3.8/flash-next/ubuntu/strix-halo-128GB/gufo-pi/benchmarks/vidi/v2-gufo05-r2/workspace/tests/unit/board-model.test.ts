import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

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
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

const HALF = STICKY_SIZE_WORLD / 2;

/** Run `fn`, counting how many `update` events the doc emits. */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', observer);
  }
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function objectFields(doc: Y.Doc, id: string): Record<string, unknown> {
  const entry = objectsMap(doc).get(id);
  if (!entry) throw new Error(`object ${id} is missing`);
  const out: Record<string, unknown> = {};
  entry.forEach((value, key) => {
    out[key] = value instanceof Y.Text ? value.toString() : value;
  });
  return out;
}

describe('board.model — initDoc', () => {
  it('sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const first = withUpdateCount(doc, () => initDoc(doc));
    expect(first.result).toBeUndefined();
    const meta = doc.getMap<{ schemaVersion?: number }>('meta');
    expect(meta.get('schemaVersion')).toBe(1);

    // A second call is a no-op (no schemaVersion transaction).
    const second = withUpdateCount(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
    expect(meta.get('schemaVersion')).toBe(1);
  });
});

describe('board.model — createSticky', () => {
  it('TC-01: creates the first note centred on the point, z 1, default colour, empty text', () => {
    const doc = new Y.Doc();
    const { result: id, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: 0 }));
    expect(updates).toBe(1);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(objectsMap(doc).size).toBe(1);

    const fields = objectFields(doc, id);
    expect(fields.type).toBe('sticky');
    expect(fields.color).toBe(DEFAULT_STICKY_COLOR);
    expect(fields.text).toBe('');
    expect(fields.z).toBe(1);
    // Centred: top-left = point − size/2.
    expect(fields.x).toBe(0 - HALF);
    expect(fields.y).toBe(0 - HALF);
    expect(typeof fields.createdAt).toBe('number');
  });

  it('TC-02: a new note stacks above existing notes (z = maxZ + 1)', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const { result: id, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: 300 }));
    expect(updates).toBe(1);
    expect(objectFields(doc, id).z).toBe(3);
  });

  it('TC-39: rejects non-finite coordinates (create returns no id, 0 updates)', () => {
    const doc = new Y.Doc();
    for (const bad of [NaN, Infinity, -Infinity]) {
      const { result, updates } = withUpdateCount(doc, () =>
        createSticky(doc, { x: bad, y: 0 }),
      );
      expect(result).toBe('');
      expect(updates).toBe(0);
      const { updates: updates2 } = withUpdateCount(doc, () =>
        createSticky(doc, { x: 0, y: bad }),
      );
      expect(updates2).toBe(0);
    }
    expect(objectsMap(doc).size).toBe(0);
  });
});

describe('board.model — moveObject', () => {
  it('TC-03: updates x, y and leaves other fields unchanged', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = objectFields(doc, id);
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = objectFields(doc, id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.type).toBe('sticky');
  });

  it('TC-04: moveObject on a stale id returns false with no update event', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, 'missing', 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-39: moveObject with non-finite coordinates returns false, 0 updates', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = objectFields(doc, id);
    for (const bad of [NaN, Infinity, -Infinity]) {
      const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, bad, 3));
      expect(result).toBe(false);
      expect(updates).toBe(0);
      const { result: r2, updates: u2 } = withUpdateCount(doc, () => moveObject(doc, id, 3, bad));
      expect(r2).toBe(false);
      expect(u2).toBe(0);
    }
    const after = objectFields(doc, id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('board.model — setStickyColor', () => {
  it('TC-05: sets the colour and leaves text, x, y, z unchanged', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    moveObject(doc, id, 40, 50);
    getStickyText(doc, id)!.insert(0, 'Faster onboarding');
    const before = objectFields(doc, id);
    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = objectFields(doc, id);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06: an unknown colour returns false, leaves the note unchanged, 0 updates', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(objectFields(doc, id).color).toBe(DEFAULT_STICKY_COLOR);
  });
});

describe('board.model — deleteObject', () => {
  it('TC-07: deletes an existing note', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(objectsMap(doc).size).toBe(1);
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(objectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08: deleteObject on a stale id returns false, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model — bringToFront', () => {
  it('TC-09: raises the bottom note (z 1 of 3) to the top (z 4)', () => {
    const doc = new Y.Doc();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 0, y: 300 });
    expect(objectFields(doc, first).z).toBe(1);
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, first));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(objectFields(doc, first).z).toBe(4);
  });

  it('TC-10: bringToFront on the topmost note is a no-op with no update event', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(objectFields(doc, top).z).toBe(2);
  });

  it('returns false for a stale id with no update event', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model — snapshot ordering and forward compatibility', () => {
  it('TC-11: notes with equal z are ordered by id (stable tie-break)', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    // Simulate the story 3 case of two notes converging on the same z.
    const objects = objectsMap(doc);
    objects.get(a)!.set('z', 5);
    objects.get(b)!.set('z', 5);

    const ids = snapshot(doc).map((n) => n.id);
    const expected = [a, b].sort();
    expect(ids).toEqual(expected);
    // Stable across repeated calls.
    expect(snapshot(doc).map((n) => n.id)).toEqual(expected);
  });

  it('TC-12: unknown object types are skipped without throwing', () => {
    const doc = new Y.Doc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    // A future story type (stories 9-12) that this renderer must ignore.
    const objects = objectsMap(doc);
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('z', 2);
    objects.set('a-shape', shape);

    let result: readonly StickySnapshot[] = [];
    expect(() => {
      result = snapshot(doc);
    }).not.toThrow();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(sticky);
  });

  it('snapshot is sorted by (z, id)', () => {
    const doc = new Y.Doc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 300, y: 0 });
    const third = createSticky(doc, { x: 0, y: 300 });
    bringToFront(doc, first); // z: first 4, second 2, third 3
    const order = snapshot(doc).map((n) => n.id);
    expect(order).toEqual([second, third, first]);
  });
});

describe('board.model — getStickyText', () => {
  it('returns the Y.Text of a note and undefined for a stale id', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    ytext!.insert(0, 'hello');
    expect(getStickyText(doc, id)!.toString()).toBe('hello');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});

describe('board.model — colour names cover the six presets', () => {
  it('every STICKY_COLORS key is accepted by setStickyColor', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    for (const name of Object.keys(STICKY_COLORS) as StickyColor[]) {
      // Start from a different colour so this is a real change, not a no-op.
      setStickyColor(doc, id, name === 'yellow' ? 'green' : 'yellow');
      expect(setStickyColor(doc, id, name)).toBe(true);
      expect(objectFields(doc, id).color).toBe(name);
    }
  });
});
