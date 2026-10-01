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

const H = STICKY_SIZE_WORLD / 2;

describe('board model', () => {
  it('TC-01 creates a default sticky centred on the point', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const [n] = snapshot(doc);
    expect(doc.getMap('objects').size).toBe(1);
    expect(n).toMatchObject({ id, type: 'sticky', color: DEFAULT_STICKY_COLOR, text: '', z: 1, x: -H, y: -H });
    expect(updates()).toBe(1);
  });

  it('TC-02 new note goes on top', () => {
    const { doc } = setup();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);
  });

  it('TC-03 moveObject updates position only', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: H, y: H });
    const before = snapshot(doc)[0];
    const base = updates();
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(snapshot(doc)[0]).toEqual({ ...before, x: 10, y: -20 });
    expect(updates() - base).toBe(1);
  });

  it('TC-04 moveObject on a stale id is rejected', () => {
    const { doc, updates } = setup();
    expect(moveObject(doc, 'nope', 1, 1)).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 5, y: 5 });
    const before = snapshot(doc)[0];
    const base = updates();
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(snapshot(doc)[0]).toEqual({ ...before, color: 'green' });
    expect(updates() - base).toBe(1);
  });

  it('TC-06 unknown colour is rejected', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const base = updates();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(updates() - base).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const base = updates();
    expect(deleteObject(doc, id)).toBe(true);
    expect(doc.getMap('objects').size).toBe(0);
    expect(updates() - base).toBe(1);
  });

  it('TC-08 deleteObject on a stale id is rejected', () => {
    const { doc, updates } = setup();
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-09 bringToFront moves a lower note above the rest', () => {
    const { doc, updates } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const base = updates();
    expect(bringToFront(doc, a)).toBe(true);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
    expect(updates() - base).toBe(1);
  });

  it('TC-10 bringToFront on the topmost note is a no-op', () => {
    const { doc, updates } = setup();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const base = updates();
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates() - base).toBe(0);
  });

  it('TC-11 equal z values sort by id, stably', () => {
    const { doc } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    const objs = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    objs.get(a)!.set('z', 5);
    objs.get(b)!.set('z', 5);
    const ids = snapshot(doc).map((n) => n.id);
    expect(ids).toEqual([a, b].sort());
    expect(snapshot(doc).map((n) => n.id)).toEqual(ids);
  });

  it('TC-12 unknown object types are skipped', () => {
    const { doc } = setup();
    createSticky(doc, { x: 0, y: 0 });
    const shape = new Y.Map<unknown>();
    (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).set('s1', shape);
    shape.set('type', 'shape');
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-39 non-finite coordinates are rejected', () => {
    const { doc, updates } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const base = updates();
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Infinity)).toBe(false);
    expect(createSticky(doc, { x: -Infinity, y: 0 })).toBe('');
    expect(createSticky(doc, { x: NaN, y: 0 })).toBe('');
    expect(updates() - base).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('initDoc sets schemaVersion once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('getStickyText returns the note text or undefined', () => {
    const { doc } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
    expect(getStickyText(doc, 'nope')).toBeUndefined();
  });
});
