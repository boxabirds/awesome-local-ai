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

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => updates++);
  return { doc, updates: () => updates };
}

const create = (doc: Y.Doc, x = 0, y = 0) => createSticky(doc, { x, y }) as string;

describe('board model', () => {
  it('initDoc sets schemaVersion once', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => updates++);
    initDoc(doc);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates).toBe(1);
  });

  it('TC-01 createSticky on an empty doc, centred on the point', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 300, y: 100 }) as string;
    const [n, ...rest] = snapshot(doc);
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: 300 - STICKY_SIZE_WORLD / 2,
      y: 100 - STICKY_SIZE_WORLD / 2,
    });
    expect(updates()).toBe(1);
  });

  it('TC-02 new note goes on top of existing z 1, 2', () => {
    const { doc } = setup();
    create(doc);
    create(doc);
    const id = create(doc);
    expect(snapshot(doc).find((n) => n.id === id)?.z).toBe(3);
  });

  it('TC-03 moveObject changes only x and y', () => {
    const { doc, updates } = setup();
    const id = create(doc);
    const before = snapshot(doc)[0];
    const base = updates();
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(snapshot(doc)[0]).toEqual({ ...before, x: 10, y: -20 });
    expect(updates() - base).toBe(1);
  });

  it('TC-04 moveObject on a stale id is rejected without an update', () => {
    const { doc, updates } = setup();
    const base = updates();
    expect(moveObject(doc, 'nope', 1, 1)).toBe(false);
    expect(updates() - base).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const { doc, updates } = setup();
    const id = create(doc, 5, 6);
    const before = snapshot(doc)[0];
    const base = updates();
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(snapshot(doc)[0]).toEqual({ ...before, color: 'green' });
    expect(updates() - base).toBe(1);
  });

  it('TC-06 unknown colour is rejected', () => {
    const { doc, updates } = setup();
    const id = create(doc);
    const base = updates();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, 'toString')).toBe(false);
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(updates() - base).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const { doc, updates } = setup();
    const id = create(doc);
    const base = updates();
    expect(deleteObject(doc, id)).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
    expect(updates() - base).toBe(1);
  });

  it('TC-08 deleteObject on a stale id is rejected', () => {
    const { doc, updates } = setup();
    const base = updates();
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates() - base).toBe(0);
  });

  it('TC-09 bringToFront moves z 1 of 3 to 4', () => {
    const { doc, updates } = setup();
    const a = create(doc);
    create(doc);
    create(doc);
    const base = updates();
    expect(bringToFront(doc, a)).toBe(true);
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(4);
    expect(updates() - base).toBe(1);
  });

  it('TC-10 bringToFront on the topmost note is a no-op', () => {
    const { doc, updates } = setup();
    create(doc);
    const top = create(doc);
    const base = updates();
    expect(bringToFront(doc, top)).toBe(false);
    expect(bringToFront(doc, 'nope')).toBe(false);
    expect(updates() - base).toBe(0);
  });

  it('TC-11 equal z is ordered by id, stably', () => {
    const { doc } = setup();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (const id of ['b', 'c', 'a']) {
      const m = new Y.Map<unknown>();
      objects.set(id, m);
      m.set('type', 'sticky');
      m.set('z', 5);
      m.set('text', new Y.Text());
    }
    expect(snapshot(doc).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(snapshot(doc).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('TC-12 unknown object types are skipped', () => {
    const { doc } = setup();
    const m = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>('objects').set('s', m);
    m.set('type', 'shape');
    create(doc);
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-39 non-finite coordinates are rejected', () => {
    const { doc, updates } = setup();
    const id = create(doc);
    const base = updates();
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(moveObject(doc, id, bad, 0)).toBe(false);
      expect(moveObject(doc, id, 0, bad)).toBe(false);
      expect(createSticky(doc, { x: bad, y: 0 })).toBe(false);
    }
    expect(snapshot(doc)).toHaveLength(1);
    expect(updates() - base).toBe(0);
  });
});
