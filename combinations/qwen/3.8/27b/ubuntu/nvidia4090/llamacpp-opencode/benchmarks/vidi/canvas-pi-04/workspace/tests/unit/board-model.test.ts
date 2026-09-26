// Story 2, task 2.1: board.model unit tests (TC-01 to TC-12 + extras).
//
// These run against a REAL Y.Doc (no mocks): Yjs is the store under test and
// is deterministic in-process. Every mutation test also counts `update`
// events: exactly 1 on success, 0 on rejection.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
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
  type StickySnapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** A fresh, initialised document. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Run `fn` and count the `update` events it emits on `doc`. */
function updatesIn(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return updates;
}

/** The single sticky in the snapshot (throws a readable error otherwise). */
function onlySticky(doc: Y.Doc): StickySnapshot {
  const snap = snapshot(doc);
  expect(snap, `expected exactly 1 sticky, got ${snap.length}`).toHaveLength(1);
  return snap[0];
}

/** Overwrite an object's z directly, simulating a concurrent (story 3) state. */
function setZ(doc: Y.Doc, id: string, z: number): void {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  expect(obj).toBeInstanceOf(Y.Map);
  obj?.set('z', z);
}

describe('board.model: init', () => {
  it('initDoc sets meta.schemaVersion once (extra)', () => {
    const doc = new Y.Doc();
    const first = updatesIn(doc, () => initDoc(doc));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(first).toBe(1);

    const second = updatesIn(doc, () => initDoc(doc));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(second).toBe(0);
  });
});

describe('board.model: createSticky', () => {
  it('TC-01 create on empty doc: yellow, empty text, z 1, centred on the point', () => {
    const doc = newDoc();
    const updates = updatesIn(doc, () => {
      const id = createSticky(doc, { x: 42, y: -17 });
      expect(id).not.toBe('');
      expect(onlySticky(doc).id).toBe(id);
    });
    expect(updates).toBe(1);

    const note = onlySticky(doc);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.x).toBe(42 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-17 - STICKY_SIZE_WORLD / 2);
    expect(note.createdAt).toBeTypeOf('number');

    // The live Y.Text exists and is empty.
    const ytext = getStickyText(doc, note.id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext?.toString()).toBe('');
  });

  it('TC-02 create with existing z 1,2 -> new z 3', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 10 });

    const id = createSticky(doc, { x: 20, y: 20 });
    expect(snapshot(doc).map((s) => s.z).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(snapshot(doc).find((s) => s.id === id)?.z).toBe(3);
  });

  it('non-finite coordinates are rejected with no object and no update (extra)', () => {
    const doc = newDoc();
    const updates = updatesIn(doc, () => {
      expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBe('');
      expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBe('');
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model: moveObject', () => {
  it('TC-03 move updates x,y and leaves the other fields untouched', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 50 }); // top-left (0, -50)
    const before = onlySticky(doc);
    expect(before.x).toBe(0);
    expect(before.y).toBe(-50);

    const updates = updatesIn(doc, () => {
      expect(moveObject(doc, id, 10, -20)).toBe(true);
    });
    expect(updates).toBe(1);

    const after = onlySticky(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-04 moveObject on a stale id returns false and emits no update (negative)', () => {
    const doc = newDoc();
    const updates = updatesIn(doc, () => {
      expect(moveObject(doc, 'no-such-id', 5, 5)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('moveObject with non-finite coordinates returns false and emits no update (extra)', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesIn(doc, () => {
      expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
      expect(moveObject(doc, id, 0, Number.NaN)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(onlySticky(doc).x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(onlySticky(doc).y).toBe(0 - STICKY_SIZE_WORLD / 2);
  });
});

describe('board.model: setStickyColor', () => {
  it('TC-05 setStickyColor green -> applied', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesIn(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });
    expect(updates).toBe(1);
    expect(onlySticky(doc).color).toBe('green');
  });

  it('TC-06 setStickyColor teal -> rejected, unchanged, no update (negative)', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesIn(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(onlySticky(doc).color).toBe(DEFAULT_STICKY_COLOR);
  });
});

describe('board.model: deleteObject', () => {
  it('TC-07 deleteObject removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesIn(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update (negative)', () => {
    const doc = newDoc();
    const updates = updatesIn(doc, () => {
      expect(deleteObject(doc, 'no-such-id')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('board.model: bringToFront', () => {
  it('TC-09 bringToFront z1 of 3 -> z 4', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 10, y: 10 }); // z 2
    createSticky(doc, { x: 20, y: 20 }); // z 3

    const updates = updatesIn(doc, () => {
      expect(bringToFront(doc, a)).toBe(true);
    });
    expect(updates).toBe(1);
    const zs = snapshot(doc).map((s) => [s.id, s.z] as const);
    expect(zs).toContainEqual([a, 4]);
  });

  it('TC-10 bringToFront on the topmost note is a no-op (negative)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 10, y: 10 }); // z 2
    const top = createSticky(doc, { x: 20, y: 20 }); // z 3

    const updates = updatesIn(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(snapshot(doc).find((s) => s.id === top)?.z).toBe(3);
  });

  it('bringToFront on a stale id returns false and emits no update (negative)', () => {
    const doc = newDoc();
    const updates = updatesIn(doc, () => {
      expect(bringToFront(doc, 'no-such-id')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('board.model: snapshot', () => {
  it('TC-11 equal z -> sorted by id tie-break, stable across calls', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    // Force an equal z, as a concurrent update from story 3 could produce.
    doc.transact(() => {
      setZ(doc, a, 7);
      setZ(doc, b, 7);
    }, LOCAL_ORIGIN);

    const expectedIds = [a, b].sort();
    const first = snapshot(doc).map((s) => s.id);
    const second = snapshot(doc).map((s) => s.id);
    expect(first).toEqual(expectedIds);
    expect(second).toEqual(first);
  });

  it('TC-12 unknown object type in the doc is skipped, no throw', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      doc.getMap('objects').set('shape-1', shape);
    }, LOCAL_ORIGIN);

    const snap = snapshot(doc); // must not throw
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
  });
});
