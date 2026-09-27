import { describe, it, expect, beforeEach } from 'vitest';
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
} from '../../src/shared/board-model.ts';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '../../src/shared/config.ts';

// Count how many `update` events a doc emits while `fn` runs. Successful
// mutations must emit exactly one; rejections and no-ops must emit zero.
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const cb = () => {
    n++;
  };
  doc.on('update', cb);
  try {
    fn();
  } finally {
    doc.off('update', cb);
  }
  return n;
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// The objects map, for tests that need to seed raw state.
function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

beforeEach(() => {
  // nothing shared between tests; every test builds its own doc
});

describe('board.model create', () => {
  // TC-01: create on empty doc -> 1 object, type sticky, default colour, empty
  // text, z 1; note centred on the given point (top-left = point - size/2).
  it('TC-01 creates a centred default sticky with z 1 on an empty doc', () => {
    const doc = newDoc();
    let id = '';
    const updates = countUpdates(doc, () => {
      id = createSticky(doc, { x: 100, y: 50 });
    });
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    const note = snap[0];
    expect(note.type).toBe('sticky');
    expect(note.id).toBe(id);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(50 - STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(updates).toBe(1);
  });

  // TC-02: create with existing z 1,2 -> new z 3.
  it('TC-02 assigns z = maxZ + 1 for a new note', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    // existing z values 1 and 2
    expect(snapshot(doc).map((s) => s.z).sort((a, b) => a - b)).toEqual([1, 2]);
    const updates = countUpdates(doc, () => createSticky(doc, { x: 5, y: 5 }));
    expect(snapshot(doc)).toHaveLength(3);
    expect(Math.max(...snapshot(doc).map((s) => s.z))).toBe(3);
    expect(updates).toBe(1);
  });
});

describe('board.model move', () => {
  // TC-03: moveObject updates x,y only, other fields unchanged.
  it('TC-03 moves a note and leaves other fields untouched', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    setStickyColor(doc, id, 'green');
    const before = snapshot(doc).find((s) => s.id === id)!;

    const updates = countUpdates(doc, () => {
      const ok = moveObject(doc, id, 10, -20);
      expect(ok).toBe(true);
    });
    const after = snapshot(doc).find((s) => s.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates).toBe(1);
  });

  // TC-04 (negative): moveObject stale id -> false, 0 updates.
  it('TC-04 rejects a move on a stale id with no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, 'missing-id', 1, 1)).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // Extra: non-finite coordinates rejected with 0 updates.
  it('rejects non-finite coordinates with no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, id, Number.NaN, 5)).toBe(false);
      expect(moveObject(doc, id, 5, Number.POSITIVE_INFINITY)).toBe(false);
    });
    expect(updates).toBe(0);
    // position unchanged
    expect(snapshot(doc)[0].x).toBe(-STICKY_SIZE_WORLD / 2);
  });
});

describe('board.model colour', () => {
  // TC-05: setStickyColor green applied.
  it('TC-05 changes the colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });
    expect(snapshot(doc)[0].color).toBe('green');
    expect(STICKY_COLORS.green).toBe('#C5E1A5');
    expect(updates).toBe(1);
  });

  // TC-06 (negative): unknown colour rejected, unchanged, 0 updates.
  it('TC-06 rejects an unknown colour with no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
    });
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates).toBe(0);
  });
});

describe('board.model delete', () => {
  // TC-07: deleteObject removes the note.
  it('TC-07 deletes a note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates).toBe(1);
  });

  // TC-08 (negative): deleteObject stale id -> false, 0 updates.
  it('TC-08 rejects a delete on a stale id with no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, 'missing-id')).toBe(false);
    });
    expect(snapshot(doc)).toHaveLength(1);
    expect(updates).toBe(0);
  });
});

describe('board.model stacking', () => {
  // TC-09: bringToFront on a lower note sets z to max+1.
  it('TC-09 brings the bottom note to the top (z 1 -> 4)', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 0, y: 0 }); // z 2
    createSticky(doc, { x: 0, y: 0 }); // z 3
    expect(snapshot(doc).find((s) => s.id === a)!.z).toBe(1);

    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, a)).toBe(true);
    });
    expect(snapshot(doc).find((s) => s.id === a)!.z).toBe(4);
    expect(updates).toBe(1);
  });

  // TC-10 (negative): bringToFront on the topmost -> no update emitted.
  it('TC-10 does not emit an update when the note is already on top', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 }); // z 2 (top)
    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });
    expect(snapshot(doc).find((s) => s.id === top)!.z).toBe(2);
    expect(updates).toBe(0);
  });

  // TC-11: two notes with equal z are ordered by id (stable tie-break).
  it('TC-11 sorts equal-z notes by id as a stable tie-break', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    // Force equal z by writing raw.
    objectsMap(doc).get!(b)!.set('z', objectsMap(doc).get!(a)!.get('z'));
    expect(snapshot(doc).find((s) => s.id === a)!.z).toBe(
      snapshot(doc).find((s) => s.id === b)!.z,
    );
    const expected = [a, b].sort();
    const first = snapshot(doc).map((s) => s.id);
    const second = snapshot(doc).map((s) => s.id);
    expect(first).toEqual(expected);
    expect(second).toEqual(first); // stable across calls
  });
});

describe('board.model read', () => {
  // TC-12: unknown object type skipped by snapshot, no throw.
  it('TC-12 skips objects with an unknown type', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    // Seed an unknown-typed object directly (forward compatibility test).
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', 1);
    obj.set('y', 2);
    obj.set('z', 9);
    objectsMap(doc).set('shape-1', obj);

    let snap: readonly { id: string }[] = [];
    expect(() => {
      snap = snapshot(doc);
    }).not.toThrow();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).not.toBe('shape-1');
  });

  // getStickyText returns the Y.Text for a note, undefined for a stale id.
  it('getStickyText returns the Y.Text for a note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});

describe('board.model initDoc + origin', () => {
  // initDoc sets meta.schemaVersion once; a second call does not overwrite.
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap<unknown>('meta');
    expect(meta.get('schemaVersion')).toBe(1);

    // Set a custom version, then re-init: must not clobber.
    meta.set('schemaVersion', 99);
    const updates = countUpdates(doc, () => initDoc(doc));
    expect(meta.get('schemaVersion')).toBe(99);
    expect(updates).toBe(0);
  });

  // Successful mutations run inside one transaction with LOCAL_ORIGIN.
  it('runs mutations with LOCAL_ORIGIN as the transaction origin', () => {
    const doc = newDoc();
    let seenOrigin: unknown = 'unset';
    const cb = (_u: Uint8Array, origin: unknown) => {
      seenOrigin = origin;
    };
    doc.on('update', cb);
    createSticky(doc, { x: 0, y: 0 });
    doc.off('update', cb);
    expect(seenOrigin).toBe(LOCAL_ORIGIN);
  });

  // Rejections never open a transaction (origin never observed).
  it('does not open a transaction on a rejected mutation', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    let sawUpdate = false;
    const cb = () => {
      sawUpdate = true;
    };
    doc.on('update', cb);
    setStickyColor(doc, id, 'teal' as unknown as StickyColor);
    moveObject(doc, 'missing', 1, 1);
    deleteObject(doc, 'missing');
    doc.off('update', cb);
    expect(sawUpdate).toBe(false);
  });
});
