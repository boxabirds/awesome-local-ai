import { describe, it, expect } from 'vitest';
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
} from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
} from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';

/** Counts Y.Doc `update` events (1 per successful transaction, 0 for rejections). */
function updateCounter(doc: Y.Doc) {
  let n = 0;
  const handler = () => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Create a note whose top-left lands exactly on (0,0). */
function createAtOrigin(doc: Y.Doc, color?: StickyColor): string {
  return createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 }, color);
}

describe('board.model — initDoc', () => {
  it('sets meta.schemaVersion once and does not overwrite it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap<unknown>('meta');
    expect(meta.get('schemaVersion')).toBe(1);

    meta.set('schemaVersion', 2);
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(2);
  });
});

describe('board.model — create (TC-01, TC-02)', () => {
  it('TC-01 creates the first note centred on the point, yellow, empty text, z 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stop = updateCounter(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    const notes = snapshot(doc);
    expect(objectsMap(doc).size).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(notes[0].type).toBe('sticky');
    expect(notes[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(notes[0].text).toBe('');
    expect(notes[0].z).toBe(1);
    // centred on the click point: top-left = point - size/2
    expect(notes[0].x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(typeof notes[0].createdAt).toBe('number');
    expect(stop()).toBe(1);
  });

  it('TC-01b uses the supplied colour', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    const id = createSticky(doc, { x: 10, y: 10 }, 'blue');
    const notes = snapshot(doc);
    expect(notes.find((n) => n.id === id)?.color).toBe('blue');
    expect(stop()).toBe(1);
  });

  it('TC-02 stacks new notes above existing ones (z 1,2 -> 3)', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);

    createSticky(doc, { x: 100, y: 0 });
    const notes = snapshot(doc);
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.z)).toEqual([1, 2, 3]);
    expect(stop()).toBe(3);
  });

  it('getStickyText returns the Y.Text of a note and undefined for a stale id', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext?.toString()).toBe('');
    expect(getStickyText(doc, 'does-not-exist')).toBeUndefined();
  });
});

describe('board.model — move (TC-03, TC-04, TC-09, TC-10)', () => {
  it('TC-03 moveObject updates only x and y', () => {
    const doc = new Y.Doc();
    const id = createAtOrigin(doc);
    const before = snapshot(doc)[0];
    expect([before.x, before.y]).toEqual([0, 0]);
    const stop = updateCounter(doc);

    expect(moveObject(doc, id, 10, -20)).toBe(true);

    const after = snapshot(doc)[0];
    expect([after.x, after.y]).toEqual([10, -20]);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(stop()).toBe(1);
  });

  it('TC-04 moveObject on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    expect(moveObject(doc, 'stale-id', 5, 5)).toBe(false);
    expect(stop()).toBe(0);
  });

  it('TC-09 bringToFront raises the bottom note above all others', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 0 });
    createSticky(doc, { x: 20, y: 0 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);
    const stop = updateCounter(doc);

    expect(bringToFront(doc, a)).toBe(true);

    const ordered = snapshot(doc);
    expect(ordered.find((n) => n.id === a)?.z).toBe(4);
    expect(ordered.map((n) => n.z)).toEqual([2, 3, 4]);
    expect(stop()).toBe(1);
  });

  it('TC-10 bringToFront on the topmost note returns false with no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 0 });
    const stop = updateCounter(doc);

    expect(bringToFront(doc, top)).toBe(false);
    expect(snapshot(doc).find((n) => n.id === top)?.z).toBe(2);
    expect(stop()).toBe(0);
  });

  it('bringToFront on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    expect(bringToFront(doc, 'stale-id')).toBe(false);
    expect(stop()).toBe(0);
  });
});

