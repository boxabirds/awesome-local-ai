import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront, createSticky, deleteObject, getStickyText, initDoc, moveObject, setStickyColor, snapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on('update', () => { updates++; });
});

const objects = () => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
function mk(x = 0, y = 0): string {
  const id = createSticky(doc, { x, y });
  if (!id) throw new Error('create failed');
  updates = 0;
  return id;
}

describe('board model', () => {
  it('initDoc sets schemaVersion once', () => {
    const d = new Y.Doc();
    initDoc(d);
    initDoc(d);
    expect(d.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('TC-01 creates a centred default note with z 1', () => {
    expect(objects().size).toBe(0);
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(updates).toBe(1);
    expect(objects().size).toBe(1);
    const [n] = snapshot(doc);
    expect(n).toMatchObject({
      id, type: 'sticky', color: DEFAULT_STICKY_COLOR, text: '', z: 1,
      x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2,
    });
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });

  it('TC-02 new note goes on top', () => {
    mk(); mk();
    const id = createSticky(doc, { x: 1, y: 1 }) as string;
    expect(snapshot(doc).find((n) => n.id === id)!.z).toBe(3);
  });

  it('TC-03 moveObject changes only x,y', () => {
    const id = mk();
    const before = snapshot(doc)[0];
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)[0]).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on stale id is rejected', () => {
    mk();
    expect(moveObject(doc, 'nope', 1, 1)).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const id = mk();
    const before = snapshot(doc)[0];
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)[0]).toEqual({ ...before, color: 'green' });
  });

  it('TC-06 unknown colour is rejected', () => {
    const id = mk();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const id = mk();
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates).toBe(1);
    expect(objects().size).toBe(0);
  });

  it('TC-08 deleteObject on stale id is rejected', () => {
    expect(deleteObject(doc, 'nope')).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-09 bringToFront moves z 1 of 3 to 4', () => {
    const a = mk(); mk(); mk();
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
  });

  it('TC-10 bringToFront on the topmost note emits nothing', () => {
    mk();
    const top = mk();
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates).toBe(0);
    expect(bringToFront(doc, 'nope')).toBe(false);
  });

  it('TC-11 equal z is ordered by id, stably', () => {
    const a = mk(); const b = mk();
    objects().get(a)!.set('z', 5);
    objects().get(b)!.set('z', 5);
    const order = snapshot(doc).map((n) => n.id);
    expect(order).toEqual([a, b].sort());
    expect(snapshot(doc).map((n) => n.id)).toEqual(order);
  });

  it('TC-12 unknown object types are skipped', () => {
    mk();
    const shape = new Y.Map<unknown>();
    objects().set('s1', shape);
    shape.set('type', 'shape');
    shape.set('x', 1);
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-39 non-finite coordinates are rejected', () => {
    const id = mk();
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(moveObject(doc, id, bad, 0)).toBe(false);
      expect(moveObject(doc, id, 0, bad)).toBe(false);
      expect(createSticky(doc, { x: bad, y: 0 })).toBe(false);
    }
    expect(updates).toBe(0);
    expect(objects().size).toBe(1);
  });
});
