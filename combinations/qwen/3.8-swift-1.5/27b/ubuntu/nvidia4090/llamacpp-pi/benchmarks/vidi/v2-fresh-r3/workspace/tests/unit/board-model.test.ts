import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function trackUpdates(doc: Y.Doc) {
  let count = 0;
  let origins: unknown[] = [];
  const fn = (_update: Uint8Array, origin: unknown) => {
    count++;
    origins.push(origin);
  };
  doc.on('update', fn);
  return {
    count: () => count,
    reset: () => {
      count = 0;
      origins = [];
    },
    origins: () => origins,
    dispose: () => doc.off('update', fn),
  };
}

describe('board.model (unit, real Y.Doc)', () => {
  let doc: Y.Doc;
  let updates: ReturnType<typeof trackUpdates>;

  beforeEach(() => {
    doc = makeDoc();
    updates = trackUpdates(doc);
    updates.reset(); // baseline (0)
  });

  afterEach(() => {
    updates.dispose();
  });

  it('initDoc sets meta.schemaVersion once', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    // Calling again must not overwrite or emit an update
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(1);
    expect(updates.count()).toBe(0);
  });

  it('TC-01: create on empty doc → 1 object, sticky, default colour, empty text, z 1, centred; 1 update', () => {
    const at = { x: 100, y: 50 };
    const id = createSticky(doc, at);
    expect(id).toBeTypeOf('string');
    expect(id.length).toBeGreaterThan(0);
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.createdAt).toBeTypeOf('number');
    // Creation is centred on the point: top-left = point − size/2
    expect(note.x).toBe(at.x - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(at.y - STICKY_SIZE_WORLD / 2);
  });

  it('TC-02: create with existing z 1,2 → new z 3', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });
    const id = createSticky(doc, { x: 20, y: 20 });
    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.z).toBe(3);
  });

  it('TC-03: moveObject updates x,y only; other fields unchanged; 1 update', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc)[0];
    updates.reset();

    const ok = moveObject(doc, id, 10, -20);
    expect(ok).toBe(true);
    expect(updates.count()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.text).toBe(before.text);
  });

  it('TC-04: moveObject on stale id → false, 0 updates (negative)', () => {
    expect(moveObject(doc, 'does-not-exist', 1, 2)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-05: setStickyColor green → applied; text, x, y, z unchanged; 1 update', () => {
    const id = createSticky(doc, { x: 30, y: 40 });
    const before = snapshot(doc)[0];
    updates.reset();

    const ok = setStickyColor(doc, id, 'green');
    expect(ok).toBe(true);
    expect(updates.count()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it('TC-06: setStickyColor with unknown colour → false, unchanged, 0 updates (negative)', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-07: deleteObject removes the note; 1 update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();

    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08: deleteObject on stale id → false, 0 updates (negative)', () => {
    expect(deleteObject(doc, 'does-not-exist')).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('TC-09: bringToFront on z 1 of 3 → z 4; 1 update', () => {
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 1, y: 0 }); // z 2
    createSticky(doc, { x: 2, y: 0 }); // z 3
    updates.reset();

    expect(bringToFront(doc, a)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
  });

  it('TC-10: bringToFront on topmost note → false, no update (negative)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 0 }); // topmost
    updates.reset();

    expect(bringToFront(doc, b)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc).find((n) => n.id === b)!.z).toBe(2);
    // Sanity: the non-topmost one still works
    expect(bringToFront(doc, a)).toBe(true);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(3);
  });

  it('TC-11: equal z → snapshot sorted by id tie-break, stable across calls', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 0 });
    // Force equal z directly on the doc (what story 3 concurrent sync may produce)
    doc.transact(() => {
      (doc.getMap('objects').get(b) as Y.Map<unknown>).set('z', 1);
    });

    const [first, second] = [snapshot(doc), snapshot(doc)];
    const expected = [a, b].sort();
    expect(first.map((n) => n.id)).toEqual(expected);
    expect(second.map((n) => n.id)).toEqual(expected);
    // z order is the primary key
    expect(first[0].z).toBeLessThanOrEqual(first[1].z);
  });

  it('TC-12: unknown object type in doc → skipped by snapshot, no throw', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const objects = doc.getMap('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 5);
      shape.set('y', 6);
      objects.set('shape-1', shape);
    });

    expect(() => snapshot(doc)).not.toThrow();
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(notes[0].type).toBe('sticky');
  });

  it('TC-39: createSticky / moveObject with NaN or Infinity coordinates → false, 0 updates (negative)', () => {
    const bad = [NaN, Infinity, -Infinity];
    for (const v of bad) {
      expect(createSticky(doc, { x: v, y: 0 })).toBe('');
      expect(createSticky(doc, { x: 0, y: v })).toBe('');
    }
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);

    // Centred at (100,100) → top-left (0,0)
    const id = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    updates.reset();
    for (const v of bad) {
      expect(moveObject(doc, id, v, 0)).toBe(false);
      expect(moveObject(doc, id, 0, v)).toBe(false);
    }
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0].x).toBe(0);
    expect(snapshot(doc)[0].y).toBe(0);
  });

  it('getStickyText returns the Y.Text for a note and undefined for stale/unknown ids', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    text!.insert(0, 'hi');
    expect(snapshot(doc)[0].text).toBe('hi');
    expect(getStickyText(doc, 'nope')).toBeUndefined();
  });
});
