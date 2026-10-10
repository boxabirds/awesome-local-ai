import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor
} from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function countUpdates(doc: Y.Doc): { count(): number; stop(): void } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  return { count: () => updates, stop: () => doc.off('update', listener) };
}

describe('board.model create', () => {
  test('TC-01: createSticky on empty doc adds one yellow sticky centred on the point with z 1', () => {
    const doc = newDoc();
    const tracker = countUpdates(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(tracker.count()).toBe(1);

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    const note = snaps[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.color).toBe('yellow');
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Creation centres the note on the given point.
    expect(note.x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(STICKY_COLORS[note.color]).toBeTruthy();
  });

  test('TC-02: createSticky stacks on top of existing notes (z 1,2 → new z 3)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const tracker = countUpdates(doc);
    const id = createSticky(doc, { x: 600, y: 0 });
    expect(tracker.count()).toBe(1);
    const note = snapshot(doc).find((n) => n.id === id);
    expect(note?.z).toBe(3);
    expect(snapshot(doc)).toHaveLength(3);
  });
});

describe('board.model move', () => {
  test('TC-03: moveObject updates x,y and leaves other fields unchanged', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    setStickyColor(doc, id, 'green');
    getStickyText(doc, id)?.insert(0, 'keep me');
    const before = snapshot(doc).find((n) => n.id === id);
    if (before === undefined) throw new Error('note missing');

    const tracker = countUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(tracker.count()).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id);
    expect(after).toBeDefined();
    expect(after?.x).toBe(10);
    expect(after?.y).toBe(-20);
    expect(after?.color).toBe(before.color);
    expect(after?.text).toBe(before.text);
    expect(after?.z).toBe(before.z);
    expect(after?.createdAt).toBe(before.createdAt);
  });

  test('TC-04: moveObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const tracker = countUpdates(doc);
    expect(moveObject(doc, 'missing-id', 5, 5)).toBe(false);
    expect(tracker.count()).toBe(0);
    // And on an emptied doc too.
    const id = snapshot(doc)[0].id;
    deleteObject(doc, id);
    const afterDelete = countUpdates(doc);
    expect(moveObject(doc, id, 5, 5)).toBe(false);
    expect(afterDelete.count()).toBe(0);
  });

  test('TC-39: moveObject and createSticky reject non-finite coordinates with no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc);

    const tracker = countUpdates(doc);
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, NaN)).toBe(false);
    expect(moveObject(doc, id, Infinity, 0)).toBe(false);
    expect(moveObject(doc, id, 0, -Infinity)).toBe(false);
    // createSticky rejects non-finite points as well (throws a TypeError; the
    // UI never produces such input — see NOTES.md).
    expect(() => createSticky(doc, { x: NaN, y: 0 })).toThrow(TypeError);
    expect(() => createSticky(doc, { x: 0, y: Infinity })).toThrow(TypeError);
    expect(tracker.count()).toBe(0);

    expect(snapshot(doc)).toEqual(before);
    for (const note of snapshot(doc)) {
      expect(Number.isFinite(note.x)).toBe(true);
      expect(Number.isFinite(note.y)).toBe(true);
    }
  });
});

describe('board.model colour', () => {
  test('TC-05: setStickyColor applies a known colour and changes nothing else', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 40, y: 60 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    const before = snapshot(doc).find((n) => n.id === id);
    if (before === undefined) throw new Error('note missing');
    expect(before.color).toBe('yellow');

    const tracker = countUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(tracker.count()).toBe(1);

    const after = snapshot(doc).find((n) => n.id === id);
    expect(after?.color).toBe('green');
    expect(after?.text).toBe(before.text);
    expect(after?.x).toBe(before.x);
    expect(after?.y).toBe(before.y);
    expect(after?.z).toBe(before.z);
  });

  test('TC-05b: every one of the six preset colours is accepted', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    // Rotate so consecutive calls always change the colour (a no-op set
    // returns false per the contract).
    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    const order = [...colors.slice(1), colors[0]];
    for (const color of order) {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(snapshot(doc).find((n) => n.id === id)?.color).toBe(color);
    }
    // Setting the current colour again is a no-op.
    expect(setStickyColor(doc, id, 'yellow')).toBe(false);
  });

  test('TC-06: setStickyColor with an unknown colour returns false and writes nothing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const tracker = countUpdates(doc);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, '')).toBe(false);
    expect(setStickyColor(doc, id, '#FFF59D')).toBe(false);
    expect(tracker.count()).toBe(0);
    expect(snapshot(doc).find((n) => n.id === id)?.color).toBe('yellow');
  });
});

describe('board.model delete', () => {
  test('TC-07: deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(objectsMap(doc).size).toBe(1);
    const tracker = countUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(tracker.count()).toBe(1);
    expect(objectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  test('TC-08: deleteObject on a stale id returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const tracker = countUpdates(doc);
    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(tracker.count()).toBe(0);
    expect(objectsMap(doc).size).toBe(1);
  });
});

describe('board.model stacking', () => {
  test('TC-09: bringToFront on the bottom note of three raises it above the top (z 1 → 4)', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const tracker = countUpdates(doc);
    expect(bringToFront(doc, first)).toBe(true);
    expect(tracker.count()).toBe(1);
    const note = snapshot(doc).find((n) => n.id === first);
    expect(note?.z).toBe(4);
    const zs = snapshot(doc).map((n) => n.z);
    expect(zs[zs.length - 1]).toBe(4);
  });

  test('TC-10: bringToFront on the topmost note returns false and emits no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const tracker = countUpdates(doc);
    expect(bringToFront(doc, top)).toBe(false);
    expect(tracker.count()).toBe(0);
    expect(snapshot(doc).find((n) => n.id === top)?.z).toBe(2);
    expect(bringToFront(doc, 'missing-id')).toBe(false);
    expect(tracker.count()).toBe(0);
  });

  test('TC-11: equal z values are ordered by id as a stable tie-break', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    // Force equal z as could happen with concurrent creators in story 3.
    objectsMap(doc).get(a)?.set('z', 7);
    objectsMap(doc).get(b)?.set('z', 7);
    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(second);
    const expected = [a, b].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    expect(first).toEqual(expected);
  });
});

describe('board.model read', () => {
  test('TC-12: snapshot skips objects with an unknown type and does not throw', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 5);
    objectsMap(doc).set('shape-1', shape);
    expect(() => snapshot(doc)).not.toThrow();
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(id);
  });

  test('initDoc sets meta.schemaVersion once and is idempotent', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    const tracker = countUpdates(doc);
    initDoc(doc);
    initDoc(doc);
    expect(tracker.count()).toBe(0);
    expect(meta.get('schemaVersion')).toBe(1);
  });
});
