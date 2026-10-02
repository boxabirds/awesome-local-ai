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
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
} from '../../src/shared/config';

/** Counts `update` events emitted after the counter is created. */
function updateCounter(doc: Y.Doc): { count(): number; stop(): void } {
  let n = 0;
  const handler = () => {
    n += 1;
  };
  doc.on('update', handler);
  return { count: () => n, stop: () => doc.off('update', handler) };
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function one(doc: Y.Doc): StickySnapshot {
  const list = snapshot(doc);
  expect(list).toHaveLength(1);
  return list[0];
}

describe('board.model initDoc', () => {
  it('sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap<unknown>('meta');
    expect(meta.get('schemaVersion')).toBe(1);

    // Does not overwrite an existing version and emits no update.
    doc.transact(() => {
      meta.set('schemaVersion', 2);
    });
    const counter = updateCounter(doc);
    initDoc(doc);
    expect(counter.count()).toBe(0);
    expect(meta.get('schemaVersion')).toBe(2);
    counter.stop();
  });
});

describe('board.model createSticky', () => {
  // TC-01
  it('TC-01 creates the first note centred on the point, yellow, empty text, z 1', () => {
    const doc = freshDoc();
    const counter = updateCounter(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    expect(counter.count()).toBe(1);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(objectsOf(doc).size).toBe(1);

    const s = one(doc);
    expect(s.id).toBe(id);
    expect(s.type).toBe('sticky');
    expect(s.color).toBe(DEFAULT_STICKY_COLOR);
    expect(s.text).toBe('');
    expect(s.z).toBe(1);
    // Centred on the point: top-left = point - size / 2
    expect(s.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(s.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(s.createdAt).toBeGreaterThan(0);
    counter.stop();
  });

  it('TC-01 centring applies at an arbitrary point', () => {
    const doc = freshDoc();
    const counter = updateCounter(doc);
    createSticky(doc, { x: 500, y: -120 });
    const s = one(doc);
    expect(s.x).toBe(500 - STICKY_SIZE_WORLD / 2);
    expect(s.y).toBe(-120 - STICKY_SIZE_WORLD / 2);
    expect(counter.count()).toBe(1);
    counter.stop();
  });

  // TC-02
  it('TC-02 stacks the new note above existing notes (z 1, 2 -> 3)', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const counter = updateCounter(doc);

    createSticky(doc, { x: 600, y: 0 });

    expect(counter.count()).toBe(1);
    const zs = snapshot(doc).map((s) => s.z);
    expect(zs).toEqual([1, 2, 3]);
    counter.stop();
  });

  it('accepts an explicit colour', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 }, 'violet');
    expect(one(doc).color).toBe('violet');
  });

  // TC-39 (create half)
  it('TC-39 rejects non-finite coordinates with no update', () => {
    const doc = freshDoc();
    const counter = updateCounter(doc);

    expect(createSticky(doc, { x: NaN, y: 0 })).toBe('');
    expect(createSticky(doc, { x: 0, y: NaN })).toBe('');
    expect(createSticky(doc, { x: Infinity, y: 0 })).toBe('');
    expect(createSticky(doc, { x: 0, y: -Infinity })).toBe('');

    expect(counter.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    counter.stop();
  });

  it('writes transactions with LOCAL_ORIGIN', () => {
    const doc = freshDoc();
    const origins: unknown[] = [];
    const handler = (_u: Uint8Array, origin: unknown) => origins.push(origin);
    doc.on('update', handler);
    createSticky(doc, { x: 0, y: 0 });
    expect(origins).toEqual([LOCAL_ORIGIN]);
    doc.off('update', handler);
  });
});

describe('board.model moveObject', () => {
  // TC-03
  it('TC-03 updates x and y and leaves every other field untouched', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    setStickyColor(doc, id, 'blue');
    doc.transact(() => {
      getStickyText(doc, id)!.insert(0, 'keep me');
    });
    const before = snapshot(doc)[0];
    const counter = updateCounter(doc);

    const ok = moveObject(doc, id, 10, -20);

    expect(ok).toBe(true);
    expect(counter.count()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    counter.stop();
  });

  // TC-04 (negative)
  it('TC-04 rejects a stale id with false and no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const counter = updateCounter(doc);

    expect(moveObject(doc, 'does-not-exist', 5, 5)).toBe(false);

    expect(counter.count()).toBe(0);
    counter.stop();
  });

  // TC-39 (move half)
  it('TC-39 rejects NaN and Infinity coordinates with no update', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = snapshot(doc)[0];
    const counter = updateCounter(doc);

    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, NaN)).toBe(false);
    expect(moveObject(doc, id, Infinity, 0)).toBe(false);
    expect(moveObject(doc, id, 0, -Infinity)).toBe(false);

    expect(counter.count()).toBe(0);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    counter.stop();
  });
});

