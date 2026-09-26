import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '../../src/shared/config';

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
});

/** Count of `update` events emitted since the last reset. */
function reset() {
  updates = 0;
}

describe('board.model contract', () => {
  it('TC-01 create on empty doc: one sticky, default colour, empty text, z 1, centred', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    const note = snap[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred on the click point (top-left = point - half size).
    expect(note.x).toBeCloseTo(0 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBeCloseTo(0 - STICKY_SIZE_WORLD / 2);
    expect(updates).toBe(1);
  });

  it('TC-02 create with existing z 1,2 → new z 3', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    reset();
    const id = createSticky(doc, { x: 0, y: 500 });
    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.z).toBe(3);
    expect(updates).toBe(1);
  });

  it('TC-03 moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc)[0];
    reset();
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    const after = snapshot(doc)[0];
    expect([after.x, after.y]).toEqual([10, -20]);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates).toBe(1);
  });

  it('TC-04 moveObject stale id → false, 0 updates (negative)', () => {
    createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(moveObject(doc, 'missing-id', 1, 1)).toBe(false);
    expect(updates).toBe(0);
  });

  it('moveObject non-finite coordinates → false, 0 updates (extra)', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-05 setStickyColor green → applied', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(snapshot(doc)[0].color).toBe('green');
    expect(updates).toBe(1);
  });

  it('TC-06 setStickyColor "teal" → false, still default, 0 updates (negative)', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates).toBe(0);
  });

  it('TC-06b setStickyColor stale id → false, 0 updates', () => {
    createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(setStickyColor(doc, 'missing-id', 'green')).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(deleteObject(doc, id)).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates).toBe(1);
  });

  it('TC-08 deleteObject stale id → false, 0 updates (negative)', () => {
    createSticky(doc, { x: 0, y: 0 });
    reset();
    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront on lowest of three → z 4', () => {
    createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 500, y: 0 }); // z 2
    const id = createSticky(doc, { x: 0, y: 500 }); // z 3
    // Move the first-created note to the front.
    const first = snapshot(doc)[0];
    expect(first.z).toBe(1);
    reset();
    expect(bringToFront(doc, first.id)).toBe(true);
    const moved = snapshot(doc).find((n) => n.id === first.id)!;
    expect(moved.z).toBe(4);
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
  });

  it('TC-10 bringToFront on topmost → no update (negative)', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = snapshot(doc).slice(-1)[0];
    reset();
    expect(bringToFront(doc, top.id)).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11 equal z → snapshot sorted by id tie-break, stable across calls', () => {
    // Force two notes with the same z by hand into the doc.
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const make = (id: string, z: number) => {
      const t = new Y.Text();
      const note = new Y.Map<unknown>();
      note.set('type', 'sticky');
      note.set('x', 0);
      note.set('y', 0);
      note.set('color', 'yellow');
      note.set('text', t);
      note.set('z', z);
      note.set('createdAt', 1);
      objects.set(id, note);
    };
    doc.transact(() => {
      make('b-id', 5);
      make('a-id', 5);
    });
    const s1 = snapshot(doc).map((n) => n.id);
    const s2 = snapshot(doc).map((n) => n.id);
    expect(s1).toEqual(['a-id', 'b-id']);
    expect(s2).toEqual(s1);
  });

  it('TC-12 unknown object type skipped by snapshot, no throw', () => {
    createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    doc.transact(() => {
      objects.set('shape-1', shape);
    });
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].type).toBe('sticky');
  });

  it('getStickyText returns the Y.Text for a note and undefined for a stale id', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(getStickyText(doc, 'missing-id')).toBeUndefined();
  });

  it('initDoc sets meta.schemaVersion once (extra)', () => {
    const fresh = new Y.Doc();
    let count = 0;
    fresh.on('update', () => {
      count += 1;
    });
    initDoc(fresh);
    expect(fresh.getMap('meta').get('schemaVersion')).toBe(1);
    expect(count).toBe(1);
    initDoc(fresh); // second call writes nothing
    expect(count).toBe(1);
  });

  it('mutations use LOCAL_ORIGIN as the transaction origin', () => {
    const origins: unknown[] = [];
    // This Yjs version reports the transaction origin on the transaction object
    // passed to the afterTransaction event (argument one, `.origin`).
    doc.on('afterTransaction', (tr: { origin: unknown }) => origins.push(tr.origin));
    const id = createSticky(doc, { x: 10, y: 10 });
    moveObject(doc, id, 1, 1);
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((o) => o === LOCAL_ORIGIN)).toBe(true);
  });
});