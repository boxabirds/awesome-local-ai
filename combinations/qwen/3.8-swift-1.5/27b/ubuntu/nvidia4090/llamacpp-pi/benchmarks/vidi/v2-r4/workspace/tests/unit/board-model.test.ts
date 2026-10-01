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
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '../../src/shared/config';

function countUpdates(doc: Y.Doc): { count: () => number; off: () => void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    count: () => count,
    off: () => { doc.off('update', handler); },
  };
}

describe('board-model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: create on empty doc
  it('TC-01: createSticky on empty doc creates 1 object with correct defaults', () => {
    const up = countUpdates(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(id).toBeTypeOf('string');
    expect(id.length).toBeGreaterThan(0);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].type).toBe('sticky');
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
    // Creation centred: x,y = point - STICKY_SIZE_WORLD/2
    expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(up.count()).toBe(1);
    up.off();
  });

  // TC-02: create with existing z 1,2 → new z 3
  it('TC-02: createSticky with existing notes gets z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 100, y: 100 });
    const id3 = createSticky(doc, { x: 200, y: 200 });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(3);
    const note3 = snap.find((s) => s.id === id3)!;
    expect(note3.z).toBe(3);
  });

  // TC-03: moveObject updates x,y, other fields unchanged
  it('TC-03: moveObject updates x and y, other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];

    const up = countUpdates(doc);
    const result = moveObject(doc, id, 10, -20);
    expect(result).toBe(true);
    expect(up.count()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
    up.off();
  });

  // TC-04: moveObject on stale id → false, 0 updates
  it('TC-04: moveObject on stale id returns false with 0 updates', () => {
    const up = countUpdates(doc);
    const result = moveObject(doc, 'nonexistent-id', 10, 20);
    expect(result).toBe(false);
    expect(up.count()).toBe(0);
    up.off();
  });

  // TC-05: setStickyColor green → applied; text, x, y, z unchanged
  it('TC-05: setStickyColor applies colour, other fields unchanged', () => {
    const id = createSticky(doc, { x: 50, y: 50 });
    const before = snapshot(doc)[0];

    const up = countUpdates(doc);
    const result = setStickyColor(doc, id, 'green');
    expect(result).toBe(true);
    expect(up.count()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    up.off();
  });

  // TC-06: setStickyColor 'teal' → false, unchanged, 0 updates
  it('TC-06: setStickyColor with unknown colour returns false', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    const up = countUpdates(doc);
    const result = setStickyColor(doc, id, 'teal');
    expect(result).toBe(false);
    expect(up.count()).toBe(0);

    const after = snapshot(doc)[0];
    expect(after.color).toBe(DEFAULT_STICKY_COLOR);
    up.off();
  });

  // TC-07: deleteObject → removed
  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const up = countUpdates(doc);
    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(up.count()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    up.off();
  });

  // TC-08: deleteObject on stale id → false, 0 updates
  it('TC-08: deleteObject on stale id returns false', () => {
    const up = countUpdates(doc);
    const result = deleteObject(doc, 'nonexistent-id');
    expect(result).toBe(false);
    expect(up.count()).toBe(0);
    up.off();
  });

  // TC-09: bringToFront z1 of 3 → z 4
  it('TC-09: bringToFront moves note to top (z = maxZ + 1)', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 100, y: 100 });
    createSticky(doc, { x: 200, y: 200 });

    // id1 has z=1
    const up = countUpdates(doc);
    const result = bringToFront(doc, id1);
    expect(result).toBe(true);
    expect(up.count()).toBe(1);

    const snap = snapshot(doc);
    const note1 = snap.find((s) => s.id === id1)!;
    expect(note1.z).toBe(4);
    up.off();
  });

  // TC-10: bringToFront on topmost → no update
  it('TC-10: bringToFront on topmost note returns false with 0 updates', () => {
    createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 100, y: 100 });

    // id2 is topmost (z=2)
    const up = countUpdates(doc);
    const result = bringToFront(doc, id2);
    expect(result).toBe(false);
    expect(up.count()).toBe(0);
    up.off();
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  it('TC-11: snapshot sorts by (z, id) with id as tie-break', () => {
    // Manually create two notes with the same z
    const objects = doc.getMap('objects');
    const textA = new Y.Text();
    const textB = new Y.Text();

    doc.transact(() => {
      const objA = new Y.Map<unknown>();
      objA.set('type', 'sticky');
      objA.set('x', 0);
      objA.set('y', 0);
      objA.set('color', 'yellow');
      objA.set('text', textA);
      objA.set('z', 5);
      objA.set('createdAt', 1000);
      objects.set('b-id', objA);

      const objB = new Y.Map<unknown>();
      objB.set('type', 'sticky');
      objB.set('x', 10);
      objB.set('y', 10);
      objB.set('color', 'blue');
      objB.set('text', textB);
      objB.set('z', 5);
      objB.set('createdAt', 2000);
      objects.set('a-id', objB);
    }, LOCAL_ORIGIN);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(2);
    // 'a-id' < 'b-id' so a-id comes first
    expect(snap[0].id).toBe('a-id');
    expect(snap[1].id).toBe('b-id');

    // Stable across calls
    const snap2 = snapshot(doc);
    expect(snap2[0].id).toBe('a-id');
    expect(snap2[1].id).toBe('b-id');
  });

  // TC-12: unknown object type in doc → skipped by snapshot, no throw
  it('TC-12: snapshot skips unknown object types without throwing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    // Add an unknown type
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'shape');
      obj.set('x', 50);
      obj.set('y', 50);
      obj.set('z', 1);
      obj.set('createdAt', 0);
      objects.set('shape-id', obj);
    }, LOCAL_ORIGIN);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
  });

  // TC-39: moveObject and createSticky with NaN / Infinity coordinates → false, 0 updates
  it('TC-39: createSticky with NaN coordinates returns empty string', () => {
    const up = countUpdates(doc);
    const id = createSticky(doc, { x: NaN, y: 0 });
    expect(id).toBe('');
    expect(up.count()).toBe(0);
    up.off();
  });

  it('TC-39: createSticky with Infinity coordinates returns empty string', () => {
    const up = countUpdates(doc);
    const id = createSticky(doc, { x: 0, y: Infinity });
    expect(id).toBe('');
    expect(up.count()).toBe(0);
    up.off();
  });

  it('TC-39: moveObject with NaN coordinates returns false', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const up = countUpdates(doc);
    const result = moveObject(doc, id, NaN, 0);
    expect(result).toBe(false);
    expect(up.count()).toBe(0);
    up.off();
  });

  it('TC-39: moveObject with Infinity coordinates returns false', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const up = countUpdates(doc);
    const result = moveObject(doc, id, 0, Infinity);
    expect(result).toBe(false);
    expect(up.count()).toBe(0);
    up.off();
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('initDoc sets meta.schemaVersion to 1', () => {
    const freshDoc = new Y.Doc();
    initDoc(freshDoc);
    const meta = freshDoc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('initDoc does not overwrite existing schemaVersion', () => {
    const freshDoc = new Y.Doc();
    initDoc(freshDoc);
    // Call again - should not throw or change
    initDoc(freshDoc);
    const meta = freshDoc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  // getStickyText
  it('getStickyText returns Y.Text for existing note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
  });

  it('getStickyText returns undefined for stale id', () => {
    const text = getStickyText(doc, 'nonexistent');
    expect(text).toBeUndefined();
  });
});
