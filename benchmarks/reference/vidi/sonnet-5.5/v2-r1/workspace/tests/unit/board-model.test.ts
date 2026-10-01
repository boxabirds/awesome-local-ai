import { beforeEach, describe, expect, it } from 'vitest';
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

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => updates++);
});

function make(x = 0, y = 0): string {
  const id = createSticky(doc, { x, y });
  if (!id) throw new Error('create failed');
  return id;
}

function find(id: string) {
  const n = snapshot(doc).find((s) => s.id === id);
  if (!n) throw new Error('missing');
  return n;
}

describe('board model', () => {
  it('initDoc sets schemaVersion once', () => {
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    doc.getMap('meta').set('schemaVersion', 7);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(7);
  });

  it('TC-01 creates a centred yellow note with z 1', () => {
    const id = make(300, 200);
    expect(updates).toBe(1);
    const n = find(id);
    expect(snapshot(doc)).toHaveLength(1);
    expect(n).toMatchObject({
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: 300 - STICKY_SIZE_WORLD / 2,
      y: 200 - STICKY_SIZE_WORLD / 2,
    });
  });

  it('TC-02 new note goes on top', () => {
    make();
    make();
    const id = make();
    expect(find(id).z).toBe(3);
  });

  it('TC-03 moveObject changes only x,y', () => {
    const id = make();
    const before = find(id);
    updates = 0;
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates).toBe(1);
    expect(find(id)).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id is rejected', () => {
    expect(moveObject(doc, 'nope', 1, 1)).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const id = make();
    const before = find(id);
    updates = 0;
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates).toBe(1);
    expect(find(id)).toEqual({ ...before, color: 'green' });
  });

  it('TC-06 unknown colour is rejected', () => {
    const id = make();
    updates = 0;
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(find(id).color).toBe('yellow');
    expect(updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const id = make();
    updates = 0;
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id is rejected', () => {
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront moves z 1 of 3 to 4', () => {
    const a = make();
    make();
    make();
    updates = 0;
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates).toBe(1);
    expect(find(a).z).toBe(4);
  });

  it('TC-10 bringToFront on the topmost note is a no-op', () => {
    make();
    const top = make();
    updates = 0;
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-11 equal z is ordered by id, stably', () => {
    const a = make();
    const b = make();
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    objects.get(a)?.set('z', 5);
    objects.get(b)?.set('z', 5);
    const ids = snapshot(doc).map((n) => n.id);
    expect(ids).toEqual([a, b].sort());
    expect(snapshot(doc).map((n) => n.id)).toEqual(ids);
  });

  it('TC-12 unknown object types are skipped', () => {
    make();
    const shape = new Y.Map<unknown>();
    (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).set('shape-1', shape);
    shape.set('type', 'shape');
    shape.set('x', 1);
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-39 non-finite coordinates are rejected', () => {
    const id = make();
    updates = 0;
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Infinity)).toBe(false);
    expect(createSticky(doc, { x: NaN, y: 0 })).toBe(false);
    expect(createSticky(doc, { x: 0, y: -Infinity })).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('uses LOCAL_ORIGIN for transactions', () => {
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    const id = make();
    moveObject(doc, id, 5, 5);
    expect(origins).toEqual([LOCAL_ORIGIN, LOCAL_ORIGIN]);
  });
});
