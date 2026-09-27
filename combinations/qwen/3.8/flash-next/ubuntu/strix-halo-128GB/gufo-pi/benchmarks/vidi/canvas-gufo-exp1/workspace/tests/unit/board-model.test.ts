/**
 * Unit tests for the board document model against a real Y.Doc (TC-01 to TC-12).
 * Every mutation test also counts `update` events: exactly 1 on success, 0 on
 * rejection, because rejections must never produce sync traffic (story 3).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** Count `update` events emitted while `fn` runs. */
const countUpdates = (doc: Y.Doc, fn: () => void): number => {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return count;
};

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

describe('initDoc', () => {
  it('sets meta.schemaVersion to 1 once and leaves it alone afterwards', () => {
    const doc = new Y.Doc();
    expect(countUpdates(doc, () => initDoc(doc))).toBe(1);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    // Second call is a no-op: no further update.
    expect(countUpdates(doc, () => initDoc(doc))).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });
});

describe('createSticky', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-01: creates a yellow sticky centred on the point as the first object', () => {
    let id = '';
    expect(countUpdates(doc, () => {
      id = createSticky(doc, { x: 0, y: 0 });
    })).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Creation is centred: the stored top-left is the point minus half the size.
    expect(note.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2);
    expect(typeof note.createdAt).toBe('number');
    expect(getStickyText(doc, id)?.toString()).toBe('');
  });

  it('TC-02: new notes stack above existing ones (z = maxZ + 1)', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const before = snapshot(doc).map((n) => n.z).sort((a, b) => a - b);
    expect(before).toEqual([1, 2]);
    expect(countUpdates(doc, () => createSticky(doc, { x: 600, y: 0 }))).toBe(1);
    const zs = snapshot(doc).map((n) => n.z).sort((a, b) => a - b);
    expect(zs).toEqual([1, 2, 3]);
  });

  it('rejects non-finite coordinates with no update', () => {
    const before = objectsOf(doc).size;
    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
      { x: Number.NEGATIVE_INFINITY, y: 0 },
    ]) {
      let id: string | null = null;
      let threw = false;
      const updates = countUpdates(doc, () => {
        try {
          id = createSticky(doc, point);
        } catch {
          threw = true;
        }
      });
      expect(threw, `point ${JSON.stringify(point)} must not throw`).toBe(false);
      // A rejected create returns a falsy id and opens no transaction.
      expect(id, `point ${JSON.stringify(point)} must not create a note`).toBeFalsy();
      expect(updates).toBe(0);
    }
    expect(objectsOf(doc).size).toBe(before);
  });
});

describe('moveObject', () => {
  let doc: Y.Doc;
  let id: string;
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 0, y: 0 });
  });

  it('TC-03: updates x,y and leaves every other field unchanged', () => {
    expect(countUpdates(doc, () => moveObject(doc, id, 10, -20))).toBe(1);
    const note = snapshot(doc)[0];
    expect(note.x).toBe(10);
    expect(note.y).toBe(-20);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.createdAt).toBeGreaterThan(0);
  });

  it('TC-04: a stale id returns false and emits no update', () => {
    const before = Y.encodeStateVector(doc);
    expect(moveObject(doc, 'missing-id', 5, 5)).toBe(false);
    // The state vector is unchanged: no update ever reached the document.
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('rejects non-finite coordinates with no update', () => {
    expect(countUpdates(doc, () => moveObject(doc, id, Number.NaN, 5))).toBe(0);
    expect(countUpdates(doc, () => moveObject(doc, id, 5, Number.POSITIVE_INFINITY))).toBe(0);
    expect(snapshot(doc)[0].x).not.toBe(Number.NaN);
  });
});

describe('setStickyColor', () => {
  let doc: Y.Doc;
  let id: string;
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 0, y: 0 });
  });

  it('TC-05: applies a valid colour', () => {
    expect(countUpdates(doc, () => setStickyColor(doc, id, 'green'))).toBe(1);
    expect(snapshot(doc)[0].color).toBe('green');
  });

  it('TC-06: an unknown colour returns false, changes nothing, emits no update', () => {
    expect(countUpdates(doc, () => setStickyColor(doc, id, 'teal'))).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('rejects a stale id with no update', () => {
    expect(countUpdates(doc, () => setStickyColor(doc, 'missing-id', 'blue'))).toBe(0);
  });
});

describe('deleteObject', () => {
  let doc: Y.Doc;
  let id: string;
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 0, y: 0 });
  });

  it('TC-07: removes the note', () => {
    expect(snapshot(doc)).toHaveLength(1);
    expect(countUpdates(doc, () => deleteObject(doc, id))).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsOf(doc).size).toBe(0);
  });

  it('TC-08: a stale id returns false and emits no update', () => {
    expect(countUpdates(doc, () => deleteObject(doc, 'missing-id'))).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('bringToFront', () => {
  it('TC-09: a bottom note gets maxZ + 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(1);
    expect(countUpdates(doc, () => bringToFront(doc, a))).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)?.z).toBe(4);
  });

  it('TC-10: bringing the topmost note forward is a no-op with no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });
    expect(countUpdates(doc, () => bringToFront(doc, top))).toBe(0);
    expect(snapshot(doc).find((n) => n.id === top)?.z).toBe(2);
  });

  it('rejects a stale id with no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    expect(countUpdates(doc, () => bringToFront(doc, 'missing-id'))).toBe(0);
  });
});

describe('snapshot', () => {
  it('TC-11: notes with equal z are ordered by id (stable across calls)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Force two notes to the same z by writing the map directly.
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      for (const id of ['c', 'a', 'b']) {
        const map = new Y.Map<unknown>();
        map.set('type', 'sticky');
        map.set('x', 0);
        map.set('y', 0);
        map.set('color', 'yellow');
        map.set('text', new Y.Text());
        map.set('z', 1);
        map.set('createdAt', 0);
        objects.set(id, map);
      }
    });
    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(['a', 'b', 'c']);
    expect(second).toEqual(first);
  });

  it('TC-12: objects of an unknown type are skipped without throwing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const sticky = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 50);
      shape.set('y', 50);
      objects.set('shape-1', shape);
    });
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(sticky);
  });

  it('keeps a stable id order when a note is raised, so the DOM is never re-ordered', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    const b = createSticky(doc, { x: 300, y: 0 }); // z 2
    const sorted = [a, b].sort();
    expect(snapshot(doc).map((n) => n.id)).toEqual(sorted);
    bringToFront(doc, a); // z 3 — depth changes, list order does not
    const after = snapshot(doc);
    expect(after.map((n) => n.id)).toEqual(sorted);
    expect(after.find((n) => n.id === a)!.z).toBe(3);
    expect(after.find((n) => n.id === b)!.z).toBe(2);
  });
});
