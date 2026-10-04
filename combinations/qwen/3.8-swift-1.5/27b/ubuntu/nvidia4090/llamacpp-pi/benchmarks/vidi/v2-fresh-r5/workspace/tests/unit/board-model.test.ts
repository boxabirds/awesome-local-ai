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
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): { count: number; reset(): void } {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  return {
    get count() { return count; },
    reset() { count = 0; },
  };
}

describe('board-model', () => {
  let doc: Y.Doc;
  let updates: { count: number; reset(): void };

  beforeEach(() => {
    doc = makeDoc();
    updates = countUpdates(doc);
  });

  // TC-01: create on empty doc
  it('TC-01: createSticky on empty doc creates 1 object with correct defaults', () => {
    const id = createSticky(doc, { x: 100, y: 200 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].type).toBe('sticky');
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
    // Centred: top-left = point - size/2
    expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(200 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].createdAt).toBeTypeOf('number');
  });

  // TC-02: create with existing z 1,2 → new z 3
  it('TC-02: createSticky with existing notes assigns z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 50 });
    updates.reset();
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const note = snap.find(n => n.id === id)!;
    expect(note.z).toBe(3);
  });

  // TC-03: moveObject updates x,y, other fields unchanged
  it('TC-03: moveObject updates position, other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    const result = moveObject(doc, id, 10, -20);
    expect(result).toBe(true);
    expect(updates.count).toBe(1);

    const snap = snapshot(doc);
    expect(snap[0].x).toBe(10);
    expect(snap[0].y).toBe(-20);
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
  });

  // TC-04: moveObject on stale id → false, 0 updates
  it('TC-04: moveObject on stale id returns false, no updates', () => {
    updates.reset();
    const result = moveObject(doc, 'nonexistent-id', 10, 20);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // TC-05: setStickyColor green → applied, other fields unchanged
  it('TC-05: setStickyColor applies colour, other fields unchanged', () => {
    const id = createSticky(doc, { x: 10, y: 20 });
    updates.reset();
    const result = setStickyColor(doc, id, 'green');
    expect(result).toBe(true);
    expect(updates.count).toBe(1);

    const snap = snapshot(doc);
    expect(snap[0].color).toBe('green');
    expect(snap[0].x).toBe(10 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(20 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
  });

  // TC-06: setStickyColor 'teal' (unknown) → false, unchanged, 0 updates
  it('TC-06: setStickyColor with unknown colour returns false, no updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    const result = setStickyColor(doc, id, 'teal');
    expect(result).toBe(false);
    expect(updates.count).toBe(0);

    const snap = snapshot(doc);
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-07: deleteObject removes the note
  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    updates.reset();
    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(updates.count).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08: deleteObject on stale id → false, 0 updates
  it('TC-08: deleteObject on stale id returns false, no updates', () => {
    updates.reset();
    const result = deleteObject(doc, 'nonexistent-id');
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // TC-09: bringToFront z1 of 3 → z 4
  it('TC-09: bringToFront on bottom note raises it to top', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    createSticky(doc, { x: 100, y: 0 });
    // id1 has z=1
    updates.reset();
    const result = bringToFront(doc, id1);
    expect(result).toBe(true);
    expect(updates.count).toBe(1);

    const snap = snapshot(doc);
    const note = snap.find(n => n.id === id1)!;
    expect(note.z).toBe(4);
  });

  // TC-10: bringToFront on topmost → no update
  it('TC-10: bringToFront on already-topmost note returns false, no updates', () => {
    createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 0 });
    // id2 has z=2 (topmost)
    updates.reset();
    const result = bringToFront(doc, id2);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  it('TC-11: snapshot sorts by (z, id) with stable tie-break', () => {
    // Create notes and set them to equal z manually
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 50, y: 0 });
    // Both have different z (1 and 2). Set them equal.
    const objects = doc.getMap('objects');
    const map1 = objects.get(id1) as Y.Map<unknown>;
    const map2 = objects.get(id2) as Y.Map<unknown>;
    doc.transact(() => {
      map1.set('z', 5);
      map2.set('z', 5);
    });

    const snap1 = snapshot(doc);
    const snap2 = snapshot(doc);
    // Should be sorted by id when z is equal
    expect(snap1[0].id).toBe(snap2[0].id);
    expect(snap1[1].id).toBe(snap2[1].id);
    // Sorted by id ascending
    expect(snap1[0].id < snap1[1].id).toBe(true);
  });

  // TC-12: unknown object type in doc → skipped by snapshot, no throw
  it('TC-12: snapshot skips unknown object types without throwing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    // Add an unknown type object
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const fake = new Y.Map<unknown>();
      fake.set('type', 'shape');
      fake.set('x', 0);
      fake.set('y', 0);
      objects.set('fake-id', fake);
    });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
  });

  // TC-39: moveObject and createSticky with NaN / Infinity → false, 0 updates
  it('TC-39a: createSticky with NaN coordinates returns false-ish (no object created)', () => {
    updates.reset();
    // createSticky should reject non-finite coordinates
    createSticky(doc, { x: NaN, y: 0 });
    // Should not create a note
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates.count).toBe(0);
  });

  it('TC-39b: createSticky with Infinity coordinates creates no object', () => {
    updates.reset();
    createSticky(doc, { x: Infinity, y: 0 });
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates.count).toBe(0);
  });

  it('TC-39c: moveObject with NaN coordinates returns false, no updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    const result = moveObject(doc, id, NaN, 0);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('TC-39d: moveObject with Infinity coordinates returns false, no updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    const result = moveObject(doc, id, 0, -Infinity);
    expect(result).toBe(false);
    expect(updates.count).toBe(0);
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('initDoc sets meta.schemaVersion to 1', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('initDoc does not overwrite existing schemaVersion', () => {
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 99);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(99);
  });

  // getStickyText
  it('getStickyText returns Y.Text for existing note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
  });

  it('getStickyText returns undefined for unknown id', () => {
    const text = getStickyText(doc, 'nonexistent');
    expect(text).toBeUndefined();
  });
});
