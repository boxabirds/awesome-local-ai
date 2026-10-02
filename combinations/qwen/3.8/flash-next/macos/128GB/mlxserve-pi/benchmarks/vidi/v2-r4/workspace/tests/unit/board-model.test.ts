/**
 * board.model — unit tests against a real `Y.Doc` (design "Test Strategy":
 * Yjs is the store under test, in-process and deterministic, so it is never
 * mocked). Every mutation test also asserts how many `update` events the
 * document emitted: exactly 1 for a successful change, 0 for a rejection.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

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
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Watches `doc` and reports how many `update` events it has emitted. */
function updateMeter(doc: Y.Doc): { count(): number; origins: unknown[] } {
  const origins: unknown[] = [];
  const listener = (update: Uint8Array, origin: unknown) => {
    void update;
    origins.push(origin);
  };
  doc.on('update', listener);
  return { count: () => origins.length, origins };
}

/** A fresh, initialised document with no meter attached. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * Starts metering *now*: tests attach this immediately before the action they
 * assert on, so setup writes never count towards the total.
 */
function meter(doc: Y.Doc): ReturnType<typeof updateMeter> {
  return updateMeter(doc);
}

/** A fresh document with the meter attached before anything is created. */
function freshDoc(): { doc: Y.Doc; updates: ReturnType<typeof updateMeter> } {
  const doc = newDoc();
  return { doc, updates: meter(doc) };
}

/** A document holding one note, metering only what happens after it exists. */
function docWithNote(color?: StickyColor): {
  doc: Y.Doc;
  id: string;
  updates: ReturnType<typeof updateMeter>;
} {
  const doc = newDoc();
  const id = createSticky(doc, { x: 0, y: 0 }, color);
  return { doc, id, updates: meter(doc) };
}

/** Writes an object into `objects` directly, bypassing the model. */
function putRawObject(doc: Y.Doc, id: string, fields: Record<string, unknown>): Y.Map<unknown> {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  objects.set(id, map);
  return map;
}

const CENTRE_OFFSET = STICKY_SIZE_WORLD / 2;

describe('board.model — create', () => {
  it('TC-01 createSticky on an empty doc adds one centred yellow note at z 1', () => {
    const { doc, updates } = freshDoc();

    const id = createSticky(doc, { x: 0, y: 0 });

    expect(id).toBeTruthy();
    expect(updates.count()).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: 'sticky',
      x: -CENTRE_OFFSET,
      y: -CENTRE_OFFSET,
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
    });
    expect(typeof notes[0].createdAt).toBe('number');
  });

  it('TC-01b centres the note on the point, wherever that point is', () => {
    const doc = newDoc();

    createSticky(doc, { x: -340.5, y: 120 });

    const [note] = snapshot(doc);
    expect(note.x).toBeCloseTo(-340.5 - CENTRE_OFFSET, 9);
    expect(note.y).toBeCloseTo(120 - CENTRE_OFFSET, 9);
  });

  it('TC-02 createSticky stacks on top of existing notes (z 1, 2 -> 3)', () => {
    const { doc, updates } = freshDoc();

    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const third = createSticky(doc, { x: 600, y: 0 });

    expect(updates.count()).toBe(3);
    const byId = new Map(snapshot(doc).map((n) => [n.id, n]));
    expect(byId.get(third)?.z).toBe(3);
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);
  });

  it('TC-01c honours an explicit colour and uses LOCAL_ORIGIN as transaction origin', () => {
    const { doc, updates } = freshDoc();

    createSticky(doc, { x: 0, y: 0 }, 'violet');

    expect(snapshot(doc)[0].color).toBe('violet');
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
  });

  it('TC-39 refuses non-finite coordinates without writing anything', () => {
    const { doc, updates } = freshDoc();

    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      expect(createSticky(doc, at)).toBeFalsy();
    }
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-39b refuses non-finite coordinates in moveObject', () => {
    const { doc, id, updates } = docWithNote();

    expect(moveObject(doc, id, Number.NaN, 3)).toBe(false);
    expect(moveObject(doc, id, 3, Number.NaN)).toBe(false);
    expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 3)).toBe(false);
    expect(moveObject(doc, id, 3, Number.NEGATIVE_INFINITY)).toBe(false);

    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0]).toMatchObject({ x: -CENTRE_OFFSET, y: -CENTRE_OFFSET });
  });

  it('gives every note a distinct id and a Y.Text', () => {
    const doc = newDoc();

    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });

    expect(a).not.toBe(b);
    expect(getStickyText(doc, a)).toBeInstanceOf(Y.Text);
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });
});

