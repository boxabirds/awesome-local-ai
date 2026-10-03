import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  bringToFront,
  createSticky,
  deleteObject,
  DOC_META_MAP,
  DOC_OBJECTS_MAP,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  SCHEMA_VERSION,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.js';
import {
  DEFAULT_STICKY_COLOR,
  isStickyColor,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  type StickyColor,
} from '../../src/shared/config.js';

/**
 * Unit tests for the board document model (design anchor `board.model`).
 * These run against a **real** Y.Doc: the document is the store under test, it
 * is deterministic in process, and mocking it would hide the merge/observe
 * behaviour story 3 and story 4 depend on.
 */

/** Half a note: creation is centred, so the top-left is the point minus this. */
const HALF = STICKY_SIZE_WORLD / 2;
/** The colour a new note gets (sticky.create_dblclick: "a yellow note"). */
const YELLOW: StickyColor = DEFAULT_STICKY_COLOR;
/** A different valid colour, and one that is not in STICKY_COLORS. */
const GREEN = 'green';
const UNKNOWN_COLOR = 'teal';
/** The point the tests create at. */
const POINT = { x: 0, y: 0 };

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown>>;

/**
 * Counts `update` events (one per transaction). The design's contract is
 * "one transaction per successful call, none per rejection", so every
 * mutation test asserts this count: 1 on success, 0 on rejection.
 */
class UpdateCount {
  private count = 0;
  readonly origins: unknown[] = [];

  constructor(doc: Y.Doc) {
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      this.count += 1;
      this.origins.push(origin);
    });
  }

  get value(): number {
    return this.count;
  }

  /** Ignore everything so far (document setup), so the next count is clean. */
  reset(): void {
    this.taken = this.count;
    this.origins.length = this.count;
  }

  /** Updates since the last `take`/`reset`; each must come from LOCAL_ORIGIN. */
  private taken = 0;

  take(): number {
    const delta = this.count - this.taken;
    const newOrigins = this.origins.slice(this.taken);
    this.taken = this.count;
    for (const origin of newOrigins) {
      expect(origin).toBe(LOCAL_ORIGIN);
    }
    return delta;
  }
}

/** Write an object map directly: how the tests build pre-existing state. */
function putObject(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const objects = objectsOf(doc);
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, value);
    }
    objects.set(id, map);
  }, LOCAL_ORIGIN);
}

/** A raw object map with the sticky fields filled in (the doc's wire format). */
function stickyFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const text = new Y.Text();
  return {
    type: 'sticky',
    x: 0,
    y: 0,
    color: YELLOW,
    text,
    z: 1,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const byId = (notes: readonly StickySnapshot[], id: string): StickySnapshot => {
  const found = notes.find((note) => note.id === id);
  if (!found) throw new Error(`no sticky note with id ${id}`);
  return found;
};

let doc: Y.Doc;
let updates: UpdateCount;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = new UpdateCount(doc);
});

