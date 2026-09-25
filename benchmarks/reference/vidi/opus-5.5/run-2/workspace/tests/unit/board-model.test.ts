import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';

const HALF = STICKY_SIZE_WORLD / 2;

/** Counts `update` events emitted by the doc from now on. */
function countUpdates(doc: Y.Doc): { readonly count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function field(doc: Y.Doc, id: string, key: string): unknown {
  return objectsMap(doc).get(id)?.get(key);
}

describe('board.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('initDoc sets meta.schemaVersion once', () => {
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    const updates = countUpdates(doc);
    initDoc(doc);
    expect(updates.count).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('TC-01 createSticky on an empty doc: one yellow sticky, empty text, z 1, centred on the point', () => {
    const updates = countUpdates(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(updates.count).toBe(1);
    expect(updates.origins[0]).toBe(LOCAL_ORIGIN);
    expect(objectsMap(doc).size).toBe(1);
    const [note] = snapshot(doc);
    expect(note).toMatchObject({
      id,
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      text: '',
      z: 1,
      x: -HALF,
      y: -HALF,
    });
    expect(typeof note?.createdAt).toBe('number');
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });

  it('createSticky accepts a colour', () => {
    const id = createSticky(doc, { x: 10, y: 20 }, 'blue');
    expect(field(doc, id, 'color')).toBe('blue');
    expect(field(doc, id, 'x')).toBe(10 - HALF);
    expect(field(doc, id, 'y')).toBe(20 - HALF);
  });

  it('TC-02 createSticky with existing z 1 and 2 gives z 3', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 50 });
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(field(doc, id, 'z')).toBe(3);
  });

  it('TC-03 moveObject updates x,y and leaves other fields unchanged', () => {
    const id = createSticky(doc, { x: HALF, y: HALF });
    const before = snapshot(doc)[0];
    const updates = countUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates.count).toBe(1);
    const after = snapshot(doc)[0];
    expect(after).toEqual({ ...before, x: 10, y: -20 });
  });

  it('TC-04 moveObject on a stale id returns false with no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(moveObject(doc, 'missing', 1, 1)).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('non-finite coordinates are rejected with no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(updates.count).toBe(0);
    expect(field(doc, id, 'x')).toBe(-HALF);
  });

  it('createSticky with non-finite coordinates returns an empty id, creates nothing and emits no update', () => {
    const updates = countUpdates(doc);
    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBe('');
    expect(createSticky(doc, { x: 0, y: Number.NEGATIVE_INFINITY })).toBe('');
    expect(objectsMap(doc).size).toBe(0);
    expect(updates.count).toBe(0);
  });

  it('TC-05 setStickyColor green is applied', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates.count).toBe(1);
    expect(snapshot(doc)[0]?.color).toBe('green');
  });

  it('TC-06 setStickyColor with an unknown colour is rejected with no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, 'toString')).toBe(false);
    expect(updates.count).toBe(0);
    expect(snapshot(doc)[0]?.color).toBe('yellow');
  });

  it('setStickyColor to the current colour is a no-op; stale id is rejected', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(setStickyColor(doc, id, 'yellow')).toBe(false);
    expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('TC-07 deleteObject removes the note', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count).toBe(1);
    expect(objectsMap(doc).size).toBe(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 deleteObject on a stale id returns false with no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    deleteObject(doc, id);
    const updates = countUpdates(doc);
    expect(deleteObject(doc, id)).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('TC-09 bringToFront on the bottom note of 3 gives z 4', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(bringToFront(doc, a)).toBe(true);
    expect(updates.count).toBe(1);
    expect(field(doc, a, 'z')).toBe(4);
    expect(snapshot(doc).at(-1)?.id).toBe(a);
  });

  it('TC-10 bringToFront on the topmost note emits no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(bringToFront(doc, top)).toBe(false);
    expect(bringToFront(doc, 'missing')).toBe(false);
    expect(updates.count).toBe(0);
    expect(field(doc, top, 'z')).toBe(2);
  });

  it('bringToFront on a note that shares the top z with another moves it strictly above', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    objectsMap(doc).get(a)?.set('z', 2);
    const [lower] = [a, b].sort();
    expect(bringToFront(doc, lower!)).toBe(true);
    expect(field(doc, lower!, 'z')).toBe(3);
  });

  it('TC-11 equal z values are ordered by id, stable across calls', () => {
    const ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 0, y: 0 })];
    for (const id of ids) objectsMap(doc).get(id)?.set('z', 5);
    const first = snapshot(doc).map((n) => n.id);
    expect(first).toEqual([...ids].sort());
    expect(snapshot(doc).map((n) => n.id)).toEqual(first);
  });

  it('TC-12 snapshot skips objects with an unknown type without throwing', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    shape.set('z', 9);
    objectsMap(doc).set('future-shape', shape);
    let result: ReturnType<typeof snapshot> = [];
    expect(() => {
      result = snapshot(doc);
    }).not.toThrow();
    expect(result.map((n) => n.id)).toEqual([id]);
  });

  it('snapshot reflects text and returns frozen objects', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    const snap = snapshot(doc);
    expect(snap[0]?.text).toBe('Faster onboarding');
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap[0])).toBe(true);
  });

  it('new notes are created above a note brought to front', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    bringToFront(doc, a);
    const c = createSticky(doc, { x: 0, y: 0 });
    expect(field(doc, c, 'z')).toBe(4);
  });
});

describe('board fixture for the manual performance run', () => {
  it('builds 500 notes in a 25×20 grid with mixed colours, all in the snapshot', async () => {
    const { buildBoard500, GRID_COLUMNS, GRID_ROWS } = await import('../fixtures/board500');
    const doc = new Y.Doc();
    const ids = buildBoard500(doc);
    expect(ids).toHaveLength(GRID_COLUMNS * GRID_ROWS);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(GRID_COLUMNS * GRID_ROWS);
    expect(new Set(snap.map((n) => n.color)).size).toBe(6);
  });
});
