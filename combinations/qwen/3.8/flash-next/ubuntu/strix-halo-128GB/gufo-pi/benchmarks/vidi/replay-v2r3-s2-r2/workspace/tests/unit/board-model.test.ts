import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
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
  type StickyColor,
} from '../../src/shared/config';

/** Count `update` events emitted by a doc. */
function updateCounter(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

describe('board.model', () => {
  describe('create', () => {
    it('TC-01: creates a yellow sticky centred on the point with z 1 on an empty doc', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const updates = updateCounter(doc);

      const point = { x: 300, y: 200 };
      const id = createSticky(doc, point);

      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      const note = snap[0];
      expect(note.id).toBe(id);
      expect(note.type).toBe('sticky');
      expect(note.color).toBe(DEFAULT_STICKY_COLOR);
      expect(note.text).toBe('');
      expect(note.z).toBe(1);
      // centred: top-left = point - half size
      expect(note.x).toBe(point.x - STICKY_SIZE_WORLD / 2);
      expect(note.y).toBe(point.y - STICKY_SIZE_WORLD / 2);
      expect(typeof note.createdAt).toBe('number');
      expect(updates()).toBe(1);
    });

    it('TC-02: new note takes z = maxZ + 1', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);

      const id = createSticky(doc, { x: 0, y: 0 });
      const note = snapshot(doc).find((n) => n.id === id)!;
      expect(note.z).toBe(3);
      expect(updates()).toBe(1);
    });
  });

  describe('move', () => {
    it('TC-03: moveObject updates x,y and leaves other fields unchanged', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 100, y: 100 }, 'blue');
      setStickyColor(doc, id, 'green');
      const before = snapshot(doc).find((n) => n.id === id)!;
      const updates = updateCounter(doc);

      const ok = moveObject(doc, id, 10, -20);
      expect(ok).toBe(true);

      const after = snapshot(doc).find((n) => n.id === id)!;
      expect(after.x).toBe(10);
      expect(after.y).toBe(-20);
      expect(after.color).toBe(before.color);
      expect(after.text).toBe(before.text);
      expect(after.z).toBe(before.z);
      expect(after.createdAt).toBe(before.createdAt);
      expect(updates()).toBe(1);
    });

    it('TC-04: moveObject on a stale id returns false and emits 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const updates = updateCounter(doc);

      const ok = moveObject(doc, 'does-not-exist', 5, 5);
      expect(ok).toBe(false);
      expect(updates()).toBe(0);
    });
  });

  describe('colour', () => {
    it('TC-05: setStickyColor applies colour and leaves text, x, y, z unchanged', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 40, y: 60 });
      const ytext = getStickyText(doc, id)!;
      ytext.insert(0, 'Faster onboarding');
      const before = snapshot(doc).find((n) => n.id === id)!;
      const updates = updateCounter(doc);

      const ok = setStickyColor(doc, id, 'green');
      expect(ok).toBe(true);

      const after = snapshot(doc).find((n) => n.id === id)!;
      expect(after.color).toBe('green');
      expect(after.text).toBe(before.text);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.z).toBe(before.z);
      expect(updates()).toBe(1);
    });

    it('TC-06: setStickyColor with an unknown colour returns false and emits 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);

      const ok = setStickyColor(doc, id, 'teal');
      expect(ok).toBe(false);
      expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
      expect(updates()).toBe(0);
    });
  });

  describe('delete', () => {
    it('TC-07: deleteObject removes the note', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);

      const ok = deleteObject(doc, id);
      expect(ok).toBe(true);
      expect(snapshot(doc)).toHaveLength(0);
      expect(objectsMap(doc).size).toBe(0);
      expect(updates()).toBe(1);
    });

    it('TC-08: deleteObject on a stale id returns false and emits 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const updates = updateCounter(doc);

      const ok = deleteObject(doc, 'does-not-exist');
      expect(ok).toBe(false);
      expect(updates()).toBe(0);
    });
  });

  describe('stacking', () => {
    it('TC-09: bringToFront moves the bottom note (z 1 of 3) to z 4', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const a = createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);

      const ok = bringToFront(doc, a);
      expect(ok).toBe(true);
      const note = snapshot(doc).find((n) => n.id === a)!;
      expect(note.z).toBe(4);
      expect(updates()).toBe(1);
    });

    it('TC-10: bringToFront on the topmost note returns false and emits 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });
      const top = createSticky(doc, { x: 0, y: 0 });
      const updates = updateCounter(doc);

      const ok = bringToFront(doc, top);
      expect(ok).toBe(false);
      expect(updates()).toBe(0);
    });

    it('TC-11: snapshot breaks z ties by id, stable across calls', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const a = createSticky(doc, { x: 0, y: 0 });
      const b = createSticky(doc, { x: 0, y: 0 });
      // Force equal z by writing b down to a's z directly.
      const objects = objectsMap(doc);
      const bMap = objects.get(b)!;
      bMap.set('z', (objects.get(a)!.get('z') as number));

      const first = snapshot(doc).map((n) => n.id);
      const second = snapshot(doc).map((n) => n.id);
      const expected = [a, b].sort();
      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
    });
  });

  describe('read', () => {
    it('TC-12: snapshot skips objects with an unknown type without throwing', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 0, y: 0 });

      // Insert a foreign object type (forward compatibility for stories 9-12).
      const objects = objectsMap(doc);
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('z', 99);
      objects.set('shape-1', shape);

      const snap = snapshot(doc);
      expect(snap).toHaveLength(1);
      expect(snap[0].type).toBe('sticky');
    });
  });

  describe('initDoc', () => {
    it('sets meta.schemaVersion to 1 exactly once', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const meta = doc.getMap('meta');
      expect(meta.get('schemaVersion')).toBe(1);

      const updates = updateCounter(doc);
      initDoc(doc);
      expect(meta.get('schemaVersion')).toBe(1);
      expect(updates()).toBe(0);
    });
  });

  describe('coordinate validation', () => {
    it('TC-39: moveObject with non-finite coordinates returns false and emits 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const before = snapshot(doc)[0];
      const updates = updateCounter(doc);

      expect(moveObject(doc, id, NaN, 0)).toBe(false);
      expect(moveObject(doc, id, 0, NaN)).toBe(false);
      expect(moveObject(doc, id, Infinity, 0)).toBe(false);
      expect(moveObject(doc, id, 0, -Infinity)).toBe(false);
      expect(updates()).toBe(0);
      const after = snapshot(doc)[0];
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
    });

    it('TC-39: createSticky with non-finite coordinates rejects with an empty id and 0 updates', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const updates = updateCounter(doc);

      let threw = false;
      let id: string | undefined;
      try {
        id = createSticky(doc, { x: NaN, y: 0 });
      } catch {
        threw = true;
      }
      // Contract: never throws for user input; rejects without a transaction and
      // returns an empty (falsy) id since no object was created.
      expect(threw).toBe(false);
      expect(id).toBe('');
      expect(snapshot(doc)).toHaveLength(0);
      expect(updates()).toBe(0);
    });
  });

  it('exposes LOCAL_ORIGIN as a unique symbol', () => {
    expect(typeof LOCAL_ORIGIN).toBe('symbol');
  });
});
