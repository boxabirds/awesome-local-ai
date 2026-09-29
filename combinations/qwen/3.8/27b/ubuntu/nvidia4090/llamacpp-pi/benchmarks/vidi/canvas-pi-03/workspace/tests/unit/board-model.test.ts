import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
} from '@/shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@/shared/config';

function trackUpdates(doc: Y.Doc): { count: () => number; lastOrigin: () => unknown; dispose: () => void } {
  let count = 0;
  let lastOrigin: unknown = undefined;
  const cb = (_update: Uint8Array, origin: unknown) => {
    count += 1;
    lastOrigin = origin;
  };
  doc.on('update', cb);
  return {
    count: () => count,
    lastOrigin: () => lastOrigin,
    dispose: () => doc.off('update', cb),
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board.model (unit, real Y.Doc)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('TC-01: createSticky on empty doc adds one sticky, centred, default colour, z 1', () => {
    const updates = trackUpdates(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
    });
    // Creation centres the note on the point (top-left = point - size/2).
    expect(notes[0].x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(notes[0].createdAt).toBeTypeOf('number');
    updates.dispose();
  });

  it('TC-02: createSticky with existing z 1,2 gets z 3', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    const updates = trackUpdates(doc);
    const c = createSticky(doc, { x: 20, y: 20 });
    expect(c).toBeTruthy();
    expect(updates.count()).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(3);
    const noteC = notes.find(n => n.id === c);
    expect(noteC?.z).toBe(3);
    updates.dispose();
  });

  it('TC-03: moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const updates = trackUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    updates.dispose();
  });

  it('TC-04 (negative): moveObject on stale id returns false, emits no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const updates = trackUpdates(doc);
    expect(moveObject(doc, 'missing-id', 10, -20)).toBe(false);
    expect(updates.count()).toBe(0);
    updates.dispose();
  });

  it('TC-05: setStickyColor green is applied, keeping other fields', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const updates = trackUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates.count()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    updates.dispose();
  });

  it('TC-06 (negative): setStickyColor with unknown colour returns false, no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = trackUpdates(doc);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    updates.dispose();
  });

  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const updates = trackUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    updates.dispose();
  });

  it('TC-08 (negative): deleteObject on stale id returns false, no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const updates = trackUpdates(doc);
    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    updates.dispose();
  });

  it('TC-09: bringToFront raises z to maxZ+1', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    createSticky(doc, { x: 20, y: 20 });
    expect(a).toBeTruthy();
    const updates = trackUpdates(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc).find(n => n.id === a)?.z).toBe(4);
    updates.dispose();
  });

  it('TC-10 (negative): bringToFront on the topmost note emits no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 10 });
    expect(top).toBeTruthy();
    const updates = trackUpdates(doc);
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates.count()).toBe(0);
    updates.dispose();
  });

  it('TC-11: equal z values sort by id tie-break, stable across calls', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // Simulate concurrent creation (story 3) producing equal z values.
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const objA = objects.get(a) as Y.Map<unknown>;
      objA.set('z', 2);
    });
    const first = snapshot(doc).map(n => n.id);
    const second = snapshot(doc).map(n => n.id);
    expect(first).toHaveLength(2);
    const sorted = [...first].sort();
    expect(first).toEqual(sorted);
    expect(second).toEqual(first); // stable across calls
  });

  it('TC-12: objects with unknown type are skipped by snapshot without throwing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 5);
      objects.set('shape-1', shape);
    });
    let notes: ReturnType<typeof snapshot> = [];
    expect(() => {
      notes = snapshot(doc);
    }).not.toThrow();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
  });

  it('extra: non-finite coordinates are rejected with no update', () => {
    const updates = trackUpdates(doc);
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();
    expect(moveObject(doc, id, Number.NaN, 5)).toBe(false);
    expect(moveObject(doc, id, 5, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(updates.count()).toBe(1); // only the successful createSticky
    expect(snapshot(doc)).toHaveLength(1);
    updates.dispose();
  });

  it('extra: initDoc sets meta.schemaVersion once and is idempotent', () => {
    const raw = new Y.Doc();
    const updates = trackUpdates(raw);
    initDoc(raw);
    expect(updates.count()).toBe(1);
    expect(raw.getMap('meta').get('schemaVersion')).toBe(1);
    initDoc(raw);
    expect(updates.count()).toBe(1); // second call is a no-op
    updates.dispose();
    raw.destroy();
  });

  it('extra: getStickyText returns the Y.Text for a sticky, undefined for stale id', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    expect(getStickyText(doc, 'missing-id')).toBeUndefined();
  });
});
