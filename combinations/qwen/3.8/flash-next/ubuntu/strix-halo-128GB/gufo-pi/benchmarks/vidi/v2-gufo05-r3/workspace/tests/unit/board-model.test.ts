import { describe, expect, it } from 'vitest';
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
} from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/** Count the `update` events a doc emits while `fn` runs. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const listener = () => {
    n += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return n;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function rawSticky(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = objectsMap(doc).get(id);
  if (!m) throw new Error(`no object with id ${id}`);
  return m;
}

describe('board.model: schema', () => {
  it('initDoc sets meta.schemaVersion once and does not overwrite it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

    // Second call is a no-op (a migration would not run twice).
    doc.getMap('meta').set('schemaVersion', 7);
    countUpdates(doc, () => initDoc(doc));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(7);
  });

  it('TC-01 createSticky on an empty doc adds one yellow sticky with z 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(objectsMap(doc).size).toBe(0);

    const updates = countUpdates(doc, () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      expect(typeof id).toBe('string');
      const m = rawSticky(doc, id);
      expect(m.get('type')).toBe('sticky');
      expect(m.get('color')).toBe(DEFAULT_STICKY_COLOR);
      expect(m.get('color')).toBe('yellow');
      expect((m.get('text') as Y.Text).toString()).toBe('');
      expect(m.get('z')).toBe(1);
      expect(typeof m.get('createdAt')).toBe('number');
    });
    expect(objectsMap(doc).size).toBe(1);
    expect(updates).toBe(1);
  });

  it('TC-01b createSticky centres the note: top-left = point − STICKY_SIZE_WORLD / 2', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 400, y: 300 });
    const m = rawSticky(doc, id);
    expect(m.get('x')).toBe(400 - STICKY_SIZE_WORLD / 2);
    expect(m.get('y')).toBe(300 - STICKY_SIZE_WORLD / 2);
  });

  it('TC-02 createSticky stacks on top: existing z 1, 2 → new z 3', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      const third = createSticky(doc, { x: 10, y: 10 });
      expect(rawSticky(doc, third).get('z')).toBe(3);
    });
    expect(updates).toBe(1);
  });

  it('createSticky accepts an explicit colour', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');
    expect(rawSticky(doc, id).get('color')).toBe('violet');
  });

  it('getStickyText returns the note Y.Text, undefined for a stale id', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    ytext?.insert(0, 'hello');
    expect(getStickyText(doc, id)?.toString()).toBe('hello');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });
});

describe('board.model: moveObject', () => {
  it('TC-03 moveObject updates x,y and leaves every other field alone', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = rawSticky(doc, id);
    const beforeText = (before.get('text') as Y.Text).toString();
    const createdAt = before.get('createdAt');
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');

    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, id, 10, -20)).toBe(true);
    });
    const after = rawSticky(doc, id);
    expect(after.get('x')).toBe(10);
    expect(after.get('y')).toBe(-20);
    expect(after.get('type')).toBe('sticky');
    expect(after.get('color')).toBe(DEFAULT_STICKY_COLOR);
    expect(after.get('z')).toBe(1);
    expect(after.get('createdAt')).toBe(createdAt);
    expect((after.get('text') as Y.Text).toString()).toBe('Faster onboarding');
    expect(beforeText).toBe('');
    expect(updates).toBe(1);
  });

  it('TC-04 moveObject on a stale id returns false and emits no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const size = objectsMap(doc).size;
    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, 'stale-id', 5, 5)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(size);
  });

  it('TC-39 moveObject with non-finite coordinates returns false and writes nothing', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 1, y: 2 });
    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      const updates = countUpdates(doc, () => {
        expect(moveObject(doc, id, x, y)).toBe(false);
      });
      expect(updates).toBe(0);
      expect(rawSticky(doc, id).get('x')).toBe(1 - STICKY_SIZE_WORLD / 2);
      expect(rawSticky(doc, id).get('y')).toBe(2 - STICKY_SIZE_WORLD / 2);
    }
  });

  it('TC-39 createSticky with non-finite coordinates writes nothing', () => {
    const doc = new Y.Doc();
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      const updates = countUpdates(doc, () => {
        const id = createSticky(doc, at);
        // Rejection is signalled by an empty (falsy) id.
        expect(id).toBeFalsy();
      });
      expect(updates).toBe(0);
      expect(objectsMap(doc).size).toBe(0);
    }
  });
});

describe('board.model: setStickyColor', () => {
  it('TC-05 setStickyColor changes only the colour', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 30, y: -40 });
    getStickyText(doc, id)?.insert(0, 'Retro item');
    const createdAt = rawSticky(doc, id).get('createdAt');

    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });
    const m = rawSticky(doc, id);
    expect(m.get('color')).toBe('green');
    expect(m.get('x')).toBe(30 - STICKY_SIZE_WORLD / 2);
    expect(m.get('y')).toBe(-40 - STICKY_SIZE_WORLD / 2);
    expect(m.get('z')).toBe(1);
    expect(m.get('createdAt')).toBe(createdAt);
    expect((m.get('text') as Y.Text).toString()).toBe('Retro item');
    expect(updates).toBe(1);
  });

  it.each(Object.keys(STICKY_COLORS))('accepts the preset colour %s', (name) => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 }); // already DEFAULT_STICKY_COLOR
    // Setting the colour a note already has is a no-op (false, no write); every
    // other preset is applied.
    const applies = name !== DEFAULT_STICKY_COLOR;
    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, name)).toBe(applies);
    });
    expect(updates).toBe(applies ? 1 : 0);
    expect(rawSticky(doc, id).get('color')).toBe(name);
  });

  it('TC-06 setStickyColor with an unknown colour returns false and emits no update', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(rawSticky(doc, id).get('color')).toBe(DEFAULT_STICKY_COLOR);
    expect(setStickyColor(doc, id, '')).toBe(false);
    expect(setStickyColor(doc, id, 'YELLOW')).toBe(false);
    expect(setStickyColor(doc, 'stale-id', 'green')).toBe(false);
  });
});

describe('board.model: deleteObject', () => {
  it('TC-07 deleteObject removes the note', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(objectsMap(doc).size).toBe(1);
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(objectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates).toBe(1);
  });

  it('TC-08 deleteObject on a stale id returns false and emits no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, 'stale-id')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(objectsMap(doc).size).toBe(1);
  });
});

describe('board.model: stacking and snapshot', () => {
  function idsOf(list: readonly { id: string }[]): string[] {
    return list.map((s) => s.id);
  }

  it('TC-09 bringToFront moves z 1 (of 3) to 4', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 0, y: 0 });
    const c = createSticky(doc, { x: 0, y: 0 });
    expect([a, b, c].map((id) => rawSticky(doc, id).get('z'))).toEqual([1, 2, 3]);

    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, a)).toBe(true);
    });
    expect(rawSticky(doc, a).get('z')).toBe(4);
    expect(rawSticky(doc, b).get('z')).toBe(2);
    expect(rawSticky(doc, c).get('z')).toBe(3);
    expect(idsOf(snapshot(doc))).toEqual([b, c, a]);
    expect(updates).toBe(1);
  });

  it('TC-10 bringToFront on the topmost note returns false and emits no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(rawSticky(doc, top).get('z')).toBe(2);
    expect(bringToFront(doc, 'stale-id')).toBe(false);
  });

  it('TC-11 equal z values are ordered by id as a stable tie-break', () => {
    const doc = new Y.Doc();
    // Two notes forced to the same z, as concurrent creation could produce once
    // story 3 syncs.
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 0, y: 0 });
    rawSticky(doc, first).set('z', 1);
    rawSticky(doc, second).set('z', 1);
    const [lowId, highId] = [first, second].sort((p, q) => (p < q ? -1 : 1));

    const a = snapshot(doc);
    const b = snapshot(doc);
    expect(a).toHaveLength(2);
    expect(idsOf(a)).toEqual([lowId, highId]);
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('TC-12 snapshot skips objects of unknown type without throwing', () => {
    const doc = new Y.Doc();
    const sticky = createSticky(doc, { x: 0, y: 0 }, 'blue');
    const shapes = new Y.Map<unknown>();
    shapes.set('type', 'shape');
    shapes.set('x', 0);
    shapes.set('y', 0);
    shapes.set('z', 5);
    objectsMap(doc).set('shape-1', shapes);

    const list = snapshot(doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: sticky,
      type: 'sticky',
      color: 'blue',
      z: 1,
      text: '',
    });
  });

  it('snapshot returns plain immutable data with x, y, text and createdAt', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 100, y: 200 });
    getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    const list = snapshot(doc);
    expect(list).toEqual([
      {
        id,
        type: 'sticky',
        x: 100 - STICKY_SIZE_WORLD / 2,
        y: 200 - STICKY_SIZE_WORLD / 2,
        color: 'yellow',
        text: 'Faster onboarding',
        z: 1,
        createdAt: expect.any(Number),
      },
    ]);
  });

  it('successful mutations are transacted with LOCAL_ORIGIN', () => {
    const doc = new Y.Doc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });

    const origins: unknown[] = [];
    const observer = (_updates: Uint8Array, origin: unknown) => {
      origins.push(origin);
    };
    doc.on('update', observer);
    moveObject(doc, bottom, 1, 1);
    setStickyColor(doc, bottom, 'pink');
    bringToFront(doc, bottom);
    deleteObject(doc, bottom);
    doc.off('update', observer);
    expect(origins).toHaveLength(4);
    for (const origin of origins) expect(origin).toBe(LOCAL_ORIGIN);
  });
});

/**
 * Story 3 will put this document on the network. These tests fix the guarantees
 * story 2 depends on when a second replica exists: updates from elsewhere merge
 * into the same note instead of duplicating or overwriting it. A second `Y.Doc`
 * fed through `Y.encodeStateAsUpdate` / `Y.applyUpdate` is exactly what a sync
 * provider will drive, minus the transport.
 */
