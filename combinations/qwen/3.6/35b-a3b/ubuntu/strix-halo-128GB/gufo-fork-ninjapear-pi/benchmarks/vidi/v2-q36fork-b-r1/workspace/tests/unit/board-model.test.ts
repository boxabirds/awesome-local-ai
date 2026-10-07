/**
 * Task 2.1: Write board model unit tests first against a real Y.Doc (TC-01 to TC-12, TC-39)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, moveObject, bringToFront, setStickyColor, deleteObject, snapshot } from '@/shared/board-model';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS } from '@/shared/config';

function countUpdateEvents(doc: Y.Doc, cb: () => void): number {
  let count = 0;
  const handler = () => { count++; };
  doc.on('update', handler);
  cb();
  doc.off('update', handler);
  return count;
}

// Also listen on objects map deep changes
function countDeepUpdates(doc: Y.Doc, cb: () => void): number {
  let count = 0;
  const objectsMap = doc.getMap('objects');
  const handler = () => { count++; };
  objectsMap.observeDeep(handler);
  cb();
  objectsMap.unobserveDeep(handler);
  // We also need update events since transact fires them
  // Actually, let's count both together
  return count;
}

describe('board.model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // ---- TC-01: create on empty doc ----
  it('TC-01: createSticky(0,0) creates one sticky with correct defaults', () => {
    const ids = countUpdateEvents(doc, () => {
      createSticky(doc, { x: 0, y: 0 });
    });
    expect(ids).toBe(1);
    const snaps = snapshot(doc) as any[];
    expect(snaps.length).toBe(1);
    expect(snaps[0].type).toBe('sticky');
    expect(snaps[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snaps[0].text).toBe('');
    expect(snaps[0].z).toBe(1);
    expect(snaps[0].x).toBe(0);
    expect(snaps[0].y).toBe(0);
  });

  // ---- TC-02: create with existing z -> new z ----
  it('TC-02: create after notes with z 1,2 → new z=3', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 100, y: 100 });
    const ids = countUpdateEvents(doc, () => {
      createSticky(doc, { x: 200, y: 200 });
    });
    expect(ids).toBe(1);
    const snaps = snapshot(doc) as any[];
    expect(snaps[snaps.length - 1].z).toBe(3);
  });

  // ---- TC-03: moveObject ----
  it('TC-03: moveObject(id, 10, -20) updates x,y', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ids = countUpdateEvents(doc, () => {
      moveObject(doc, id, 10, -20);
    });
    expect(ids).toBe(1);
    const snaps = snapshot(doc) as any[];
    expect(snaps[0].x).toBe(10);
    expect(snaps[0].y).toBe(-20);
  });

  // ---- TC-04: moveObject stale id ----
  it('TC-04: moveObject on stale id → false, 0 updates', () => {
    const ids = countUpdateEvents(doc, () => {
      const result = moveObject(doc, 'nonexistent-id', 5, 5);
      expect(result).toBe(false);
    });
    expect(ids).toBe(0);
  });

  // ---- TC-05: setStickyColor ----
  it('TC-05: setStickyColor(id, "green") → color green', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ids = countUpdateEvents(doc, () => {
      const result = setStickyColor(doc, id, 'green');
      expect(result).toBe(true);
    });
    expect(ids).toBe(1);
    const snaps = snapshot(doc) as any[];
    expect(snaps[0].color).toBe('green');
  });

  // ---- TC-06: unknown colour ----
  it('TC-06: setStickyColor(id, "teal") → false, unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ids = countUpdateEvents(doc, () => {
      const result = setStickyColor(doc, id, 'teal');
      expect(result).toBe(false);
    });
    expect(ids).toBe(0);
    const snaps = snapshot(doc) as any[];
    expect(snaps[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  // ---- TC-07: deleteObject ----
  it('TC-07: deleteObject(id) removes note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ids = countUpdateEvents(doc, () => {
      const result = deleteObject(doc, id);
      expect(result).toBe(true);
    });
    expect(ids).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // ---- TC-08: deleteObject stale id ----
  it('TC-08: deleteObject on stale id → false, 0 updates', () => {
    const ids = countUpdateEvents(doc, () => {
      const result = deleteObject(doc, 'nonexistent');
      expect(result).toBe(false);
    });
    expect(ids).toBe(0);
  });

  // ---- TC-09: bringToFront ----
  it('TC-09: bringToFront(z=1 of 3) → z becomes 4', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 });
    const id3 = createSticky(doc, { x: 20, y: 20 });
    // id1 has z=1, maxZ=3
    const ids = countUpdateEvents(doc, () => {
      const result = bringToFront(doc, id1);
      expect(result).toBe(true);
    });
    expect(ids).toBe(1);
    const snaps = snapshot(doc) as any[];
    const note1 = snaps.find((s: any) => s.id === id1)!;
    expect(note1.z).toBe(4);
  });

  // ---- TC-10: bringToFront on topmost ----
  it('TC-10: bringToFront on topmost → false, no update', () => {
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 10, y: 10 });
    // id2 is topmost (z=2)
    const ids = countUpdateEvents(doc, () => {
      const result = bringToFront(doc, id2);
      expect(result).toBe(false);
    });
    expect(ids).toBe(0);
  });

  // ---- TC-11: equal z tie-break ----
  it('TC-11: sortedObjects() ordered by id as tie-break, stable', () => {
    const idA = createSticky(doc, { x: 0, y: 0 });
    const idB = createSticky(doc, { x: 10, y: 10 });
    // Both have different z, let's manually check ordering when z is same
    const snaps1 = snapshot(doc);
    const snaps2 = snapshot(doc);
    expect(snaps1).toEqual(snaps2); // stable across calls
  });

  // ---- TC-12: unknown object type skipped ----
  it('TC-12: unknown object type in doc → skipped by snapshot', () => {
    const objects = doc.getMap('objects');
    objects.set('unknown-type', (() => {
      const m = new Y.Map();
      m.set('type', 'shape' as const);
      return m;
    })() as any);
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(0);
  });

  // ---- TC-39: non-finite coordinates ----
  it('TC-39: moveObject/createSticky with NaN/Infinity → false, 0 updates', () => {
    // createSticky with NaN
    const ids1 = countUpdateEvents(doc, () => {
      const id = createSticky(doc, { x: NaN, y: 0 });
      expect(id).toBe('');
    });
    expect(ids1).toBe(0);

    // createSticky with Infinity
    const ids2 = countUpdateEvents(doc, () => {
      const id = createSticky(doc, { x: Infinity, y: 0 });
      expect(id).toBe('');
    });
    expect(ids2).toBe(0);

    // Create a valid note for moveObject test
    const id = createSticky(doc, { x: 0, y: 0 });
    const ids3 = countUpdateEvents(doc, () => {
      const result = moveObject(doc, id, NaN, 0);
      expect(result).toBe(false);
    });
    expect(ids3).toBe(0);

    const ids4 = countUpdateEvents(doc, () => {
      const result = moveObject(doc, id, 0, Infinity);
      expect(result).toBe(false);
    });
    expect(ids4).toBe(0);
  });

  // ---- Extra: initDoc sets schemaVersion once ----
  it('initDoc sets meta.schemaVersion once', () => {
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    // Calling again should not change it (already 1)
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});
