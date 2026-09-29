// board.model (story 2, TC-01 to TC-12 + extras) — unit tests against a real
// Y.Doc, no mocks. Each mutation test also asserts the number of `update`
// events emitted: 1 for a successful change, 0 for a rejection/no-op.

import { describe, expect, it } from 'vitest';
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
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` and report how many Yjs update events it emitted. */
function withUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  const result = fn();
  doc.off('update', observer);
  return { result, updates };
}

describe('board.model', () => {
  it('TC-01 createSticky on empty doc: 1 object, sticky, default colour, empty text, z 1, centred', () => {
    const doc = freshDoc();
    const at = { x: 100, y: -50 };
    const { result: id, updates } = withUpdates(doc, () => createSticky(doc, at));
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: 'sticky',
      x: at.x - STICKY_SIZE_WORLD / 2,
      y: at.y - STICKY_SIZE_WORLD / 2,
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
    });
    expect(notes[0]?.createdAt).toBeTypeOf('number');
  });

  it('TC-02 createSticky with existing z 1,2 → new z 3', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const { result: id, updates } = withUpdates(doc, () => createSticky(doc, { x: 600, y: 0 }));
    expect(updates).toBe(1);
    const note = snapshot(doc).find((n) => n.id === id);
    expect(note?.z).toBe(3);
  });

  it('TC-03 moveObject updates x,y only; other fields unchanged', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc).find((n) => n.id === id)!;
    const { result, updates } = withUpdates(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on stale id → false, no update (negative)', () => {
    const doc = freshDoc();
    const { result, updates } = withUpdates(doc, () => moveObject(doc, 'nope', 1, 2));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-04b moveObject with non-finite coordinates → false, no update (negative)', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const a = withUpdates(doc, () => moveObject(doc, id, NaN, 0));
    expect(a.result).toBe(false);
    expect(a.updates).toBe(0);
    const b = withUpdates(doc, () => moveObject(doc, id, 0, Infinity));
    expect(b.result).toBe(false);
    expect(b.updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === id)?.x).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-05 setStickyColor green → applied', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = withUpdates(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc).find((n) => n.id === id)?.color).toBe('green');
  });

  it("TC-06 setStickyColor 'teal' → false, unchanged, no update (negative)", () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { result, updates } = withUpdates(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === id)?.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-07 deleteObject removes the note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const { result, updates } = withUpdates(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 deleteObject on stale id → false, no update (negative)', () => {
    const doc = freshDoc();
    const { result, updates } = withUpdates(doc, () => deleteObject(doc, 'missing'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront: z 1 of 3 → z 4', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(1);
    const { result, updates } = withUpdates(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(4);
  });

  it('TC-10 bringToFront on the topmost note → z unchanged, no update (negative)', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    expect(snapshot(doc).find((n) => n.id === b)?.z).toBe(2);
    const { result, updates } = withUpdates(doc, () => bringToFront(doc, b));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).find((n) => n.id === b)?.z).toBe(2);
  });

  it('TC-11 equal z → snapshot ordered by id tie-break, stable across calls', () => {
    const doc = freshDoc();
    const objects = doc.getMap('objects');
    const mk = (id: string) => {
      const m = new Y.Map();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', 'yellow');
      m.set('text', new Y.Text());
      m.set('z', 7);
      m.set('createdAt', Date.now());
      objects.set(id, m);
    };
    mk('bbb');
    mk('ccc');
    mk('aaa');
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['aaa', 'bbb', 'ccc']);
    // Stable across repeated calls.
    for (let i = 0; i < 3; i += 1) {
      expect(snapshot(doc).map((n) => n.id)).toEqual(first);
    }
  });

  it("TC-12 unknown object type is skipped by snapshot without throwing", () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const shape = new Y.Map();
    shape.set('type', 'shape');
    shape.set('x', 5);
    shape.set('y', 6);
    shape.set('z', 99);
    objects.set('shape-1', shape);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(id);
  });

  it('initDoc sets meta.schemaVersion once and leaves it untouched on re-run', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    // Re-running must not overwrite an existing (e.g. migrated) value.
    doc.getMap('meta').set('schemaVersion', 2);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(2);
  });

  it('getStickyText returns the note Y.Text, undefined for stale ids', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});
