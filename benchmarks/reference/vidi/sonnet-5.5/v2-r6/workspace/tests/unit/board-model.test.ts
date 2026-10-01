import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront, createSticky, deleteObject, getStickyText, initDoc, LOCAL_ORIGIN, moveObject,
  setStickyColor, snapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const counter = { updates: 0 };
  doc.on('update', () => { counter.updates += 1; });
  return { doc, counter };
}
const objects = (doc: Y.Doc) => doc.getMap('objects');
const make = (doc: Y.Doc, x = 100, y = 100) => createSticky(doc, { x, y }) as string;

describe('board model', () => {
  it('initDoc sets schemaVersion once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    let n = 0;
    doc.on('update', () => { n += 1; });
    initDoc(doc);
    expect(n).toBe(0);
  });

  it('TC-01 create on an empty doc', () => {
    const { doc, counter } = setup();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(objects(doc).size).toBe(1);
    const [n] = snapshot(doc);
    expect(n).toMatchObject({
      id, type: 'sticky', color: DEFAULT_STICKY_COLOR, text: '', z: 1,
      x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2,
    });
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
    expect(counter.updates).toBe(1);
  });

  it('TC-02 new note gets z = maxZ + 1', () => {
    const { doc } = setup();
    make(doc);
    make(doc);
    const id = make(doc);
    expect(snapshot(doc).find((n) => n.id === id)?.z).toBe(3);
  });

  it('TC-03 moveObject changes only x and y', () => {
    const { doc, counter } = setup();
    const id = make(doc, 0, 0);
    const before = snapshot(doc)[0];
    counter.updates = 0;
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(snapshot(doc)[0]).toEqual({ ...before, x: 10, y: -20 });
    expect(counter.updates).toBe(1);
  });

  it('TC-04 moveObject on a stale id is rejected', () => {
    const { doc, counter } = setup();
    expect(moveObject(doc, 'missing', 1, 2)).toBe(false);
    expect(counter.updates).toBe(0);
  });

  it('TC-05 setStickyColor changes only the colour', () => {
    const { doc, counter } = setup();
    const id = make(doc);
    const before = snapshot(doc)[0];
    counter.updates = 0;
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(snapshot(doc)[0]).toEqual({ ...before, color: 'green' });
    expect(counter.updates).toBe(1);
  });

  it('TC-06 unknown colour is rejected', () => {
    const { doc, counter } = setup();
    const id = make(doc);
    counter.updates = 0;
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, 'toString')).toBe(false);
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(counter.updates).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const { doc, counter } = setup();
    const id = make(doc);
    counter.updates = 0;
    expect(deleteObject(doc, id)).toBe(true);
    expect(objects(doc).size).toBe(0);
    expect(counter.updates).toBe(1);
  });

  it('TC-08 deleteObject on a stale id is rejected', () => {
    const { doc, counter } = setup();
    expect(deleteObject(doc, 'missing')).toBe(false);
    expect(counter.updates).toBe(0);
  });

  it('TC-09 bringToFront moves z 1 of 3 to 4', () => {
    const { doc, counter } = setup();
    const a = make(doc);
    make(doc);
    make(doc);
    counter.updates = 0;
    expect(bringToFront(doc, a)).toBe(true);
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(4);
    expect(counter.updates).toBe(1);
  });

  it('TC-10 bringToFront on the topmost note emits nothing', () => {
    const { doc, counter } = setup();
    make(doc);
    const top = make(doc);
    counter.updates = 0;
    expect(bringToFront(doc, top)).toBe(false);
    expect(counter.updates).toBe(0);
  });

  it('TC-11 equal z is ordered by id, stably', () => {
    const { doc } = setup();
    for (const id of ['b', 'a', 'c']) {
      const m = new Y.Map<unknown>();
      objects(doc).set(id, m);
      m.set('type', 'sticky');
      m.set('z', 5);
    }
    const ids = snapshot(doc).map((n) => n.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(snapshot(doc).map((n) => n.id)).toEqual(ids);
  });

  it('TC-12 unknown object types are skipped', () => {
    const { doc } = setup();
    const m = new Y.Map<unknown>();
    objects(doc).set('s', m);
    m.set('type', 'hologram');
    make(doc);
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-39 non-finite coordinates are rejected', () => {
    const { doc, counter } = setup();
    const id = make(doc);
    counter.updates = 0;
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(moveObject(doc, id, bad, 0)).toBe(false);
      expect(moveObject(doc, id, 0, bad)).toBe(false);
      expect(createSticky(doc, { x: bad, y: 0 })).toBe(false);
    }
    expect(counter.updates).toBe(0);
    expect(objects(doc).size).toBe(1);
  });

  it('mutations use LOCAL_ORIGIN', () => {
    const { doc } = setup();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    const id = make(doc);
    moveObject(doc, id, 1, 1);
    expect(origins).toEqual([LOCAL_ORIGIN, LOCAL_ORIGIN]);
  });
});
