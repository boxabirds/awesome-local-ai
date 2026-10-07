import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
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
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Counts `update` events (one per committed transaction) on a doc. */
function updateCounter(doc: Y.Doc): { count(): number; reset(): void } {
  let n = 0;
  doc.on('update', () => n++);
  return { count: () => n, reset: () => (n = 0) };
}

function freshDoc(): { doc: Y.Doc; updates: { count(): number; reset(): void } } {
  const doc = new Y.Doc();
  const updates = updateCounter(doc);
  initDoc(doc);
  updates.reset();
  return { doc, updates };
}

function firstNote(doc: Y.Doc): StickySnapshot {
  const s = snapshot(doc);
  expect(s.length).toBeGreaterThan(0);
  return s[0]!;
}

/** Force two objects to the same z in one transaction (simulates a story 3 merge). */
function forceEqualZ(doc: Y.Doc, ids: string[], z: number): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  doc.transact(() => {
    for (const id of ids) objects.get(id)!.set('z', z);
  });
}

describe('board.model (src/shared/board-model.ts)', () => {
  let doc: Y.Doc;
  let updates: { count(): number; reset(): void };

  beforeEach(() => {
    const fresh = freshDoc();
    doc = fresh.doc;
    updates = fresh.updates;
  });

  it('initDoc sets meta.schemaVersion exactly once', () => {
    const meta = doc.getMap<number>('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    const before = updates.count();
    initDoc(doc); // second call is a no-op
    expect(updates.count()).toBe(before);
    expect(meta.get('schemaVersion')).toBe(1);
  });

  // TC-01: create on an empty doc -> one yellow sticky, z 1, centred on the point.
  it('TC-01 createSticky on an empty doc creates one yellow note centred on the point', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(updates.count()).toBe(1);

    const s = snapshot(doc);
    expect(s).toHaveLength(1);
    const note = s[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.color).toBe('yellow');
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.createdAt).toBeGreaterThan(0);
  });

  // TC-02: stacking for a fresh note is maxZ + 1.
  it('TC-02 createSticky above notes with z 1,2 gets z 3', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const before = snapshot(doc).map((n) => n.z);
    expect(before).toEqual([1, 2]);
    const third = createSticky(doc, { x: 600, y: 0 });
    expect(snapshot(doc).find((n) => n.id === third)!.z).toBe(3);
  });

  // TC-03: moveObject writes x,y and touches nothing else.
  it('TC-03 moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    const before = firstNote(doc);
    const ok = moveObject(doc, id, 10, -20);
    expect(ok).toBe(true);
    expect(updates.count()).toBe(1);
    const after = firstNote(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  // TC-04 (negative): stale id -> false, no transaction.
  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    expect(moveObject(doc, 'missing', 5, 5)).toBe(false);
    expect(updates.count()).toBe(0);
  });

  // TC-05: colour change writes only the color field.
  it('TC-05 setStickyColor(id, "green") changes colour only', () => {
    const id = createSticky(doc, { x: 40, y: -60 });
    moveObject(doc, id, 12, 34);
    updates.reset();
    const before = firstNote(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates.count()).toBe(1);
    const after = firstNote(doc);
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  // TC-06 (negative): unknown colour -> false, colour unchanged, no update.
  it('TC-06 setStickyColor with an unknown colour returns false and writes nothing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(firstNote(doc).color).toBe('yellow');
  });

  // TC-07: deleteObject removes the note.
  it('TC-07 deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count()).toBe(2);
    expect(snapshot(doc)).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  // TC-08 (negative): deleting a stale id is a no-op.
  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(deleteObject(doc, 'missing')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-09: bringToFront moves the bottom note above every other note.
  it('TC-09 bringToFront on the z-1 note of three gives it maxZ + 1', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    const c = createSticky(doc, { x: 600, y: 0 });
    expect([a, b, c]).toHaveLength(3);
    expect(snapshot(doc).map((n) => n.id)).toEqual([a, b, c]);
    updates.reset();
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(snapshot(doc).map((n) => n.id)).toEqual([b, c, a]);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
  });

  // TC-10 (negative): bringToFront on the topmost note is a no-op.
  it('TC-10 bringToFront on the topmost note returns false and emits no update', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    updates.reset();
    expect(bringToFront(doc, b)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc).map((n) => n.id)).toEqual([a, b]);
  });

  // TC-11: equal z values are ordered by id so every client agrees.
  it('TC-11 snapshot sorts equal z values by id, stably', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 300, y: 0 });
    forceEqualZ(doc, [a, b], 7);
    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    const expected = [a, b].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(snapshot(doc).map((n) => n.z)).toEqual([7, 7]);
  });

  // TC-12: objects of unknown type are skipped (forward compatibility).
  it('TC-12 snapshot skips objects with an unknown type and does not throw', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('shape-1', (() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'shape');
      m.set('x', 5);
      return m;
    })());
    const s = snapshot(doc);
    expect(s).toHaveLength(1);
    expect(s[0]!.id).toBe(id);
    expect(s.some((n) => n.id === 'shape-1')).toBe(false);
  });

  // TC-39 (negative): non-finite coordinates are rejected.
  it('TC-39 rejects NaN/Infinity coordinates with false and no update', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(createSticky(doc, { x: bad, y: 0 })).toBe('');
      expect(createSticky(doc, { x: 0, y: bad })).toBe('');
    }
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates.count()).toBe(0);

    const id = createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(firstNote(doc)).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
  });

  it('getStickyText exposes the Y.Text and edits show up in the snapshot', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    ytext!.insert(0, 'Faster onboarding');
    expect(firstNote(doc).text).toBe('Faster onboarding');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  it('mutations use LOCAL_ORIGIN as the transaction origin', () => {
    const origins: unknown[] = [];
    doc.on('afterTransaction', (t: { origin: unknown }) => origins.push(t.origin));
    createSticky(doc, { x: 0, y: 0 });
    expect(origins).toContain(LOCAL_ORIGIN);
  });

  // All six named colours are accepted; re-applying the current colour is the
  // documented no-op (false, no update), so it is skipped here.
  it('every named sticky colour round-trips through setStickyColor', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    for (const colour of Object.keys(STICKY_COLORS) as StickyColor[]) {
      if (firstNote(doc).color === colour) continue;
      const before = updates.count();
      expect(setStickyColor(doc, id, colour)).toBe(true);
      expect(updates.count()).toBe(before + 1);
      expect(firstNote(doc).color).toBe(colour);
    }
    const before = updates.count();
    expect(setStickyColor(doc, id, firstNote(doc).color)).toBe(false);
    expect(updates.count()).toBe(before);
  });
});
