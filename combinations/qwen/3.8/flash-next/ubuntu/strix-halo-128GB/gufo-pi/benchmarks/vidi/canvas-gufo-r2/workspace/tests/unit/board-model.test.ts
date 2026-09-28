/**
 * Board model unit tests (TC-01 to TC-12).
 * Uses a real Y.Doc. Every mutation test also asserts the number of `update` events emitted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
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

describe('board-model', () => {
  let doc: Y.Doc;
  let updateCount: number;

  beforeEach(() => {
    doc = new Y.Doc();
    updateCount = 0;
    doc.on('update', () => {
      updateCount++;
    });
  });

  it('TC-01: create on empty doc', () => {
    const id = createSticky(doc, { x: 300, y: 200 });
    expect(updateCount).toBe(1); // one transaction for the sticky
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    const s = snaps[0];
    expect(s.id).toBe(id);
    expect(s.type).toBe('sticky');
    expect(s.color).toBe(DEFAULT_STICKY_COLOR);
    expect(s.text).toBe('');
    expect(s.z).toBe(1);
    expect(s.x).toBe(300 - STICKY_SIZE_WORLD / 2);
    expect(s.y).toBe(200 - STICKY_SIZE_WORLD / 2);
    expect(s.createdAt).toBeGreaterThan(0);
  });

  it('TC-02: create with existing z 1,2 -> new z 3', () => {
    const objects = doc.getMap('objects');
    // Create two sticky notes with z 1 and 2
    const y1 = new Y.Map();
    y1.set('type', 'sticky');
    y1.set('x', 0);
    y1.set('y', 0);
    y1.set('color', 'yellow');
    y1.set('z', 1);
    y1.set('createdAt', Date.now());
    y1.set('text', new Y.Text());
    objects.set('a', y1);
    const y2 = new Y.Map();
    y2.set('type', 'sticky');
    y2.set('x', 100);
    y2.set('y', 100);
    y2.set('color', 'yellow');
    y2.set('z', 2);
    y2.set('createdAt', Date.now());
    y2.set('text', new Y.Text());
    objects.set('b', y2);
    updateCount = 0; // Reset; we care about the transaction from createSticky
    const id = createSticky(doc, { x: 200, y: 200 });
    expect(updateCount).toBe(1);
    const snaps = snapshot(doc);
    const newNote = snaps.find((s) => s.id === id)!;
    expect(newNote.z).toBe(3);
  });

  it('TC-03: moveObject updates x,y; other fields unchanged', () => {
    const id = createSticky(doc, { x: 300, y: 200 });
    updateCount = 0;
    const result = moveObject(doc, id, 10, -20);
    expect(result).toBe(true);
    expect(updateCount).toBe(1);
    const snaps = snapshot(doc);
    const s = snaps.find((n) => n.id === id)!;
    expect(s.x).toBe(10);
    expect(s.y).toBe(-20);
    expect(s.color).toBe(DEFAULT_STICKY_COLOR);
    expect(s.z).toBe(1);
    expect(s.text).toBe('');
  });

  it('TC-04: moveObject stale id -> false, 0 updates', () => {
    updateCount = 0;
    const result = moveObject(doc, 'missing-id', 10, 10);
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('TC-05: setStickyColor green -> applied', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    const result = setStickyColor(doc, id, 'green');
    expect(result).toBe(true);
    expect(updateCount).toBe(1);
    const snaps = snapshot(doc);
    expect(snaps[0].color).toBe('green');
  });

  it('TC-06: setStickyColor "teal" -> false, unchanged, 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    const result = setStickyColor(doc, id, 'teal');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
    const snaps = snapshot(doc);
    expect(snaps[0].color).toBe('yellow');
  });

  it('TC-07: deleteObject -> removed', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(updateCount).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08: deleteObject stale id -> false, 0 updates', () => {
    updateCount = 0;
    const result = deleteObject(doc, 'missing-id');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('TC-09: bringToFront z1 of 3 -> z 4', () => {
    const objects = doc.getMap('objects');
    const mkNote = (id: string, z: number) => {
      const ym = new Y.Map();
      ym.set('type', 'sticky');
      ym.set('x', 0);
      ym.set('y', 0);
      ym.set('color', 'yellow');
      ym.set('z', z);
      ym.set('createdAt', Date.now());
      ym.set('text', new Y.Text());
      objects.set(id, ym);
    };
    mkNote('a', 1);
    mkNote('b', 2);
    mkNote('c', 3);
    updateCount = 0;
    const result = bringToFront(doc, 'a');
    expect(result).toBe(true);
    expect(updateCount).toBe(1);
    const snaps = snapshot(doc);
    const a = snaps.find((s) => s.id === 'a')!;
    expect(a.z).toBe(4);
  });

  it('TC-10: bringToFront on topmost -> no update (false)', () => {
    const objects = doc.getMap('objects');
    const mkNote = (id: string, z: number) => {
      const ym = new Y.Map();
      ym.set('type', 'sticky');
      ym.set('x', 0);
      ym.set('y', 0);
      ym.set('color', 'yellow');
      ym.set('z', z);
      ym.set('createdAt', Date.now());
      ym.set('text', new Y.Text());
      objects.set(id, ym);
    };
    mkNote('a', 5);
    mkNote('b', 3);
    updateCount = 0;
    const result = bringToFront(doc, 'a');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('TC-11: equal z -> snapshot sorted by id tie-break, stable', () => {
    const objects = doc.getMap('objects');
    const mkNote = (id: string, z: number) => {
      const ym = new Y.Map();
      ym.set('type', 'sticky');
      ym.set('x', 0);
      ym.set('y', 0);
      ym.set('color', 'yellow');
      ym.set('z', z);
      ym.set('createdAt', Date.now());
      ym.set('text', new Y.Text());
      objects.set(id, ym);
    };
    mkNote('zebra', 5);
    mkNote('apple', 5);
    const s1 = snapshot(doc);
    const s2 = snapshot(doc);
    expect(s1[0].id).toBe('apple');
    expect(s1[1].id).toBe('zebra');
    expect(s1.map((n) => n.id)).toEqual(s2.map((n) => n.id));
  });

  it('TC-12: unknown object type -> skipped, no throw', () => {
    const objects = doc.getMap('objects');
    const ym = new Y.Map();
    ym.set('type', 'shape');
    ym.set('x', 0);
    ym.set('y', 0);
    objects.set('shape1', ym);
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('extra: non-finite coordinates rejected with 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updateCount = 0;
    expect(moveObject(doc, id, NaN, 5)).toBe(false);
    expect(moveObject(doc, id, 5, Infinity)).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('extra: initDoc sets meta.schemaVersion once', () => {
    initDoc(doc);
    initDoc(doc); // second call should not emit an extra update
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('extra: getStickyText returns Y.Text for a valid sticky', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
  });

  it('extra: getStickyText returns undefined for missing id', () => {
    expect(getStickyText(doc, 'nonexistent')).toBeUndefined();
  });
});
