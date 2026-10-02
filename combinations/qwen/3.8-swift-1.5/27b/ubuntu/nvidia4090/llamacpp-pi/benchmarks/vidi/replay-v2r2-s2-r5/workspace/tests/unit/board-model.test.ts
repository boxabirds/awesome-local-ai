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

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function trackUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  return () => count;
}

describe('board-model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-01: create on empty doc
  it('TC-01: createSticky on empty doc creates 1 object with correct defaults', () => {
    const getUpdates = trackUpdates(doc);
    const id = createSticky(doc, { x: 100, y: 200 });
    expect(getUpdates()).toBe(1);

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].type).toBe('sticky');
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
    // Creation centred: top-left = point - STICKY_SIZE_WORLD/2
    expect(snap[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap[0].y).toBe(200 - STICKY_SIZE_WORLD / 2);
  });

  // TC-02: create with existing z 1,2 → new z 3
  it('TC-02: createSticky with existing notes gives z = maxZ + 1', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    const id3 = createSticky(doc, { x: 20, y: 20 });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(3);

    const note3 = snap.find((s) => s.id === id3)!;
    expect(note3.z).toBe(3);
  });

  // TC-03: moveObject → x,y updated, other fields unchanged
  it('TC-03: moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc).find((s) => s.id === id)!;

    const getUpdates = trackUpdates(doc);
    const result = moveObject(doc, id, 10, -20);
    expect(getUpdates()).toBe(1);
    expect(result).toBe(true);

    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
  });

  // TC-04: moveObject stale id → false, 0 updates
  it('TC-04: moveObject on stale id returns false with 0 updates', () => {
    const getUpdates = trackUpdates(doc);
    const result = moveObject(doc, 'nonexistent-id', 10, 20);
    expect(result).toBe(false);
    expect(getUpdates()).toBe(0);
  });

  // TC-05: setStickyColor green → applied; text, x, y, z unchanged
  it('TC-05: setStickyColor changes colour and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 5, y: 6 });
    const before = snapshot(doc).find((s) => s.id === id)!;

    const getUpdates = trackUpdates(doc);
    const result = setStickyColor(doc, id, 'green');
    expect(getUpdates()).toBe(1);
    expect(result).toBe(true);

    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.color).toBe('green');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
  });

  // TC-06: setStickyColor 'teal' → false, unchanged, 0 updates
  it('TC-06: setStickyColor with unknown colour returns false with 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const getUpdates = trackUpdates(doc);
    const result = setStickyColor(doc, id, 'teal');
    expect(result).toBe(false);
    expect(getUpdates()).toBe(0);

    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.color).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-07: deleteObject → removed
  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const getUpdates = trackUpdates(doc);
    const result = deleteObject(doc, id);
    expect(getUpdates()).toBe(1);
    expect(result).toBe(true);

    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08: deleteObject stale id → false, 0 updates
  it('TC-08: deleteObject on stale id returns false with 0 updates', () => {
    const getUpdates = trackUpdates(doc);
    const result = deleteObject(doc, 'nonexistent-id');
    expect(result).toBe(false);
    expect(getUpdates()).toBe(0);
  });

  // TC-09: bringToFront z1 of 3 → z 4
  it('TC-09: bringToFront on bottom note gives it z = maxZ + 1', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    createSticky(doc, { x: 20, y: 20 });

    // id1 has z=1
    const getUpdates = trackUpdates(doc);
    const result = bringToFront(doc, id1);
    expect(getUpdates()).toBe(1);
    expect(result).toBe(true);

    const snap = snapshot(doc);
    const note1 = snap.find((s) => s.id === id1)!;
    expect(note1.z).toBe(4);
  });

  // TC-10: bringToFront on topmost → no update
  it('TC-10: bringToFront on topmost note returns false with 0 updates', () => {
    createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 }); // z=2, topmost

    const getUpdates = trackUpdates(doc);
    const result = bringToFront(doc, id2);
    expect(result).toBe(false);
    expect(getUpdates()).toBe(0);
  });

  // TC-11: equal z → snapshot sorted by id tie-break, stable
  it('TC-11: snapshot sorts by (z, id) with id as tie-break for equal z', () => {
    // Create two notes and manually set them to the same z
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 });

    // Set both to z=1 to simulate equal z
    const objects = doc.getMap('objects');
    const obj1 = objects.get(id1) as Y.Map<unknown>;
    const obj2 = objects.get(id2) as Y.Map<unknown>;
    doc.transact(() => {
      obj1.set('z', 1);
      obj2.set('z', 1);
    });

    const snap1 = snapshot(doc);
    const snap2 = snapshot(doc);

    // Should be sorted by id when z is equal
    expect(snap1[0].id).toBe(snap1[0].id < snap1[1].id ? snap1[0].id : snap1[1].id);
    expect(snap1[0].id <= snap1[1].id).toBe(true);

    // Stable across calls
    expect(snap1[0].id).toBe(snap2[0].id);
    expect(snap1[1].id).toBe(snap2[1].id);
  });

  // TC-12: unknown object type in doc → skipped by snapshot, no throw
  it('TC-12: snapshot skips unknown object types without throwing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });

    // Add an unknown type object
    const objects = doc.getMap('objects');
    doc.transact(() => {
      const shapeMap = new Y.Map<unknown>();
      shapeMap.set('type', 'shape');
      shapeMap.set('x', 5);
      shapeMap.set('y', 5);
      objects.set('shape-1', shapeMap);
    });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].type).toBe('sticky');
  });

  // TC-39: moveObject and createSticky with NaN / Infinity → false, 0 updates
  it('TC-39: moveObject with NaN coordinates returns false with 0 updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const getUpdates = trackUpdates(doc);
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, NaN)).toBe(false);
    expect(moveObject(doc, id, Infinity, 0)).toBe(false);
    expect(moveObject(doc, id, 0, -Infinity)).toBe(false);
    expect(getUpdates()).toBe(0);
  });

  it('TC-39: createSticky with NaN/Infinity coordinates returns empty string with 0 updates', () => {
    const getUpdates = trackUpdates(doc);
    expect(createSticky(doc, { x: NaN, y: 0 })).toBe('');
    expect(createSticky(doc, { x: 0, y: Infinity })).toBe('');
    expect(getUpdates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('initDoc sets meta.schemaVersion to 1', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('initDoc is idempotent', () => {
    initDoc(doc);
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
  });

  // getStickyText
  it('getStickyText returns the Y.Text for a note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
  });

  it('getStickyText returns undefined for unknown id', () => {
    expect(getStickyText(doc, 'nonexistent')).toBeUndefined();
  });
});
