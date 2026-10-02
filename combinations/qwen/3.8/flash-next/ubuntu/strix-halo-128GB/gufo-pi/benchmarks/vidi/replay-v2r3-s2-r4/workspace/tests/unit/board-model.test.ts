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
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '../../src/shared/config';

const HALF = STICKY_SIZE_WORLD / 2;

/** Counts `update` events emitted by a doc (1 per successful transaction, 0 for rejections). */
function updateCounter(doc: Y.Doc) {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    stop() {
      doc.off('update', handler);
    },
  };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const OBJECTS = 'objects';
const META = 'meta';

/** Force a `z` value directly (bypasses the model, for stacking edge cases). */
function forceZ(doc: Y.Doc, id: string, z: number): void {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS);
  const obj = objects.get(id);
  if (!obj) throw new Error(`missing object ${id}`);
  obj.set('z', z);
}

describe('board.model: document initialisation', () => {
  it('initDoc sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const counter = updateCounter(doc);

    initDoc(doc);
    const meta = doc.getMap<number>(META);
    expect(meta.get('schemaVersion')).toBe(1);
    expect(counter.count).toBe(1);

    // A second initDoc must not overwrite the version or emit another update.
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(1);
    expect(counter.count).toBe(1);

    counter.stop();
    doc.destroy();
  });
});

describe('board.model: create', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = newDoc();
  });

  it('TC-01: creates the first sticky centred on the point, yellow, empty text, z 1', () => {
    const counter = updateCounter(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    expect(typeof id).toBe('string');
    expect(counter.count).toBe(1);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred on the click point: top-left = point - size / 2
    expect(note.x).toBeCloseTo(-HALF, 6);
    expect(note.y).toBeCloseTo(-HALF, 6);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(getStickyText(doc, id!)?.toString()).toBe('');

    counter.stop();
    doc.destroy();
  });

  it('TC-01b: create is centred for an arbitrary point and accepts an explicit colour', () => {
    const id = createSticky(doc, { x: 640, y: 400 }, 'blue');
    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.x).toBeCloseTo(640 - HALF, 6);
    expect(note.y).toBeCloseTo(400 - HALF, 6);
    expect(note.color).toBe('blue');
    doc.destroy();
  });

  it('TC-02: a new sticky stacks above existing ones (z 1, 2 -> new z 3)', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const counter = updateCounter(doc);

    const id = createSticky(doc, { x: 600, y: 0 });

    expect(counter.count).toBe(1);
    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.z).toBe(3);

    counter.stop();
    doc.destroy();
  });
});

describe('board.model: move', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = newDoc();
    // Point (100, 100) -> top-left (0, 0)
    const created = createSticky(doc, { x: 100, y: 100 }, 'green');
    id = created!;
    const note = snapshot(doc)[0]!;
    expect(note.x).toBe(0);
    expect(note.y).toBe(0);
  });

  it('TC-03: moveObject updates x and y only', () => {
    const before = snapshot(doc)[0]!;
    const counter = updateCounter(doc);

    expect(moveObject(doc, id, 10, -20)).toBe(true);

    expect(counter.count).toBe(1);
    const after = snapshot(doc)[0]!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);

    counter.stop();
    doc.destroy();
  });

  it('TC-04: moveObject on a stale id returns false and emits no update', () => {
    const counter = updateCounter(doc);

    expect(moveObject(doc, 'missing-id', 5, 5)).toBe(false);
    expect(counter.count).toBe(0);
    expect(snapshot(doc)[0]!.x).toBe(0);

    counter.stop();
    doc.destroy();
  });

  it('TC-39: non-finite coordinates are rejected for moveObject and createSticky', () => {
    const counter = updateCounter(doc);
    const before = snapshot(doc);

    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NaN)).toBe(false);
    expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(counter.count).toBe(0);

    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    expect(counter.count).toBe(0);

    expect(snapshot(doc)).toEqual(before);

    counter.stop();
    doc.destroy();
  });
});