describe('initDoc', () => {
  it('writes meta.schemaVersion once and leaves it alone afterwards', () => {
    const meta = doc.getMap<unknown>(DOC_META_MAP);
    expect(meta.get('schemaVersion')).toBe(SCHEMA_VERSION);

    const before = updates.value;
    initDoc(doc);
    initDoc(doc);
    expect(updates.value).toBe(before);
    expect(meta.get('schemaVersion')).toBe(SCHEMA_VERSION);
  });

  it('does not disturb objects that are already in the document', () => {
    const id = createSticky(doc, POINT);
    expect(typeof id).toBe('string');
    initDoc(doc);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('createSticky', () => {
  it('TC-01 creates the first note, centred, yellow, empty and at z 1', () => {
    expect(snapshot(doc)).toHaveLength(0);

    const id = createSticky(doc, POINT) as string;

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(objectsOf(doc).size).toBe(1);
    expect(updates.take()).toBe(1);

    const note = byId(snapshot(doc), id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(YELLOW);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // "a yellow square note appears centred on that spot": the stored position
    // is the top-left, i.e. the point minus half the note size.
    expect(note.x).toBe(POINT.x - HALF);
    expect(note.y).toBe(POINT.y - HALF);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('');
  });

  it('TC-01 places the note centred on an arbitrary point too', () => {
    const id = createSticky(doc, { x: -320.5, y: 97.25 }) as string;
    const note = byId(snapshot(doc), id);
    expect(note.x).toBeCloseTo(-320.5 - HALF, 9);
    expect(note.y).toBeCloseTo(97.25 - HALF, 9);
  });

  it('TC-02 stacks a new note above existing ones (z = max z + 1)', () => {
    createSticky(doc, { x: 10, y: 0 });
    createSticky(doc, { x: 400, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2]);
    updates.reset();

    const id = createSticky(doc, { x: 0, y: 300 }) as string;
    expect(updates.take()).toBe(1);
    expect(byId(snapshot(doc), id).z).toBe(3);
  });

  it('uses the requested colour when it is one of the six', () => {
    const id = createSticky(doc, POINT, GREEN) as string;
    expect(byId(snapshot(doc), id).color).toBe(GREEN);
    expect(updates.take()).toBe(1);
  });

  it('TC-39 rejects non-finite coordinates without touching the document', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const x of bad) {
      expect(createSticky(doc, { x, y: 0 })).toBe(false);
      expect(createSticky(doc, { x: 0, y: x })).toBe(false);
      expect(createSticky(doc, { x: x, y: x })).toBe(false);
    }
    expect(updates.take()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('rejects a colour name that is not in STICKY_COLORS', () => {
    expect(createSticky(doc, POINT, UNKNOWN_COLOR as StickyColor)).toBe(false);
    expect(updates.take()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('moveObject', () => {
  it('TC-03 writes the new top-left and nothing else', () => {
    const id = createSticky(doc, POINT, GREEN) as string;
    const before = byId(snapshot(doc), id);
    updates.reset();

    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updates.take()).toBe(1);

    const after = byId(snapshot(doc), id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  it('accepts far-away coordinates (the board is unbounded)', () => {
    const id = createSticky(doc, POINT) as string;
    expect(moveObject(doc, id, 1_000_000, -999_999.5)).toBe(true);
    const note = byId(snapshot(doc), id);
    expect(note.x).toBe(1_000_000);
    expect(note.y).toBe(-999_999.5);
  });

  it('TC-04 rejects a stale id with false and no update at all', () => {
    const id = createSticky(doc, POINT) as string;
    deleteObject(doc, id);
    const before = updates.value;

    expect(moveObject(doc, id, 5, 5)).toBe(false);
    expect(updates.value).toBe(before);
    expect(objectsOf(doc).size).toBe(0);
  });

  it('TC-39 rejects non-finite coordinates with false and no update', () => {
    const id = createSticky(doc, POINT) as string;
    const before = byId(snapshot(doc), id);
    updates.reset();

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(moveObject(doc, id, bad, 0)).toBe(false);
      expect(moveObject(doc, id, 0, bad)).toBe(false);
      expect(moveObject(doc, id, bad, bad)).toBe(false);
    }
    expect(updates.take()).toBe(0);

    const after = byId(snapshot(doc), id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('setStickyColor', () => {
  it('TC-05 changes only the colour of a selected note', () => {
    const id = createSticky(doc, { x: 40, y: -60 }) as string;
    moveObject(doc, id, 11, 12);
    const before = byId(snapshot(doc), id);
    updates.reset();

    expect(setStickyColor(doc, id, GREEN)).toBe(true);
    expect(updates.take()).toBe(1);

    const after = byId(snapshot(doc), id);
    expect(after.color).toBe(GREEN);
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('applies each of the six colour names', () => {
    const id = createSticky(doc, POINT) as string;
    for (const name of Object.keys(STICKY_COLORS) as StickyColor[]) {
      // Setting the colour the note already has is a no-op (returns false);
      // every other colour name is applied in its own transaction.
      const expected = byId(snapshot(doc), id).color === name ? false : true;
      updates.reset();
      expect(setStickyColor(doc, id, name)).toBe(expected);
      expect(updates.take()).toBe(expected ? 1 : 0);
      expect(byId(snapshot(doc), id).color).toBe(name);
    }
  });

  it('TC-06 rejects an unknown colour: unchanged, no update', () => {
    const id = createSticky(doc, POINT) as string;
    expect(byId(snapshot(doc), id).color).toBe(YELLOW);
    updates.reset();

    expect(setStickyColor(doc, id, UNKNOWN_COLOR)).toBe(false);
    expect(updates.take()).toBe(0);
    expect(byId(snapshot(doc), id).color).toBe(YELLOW);
    expect(objectsOf(doc).get(id)?.get('color')).toBe(YELLOW);
  });

  it('rejects a stale id and an unknown object with no update', () => {
    expect(setStickyColor(doc, 'missing-id', GREEN)).toBe(false);
    putObject(doc, 'shape-1', { type: 'shape', z: 1 });
    updates.reset();
    expect(setStickyColor(doc, 'shape-1', GREEN)).toBe(false);
    expect(updates.take()).toBe(0);
  });
});

describe('deleteObject', () => {
  it('TC-07 removes the note from the document', () => {
    const id = createSticky(doc, POINT) as string;
    expect(snapshot(doc)).toHaveLength(1);
    updates.reset();

    expect(deleteObject(doc, id)).toBe(true);
    expect(updates.take()).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsOf(doc).size).toBe(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('leaves the other notes alone', () => {
    const keep = createSticky(doc, { x: 0, y: 0 }) as string;
    const drop = createSticky(doc, { x: 500, y: 0 }) as string;

    expect(deleteObject(doc, drop)).toBe(true);
    expect(snapshot(doc).map((note) => note.id)).toEqual([keep]);
  });

  it('TC-08 rejects a stale id with false and no update', () => {
    const id = createSticky(doc, POINT) as string;
    deleteObject(doc, id);

    const before = updates.value;
    expect(deleteObject(doc, id)).toBe(false);
    expect(deleteObject(doc, 'never-existed')).toBe(false);
    expect(updates.value).toBe(before);
  });
});

describe('bringToFront', () => {
  it('TC-09 puts a bottom note above all the others (z 1 of 3 becomes 4)', () => {
    const first = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 300, y: 0 });
    createSticky(doc, { x: 600, y: 0 });
    expect(byId(snapshot(doc), first).z).toBe(1);
    updates.reset();

    expect(bringToFront(doc, first)).toBe(true);
    expect(updates.take()).toBe(1);

    const notes = snapshot(doc);
    expect(byId(notes, first).z).toBe(4);
    // only the stacking changed
    expect(byId(notes, first).x).toBe(-HALF);
    expect(byId(notes, first).y).toBe(-HALF);
    // and it is the last one drawn
    expect(notes[notes.length - 1]?.id).toBe(first);
  });

  it('TC-10 does nothing when the note is already topmost (no sync traffic)', () => {
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 300, y: 0 }) as string;

    const before = updates.value;
    expect(bringToFront(doc, top)).toBe(false);
    expect(updates.value).toBe(before);
  });

  it('rejects stale ids and objects it does not know', () => {
    expect(bringToFront(doc, 'missing-id')).toBe(false);
    putObject(doc, 'shape-1', { type: 'shape', z: 3 });
    updates.reset();
    expect(bringToFront(doc, 'shape-1')).toBe(false);
    expect(updates.take()).toBe(0);
  });
});

describe('snapshot', () => {
  it('TC-11 breaks equal z ties by id, identically on every call', () => {
    // Equal z is what story 3 can produce when two people create at once; the
    // render order must still be the same on every client.
    putObject(doc, 'b-note', stickyFields({ z: 5, x: 0 }));
    putObject(doc, 'a-note', stickyFields({ z: 5, x: 300 }));
    putObject(doc, 'c-note', stickyFields({ z: 5, x: 600 }));

    const first = snapshot(doc).map((note) => note.id);
    expect(first).toEqual(['a-note', 'b-note', 'c-note']);
    expect(snapshot(doc).map((note) => note.id)).toEqual(first);
  });

  it('sorts by z first and only then by id', () => {
    putObject(doc, 'z2', stickyFields({ z: 2 }));
    putObject(doc, 'z1', stickyFields({ z: 1 }));
    putObject(doc, 'z10', stickyFields({ z: 10 }));
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 10]);
  });

  it('TC-12 skips objects of an unknown type instead of throwing', () => {
    createSticky(doc, POINT);
    putObject(doc, 'shape-1', { type: 'shape', x: 0, y: 0, z: 2 });
    putObject(doc, 'image-1', { type: 'image', x: 0, y: 0, z: 3 });
    putObject(doc, 'no-type', { x: 0, y: 0, z: 4 });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe('sticky');
  });

  it('returns an immutable, self-contained copy of the text', () => {
    const id = createSticky(doc, POINT) as string;
    const text = getStickyText(doc, id);
    const before = snapshot(doc);
    expect(before[0]?.text).toBe('');

    text?.insert(0, 'Faster onboarding');
    const after = snapshot(doc);
    expect(after[0]?.text).toBe('Faster onboarding');
    // the earlier snapshot is not mutated in place
    expect(before[0]?.text).toBe('');
  });

  it('is empty for a fresh document', () => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    expect(snapshot(fresh)).toEqual([]);
  });
});

describe('getStickyText', () => {
  it('returns the shared Y.Text of a note, undefined for anything else', () => {
    const id = createSticky(doc, POINT) as string;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    updates.reset();

    doc.transact(() => text?.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    expect(updates.take()).toBe(1);
    expect(getStickyText(doc, id)?.toString()).toBe('Faster onboarding');

    expect(getStickyText(doc, 'missing-id')).toBeUndefined();
    putObject(doc, 'shape-1', { type: 'shape', z: 1 });
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
  });

  it('holds text up to the document limit', () => {
    const id = createSticky(doc, POINT) as string;
    const long = 'Faster onboarding for new teammates. '.repeat(40);
    getStickyText(doc, id)?.insert(0, long.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(getStickyText(doc, id)?.length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('settings sanity (config is the single source)', () => {
  it('knows the six colours and validates names against them', () => {
    expect(Object.keys(STICKY_COLORS)).toEqual([
      'yellow',
      'orange',
      'green',
      'blue',
      'pink',
      'violet',
    ]);
    expect(isStickyColor(YELLOW)).toBe(true);
    expect(isStickyColor(UNKNOWN_COLOR)).toBe(false);
    expect(isStickyColor(undefined)).toBe(false);
    expect(STICKY_SIZE_WORLD).toBe(200);
  });
});
