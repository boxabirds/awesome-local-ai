/**
 * Unit tests for the board document model (design capability `board.model`).
 *
 * Everything runs against a real `Y.Doc`: Yjs is deterministic in-process, and it
 * is the store under test, so nothing is mocked. Each mutation test also asserts
 * the number of `update` events — 1 for a successful change, 0 for a rejection —
 * because story 3 pays for every update it sends over the wire.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  isStickyColor,
  LOCAL_ORIGIN,
  META_MAP,
  moveObject,
  OBJECTS_MAP,
  SCHEMA_VERSION,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { LONG_PROSE_1000, SHORT_PHRASE } from '../fixtures/texts';

const HALF = STICKY_SIZE_WORLD / 2;

interface Recorder {
  /** Number of `doc` update events seen so far. */
  count(): number;
  /** Origins of the update events seen so far. */
  origins(): unknown[];
  reset(): void;
}

/** Counts `update` events on a doc (attach after `initDoc` to ignore setup). */
function recordUpdates(doc: Y.Doc): Recorder {
  const origins: unknown[] = [];
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    origins.push(origin);
  });
  return {
    count: () => origins.length,
    origins: () => [...origins],
    reset: () => {
      origins.length = 0;
    },
  };
}

let doc: Y.Doc;
let updates: Recorder;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = recordUpdates(doc);
});

const objects = (): Y.Map<Y.Map<unknown>> => doc.getMap(OBJECTS_MAP);
const entry = (id: string): Y.Map<unknown> => objects().get(id) as Y.Map<unknown>;
const zOf = (id: string): number => Number(entry(id).get('z'));

/** Forces a `z` value directly in the document (stacking fixtures). */
const forceZ = (id: string, z: number): void => {
  doc.transact(() => {
    entry(id).set('z', z);
  });
};

describe('initDoc', () => {
  it('sets meta.schemaVersion once and leaves it alone afterwards', () => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    expect(fresh.getMap(META_MAP).get('schemaVersion')).toBe(SCHEMA_VERSION);
    let count = 0;
    fresh.on('update', () => {
      count += 1;
    });
    initDoc(fresh);
    expect(count).toBe(0);
    expect(fresh.getMap(META_MAP).get('schemaVersion')).toBe(SCHEMA_VERSION);
  });
});

describe('createSticky', () => {
  it('TC-01 creates the first note centred on the point, yellow, empty, z 1', () => {
    const id = createSticky(doc, { x: 10, y: 10 });
    expect(id).toBeTruthy();
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    if (typeof id !== 'string' || !note) throw new Error('unreachable');
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    // Centred: the stored top-left is the point minus half the note size.
    expect(note.x).toBe(10 - HALF);
    expect(note.y).toBe(10 - HALF);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(note.createdAt).toBeGreaterThan(0);
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
    expect(entry(id).get('createdAt')).toBe(note.createdAt);
  });

  it('TC-02 stacks the next note above the existing z values 1 and 2', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    updates.reset();
    const third = createSticky(doc, { x: 0, y: 300 });
    expect(updates.count()).toBe(1);
    expect(typeof third === 'string' ? zOf(third) : 0).toBe(3);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
  });

  it('uses the requested colour when it is one of the six presets', () => {
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');
    const note = snapshot(doc)[0];
    expect(typeof id === 'string' ? note?.color : null).toBe('violet');
  });

  it('TC-39 rejects non-finite coordinates without writing anything', () => {
    const before = snapshot(doc).length;
    const cases: Array<{ x: number; y: number }> = [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ];
    for (const at of cases) {
      expect(createSticky(doc, at)).toBe(false);
    }
    expect(updates.count()).toBe(0);
    expect(snapshot(doc).length).toBe(before);
  });
});

describe('moveObject', () => {
  it('TC-03 updates x and y and leaves every other field alone', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    setStickyColor(doc, id, 'green');
    const ytext = getStickyText(doc, id) as Y.Text;
    doc.transact(() => ytext.insert(0, SHORT_PHRASE), LOCAL_ORIGIN);
    updates.reset();

    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);

    const note = snapshot(doc)[0];
    expect(note).toMatchObject({ id, x: 10, y: -20, color: 'green', text: SHORT_PHRASE, z: 1 });
  });

  it('TC-04 rejects a stale id with false and no update', () => {
    expect(moveObject(doc, 'missing-id', 1, 2)).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('ignores a move that does not change the position', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    updates.reset();
    expect(moveObject(doc, id, -HALF, -HALF)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0]).toMatchObject({ x: -HALF, y: -HALF });
  });

  it('TC-39 rejects non-finite coordinates with false and no update', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    updates.reset();
    const cases: Array<[number, number]> = [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ];
    for (const [x, y] of cases) {
      expect(moveObject(doc, id, x, y)).toBe(false);
    }
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0]).toMatchObject({ x: -HALF, y: -HALF });
  });

  it('rejects a move of an object that is not a sticky note', () => {
    doc.getMap(OBJECTS_MAP).set('shape-1', new Y.Map([['type', 'shape']]));
    updates.reset();
    expect(moveObject(doc, 'shape-1', 1, 1)).toBe(false);
    expect(updates.count()).toBe(0);
  });
});