describe('board.model setStickyColor', () => {
  // TC-05
  it('TC-05 changes only the colour', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 40, y: 60 });
    doc.transact(() => {
      getStickyText(doc, id)!.insert(0, 'Faster onboarding');
    });
    const before = snapshot(doc)[0];
    expect(before.color).toBe(DEFAULT_STICKY_COLOR);
    const counter = updateCounter(doc);

    const ok = setStickyColor(doc, id, 'green');

    expect(ok).toBe(true);
    expect(counter.count()).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(STICKY_COLORS[after.color]).toBe('#C5E1A5');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.id).toBe(before.id);
    counter.stop();
  });

  it.each(Object.keys(STICKY_COLORS))('applies the %s colour', (color) => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, color === 'blue' ? 'pink' : 'blue');
    expect(setStickyColor(doc, id, color)).toBe(true);
    expect(one(doc).color).toBe(color);
  });

  it('treats re-applying the current colour as a no-op (false, no update)', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const counter = updateCounter(doc);
    expect(setStickyColor(doc, id, DEFAULT_STICKY_COLOR)).toBe(false);
    expect(counter.count()).toBe(0);
    expect(one(doc).color).toBe(DEFAULT_STICKY_COLOR);
    counter.stop();
  });

  // TC-06 (negative)
  it('TC-06 rejects an unknown colour with false, no update, unchanged colour', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const counter = updateCounter(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);

    expect(counter.count()).toBe(0);
    expect(one(doc).color).toBe(DEFAULT_STICKY_COLOR);
    counter.stop();
  });

  it('rejects a stale id with false and no update', () => {
    const doc = freshDoc();
    const counter = updateCounter(doc);
    expect(setStickyColor(doc, 'nope', 'pink')).toBe(false);
    expect(counter.count()).toBe(0);
    counter.stop();
  });
});

describe('board.model deleteObject', () => {
  // TC-07
  it('TC-07 removes the note', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const counter = updateCounter(doc);

    const ok = deleteObject(doc, id);

    expect(ok).toBe(true);
    expect(counter.count()).toBe(1);
    expect(objectsOf(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
    counter.stop();
  });

  it('leaves other notes alone', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    deleteObject(doc, a);
    const list = snapshot(doc);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b);
  });

  // TC-08 (negative)
  it('TC-08 rejects a stale id with false and no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const counter = updateCounter(doc);

    expect(deleteObject(doc, 'does-not-exist')).toBe(false);

    expect(counter.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    counter.stop();
  });
});

describe('board.model bringToFront', () => {
  // TC-09
  it('TC-09 raises the bottom note of three above the current top', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    expect(snapshot(doc).map((s) => s.z)).toEqual([1, 2, 3]);
    const counter = updateCounter(doc);

    const ok = bringToFront(doc, a);

    expect(ok).toBe(true);
    expect(counter.count()).toBe(1);
    const list = snapshot(doc);
    expect(list.map((s) => s.z)).toEqual([2, 3, 4]);
    expect(list[2].id).toBe(a);
    counter.stop();
  });

  // TC-10 (negative)
  it('TC-10 does nothing when the note is already topmost', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 });
    const counter = updateCounter(doc);

    expect(bringToFront(doc, top)).toBe(false);

    expect(counter.count()).toBe(0);
    expect(snapshot(doc).map((s) => s.z)).toEqual([1, 2]);
    counter.stop();
  });

  it('rejects a stale id with false and no update', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const counter = updateCounter(doc);
    expect(bringToFront(doc, 'nope')).toBe(false);
    expect(counter.count()).toBe(0);
    counter.stop();
  });
});

describe('board.model snapshot ordering and forward compatibility', () => {
  // TC-11
  it('TC-11 breaks equal z ties by id, stably', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const c = createSticky(doc, { x: 600, y: 0 });

    // Force all three to the same z (simulates concurrent creation in story 3).
    doc.transact(() => {
      objectsOf(doc).get(a)!.set('z', 5);
      objectsOf(doc).get(b)!.set('z', 5);
      objectsOf(doc).get(c)!.set('z', 5);
    });

    const sorted = [...[a, b, c]].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    const first = snapshot(doc);
    const second = snapshot(doc);

    expect(first.map((s) => s.id)).toEqual(sorted);
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
  });

  it('orders by z then id when z differs', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    expect(snapshot(doc).map((s) => s.id)).toEqual([a, b]);
    bringToFront(doc, b);
    bringToFront(doc, a);
    expect(snapshot(doc).map((s) => s.id)).toEqual([b, a]);
  });

  // TC-12
  it('TC-12 skips objects with an unknown type without throwing', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });

    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 0);
      shape.set('y', 0);
      shape.set('z', 99);
      objectsOf(doc).set('shape-1', shape);
    });

    const list = snapshot(doc);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sticky);
  });

  it('returns immutable snapshots that only change when the doc changes', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const a = snapshot(doc);
    const b = snapshot(doc);
    expect(a).toEqual(b);
    createSticky(doc, { x: 400, y: 400 });
    expect(snapshot(doc)).not.toEqual(a);
  });
});

describe('board.model getStickyText', () => {
  it('returns the note Y.Text so callers can edit it', () => {
    const doc = freshDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    const counter = updateCounter(doc);
    doc.transact(() => ytext!.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    expect(counter.count()).toBe(1);
    expect(snapshot(doc)[0].text).toBe('Faster onboarding');
    counter.stop();
  });

  it('returns undefined for a stale id or a non-sticky object', () => {
    const doc = freshDoc();
    expect(getStickyText(doc, 'nope')).toBeUndefined();
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      objectsOf(doc).set('shape-1', shape);
    });
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
  });
});
