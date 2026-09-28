import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import {
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

/**
 * board.model contract, against a real Y.Doc (no mocks).
 *
 * Every mutation test also counts the `update` events the document emits:
 * exactly 1 for a successful change, 0 for a rejection or a no-op, because
 * story 3 pays for every emitted update on the wire.
 */

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count Y.Doc `update` events fired while `fn` runs. */
function countUpdates(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    fn();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function firstNote(doc: Y.Doc): StickySnapshot {
  const notes = snapshot(doc);
  if (notes.length === 0) throw new Error('expected at least one note');
  return notes[0]!;
}

describe('board.model: create', () => {
  // TC-01
  it('TC-01 creates a yellow sticky with empty text at z 1, centred on the point', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    let id = '';
    const updates = countUpdates(doc, () => {
      id = createSticky(doc, { x: 0, y: 0 });
    });

    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // The note's top-left is the point minus half the note size, so it is
    // centred where the user clicked.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('');
  });

  it('centres the note on an arbitrary point', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 123.5, y: -40 });
    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.x).toBeCloseTo(123.5 - STICKY_SIZE_WORLD / 2, 9);
    expect(note.y).toBeCloseTo(-40 - STICKY_SIZE_WORLD / 2, 9);
  });

  // TC-02
  it('TC-02 places a new note above existing ones (z = maxZ + 1)', () => {
    const doc = newDoc();
    // Hand-build two notes with z 1 and 2 so the test does not depend on
    // createSticky's own stacking maths.
    const a = new Y.Map<unknown>();
    a.set('type', 'sticky');
    a.set('x', 0);
    a.set('y', 0);
    a.set('color', 'yellow');
    a.set('text', new Y.Text(''));
    a.set('z', 1);
    a.set('createdAt', 1);
    const b = new Y.Map<unknown>();
    b.set('type', 'sticky');
    b.set('x', 0);
    b.set('y', 0);
    b.set('color', 'yellow');
    b.set('text', new Y.Text(''));
    b.set('z', 2);
    b.set('createdAt', 2);
    const objects = objectsMap(doc);
    objects.set('note-a', a);
    objects.set('note-b', b);

    let id = '';
    const updates = countUpdates(doc, () => {
      id = createSticky(doc, { x: 10, y: 10 });
    });
    expect(updates).toBe(1);
    const note = snapshot(doc).find((n) => n.id === id)!;
    expect(note.z).toBe(3);
    // It renders on top.
    expect(snapshot(doc)[2]!.id).toBe(id);
  });

  it('accepts an explicit colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');
    expect(firstNote(doc).color).toBe('violet');
    expect(id).toBeTruthy();
  });

  it('rejects a non-sticky colour argument at the type level by ignoring it', () => {
    // The signature only accepts StickyColor; a caller that bypasses the type
    // system must still get a valid document (defensive default).
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'teal' as unknown as StickyColor);
    expect(Object.keys(STICKY_COLORS)).toContain(firstNote(doc).color);
    expect(id).toBeTruthy();
  });

  it('generates unique ids', () => {
    const doc = newDoc();
    const ids = new Set<string>();
    for (let i = 0; i < 25; i += 1) ids.add(createSticky(doc, { x: i, y: i }));
    expect(ids.size).toBe(25);
    expect(snapshot(doc)).toHaveLength(25);
  });
});

