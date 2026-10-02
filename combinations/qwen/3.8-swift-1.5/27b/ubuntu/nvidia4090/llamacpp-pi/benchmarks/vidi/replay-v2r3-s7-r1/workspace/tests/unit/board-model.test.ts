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
  LOCAL_ORIGIN,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
} from '../../src/shared/config';

/** Run `fn` and count how many `update` events the doc emits. */
function withUpdateCount(doc: Y.Doc, fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: unknown;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Create a note and narrow the result to a string id (for tests that just need an id). */
function makeNote(doc: Y.Doc, at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  expect(id, 'createSticky should succeed').not.toBe(false);
  return id as string;
}

/** Read a single object map out of the doc for internal assertions. */
function objMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const objects = doc.getMap('objects');
  const m = objects.get(id);
  expect(m, `object ${id} should exist`).toBeInstanceOf(Y.Map);
  return m as Y.Map<unknown>;
}

describe('board.model (Yjs board model against a real Y.Doc)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = makeDoc();
  });

  // Extra: initDoc sets meta.schemaVersion once
  it('initDoc sets meta.schemaVersion once and is idempotent', () => {
    const d = new Y.Doc();
    initDoc(d);
    expect(d.getMap('meta').get('schemaVersion')).toBe(1);
    // Calling again must not change it.
    const { updates } = withUpdateCount(d, () => initDoc(d));
    expect(updates).toBe(0);
    expect(d.getMap('meta').get('schemaVersion')).toBe(1);
  });

  // TC-01
  it('TC-01: create on empty doc → 1 sticky, default colour, empty text, z 1, centred', () => {
    const { result, updates } = withUpdateCount(doc, () => createSticky(doc, { x: 100, y: 50 }));
    const id = result as string;
    expect(updates).toBe(1);
    expect(typeof id).toBe('string');
    expect(snapshot(doc)).toHaveLength(1);

    const m = objMap(doc, id);
    expect(m.get('type')).toBe('sticky');
    expect(m.get('color')).toBe(DEFAULT_STICKY_COLOR);
    expect((m.get('text') as Y.Text).toString()).toBe('');
    expect(m.get('z')).toBe(1);
    // Creation centred: top-left = point - size/2
    expect(m.get('x')).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(m.get('y')).toBe(50 - STICKY_SIZE_WORLD / 2);
  });

  // TC-02
  it('TC-02: create with existing z 1,2 → new z 3', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 0, y: 0 });
    expect(objMap(doc, a).get('z')).toBe(1);
    expect(objMap(doc, b).get('z')).toBe(2);
    const c = makeNote(doc, { x: 0, y: 0 });
    expect(objMap(doc, c).get('z')).toBe(3);
  });

  // TC-03
  it('TC-03: moveObject updates x,y only; other fields unchanged', () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    const before = objMap(doc, id);
    const colorBefore = before.get('color');
    const zBefore = before.get('z');
    const textBefore = (before.get('text') as Y.Text).toString();
    const createdAtBefore = before.get('createdAt');

    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const after = objMap(doc, id);
    expect(after.get('x')).toBe(10);
    expect(after.get('y')).toBe(-20);
    expect(after.get('color')).toBe(colorBefore);
    expect(after.get('z')).toBe(zBefore);
    expect((after.get('text') as Y.Text).toString()).toBe(textBefore);
    expect(after.get('createdAt')).toBe(createdAtBefore);
  });

  // TC-04 (negative)
  it('TC-04: moveObject on a stale id → false, 0 updates', () => {
    const { result, updates } = withUpdateCount(doc, () => moveObject(doc, 'nope', 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  // TC-05
  it('TC-05: setStickyColor green → applied; text, x, y, z unchanged', () => {
    const id = makeNote(doc, { x: 40, y: 40 });
    const before = objMap(doc, id);
    const textBefore = (before.get('text') as Y.Text).toString();
    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'green'));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = objMap(doc, id);
    expect(after.get('color')).toBe('green');
    expect(after.get('x')).toBe(before.get('x'));
    expect(after.get('y')).toBe(before.get('y'));
    expect(after.get('z')).toBe(before.get('z'));
    expect((after.get('text') as Y.Text).toString()).toBe(textBefore);
  });

  // TC-06 (negative)
  it("TC-06: setStickyColor 'teal' (unknown) → false, unchanged, 0 updates", () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    const { result, updates } = withUpdateCount(doc, () => setStickyColor(doc, id, 'teal'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(objMap(doc, id).get('color')).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-07
  it('TC-07: deleteObject removes the note', () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-08 (negative)
  it('TC-08: deleteObject on a stale id → false, 0 updates', () => {
    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, 'ghost'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  // TC-09
  it('TC-09: bringToFront on z 1 of 3 → z 4', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(objMap(doc, a).get('z')).toBe(1);
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, a));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(objMap(doc, a).get('z')).toBe(4);
  });

  // TC-10 (negative)
  it('TC-10: bringToFront on the topmost note → no update', () => {
    makeNote(doc, { x: 0, y: 0 }); // a lower note so b is topmost
    const b = makeNote(doc, { x: 0, y: 0 });
    expect(objMap(doc, b).get('z')).toBe(2); // b is topmost
    const { result, updates } = withUpdateCount(doc, () => bringToFront(doc, b));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(objMap(doc, b).get('z')).toBe(2);
  });

  // TC-11
  it('TC-11: equal z → snapshot ordered by id tie-break, stable across calls', () => {
    // Create two notes and force them to the same z.
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const mapA = objects.get(a) as Y.Map<unknown>;
    const mapB = objects.get(b) as Y.Map<unknown>;
    mapA.set('z', 5);
    mapB.set('z', 5);

    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
    // Sorted by id as tie-break (ascending)
    const ids = first.map((s) => s.id);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  // TC-12
  it('TC-12: unknown object type in doc → skipped by snapshot, no throw', () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    objects.set('shape-1', shape);

    expect(() => snapshot(doc)).not.toThrow();
    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(id);
    expect(snaps[0].type).toBe('sticky');
  });

  // TC-39 (negative)
  it('TC-39: createSticky / moveObject with NaN or Infinity → false, 0 updates', () => {
    const badCoords = [
      { x: NaN, y: 0 },
      { x: 0, y: NaN },
      { x: Infinity, y: 0 },
      { x: 0, y: -Infinity },
    ];
    for (const at of badCoords) {
      const { result, updates } = withUpdateCount(doc, () => createSticky(doc, at));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);

    // Create at (size/2, size/2) so the top-left lands on (0, 0).
    const id = makeNote(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    for (const [x, y] of [[NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity]] as const) {
      const { result, updates } = withUpdateCount(doc, () => moveObject(doc, id, x, y));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(objMap(doc, id).get('x')).toBe(0);
    expect(objMap(doc, id).get('y')).toBe(0);
  });

  // getStickyText
  it('getStickyText returns the Y.Text for an existing note and undefined for a stale id', () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  // LOCAL_ORIGIN is used as the transaction origin for successful mutations
  it('successful mutations transact with LOCAL_ORIGIN', () => {
    const id = makeNote(doc, { x: 0, y: 0 });
    const objects = doc.getMap('objects');
    let origin: unknown = 'unset';
    objects.observeDeep((_events, tr) => {
      origin = tr.origin;
    });
    moveObject(doc, id, 1, 2);
    expect(origin).toBe(LOCAL_ORIGIN);
  });

  // snapshot immutability & sorting by z
  it('snapshot is sorted by z (higher on top) and immutable', () => {
    const a = makeNote(doc, { x: 0, y: 0 });
    const b = makeNote(doc, { x: 0, y: 0 });
    const snaps = snapshot(doc);
    // Sorted ascending by z so the renderer draws higher z last (on top):
    // a (z=1) before b (z=2).
    expect(snaps.map((s) => s.id)).toEqual([a, b]);
    // Immutability: mutating the returned array must not affect future snapshots.
    (snaps as StickySnapshot[]).push({
      id: 'fake', type: 'sticky', x: 0, y: 0, color: 'blue', text: '', z: 99, createdAt: 0,
    });
    expect(snapshot(doc)).toHaveLength(2);
  });
});

// Sanity: STICKY_COLORS has exactly six entries used by the toolbar
it('STICKY_COLORS exposes the six preset colours', () => {
  expect(Object.keys(STICKY_COLORS)).toEqual([
    'yellow',
    'orange',
    'green',
    'blue',
    'pink',
    'violet',
  ]);
});
