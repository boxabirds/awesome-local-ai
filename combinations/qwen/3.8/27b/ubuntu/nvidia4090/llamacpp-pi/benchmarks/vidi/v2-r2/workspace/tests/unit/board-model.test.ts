/**
 * Story 2, board.model (design TC-01 to TC-12, TC-39).
 *
 * Unit tests against a REAL Y.Doc (no mocks): every mutation rule lives in
 * src/shared/board-model.ts and Yjs is deterministic in-process. Each
 * mutation test also asserts the number of `update` events emitted
 * (1 on success, 0 on rejection) and the transaction origin.
 */
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
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

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts the `update` events the doc emits from now on. */
function countUpdates(doc: Y.Doc): { count: () => number; dispose: () => void } {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  return { count: () => updates, dispose: () => doc.off('update', handler) };
}

/** The objects map with permissive typing for test fixture manipulation. */
function objectsOf(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects') as Y.Map<any>;
}

function notes(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

function byId(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return notes(doc).find((n) => n.id === id);
}

beforeEach(() => {
  // Y.Doc instances are independent; nothing to reset between tests.
});

describe('board.model: initDoc', () => {
  it('sets meta.schemaVersion once, and does not re-write it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

    const updates = countUpdates(doc);
    initDoc(doc); // idempotent: no transaction, no update
    expect(updates.count()).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    updates.dispose();
  });
});

describe('board.model: create (TC-01, TC-02, TC-39)', () => {
  it('TC-01: create on an empty doc produces one yellow sticky at z 1, centred on the point', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    const id = createSticky(doc, { x: 100, y: -50 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(updates.count()).toBe(1);

    const all = notes(doc);
    expect(all).toHaveLength(1);
    const n = all[0];
    expect(n.id).toBe(id);
    expect(n.type).toBe('sticky');
    expect(n.color).toBe(DEFAULT_STICKY_COLOR);
    expect(n.text).toBe('');
    expect(n.z).toBe(1);
    // Creation is centred: top-left = point - STICKY_SIZE_WORLD / 2.
    expect(n.x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(n.y).toBe(-50 - STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(n.createdAt)).toBe(true);

    // Mutations transact with the LOCAL_ORIGIN origin (story 8 undo).
    const origins: unknown[] = [];
    const originHandler = (_update: Uint8Array, origin: unknown): void => {
      origins.push(origin);
    };
    doc.on('update', originHandler);
    createSticky(doc, { x: 0, y: 0 });
    expect(origins).toEqual([LOCAL_ORIGIN]);
    doc.off('update', originHandler);
    updates.dispose();
  });

  it('TC-02: a new note goes on top (z = maxZ + 1) with existing z 1,2', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 10 });
    const c = createSticky(doc, { x: 20, y: 20 });
    expect(byId(doc, a)?.z).toBe(1);
    expect(byId(doc, b)?.z).toBe(2);
    expect(byId(doc, c)?.z).toBe(3);
  });

  it('TC-39: createSticky with NaN or Infinity coordinates is rejected, 0 updates', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    expect(createSticky(doc, { x: NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: NaN })).toBeFalsy();
    expect(createSticky(doc, { x: Infinity, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: -Infinity })).toBeFalsy();
    expect(createSticky(doc, { x: Number.NaN, y: Number.NaN })).toBeFalsy();

    expect(updates.count()).toBe(0);
    expect(notes(doc)).toHaveLength(0);
    updates.dispose();
  });
});

