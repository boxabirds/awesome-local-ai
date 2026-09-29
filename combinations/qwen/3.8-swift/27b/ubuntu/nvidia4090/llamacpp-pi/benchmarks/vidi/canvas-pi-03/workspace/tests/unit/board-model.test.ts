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
} from 'src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
} from 'src/shared/config';

/** Counts `update` events emitted on the doc. */
function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = () => {
    n += 1;
  };
  doc.on('update', handler);
  return () => n;
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('board.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = newDoc();
  });

  it('TC-01: create on empty doc produces one yellow sticky with z 1, centred on the point', () => {
    const updates = countUpdates(doc);
    const id = createSticky(doc, { x: 0, y: 0 })!;
    expect(id).toBeTruthy();
    expect(updates()).toBe(1);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
    });
    // creation is centred on the click: top-left = point - STICKY_SIZE_WORLD/2
    expect(notes[0].x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(notes[0].createdAt).toBeTypeOf('number');
    expect(Number.isFinite(notes[0].createdAt)).toBe(true);
  });

  it('TC-02: create with existing z 1,2 gives new z 3', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 50, y: 50 })!;
    expect(snapshot(doc).map((n) => n.z).sort()).toEqual([1, 2]);
    expect(a).not.toBe(b);

    const c = createSticky(doc, { x: 100, y: 100 })!;
    const note = snapshot(doc).find((n) => n.id === c)!;
    expect(note.z).toBe(3);
  });

  it('TC-03: moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const before = snapshot(doc)[0];

    const updates = countUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates()).toBe(1);

    const after = snapshot(doc)[0];
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.text).toBe('');
  });

  it('TC-04: moveObject on a stale id returns false and emits no update', () => {
    const updates = countUpdates(doc);
    expect(moveObject(doc, 'no-such-id', 1, 2)).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-05: setStickyColor green is applied', () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;

    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc)[0].color).toBe('green');
  });

  it("TC-06: setStickyColor with an unknown colour ('teal') is rejected with no update", () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;

    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('TC-07: deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;
    expect(snapshot(doc)).toHaveLength(1);

    const updates = countUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08: deleteObject on a stale id returns false and emits no update', () => {
    const updates = countUpdates(doc);
    expect(deleteObject(doc, 'no-such-id')).toBe(false);
    expect(updates()).toBe(0);
  });

  it('TC-09: bringToFront on the bottom note of three gives z 4', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    createSticky(doc, { x: 10, y: 10 })!;
    createSticky(doc, { x: 20, y: 20 })!;
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(1);

    const updates = countUpdates(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshot(doc).find((n) => n.id === a)!.z).toBe(4);
  });

  it('TC-10: bringToFront on the topmost note is a no-op with no update', () => {
    createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 10, y: 10 })!;
    expect(snapshot(doc).find((n) => n.id === b)!.z).toBe(2);

    const updates = countUpdates(doc);
    expect(bringToFront(doc, b)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc).find((n) => n.id === b)!.z).toBe(2);
  });

  it('TC-11: notes with equal z sort by id tie-break, stable across calls', () => {
    // Force equal z values to simulate concurrent creation (story 3 scenario).
    const ids: string[] = [];
    for (const [x, y] of [
      [0, 0],
      [300, 0],
      [150, 100],
    ]) {
      const id = createSticky(doc, { x, y })!;
      ids.push(id);
    }
    // Make all z equal.
    doc.transact(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      objects.forEach((obj) => obj.set('z', 7));
    });

    const first = snapshot(doc);
    const second = snapshot(doc);
    const sortedIds = [...ids].sort();
    expect(first.map((n) => n.id)).toEqual(sortedIds);
    expect(second.map((n) => n.id)).toEqual(sortedIds);
  });

  it("TC-12: snapshot skips unknown object types without throwing", () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;
    doc.transact(() => {
      const objects = doc.getMap('objects');
      const shape: Y.Map<unknown> = new Y.Map();
      shape.set('type', 'shape');
      shape.set('x', 1);
      objects.set('shape-1', shape);
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(notes[0].type).toBe('sticky');
  });

  it('rejects non-finite coordinates for createSticky and moveObject with no updates', () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;

    const updates = countUpdates(doc);
    expect(createSticky(doc, { x: NaN, y: 0 })).toBeNull();
    expect(createSticky(doc, { x: Infinity, y: 0 })).toBeNull();
    expect(moveObject(doc, id, NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, -Infinity)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].x).toBe(0 - STICKY_SIZE_WORLD / 2);
  });

  it('initDoc sets meta.schemaVersion once and is idempotent', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(1);
  });

  it('successful mutations use LOCAL_ORIGIN as the transaction origin', () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;
    createSticky(doc, { x: 30, y: 30 })!; // make the first note no longer topmost
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, _origin: unknown) => {
      origins.push(_origin);
    });
    moveObject(doc, id, 5, 5);
    setStickyColor(doc, id, 'blue');
    bringToFront(doc, id);
    deleteObject(doc, id);
    expect(origins).toHaveLength(4);
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });

  it('getStickyText returns the note Y.Text, or undefined for a stale id', () => {
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });
});
