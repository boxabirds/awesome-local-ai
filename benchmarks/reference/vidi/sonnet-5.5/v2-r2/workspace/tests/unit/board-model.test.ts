import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront, createSticky, deleteObject, getStickyText, initDoc, moveObject, setStickyColor, snapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  return { doc, updates: () => updates };
}

describe('board model', () => {
  it('initDoc sets schemaVersion once', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    initDoc(doc);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates).toBe(1);
  });

  it('TC-01 creates a centred default note on an empty doc', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);
    expect(doc.getMap('objects').size).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id, type: 'sticky', color: DEFAULT_STICKY_COLOR, text: '', z: 1,
      x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2,
    });
    expect(updates()).toBe(1);
  });

  it('TC-02 new note goes on top', () => {
    const { doc } = setup();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 5, y: 5 });
    const id = createSticky(doc, { x: 9, y: 9 });
    expect(snapshot(doc).find((n) => n.id === id)?.z).toBe(3);
  });

  it('TC-03 moveObject updates only the position', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc)[0];
    const n = updates();
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates() - n).toBe(1);
    expect(snapshot(doc)[0]).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id is rejected', () => {
    const { doc, updates } = setup();
    expect(moveObject(doc, 'nope', 1, 1)).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const n = updates();
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates() - n).toBe(1);
    expect(snapshot(doc)[0]).toEqual({ ...before, color: 'green' });
  });

  it('TC-06 unknown colour is rejected', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const n = updates();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, 'toString')).toBe(false);
    expect(updates()).toBe(n);
    expect(snapshot(doc)[0].color).toBe('yellow');
  });

  it('TC-07 deleteObject removes the note', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const n = updates();
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates() - n).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id is rejected', () => {
    const { doc, updates } = setup();
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-09 bringToFront lifts a lower note above all', () => {
    const { doc, updates } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 1, y: 1 });
    createSticky(doc, { x: 2, y: 2 });
    const n = updates();
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates() - n).toBe(1);
    expect(snapshot(doc).find((s) => s.id === a)?.z).toBe(4);
    expect(snapshot(doc).at(-1)?.id).toBe(a);
  });

  it('TC-10 bringToFront on the topmost note is a no-op', () => {
    const { doc, updates } = setup();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 1, y: 1 });
    const n = updates();
    expect(bringToFront(doc, top)).toBe(false);
    expect(bringToFront(doc, 'nope')).toBe(false);
    expect(updates()).toBe(n);
  });

  it('TC-11 equal z is ordered by id, stably', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap('objects');
    for (const id of ['b', 'c', 'a']) {
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky'); m.set('x', 0); m.set('y', 0); m.set('color', 'yellow');
      m.set('text', new Y.Text()); m.set('z', 1); m.set('createdAt', 0);
      objects.set(id, m);
    }
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a', 'b', 'c']);
    expect(snapshot(doc).map((n) => n.id)).toEqual(first);
  });

  it('TC-12 unknown object types are skipped', () => {
    const { doc } = setup();
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('z', 5);
    doc.getMap('objects').set('s', shape);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);
  });

  it('TC-39 non-finite coordinates are rejected', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const n = updates();
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Infinity)).toBe(false);
    expect(createSticky(doc, { x: -Infinity, y: 0 })).toBe('');
    expect(createSticky(doc, { x: 0, y: NaN })).toBe('');
    expect(updates()).toBe(n);
    expect(snapshot(doc)).toHaveLength(1);
  });
});