describe('board.model: move (TC-03, TC-04, TC-39)', () => {
  it('TC-03: moveObject updates x,y and leaves the other fields unchanged', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = byId(doc, id);
    expect(before).toBeDefined();

    const updates = countUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates.count()).toBe(1);

    const after = byId(doc, id);
    expect(after?.x).toBe(10);
    expect(after?.y).toBe(-20);
    expect(after?.id).toBe(before?.id);
    expect(after?.type).toBe(before?.type);
    expect(after?.color).toBe(before?.color);
    expect(after?.text).toBe(before?.text);
    expect(after?.z).toBe(before?.z);
    expect(after?.createdAt).toBe(before?.createdAt);
    updates.dispose();
  });

  it('TC-04: moveObject on a stale id returns false and emits 0 updates', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(moveObject(doc, 'no-such-id', 5, 5)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(notes(doc)).toHaveLength(0);
    updates.dispose();
  });

  it('TC-39: moveObject with NaN / Infinity coordinates returns false, 0 updates', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, NaN)).toBe(false);
    expect(moveObject(doc, id, Infinity, 0)).toBe(false);
    expect(moveObject(doc, id, 0, -Infinity)).toBe(false);

    expect(updates.count()).toBe(0);
    expect(byId(doc, id)?.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(byId(doc, id)?.y).toBe(-STICKY_SIZE_WORLD / 2);
    updates.dispose();
  });
});

describe('board.model: colour (TC-05, TC-06)', () => {
  it('TC-05: setStickyColor applies the colour and leaves text, x, y, z unchanged', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 30, y: 40 });
    const before = byId(doc, id);
    expect(before?.color).toBe(DEFAULT_STICKY_COLOR);

    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates.count()).toBe(1);

    const after = byId(doc, id);
    expect(after?.color).toBe('green');
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z);
    expect(after?.text).toBe(before?.text);
    updates.dispose();
  });

  it('TC-06: setStickyColor with an unknown colour returns false, 0 updates', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, 'YELLOW')).toBe(false);
    expect(setStickyColor(doc, id, '')).toBe(false);

    expect(updates.count()).toBe(0);
    expect(byId(doc, id)?.color).toBe(DEFAULT_STICKY_COLOR);
    updates.dispose();
  });
});

describe('board.model: delete (TC-07, TC-08)', () => {
  it('TC-07: deleteObject removes the note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(notes(doc)).toHaveLength(1);

    const updates = countUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(notes(doc)).toHaveLength(0);
    updates.dispose();
  });

  it('TC-08: deleteObject on a stale id returns false and emits 0 updates', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(deleteObject(doc, 'no-such-id')).toBe(false);
    expect(updates.count()).toBe(0);
    updates.dispose();
  });
});

describe('board.model: stacking (TC-09, TC-10, TC-11)', () => {
  it('TC-09: bringToFront raises a note at z 1 of 3 to z 4', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    const c = createSticky(doc, { x: 20, y: 0 });
    expect(byId(doc, a)?.z).toBe(1);

    const updates = countUpdates(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(byId(doc, a)?.z).toBe(4);
    // The other notes keep their stacking.
    expect(byId(doc, b)?.z).toBe(2);
    expect(byId(doc, c)?.z).toBe(3);
    updates.dispose();
  });

  it('TC-10: bringToFront on the topmost note is a no-op (0 updates)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    expect(byId(doc, b)?.z).toBe(2);

    const updates = countUpdates(doc);
    expect(bringToFront(doc, b)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(byId(doc, b)?.z).toBe(2);
    updates.dispose();
  });

  it('TC-11: equal z values tie-break by id, stable across calls', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    // Simulate concurrent sync (story 3) producing equal z values.
    const objects = objectsOf(doc);
    doc.transact(() => {
      objects.get(a)?.set('z', 7);
      objects.get(b)?.set('z', 7);
    });

    const first = notes(doc).map((n) => n.id);
    const second = notes(doc).map((n) => n.id);
    expect(first).toEqual([...first].sort()); // id tie-break
    expect(second).toEqual(first); // stable
  });
});

describe('board.model: snapshot (TC-12)', () => {
  it('TC-12: unknown object types are skipped, no throw', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const objects = objectsOf(doc);
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 5);
      objects.set('shape-1', shape);
      // Not even a Y.Map entry.
      objects.set('garbage-1', 'oops');
    });

    expect(() => snapshot(doc)).not.toThrow();
    const all = notes(doc);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].type).toBe('sticky');
  });

  it('getStickyText returns the live Y.Text, undefined for stale ids', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    doc.transact(() => {
      text?.insert(0, 'hello');
    }, LOCAL_ORIGIN);
    expect(byId(doc, id)?.text).toBe('hello');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });
});