describe('setStickyColor', () => {
  it('TC-05 changes only the colour of a note', () => {
    const id = createSticky(doc, { x: 40, y: 50 }) as string;
    const ytext = getStickyText(doc, id) as Y.Text;
    doc.transact(() => ytext.insert(0, SHORT_PHRASE), LOCAL_ORIGIN);
    updates.reset();

    expect(setStickyColor(doc, id, 'green')).toBe(true);
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);

    const note = snapshot(doc)[0];
    expect(note).toMatchObject({
      id,
      x: 40 - HALF,
      y: 50 - HALF,
      color: 'green',
      text: SHORT_PHRASE,
      z: 1,
    });
  });

  it('TC-06 rejects an unknown colour with false, no update and no change', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    updates.reset();
    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)[0]?.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('rejects a stale id and a non-string colour', () => {
    expect(setStickyColor(doc, 'missing-id', 'blue')).toBe(false);
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    updates.reset();
    expect(setStickyColor(doc, 'missing-id', 'blue')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(setStickyColor(doc, id, 42 as any)).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('accepts all six preset colours by name', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const names = Object.keys(STICKY_COLORS) as StickyColor[];
    expect(names).toEqual(['yellow', 'orange', 'green', 'blue', 'pink', 'violet']);
    for (const name of names) {
      expect(isStickyColor(name)).toBe(true);
      setStickyColor(doc, id, name);
      expect(snapshot(doc)[0]?.color).toBe(name);
    }
    expect(isStickyColor('teal')).toBe(false);
    expect(isStickyColor(undefined)).toBe(false);
  });
});

describe('deleteObject', () => {
  it('TC-07 removes the note from the document', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    updates.reset();
    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objects().has(id)).toBe(false);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08 rejects a stale id with false and no update', () => {
    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(updates.count()).toBe(0);
  });
});

describe('bringToFront', () => {
  it('TC-09 restacks the bottom note of three to the top', () => {
    const first = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    updates.reset();

    expect(bringToFront(doc, first)).toBe(true);
    expect(updates.count()).toBe(1);
    expect(updates.origins()[0]).toBe(LOCAL_ORIGIN);
    expect(zOf(first)).toBe(4);
    expect(snapshot(doc).map((note) => note.id)[2]).toBe(first);
  });

  it('TC-10 does not touch the document when the note is already topmost', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 }) as string;
    updates.reset();
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(zOf(top)).toBe(2);
  });

  it('TC-11 treats an equal z as topmost and leaves the doc alone', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 300, y: 0 }) as string;
    forceZ(b, 1);
    updates.reset();
    expect(bringToFront(doc, b)).toBe(false);
    expect(updates.count()).toBe(0);
    updates.reset();
    expect(bringToFront(doc, a)).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('rejects a stale id with false and no update', () => {
    createSticky(doc, { x: 0, y: 0 });
    updates.reset();
    expect(bringToFront(doc, 'missing-id')).toBe(false);
    expect(updates.count()).toBe(0);
  });
});

describe('snapshot', () => {
  it('TC-11 orders equal z values by id, deterministically across calls', () => {
    const ids = [createSticky(doc, { x: 0, y: 0 }), createSticky(doc, { x: 300, y: 0 })].map(
      String,
    );
    for (const id of ids) forceZ(id, 1);
    const byId = [...ids].sort();
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((note) => note.id)).toEqual(byId);
    expect(second.map((note) => note.id)).toEqual(byId);
    expect(first).toEqual(second);
    // A stable order is also independent of the map's insertion order.
    expect(first.map((note) => note.id)).toEqual(second.map((note) => note.id));
  });

  it('orders by z before id', () => {
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 300, y: 0 }) as string;
    forceZ(a, 9);
    forceZ(b, 2);
    expect(snapshot(doc).map((note) => note.id)).toEqual([b, a]);
  });

  it('TC-12 skips objects of an unknown type and does not throw', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    objects().set('shape-1', shape);
    objects().set('garbage', 'not-a-map' as unknown as Y.Map<unknown>);
    updates.reset();
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(id);
    expect(updates.count()).toBe(0);
  });

  it('reflects text edits made through the shared Y.Text', () => {
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const ytext = getStickyText(doc, id) as Y.Text;
    expect(snapshot(doc)[0]?.text).toBe('');
    doc.transact(() => ytext.insert(0, LONG_PROSE_1000), LOCAL_ORIGIN);
    expect(snapshot(doc)[0]?.text).toBe(LONG_PROSE_1000);
  });

  it('returns an immutable empty array for a doc that was never touched', () => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    expect(snapshot(fresh)).toEqual([]);
  });
});