describe('board.model: move', () => {
  // TC-03
  it('TC-03 updates x and y and leaves every other field alone', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'green');
    const before = firstNote(doc);

    let result = false;
    const updates = countUpdates(doc, () => {
      result = moveObject(doc, id, 10, -20);
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = firstNote(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  // TC-04 (negative)
  it('TC-04 rejects a stale id with false and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    let result = true;
    const updates = countUpdates(doc, () => {
      result = moveObject(doc, 'missing-id', 1, 2);
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);

    const before = firstNote(doc);
    // Also rejects a non-finite coordinate without moving the real note.
    const updates2 = countUpdates(doc, () => {
      result = moveObject(doc, id, Number.NaN, 5);
    });
    expect(result).toBe(false);
    expect(updates2).toBe(0);
    expect(firstNote(doc)).toEqual(before);
  });

  it('rejects non-finite coordinates', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 1, y: 2 });
    const before = firstNote(doc);

    for (const [x, y] of [
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
      [Number.NaN, Number.NaN],
    ]) {
      let result = true;
      const updates = countUpdates(doc, () => {
        result = moveObject(doc, id, x, y);
      });
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(firstNote(doc)).toEqual(before);
  });

  it('is a no-op with no update when moving to the same position', () => {
    const doc = newDoc();
    createSticky(doc, { x: 5, y: 5 });
    const at = firstNote(doc); // top-left = point minus half size
    let result = true;
    const updates = countUpdates(doc, () => {
      result = moveObject(doc, at.id, at.x, at.y);
    });
    // Same coordinates: no change applied, so nothing hits the wire in story 3.
    expect(updates).toBe(0);
    expect(result).toBe(false);
    expect(firstNote(doc).x).toBe(at.x);
  });
});

describe('board.model: colour', () => {
  // TC-05
  it('TC-05 changes the colour to green', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(firstNote(doc).color).toBe('yellow');

    let result = false;
    const updates = countUpdates(doc, () => {
      result = setStickyColor(doc, id, 'green');
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(firstNote(doc).color).toBe('green');
  });

  it('applies every one of the six preset colours', () => {
    const doc = newDoc();
    // Start from violet so every preset (including violet once) differs from
    // the previous colour except the violet step, which is the first change.
    const id = createSticky(doc, { x: 0, y: 0 }, 'blue');
    const colors = (Object.keys(STICKY_COLORS) as StickyColor[]).filter(
      (c) => c !== 'blue',
    );
    for (const color of colors) {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(firstNote(doc).color).toBe(color);
    }
  });

  // TC-06 (negative)
  it('TC-06 rejects an unknown colour, leaves the note alone and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const before = firstNote(doc);

    let result = true;
    const updates = countUpdates(doc, () => {
      result = setStickyColor(doc, id, 'teal');
    });

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(firstNote(doc).color).toBe('yellow');
    expect(firstNote(doc).x).toBe(before.x);
  });

  it('rejects a stale id', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    let result = true;
    const updates = countUpdates(doc, () => {
      result = setStickyColor(doc, 'missing', 'blue');
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('is a no-op with no update when setting the current colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'orange');
    let result = true;
    const updates = countUpdates(doc, () => {
      result = setStickyColor(doc, id, 'orange');
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(firstNote(doc).color).toBe('orange');
  });
});

describe('board.model: delete', () => {
  // TC-07
  it('TC-07 removes the note from the document', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    let result = false;
    const updates = countUpdates(doc, () => {
      result = deleteObject(doc, id);
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsMap(doc).has(id)).toBe(false);
  });

  // TC-08 (negative)
  it('TC-08 rejects a stale delete with false and no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });

    let result = true;
    const updates = countUpdates(doc, () => {
      result = deleteObject(doc, 'missing-id');
    });

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('board.model: stacking', () => {
  // TC-09
  it('TC-09 brings a bottom note to the top (z 1 -> 4 of 3 notes)', () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).map((n) => n.id)).toContain(bottom);
    // bottom is at z 1; bring it to the front (max z 3 -> 4).
    expect(snapshot(doc)[0]!.id).toBe(bottom);

    let result = false;
    const updates = countUpdates(doc, () => {
      result = bringToFront(doc, bottom);
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const notes = snapshot(doc);
    expect(notes[notes.length - 1]!.id).toBe(bottom);
    expect(notes[notes.length - 1]!.z).toBe(4);
  });

  // TC-10 (negative)
  it('TC-10 emits no update when the topmost note is brought to front', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);
    expect(notes[notes.length - 1]!.id).toBe(top);
    const zBefore = notes[notes.length - 1]!.z;

    let result = true;
    const updates = countUpdates(doc, () => {
      result = bringToFront(doc, top);
    });

    expect(result).toBe(false);
    expect(updates).toBe(0);
    const after = snapshot(doc);
    expect(after[after.length - 1]!.id).toBe(top);
    expect(after[after.length - 1]!.z).toBe(zBefore);
  });

  it('rejects bringToFront for a stale id', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    let result = true;
    const updates = countUpdates(doc, () => {
      result = bringToFront(doc, 'missing');
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: snapshot', () => {
  // TC-11
  it('TC-11 sorts equal z values by id, stably across calls', () => {
    const doc = newDoc();
    // Create three notes with identical z by hand.
    const ids = ['c-id', 'a-id', 'b-id'];
    for (const id of ids) {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', 0);
      map.set('y', 0);
      map.set('color', 'yellow');
      map.set('text', new Y.Text(id));
      map.set('z', 7);
      map.set('createdAt', 1);
      objectsMap(doc).set(id, map);
    }

    const order = snapshot(doc).map((n) => n.id);
    expect(order).toEqual(['a-id', 'b-id', 'c-id']);
    // Stable: repeated calls give the same order.
    expect(snapshot(doc).map((n) => n.id)).toEqual(order);
    expect(snapshot(doc).map((n) => n.id)).toEqual(order);
  });

  it('sorts by z first and id second', () => {
    const doc = newDoc();
    const z1 = createSticky(doc, { x: 0, y: 0 });
    const z2 = createSticky(doc, { x: 0, y: 0 });
    bringToFront(doc, z1);
    // z1 is now on top.
    const notes = snapshot(doc);
    expect(notes[notes.length - 1]!.id).toBe(z1);
    expect(notes[0]!.id).toBe(z2);
  });

  // TC-12
  it('TC-12 skips objects of an unknown type without throwing', () => {
    const doc = newDoc();
    const stickyId = createSticky(doc, { x: 1, y: 2 });
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', 0);
    shape.set('y', 0);
    shape.set('z', 5);
    objectsMap(doc).set('shape-1', shape);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(stickyId);
    expect(() => snapshot(doc)).not.toThrow();
  });

  it('skips malformed entries (no type, missing fields) without throwing', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    objectsMap(doc).set('no-type', new Y.Map<unknown>());
    const half = new Y.Map<unknown>();
    half.set('type', 'sticky');
    objectsMap(doc).set('half-sticky', half);

    let notes: readonly StickySnapshot[] = [];
    expect(() => {
      notes = snapshot(doc);
    }).not.toThrow();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe('sticky');
  });

  it('returns frozen, immutable snapshot objects', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const note = firstNote(doc);
    expect(Object.isFrozen(note)).toBe(true);
    expect(() => {
      (note as { x: number }).x = 999;
    }).toThrow();
    // The array itself is read-only.
    const notes = snapshot(doc);
    expect(Object.isFrozen(notes)).toBe(true);
  });

  it('reflects text edited through getStickyText', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    ytext!.insert(0, 'Faster onboarding');
    expect(firstNote(doc).text).toBe('Faster onboarding');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });
});

describe('board.model: initDoc', () => {
  it('sets meta.schemaVersion once and leaves an existing one alone', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const meta = doc.getMap<number>('meta');
    expect(meta.get('schemaVersion')).toBe(1);

    // A second initDoc does not overwrite a migrated version.
    const listener = vi.fn();
    doc.on('update', listener);
    meta.set('schemaVersion', 2);
    listener.mockClear();
    initDoc(doc);
    expect(meta.get('schemaVersion')).toBe(2);
    expect(listener).not.toHaveBeenCalled();
  });
});
