/**
 * Story 2 · task 1 — board.model unit tests (TC-01 … TC-12) written against a
 * real `Y.Doc` (no mocks). Every mutation also asserts how many `update`
 * events the document emitted: exactly 1 for a successful change, 0 for a
 * rejection / no-op (the story-3 wire layer must not see echo updates).
 *
 * These compile against the task-1 stub, which throws "not implemented", so
 * the suite is red for the right reason before task 2 lands the model.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';

const HALF = STICKY_SIZE_WORLD / 2;

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count the `update` events a single call emits on the doc. */
function withUpdateCount(doc: Y.Doc, action: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  const result = action();
  doc.off('update', listener);
  return { result, updates };
}

/** Seed a raw sticky (or any-typed) object directly, bypassing the model. */
function seedObject(
  doc: Y.Doc,
  id: string,
  fields: Partial<{
    type: string;
    x: number;
    y: number;
    color: string;
    text: string;
    z: number;
  }>,
): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const map = new Y.Map<unknown>();
  map.set('type', fields.type ?? 'sticky');
  map.set('x', fields.x ?? 0);
  map.set('y', fields.y ?? 0);
  map.set('color', fields.color ?? DEFAULT_STICKY_COLOR);
  map.set('text', new Y.Text(fields.text ?? ''));
  map.set('z', fields.z ?? 1);
  map.set('createdAt', 0);
  objects.set(id, map);
}

describe('initDoc', () => {
  it('sets meta.schemaVersion once and leaves an existing value alone', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap<{ schemaVersion?: number }>('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    expect(() => initDoc(doc)).not.toThrow();
    expect(meta.get('schemaVersion')).toBe(1);
    doc.destroy();
  });
});

describe('createSticky', () => {
  it('TC-01: creates a centred yellow sticky with empty text at z 1', () => {
    const doc = freshDoc();
    expect(doc.getMap('objects').size).toBe(0);

    const { result, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 0, y: 0 }));
    const id = result as string;
    expect(typeof id).toBe('string');

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    const note = snap[0];
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Creation is centred: top-left is the point minus half the note size.
    expect(note.x).toBeCloseTo(-HALF, 6);
    expect(note.y).toBeCloseTo(-HALF, 6);
    expect(updates).toBe(1);
    doc.destroy();
  });

  it('TC-02: a new note stacks above existing ones (z = maxZ + 1)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(1);
    expect(snapshot(doc).find((n) => n.id === b)?.z).toBe(2);

    const { result, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 10, y: 10 }));
    const c = result as string;
    expect(snapshot(doc).find((n) => n.id === c)?.z).toBe(3);
    expect(updates).toBe(1);
    doc.destroy();
  });

  it('honours an explicit colour and defaults the rest', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 500, y: -300 }, 'green');
    const note = snapshot(doc).find((n) => n.id === id);
    expect(note?.color).toBe('green');
    expect(note?.x).toBeCloseTo(500 - HALF, 6);
    expect(note?.y).toBeCloseTo(-300 - HALF, 6);
    expect(STICKY_COLORS.green).toBe('#C5E1A5');
    doc.destroy();
  });
});

describe('moveObject', () => {
  it('TC-03: updates x/y and leaves every other field untouched', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue');
    const before = snapshot(doc).find((n) => n.id === id)!;

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: 10, y: -20 });
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
    doc.destroy();
  });

  it('TC-04: a stale id is rejected with no update emitted', () => {
    const doc = freshDoc();
    const { result, updates } = withUpdateCount(doc, () =>
      moveObject(doc, 'missing', 1, 1),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
    doc.destroy();
  });

  it('rejects non-finite coordinates with no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = withUpdateCount(doc, () => moveObject(doc, id, Number.NaN, 5));
    expect(updates.result).toBe(false);
    expect(updates.updates).toBe(0);
    const stillHere = snapshot(doc).find((n) => n.id === id)!;
    expect({ x: stillHere.x, y: stillHere.y }).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
    });
    doc.destroy();
  });
});

describe('setStickyColor', () => {
  it('TC-05: recolours a selected note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = withUpdateCount(doc, () =>
      setStickyColor(doc, id, 'green'),
    );
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc).find((n) => n.id === id)?.color).toBe('green');
    doc.destroy();
  });

  it('TC-06: an unknown colour is rejected and changes nothing', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = withUpdateCount(doc, () =>
      setStickyColor(doc, id, 'teal'),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === id)?.color).toBe(DEFAULT_STICKY_COLOR);
    doc.destroy();
  });
});

describe('deleteObject', () => {
  it('TC-07: removes a note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(doc.getMap('objects').size).toBe(1);

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    doc.destroy();
  });

  it('TC-08: a stale id is rejected with no update', () => {
    const doc = freshDoc();
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    doc.destroy();
  });
});

describe('bringToFront', () => {
  it('TC-09: raises the lowest of three notes to the top', () => {
    const doc = freshDoc();
    seedObject(doc, 'a', { z: 1 });
    seedObject(doc, 'b', { z: 2 });
    seedObject(doc, 'c', { z: 3 });

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, 'a'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const snap = snapshot(doc);
    expect(snap.find((n) => n.id === 'a')?.z).toBe(4);
    expect(snap.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    doc.destroy();
  });

  it('TC-10: bringing the top note to front is a no-op (no update)', () => {
    const doc = freshDoc();
    seedObject(doc, 'a', { z: 1 });
    seedObject(doc, 'b', { z: 2 });

    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, 'b'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === 'b')?.z).toBe(2);
    doc.destroy();
  });
});

describe('snapshot ordering and forward-compatibility', () => {
  it('TC-11: equal z values are ordered by id, stably', () => {
    const doc = freshDoc();
    seedObject(doc, 'zz', { z: 5 });
    seedObject(doc, 'aa', { z: 5 });
    seedObject(doc, 'mm', { z: 5 });

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['aa', 'mm', 'zz']);
    expect(second).toEqual(first);
    doc.destroy();
  });

  it('TC-12: skips unknown object types without throwing', () => {
    const doc = freshDoc();
    seedObject(doc, 'keep', { z: 1 });
    seedObject(doc, 'shape', { z: 2, type: 'shape' });

    let snap: readonly { id: string }[] = [];
    expect(() => {
      snap = snapshot(doc);
    }).not.toThrow();
    expect(snap.map((n) => n.id)).toEqual(['keep']);
    doc.destroy();
  });
});

describe('getStickyText', () => {
  it('returns the Y.Text for a note and undefined otherwise', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
    doc.destroy();
  });
});

describe('LOCAL_ORIGIN', () => {
  it('is used as the transaction origin for successful mutations', () => {
    const doc = freshDoc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: { origin: unknown }) => origins.push(tr.origin));
    createSticky(doc, { x: 0, y: 0 });
    expect(origins).toEqual([LOCAL_ORIGIN]);
    doc.destroy();
  });
});