describe('board.model — move', () => {
  it('TC-03 moveObject updates the position and nothing else', () => {
    const { doc, id, updates } = docWithNote('blue');
    const before = snapshot(doc)[0];

    expect(moveObject(doc, id, 10, -20)).toBe(true);

    expect(updates.count()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    const { doc, updates } = docWithNote();

    expect(moveObject(doc, 'gone', 5, 5)).toBe(false);

    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0]).toMatchObject({ x: -CENTRE_OFFSET, y: -CENTRE_OFFSET });
  });

  it('TC-04b moveObject cannot move an object of another type', () => {
    const doc = newDoc();
    putRawObject(doc, 'shape-1', { type: 'shape', x: 0, y: 0, z: 1 });
    const updates = meter(doc);

    expect(moveObject(doc, 'shape-1', 9, 9)).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('TC-04c moveObject to the position it already has is a no-op', () => {
    const { doc, id, updates } = docWithNote();

    expect(moveObject(doc, id, -CENTRE_OFFSET, -CENTRE_OFFSET)).toBe(false);
    expect(updates.count()).toBe(0);
  });
});

describe('board.model — colour', () => {
  it('TC-05 setStickyColor changes the colour only', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 12, y: 34 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    const updates = updateMeter(doc);
    const before = snapshot(doc)[0];

    expect(setStickyColor(doc, id, 'green')).toBe(true);

    expect(updates.count()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe('Faster onboarding');
    expect(after.x).toBeCloseTo(12 - CENTRE_OFFSET, 9);
    expect(after.y).toBeCloseTo(34 - CENTRE_OFFSET, 9);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-06 setStickyColor with an unknown colour name changes nothing', () => {
    const { doc, id, updates } = docWithNote();

    expect(setStickyColor(doc, id, 'teal')).toBe(false);

    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0].color).toBe('yellow');
  });

  it('TC-06b setStickyColor on a stale id returns false and emits no update', () => {
    const { doc, updates } = docWithNote();

    expect(setStickyColor(doc, 'gone', 'pink')).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it.each(Object.keys(STICKY_COLORS) as StickyColor[])('accepts the %s swatch', (color) => {
    // Start from a different colour: setting the colour a note already has is
    // a no-op and returns false by contract.
    const { doc, id } = docWithNote(color === 'yellow' ? 'blue' : 'yellow');

    expect(setStickyColor(doc, id, color)).toBe(true);
    expect(snapshot(doc)[0].color).toBe(color);
  });

  it('TC-05b setting the colour the note already has is a no-op', () => {
    const { doc, id, updates } = docWithNote('green');

    expect(setStickyColor(doc, id, 'green')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0].color).toBe('green');
  });
});

describe('board.model — stacking', () => {
  it('TC-09 bringToFront moves a note from the bottom (z 1 of 3) to z 4', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    const updates = meter(doc);

    expect(bringToFront(doc, first)).toBe(true);

    expect(updates.count()).toBe(1);
    const byId = new Map(snapshot(doc).map((n) => [n.id, n.z]));
    expect(byId.get(first)).toBe(4);
  });

  it('TC-10 bringToFront on the topmost note returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });
    const updates = meter(doc);

    expect(bringToFront(doc, top)).toBe(false);

    expect(updates.count()).toBe(0);
    expect(new Map(snapshot(doc).map((n) => [n.id, n.z])).get(top)).toBe(2);
  });

  it('TC-10b bringToFront on a stale id returns false and emits no update', () => {
    const { doc, updates } = docWithNote();

    expect(bringToFront(doc, 'gone')).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('TC-11 sorts equal z values by id, identically on every call', () => {
    const doc = newDoc();
    // Two notes with the same z, as story 3 can produce after a merge.
    putRawObject(doc, 'ccc', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text('c'), z: 1, createdAt: 1 });
    putRawObject(doc, 'aaa', { type: 'sticky', x: 10, y: 0, color: 'yellow', text: new Y.Text('a'), z: 1, createdAt: 2 });
    putRawObject(doc, 'bbb', { type: 'sticky', x: 20, y: 0, color: 'yellow', text: new Y.Text('b'), z: 1, createdAt: 3 });

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);

    expect(first).toEqual(['aaa', 'bbb', 'ccc']);
    expect(second).toEqual(first);
  });

  it('TC-11b sorts by z first and uses the id only as a tie-break', () => {
    const doc = newDoc();
    putRawObject(doc, 'aaa', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(''), z: 3, createdAt: 1 });
    putRawObject(doc, 'bbb', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(''), z: 1, createdAt: 2 });
    putRawObject(doc, 'ccc', { type: 'sticky', x: 0, y: 0, color: 'yellow', text: new Y.Text(''), z: 2, createdAt: 3 });

    expect(snapshot(doc).map((n) => [n.id, n.z])).toEqual([
      ['bbb', 1],
      ['ccc', 2],
      ['aaa', 3],
    ]);
  });
});

describe('board.model — delete and forward compatibility', () => {
  it('TC-07 deleteObject removes the note', () => {
    const { doc, id, updates } = docWithNote();

    expect(deleteObject(doc, id)).toBe(true);

    expect(updates.count()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    const { doc, id, updates } = docWithNote();

    expect(deleteObject(doc, 'gone')).toBe(false);
    expect(deleteObject(doc, id)).toBe(true);
    expect(deleteObject(doc, id)).toBe(false);

    // 1 update for the successful delete, none for the two rejections.
    expect(updates.count()).toBe(1);
  });

  it('TC-12 skips objects with an unknown type without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Stories 9-12 add object types; older clients must ignore them.
    putRawObject(doc, 'future-1', { type: 'shape', x: 5, y: 5, z: 9, createdAt: 1 });
    putRawObject(doc, 'future-2', { x: 1, y: 1 });

    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);
  });

  it('TC-12b ignores a malformed sticky without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    putRawObject(doc, 'broken', { type: 'sticky', x: 'far', y: null, z: 2 });
    putRawObject(doc, 'broken-text', { type: 'sticky', x: 0, y: 0, color: 'teal', text: 'plain string', z: 3 });

    expect(() => snapshot(doc)).not.toThrow();
    const notes = snapshot(doc);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.id)).toContain(id);
    // unknown colour falls back to the default; missing text reads as empty
    const broken = notes.find((n) => n.id === 'broken-text');
    expect(broken?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(broken?.text).toBe('');
  });

  it('meta.schemaVersion is set once and not overwritten', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

    const updates = updateMeter(doc);
    initDoc(doc);
    expect(updates.count()).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});
