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
import type { StickySnapshot } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** A document initialised the way the app initialises one. */
function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts `update` events on the doc from now on (1 per successful mutation, 0 for rejections). */
function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

function notes(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

function note(doc: Y.Doc, id: string): StickySnapshot {
  const found = notes(doc).find((n) => n.id === id);
  if (!found) throw new Error(`note ${id} not found`);
  return found;
}

describe('board.model: create', () => {
  it('TC-01 creates one sticky note centred on the point, yellow, empty text, z 1', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    expect(id).not.toBe('');
    const all = notes(doc);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id,
      type: 'sticky',
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
    });
    expect(typeof all[0].createdAt).toBe('number');
    expect(updates()).toBe(1);
  });

  it('TC-01 (extra) centres on an off-origin point and accepts an explicit colour', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 50, y: -30 }, 'green');
    expect(note(doc, id)).toMatchObject({ x: 50 - STICKY_SIZE_WORLD / 2, y: -30 - STICKY_SIZE_WORLD / 2, color: 'green' });
  });

  it('TC-02 new note stacks above existing z values (z 1,2 -> z 3)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    expect(note(doc, a).z).toBe(1);
    expect(note(doc, b).z).toBe(2);

    const updates = countUpdates(doc);
    const c = createSticky(doc, { x: 600, y: 0 });

    expect(note(doc, c).z).toBe(3);
    expect(updates()).toBe(1);
  });

  it('extra: rejects non-finite coordinates with no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBe('');
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBe('');
    expect(notes(doc)).toHaveLength(0);
    expect(updates()).toBe(0);
  });

  it('extra: rejects an unknown colour with no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    // `teal` is not one of the six product colours.
    expect(createSticky(doc, { x: 0, y: 0 }, 'teal' as never)).toBe('');
    expect(notes(doc)).toHaveLength(0);
    expect(updates()).toBe(0);
  });
});

describe('board.model: move', () => {
  it('TC-03 moves the note and leaves other fields unchanged', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, 'idea');
    const before = note(doc, id);

    const updates = countUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);

    const after = note(doc, id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    // Every other field is untouched.
    expect({ id: after.id, type: after.type, color: after.color, text: after.text, z: after.z, createdAt: after.createdAt }).toEqual({
      id: before.id,
      type: before.type,
      color: before.color,
      text: before.text,
      z: before.z,
      createdAt: before.createdAt,
    });
    expect(updates()).toBe(1);
  });

  it('TC-04 rejects a stale id with no update (negative)', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    expect(moveObject(doc, 'missing', 5, 5)).toBe(false);
    expect(updates()).toBe(0);
  });

  it('extra: rejects non-finite coordinates with no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(note(doc, id)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
    expect(updates()).toBe(0);
  });
});

describe('board.model: colour', () => {
  it('TC-05 applies a valid colour', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(note(doc, id).color).toBe('green');
    expect(updates()).toBe(1);
  });

  it('TC-06 rejects an unknown colour with no update (negative)', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(note(doc, id).color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates()).toBe(0);
  });

  it('extra: rejects a stale id with no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model: delete', () => {
  it('TC-07 removes the note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(deleteObject(doc, id)).toBe(true);
    expect(notes(doc)).toHaveLength(0);
    expect(updates()).toBe(1);
  });

  it('TC-08 rejects a stale id with no update (negative)', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    expect(deleteObject(doc, 'missing')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model: stacking', () => {
  it('TC-09 brings a buried note to the top (z 1 of 3 -> z 4)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    const updates = countUpdates(doc);

    expect(bringToFront(doc, a)).toBe(true);
    expect(note(doc, a).z).toBe(4);
    expect(updates()).toBe(1);
  });

  it('TC-10 does not touch the topmost note (no update, negative)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const updates = countUpdates(doc);

    expect(bringToFront(doc, b)).toBe(false);
    expect(note(doc, b).z).toBe(2);
    expect(note(doc, a).z).toBe(1);
    expect(updates()).toBe(0);
  });

  it('extra: rejects a stale id with no update', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    expect(bringToFront(doc, 'missing')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('board.model: render order and reads', () => {
  it('TC-11 breaks z ties by id and is stable across calls', () => {
    const doc = freshDoc();
    const objects = doc.getMap('objects');
    const make = (id: string, z: number): void => {
      const m = new Y.Map();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', 'yellow');
      m.set('text', new Y.Text());
      m.set('z', z);
      m.set('createdAt', 1);
      objects.set(id, m);
    };
    make('note-b', 5);
    make('note-a', 5);
    make('note-c', 1);

    const first = notes(doc).map((n) => n.id);
    expect(first).toEqual(['note-c', 'note-a', 'note-b']);
    // Stable across calls (the snapshot is not a fresh sort of a shuffled list).
    expect(notes(doc).map((n) => n.id)).toEqual(first);
  });

  it('TC-12 skips unknown object types without throwing', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const shape = new Y.Map();
    shape.set('type', 'shape');
    shape.set('x', 10);
    shape.set('y', 10);
    objects.set('shape-1', shape);

    expect(() => notes(doc)).not.toThrow();
    const all = notes(doc);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(stickyId);
  });

  it('getStickyText returns the live Y.Text for a real id, undefined for a stale one', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    text!.insert(0, 'hello');
    expect(note(doc, id).text).toBe('hello');

    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});

describe('board.model: init', () => {
  it('sets meta.schemaVersion once (idempotent, no update on second call)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = countUpdates(doc);

    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    initDoc(doc);
    expect(updates()).toBe(0);
  });
});