function replicas(): { a: Y.Doc; b: Y.Doc } {
  const a = new Y.Doc();
  const b = new Y.Doc();
  initDoc(a);
  initDoc(b);
  // The handshake a sync provider performs before relaying live updates: an
  // update is only valid for a replica that already has the state it was made
  // against.
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== b) Y.applyUpdate(b, update, a);
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== a) Y.applyUpdate(a, update, b);
  });
  return { a, b };
}

describe('board.model: a second replica merges (story 3 readiness)', () => {
  it('concurrent text edits from both replicas are both present after merging', () => {
    const { a, b } = replicas();
    const id = createSticky(a, { x: 0, y: 0 });
    expect(getStickyText(b, id)?.toString()).toBe('');

    getStickyText(a, id)?.insert(0, 'AAA');
    getStickyText(b, id)?.insert(0, 'BBB');

    expect(getStickyText(a, id)?.toString()).toContain('AAA');
    expect(getStickyText(a, id)?.toString()).toContain('BBB');
    expect(getStickyText(b, id)?.toString()).toBe(getStickyText(a, id)?.toString());
    // Merging must not create a second note.
    expect(snapshot(a)).toHaveLength(1);
    expect(snapshot(b)).toHaveLength(1);
  });

  it('a colour change made on one replica is visible on the other', () => {
    const { a, b } = replicas();
    const id = createSticky(a, { x: 0, y: 0 });
    expect(setStickyColor(b, id, 'green')).toBe(true);
    expect(snapshot(a)[0].color).toBe('green');
  });

  it('a move made on one replica is visible on the other', () => {
    const { a, b } = replicas();
    const id = createSticky(a, { x: 0, y: 0 });
    expect(moveObject(b, id, 120, -40)).toBe(true);
    const moved = snapshot(a)[0];
    expect(moved.x).toBe(120);
    expect(moved.y).toBe(-40);
  });

  it('a delete on one replica removes the note everywhere and its text is gone', () => {
    const { a, b } = replicas();
    const id = createSticky(a, { x: 0, y: 0 });
    getStickyText(a, id)?.insert(0, 'shared');
    expect(deleteObject(b, id)).toBe(true);
    expect(snapshot(a)).toHaveLength(0);
    expect(getStickyText(a, id)).toBeUndefined();
  });

  it('concurrent creates keep both notes, ordered by (z, id)', () => {
    const { a, b } = replicas();
    const idA = createSticky(a, { x: 0, y: 0 });
    const idB = createSticky(b, { x: 500, y: 0 });
    const ids = snapshot(a).map((note) => note.id).sort();
    expect(ids).toEqual([idA, idB].sort());
    expect(snapshot(b).length).toBe(2);
  });
});