describe('board.model: colour', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = newDoc();
    id = createSticky(doc, { x: 100, y: 100 })!;
  });

  it('TC-05: setStickyColor changes only the colour', () => {
    const before = snapshot(doc)[0]!;
    expect(before.color).toBe(DEFAULT_STICKY_COLOR);
    const counter = updateCounter(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(true);

    expect(counter.count).toBe(1);
    const after = snapshot(doc)[0]!;
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);

    counter.stop();
    doc.destroy();
  });

  it('TC-05b: accepts every colour in STICKY_COLORS', () => {
    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      // The note starts as DEFAULT_STICKY_COLOR; re-applying it is the documented no-op.
      if (color === DEFAULT_STICKY_COLOR) continue;
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(snapshot(doc)[0]!.color).toBe(color);
    }
    doc.destroy();
  });

  it('TC-05c: selecting the colour a note already has is a no-op (false, no update)', () => {
    const counter = updateCounter(doc);
    expect(setStickyColor(doc, id, DEFAULT_STICKY_COLOR)).toBe(false);
    expect(counter.count).toBe(0);
    counter.stop();
    doc.destroy();
  });

  it('TC-06: an unknown colour returns false, changes nothing and emits no update', () => {
    const counter = updateCounter(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(counter.count).toBe(0);
    expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);

    // A stale id is rejected too.
    expect(setStickyColor(doc, 'missing-id', 'green')).toBe(false);
    expect(counter.count).toBe(0);

    counter.stop();
    doc.destroy();
  });
});

describe('board.model: delete', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = newDoc();
    id = createSticky(doc, { x: 0, y: 0 })!;
  });

  it('TC-07: deleteObject removes the note', () => {
    expect(snapshot(doc)).toHaveLength(1);
    const counter = updateCounter(doc);

    expect(deleteObject(doc, id)).toBe(true);

    expect(counter.count).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();

    counter.stop();
    doc.destroy();
  });

  it('TC-08: deleteObject on a stale id returns false and emits no update', () => {
    const counter = updateCounter(doc);

    expect(deleteObject(doc, 'missing-id')).toBe(false);
    expect(counter.count).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);

    counter.stop();
    doc.destroy();
  });
});

describe('board.model: stacking', () => {
  let doc: Y.Doc;
  let a: string;
  let b: string;
  let c: string;

  beforeEach(() => {
    doc = newDoc();
    a = createSticky(doc, { x: 0, y: 0 })!;
    b = createSticky(doc, { x: 300, y: 0 })!;
    c = createSticky(doc, { x: 600, y: 0 })!;
  });

  it('TC-09: bringToFront raises z 1 of 3 to max z + 1 = 4', () => {
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);
    const counter = updateCounter(doc);

    expect(bringToFront(doc, a)).toBe(true);

    expect(counter.count).toBe(1);
    const ordered = snapshot(doc);
    expect(ordered.map((n) => n.id)).toEqual([b, c, a]);
    expect(ordered[2]!.z).toBe(4);

    counter.stop();
    doc.destroy();
  });

  it('TC-10: bringToFront on the topmost note is a no-op with no update', () => {
    const counter = updateCounter(doc);

    expect(bringToFront(doc, c)).toBe(false);
    expect(counter.count).toBe(0);
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);

    counter.stop();
    doc.destroy();
  });

  it('TC-10b: bringToFront on a stale id returns false and emits no update', () => {
    const counter = updateCounter(doc);
    expect(bringToFront(doc, 'missing-id')).toBe(false);
    expect(counter.count).toBe(0);
    counter.stop();
    doc.destroy();
  });

  it('TC-11: equal z values are ordered by id as a stable tie-break', () => {
    // Force all three notes to the same z (possible once story 3 syncs peers).
    forceZ(doc, a, 5);
    forceZ(doc, b, 5);
    forceZ(doc, c, 5);

    const ids = [a, b, c].slice().sort();
    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);

    expect(first).toEqual(ids);
    expect(second).toEqual(ids);
  });
});

describe('board.model: snapshot reads', () => {
  it('TC-12: objects of unknown type are skipped without throwing', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;

    // Forward compatibility: stories 9-12 add types this build does not know.
    const objects = doc.getMap<Y.Map<unknown>>(OBJECTS);
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 10);
    shape.set('y', 20);
    objects.set('shape-1', shape);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(id);

    doc.destroy();
  });

  it('snapshot reflects text written through getStickyText', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 })!;
    const ytext = getStickyText(doc, id)!;
    ytext.insert(0, 'Faster onboarding');

    expect(snapshot(doc)[0]!.text).toBe('Faster onboarding');
    expect(getStickyText(doc, 'missing-id')).toBeUndefined();

    doc.destroy();
  });

  it('mutations run under LOCAL_ORIGIN', () => {
    const doc = newDoc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: { origin: unknown }) => {
      origins.push(tr.origin);
    });

    const id = createSticky(doc, { x: 0, y: 0 })!;
    createSticky(doc, { x: 300, y: 0 })!; // so bringToFront has somewhere to go
    moveObject(doc, id, 1, 1);
    setStickyColor(doc, id, 'pink');
    bringToFront(doc, id);
    deleteObject(doc, id);

    // The handler is attached after initDoc: 2 creates, move, colour, bringToFront, delete.
    expect(origins).toEqual([
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
      LOCAL_ORIGIN,
    ]);

    doc.destroy();
  });
});
