/**
 * Story 2 · task 1 — board-model unit tests (TC-01 … TC-12 + extras), run
 * against a **real** `Y.Doc` (no mocks): the mutation rules all live in
 * `board-model.ts`, and Yjs is deterministic in-process. Every mutation test
 * also pins the number of `update` events: 1 for a successful change, 0 for a
 * rejected / no-op call.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
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
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** Open a doc and start counting `update` events emitted from now on. */
function tracked(): { doc: Y.Doc; updates: () => number } {
  const doc = new Y.Doc();
  initDoc(doc);
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return { doc, updates: () => count };
}

function getNote(doc: Y.Doc, id: string): Y.Map<unknown> {
  const record = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!record) throw new Error(`no object ${id}`);
  return record;
}

describe('createSticky', () => {
  it('TC-01: creates a yellow note centred on the point, z 1, empty text', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });

    expect(doc.getMap('objects').size).toBe(1);
    const note = getNote(doc, id);
    expect(note.get('type')).toBe('sticky');
    expect(note.get('color')).toBe(DEFAULT_STICKY_COLOR);
    expect((note.get('text') as Y.Text).toString()).toBe('');
    expect(note.get('z')).toBe(1);
    // Creation is centred: the top-left is the point minus half the note.
    const half = STICKY_SIZE_WORLD / 2;
    expect(note.get('x')).toBe(0 - half);
    expect(note.get('y')).toBe(0 - half);
    expect(typeof note.get('createdAt')).toBe('number');
    expect(updates()).toBe(1);
  });

  it('TC-02: a new note lands on top of existing notes (z = maxZ + 1)', () => {
    const { doc } = tracked();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 500, y: 500 });
    expect(getNote(doc, first).get('z')).toBe(1);
    expect(getNote(doc, second).get('z')).toBe(2);

    const before = snapshot(doc).length;
    const third = createSticky(doc, { x: -500, y: 250 });
    expect(getNote(doc, third).get('z')).toBe(3);
    expect(snapshot(doc).length).toBe(before + 1);
  });

  it('centres the note away from the origin too', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 300, y: -120 });
    const note = getNote(doc, id);
    const half = STICKY_SIZE_WORLD / 2;
    expect(note.get('x')).toBe(300 - half);
    expect(note.get('y')).toBe(-120 - half);
    expect(updates()).toBe(1);
  });
});

describe('moveObject', () => {
  it('TC-03: moves a note and leaves every other field alone', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = getNote(doc, id);
    const beforeZ = before.get('z');
    const beforeColor = before.get('color');

    expect(moveObject(doc, id, 10, -20)).toBe(true);
    const note = getNote(doc, id);
    expect(note.get('x')).toBe(10);
    expect(note.get('y')).toBe(-20);
    expect(note.get('z')).toBe(beforeZ);
    expect(note.get('color')).toBe(beforeColor);
    expect(updates()).toBe(2); // 1 create + 1 move
  });

  it('TC-04: a stale id is rejected with no update (negative)', () => {
    const { doc, updates } = tracked();
    createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1); // the seed create

    expect(moveObject(doc, 'does-not-exist', 5, 5)).toBe(false);
    expect(updates()).toBe(1); // still just the create
  });

  it('rejects non-finite coordinates with no update', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);

    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(updates()).toBe(1);
    const note = getNote(doc, id);
    expect(note.get('x')).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
  });
});

describe('setStickyColor', () => {
  it('TC-05: recolours a valid note', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);

    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(getNote(doc, id).get('color')).toBe('green');
    expect(updates()).toBe(2);
  });

  it('TC-06: an unknown colour is rejected, unchanged, no update (negative)', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(getNote(doc, id).get('color')).toBe(DEFAULT_STICKY_COLOR);
    expect(updates()).toBe(1);
  });

  it('rejects prototype keys (e.g. "toString") and a stale id', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates()).toBe(1);

    expect(setStickyColor(doc, id, 'toString')).toBe(false);
    expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
    expect(updates()).toBe(1);
  });
});

describe('deleteObject', () => {
  it('TC-07: removes the note', () => {
    const { doc, updates } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(doc.getMap('objects').size).toBe(1);
    expect(updates()).toBe(1);

    expect(deleteObject(doc, id)).toBe(true);
    expect(doc.getMap('objects').size).toBe(0);
    expect(updates()).toBe(2);
  });

  it('TC-08: a stale id is rejected with no update (negative)', () => {
    const { doc, updates } = tracked();
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('bringToFront', () => {
  it('TC-09: raises the bottom note of three to the top (z 1 -> 4)', () => {
    const { doc, updates } = tracked();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 400, y: 0 });
    createSticky(doc, { x: 800, y: 0 });
    expect(getNote(doc, first).get('z')).toBe(1);
    expect(updates()).toBe(3);

    expect(bringToFront(doc, first)).toBe(true);
    expect(getNote(doc, first).get('z')).toBe(4);
    expect(updates()).toBe(4);
  });

  it('TC-10: bringToFront on the topmost note emits no update (negative)', () => {
    const { doc, updates } = tracked();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 400, y: 0 });
    expect(updates()).toBe(2);

    expect(bringToFront(doc, top)).toBe(false);
    expect(getNote(doc, top).get('z')).toBe(2);
    expect(updates()).toBe(2);
  });

  it('rejects a stale id with no update', () => {
    const { doc, updates } = tracked();
    expect(bringToFront(doc, 'ghost')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('snapshot ordering and forward compatibility', () => {
  it('TC-11: equal z values are ordered by id, stable across calls', () => {
    const { doc } = tracked();
    // Build two notes at equal z by hand, so the ordering is a pure read test.
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      for (const id of ['b-id', 'a-id']) {
        const note = new Y.Map<unknown>();
        note.set('type', 'sticky');
        note.set('x', 0);
        note.set('y', 0);
        note.set('color', 'yellow');
        note.set('text', new Y.Text(''));
        note.set('z', 1);
        note.set('createdAt', 0);
        objects.set(id, note);
      }
    });

    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((note) => note.id)).toEqual(['a-id', 'b-id']);
    expect(second.map((note) => note.id)).toEqual(first.map((note) => note.id));
  });

  it('TC-12: skips unknown object types without throwing', () => {
    const { doc } = tracked();
    const sticky = createSticky(doc, { x: 0, y: 0 });

    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 10);
      objects.set('shape-1', shape);
    });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(sticky);
    expect(snap[0].type).toBe('sticky');
  });
});

describe('getStickyText and initDoc', () => {
  it('exposes the note text and returns undefined for a stale id', () => {
    const { doc } = tracked();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(getStickyText(doc, id)?.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  it('initDoc sets meta.schemaVersion exactly once', () => {
    const doc = new Y.Doc();
    let count = 0;
    doc.on('update', () => {
      count += 1;
    });
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(count).toBe(1);

    initDoc(doc);
    expect(count).toBe(1); // second call is a no-op
  });

  it('tags local mutations with LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    const id = createSticky(doc, { x: 0, y: 0 });
    moveObject(doc, id, 1, 1);
    expect(origins.every((origin) => origin === LOCAL_ORIGIN)).toBe(true);
  });
});