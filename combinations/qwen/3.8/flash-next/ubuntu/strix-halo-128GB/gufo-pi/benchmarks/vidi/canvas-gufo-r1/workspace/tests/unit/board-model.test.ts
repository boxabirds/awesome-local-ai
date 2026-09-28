import { describe, expect, it } from 'vitest';
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
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => { count++; };
  doc.on('update', listener);
  fn();
  doc.off('update', listener);
  return count;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

describe('board-model', () => {
  // TC-01: create on empty doc
  it('TC-01 createSticky on empty doc produces one sticky with defaults', () => {
    const doc = newDoc();
    const at = { x: 100, y: 200 };
    const id = createSticky(doc, at);
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(id);
    expect(snaps[0].type).toBe('sticky');
    expect(snaps[0].x).toBe(at.x - STICKY_SIZE_WORLD / 2);
    expect(snaps[0].y).toBe(at.y - STICKY_SIZE_WORLD / 2);
    expect(snaps[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snaps[0].text).toBe('');
    expect(snaps[0].z).toBe(1);
    expect(snaps[0].createdAt).toBeGreaterThan(0);
  });

  // TC-02: create with existing z 1,2 → new z 3
  it('TC-02 createSticky assigns z = maxZ + 1', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const id = createSticky(doc, { x: 600, y: 0 });
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(3);
    const last = snaps.find((s) => s.id === id)!;
    expect(last.z).toBe(3);
  });

  // TC-03: moveObject → x,y updated, other fields unchanged
  it('TC-03 moveObject updates x,y and leaves other fields unchanged', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc)[0];
    const updates = countUpdates(doc, () => {
      const result = moveObject(doc, id, 10, -20);
      expect(result).toBe(true);
    });
    expect(updates).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  // TC-04: moveObject stale id → false, 0 updates (negative)
  it('TC-04 moveObject with stale id returns false and emits 0 updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const result = moveObject(doc, 'nonexistent', 10, 20);
      expect(result).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-05: setStickyColor green → applied
  it('TC-05 setStickyColor changes the color', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const result = setStickyColor(doc, id, 'green');
      expect(result).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)[0].color).toBe('green');
  });

  // TC-06: setStickyColor 'teal' → false, unchanged, 0 updates (negative)
  it('TC-06 setStickyColor with invalid colour returns false and emits 0 updates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const result = setStickyColor(doc, id, 'teal');
      expect(result).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-07: deleteObject → removed
  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const result = deleteObject(doc, id);
      expect(result).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08: deleteObject stale id → false, 0 updates (negative)
  it('TC-08 deleteObject with stale id returns false and emits 0 updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      const result = deleteObject(doc, 'nonexistent');
      expect(result).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-09: bringToFront z1 of 3 → z 4
  it('TC-09 bringToFront raises a note to maxZ + 1', () => {
    const doc = newDoc();
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    // id1 has z=1, others z=2 and z=3
    const updates = countUpdates(doc, () => {
      const result = bringToFront(doc, id1);
      expect(result).toBe(true);
    });
    expect(updates).toBe(1);
    const obj = snapshot(doc).find((s) => s.id === id1)!;
    expect(obj.z).toBe(4);
  });

  // TC-10: bringToFront on topmost → no update (negative)
  it('TC-10 bringToFront on topmost note emits 0 updates', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const topId = createSticky(doc, { x: 300, y: 0 });
    // topId already has z=2 (max)
    const updates = countUpdates(doc, () => {
      const result = bringToFront(doc, topId);
      expect(result).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc).find((s) => s.id === topId)!.z).toBe(2);
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  it('TC-11 snapshot sorts equal-z notes by id as tie-break', () => {
    const doc = newDoc();
    // Manually insert two notes with same z to test tie-break
    const objects = objectsMap(doc);
    const obj1 = new Y.Map<unknown>();
    obj1.set('type', 'sticky');
    obj1.set('x', 0);
    obj1.set('y', 0);
    obj1.set('color', 'yellow');
    obj1.set('text', new Y.Text(''));
    obj1.set('z', 1);
    obj1.set('createdAt', 1000);
    const obj2 = new Y.Map<unknown>();
    obj2.set('type', 'sticky');
    obj2.set('x', 100);
    obj2.set('y', 100);
    obj2.set('color', 'blue');
    obj2.set('text', new Y.Text(''));
    obj2.set('z', 1);
    obj2.set('createdAt', 2000);

    doc.transact(() => {
      // Insert with known ids so we can sort by them
      objects.set('zzz-id', obj1);
      objects.set('aaa-id', obj2);
    });

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(2);
    // Sorted by (z, id): same z, so 'aaa-id' < 'zzz-id'
    expect(snaps[0].id).toBe('aaa-id');
    expect(snaps[1].id).toBe('zzz-id');
    // Stable across calls
    const snaps2 = snapshot(doc);
    expect(snaps2[0].id).toBe('aaa-id');
    expect(snaps2[1].id).toBe('zzz-id');
  });

  // TC-12: unknown object type in doc → skipped by snapshot, no throw
  it('TC-12 snapshot skips unknown object types', () => {
    const doc = newDoc();
    const objects = objectsMap(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('z', 1);
    doc.transact(() => {
      objects.set('shape-1', obj);
    });
    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
  });

  // Extra: non-finite coordinates rejected with 0 updates
  it('extra: createSticky with non-finite coordinates throws', () => {
    const doc = newDoc();
    expect(() => createSticky(doc, { x: NaN, y: 0 })).toThrow();
    expect(() => createSticky(doc, { x: 0, y: Infinity })).toThrow();
  });

  // Extra: moveObject with non-finite coordinates returns false
  it('extra: moveObject with non-finite coordinates returns false and 0 updates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, id, NaN, 0)).toBe(false);
      expect(moveObject(doc, id, 0, Infinity)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('extra: initDoc sets meta.schemaVersion = 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    // Calling again does not change it
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(1);
  });

  // Extra: getStickyText returns Y.Text for a valid note
  it('extra: getStickyText returns Y.Text for a sticky note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');
  });

  // Extra: getStickyText returns undefined for stale id
  it('extra: getStickyText returns undefined for stale id', () => {
    const doc = newDoc();
    expect(getStickyText(doc, 'nonexistent')).toBeUndefined();
  });

  // Extra: LOCAL_ORIGIN is a symbol
  it('extra: LOCAL_ORIGIN is defined as a symbol', () => {
    expect(typeof LOCAL_ORIGIN).toBe('symbol');
  });
});