describe('board.model — colour (TC-05, TC-06)', () => {
  it('TC-05 setStickyColor changes only the colour', () => {
    const doc = new Y.Doc();
    const id = createAtOrigin(doc);
    const before = snapshot(doc)[0];
    const stop = updateCounter(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(true);

    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(stop()).toBe(1);
  });

  it.each(Object.keys(STICKY_COLORS) as StickyColor[])(
    'accepts the preset colour %s',
    (color) => {
      const doc = new Y.Doc();
      // Start from a different colour: setting the current colour is a no-op.
      const id = createSticky(doc, { x: 0, y: 0 }, color === 'blue' ? 'pink' : 'blue');
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(snapshot(doc)[0].color).toBe(color);
    },
  );

  it('setting the colour the note already has is a no-op (false, 0 updates)', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);
    expect(setStickyColor(doc, id, DEFAULT_STICKY_COLOR)).toBe(false);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(stop()).toBe(0);
  });

  it('TC-06 unknown colour returns false, writes nothing, emits no update', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(stop()).toBe(0);
  });

  it('setStickyColor on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    expect(setStickyColor(doc, 'stale-id', 'green')).toBe(false);
    expect(stop()).toBe(0);
  });
});

describe('board.model — delete (TC-07, TC-08)', () => {
  it('TC-07 deleteObject removes the note', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    const stop = updateCounter(doc);

    expect(deleteObject(doc, id)).toBe(true);

    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsMap(doc).size).toBe(0);
    expect(stop()).toBe(1);
  });

  it('TC-08 deleteObject on a stale id returns false with no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const stop = updateCounter(doc);

    expect(deleteObject(doc, 'stale-id')).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
    expect(stop()).toBe(0);
  });
});

describe('board.model — snapshot ordering and forward compatibility (TC-11, TC-12)', () => {
  function withEqualZ(doc: Y.Doc, ids: string[], z: number) {
    doc.transact(() => {
      const objects = objectsMap(doc);
      for (const id of ids) {
        objects.get(id)?.set('z', z);
      }
    });
  }

  it('TC-11 sorts equal z by id as a stable tie-break', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 10, y: 0 });
    const c = createSticky(doc, { x: 20, y: 0 });
    withEqualZ(doc, [a, b, c], 7);

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    const expected = [a, b, c].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
  });

  it('TC-12 skips objects of unknown type without throwing', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 3);
      shape.set('y', 4);
      objectsMap(doc).set('shape-1', shape);
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
  });

  it('snapshot returns plain immutable-looking objects sorted by (z, id)', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 100 });
    setStickyColor(doc, b, 'pink');
    const notes = snapshot(doc);
    expect(notes[0].id).toBe(a);
    expect(notes[1].id).toBe(b);
    expect(notes[1].color).toBe('pink');
  });
});

describe('board.model — non-finite coordinates (TC-39)', () => {
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it.each(bad)('moveObject rejects %s', (value) => {
    const doc = new Y.Doc();
    const id = createAtOrigin(doc);
    const before = snapshot(doc)[0];
    const stop = updateCounter(doc);

    expect(moveObject(doc, id, value, 0)).toBe(false);
    expect(moveObject(doc, id, 0, value)).toBe(false);

    expect(snapshot(doc)[0].x).toBe(before.x);
    expect(snapshot(doc)[0].y).toBe(before.y);
    expect(stop()).toBe(0);
  });

  it.each(bad)('createSticky rejects %s', (value) => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);

    const id = createSticky(doc, { x: value, y: 0 });
    expect(Boolean(id)).toBe(false);
    expect(snapshot(doc)).toHaveLength(0);
    expect(stop()).toBe(0);
  });

  it('rejects a non-object point without throwing', () => {
    const doc = new Y.Doc();
    const stop = updateCounter(doc);
    const id = createSticky(doc, undefined as unknown as { x: number; y: number });
    expect(Boolean(id)).toBe(false);
    expect(stop()).toBe(0);
  });
});

describe('board.model — transaction origin', () => {
  it('successful mutations use LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 100 });
    const origins: unknown[] = [];
    const handler = (_updates: unknown, origin: unknown) => origins.push(origin);
    doc.on('update', handler);

    moveObject(doc, id, 1, 1);
    setStickyColor(doc, id, 'violet');
    bringToFront(doc, id);
    deleteObject(doc, id);

    doc.off('update', handler);
    expect(origins).toHaveLength(4);
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });
});
