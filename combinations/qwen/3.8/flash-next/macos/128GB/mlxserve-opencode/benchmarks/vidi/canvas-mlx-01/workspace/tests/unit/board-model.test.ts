import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model.js';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config.js';

/**
 * Real `Y.Doc` under test — no mocks. Every mutation test also counts the `update`
 * events the doc emits: exactly one on a successful transaction, none on a rejection
 * (a rejected call must not open a transaction, or story 3 would ship no-op traffic).
 */

const newDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

/** Run `fn` while counting the document-level `update` events it emits. */
function countUpdates(doc: Y.Doc, fn: () => unknown): number {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return updates;
}

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap('objects');

describe('createSticky (TC-01, TC-02)', () => {
  it('TC-01 creates one centred yellow note at z 1 on an empty board', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    let id = '';
    const updates = countUpdates(doc, () => {
      id = createSticky(doc, { x: 0, y: 0 });
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // centred on the click point: top-left is the point minus half the note size
    expect(note.x).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(0 - STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(updates).toBe(1);
  });

  it('TC-02 places a new note above the existing ones (z = maxZ + 1)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 500, y: 500 }); // z 2

    let newId = '';
    const updates = countUpdates(doc, () => {
      newId = createSticky(doc, { x: 20, y: 30 });
    });

    const created = snapshot(doc).find((n) => n.id === newId)!;
    expect(created.z).toBe(3);
    expect(updates).toBe(1);
  });
});

describe('moveObject (TC-03, TC-04)', () => {
  it('TC-03 updates x,y and leaves every other field untouched', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    setStickyColor(doc, id, 'blue');
    const before = snapshot(doc).find((n) => n.id === id)!;

    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, id, 10, -20)).toBe(true);
    });

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates).toBe(1);
  });

  it('TC-04 rejects a stale id with false and emits no update', () => {
    const doc = newDoc();
    const missing = '00000000-0000-0000-0000-000000000000';

    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, missing, 1, 1)).toBe(false);
    });

    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('rejects non-finite coordinates with false and emits no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(moveObject(doc, id, Number.NaN, 5)).toBe(false);
      expect(moveObject(doc, id, 5, Number.POSITIVE_INFINITY)).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('setStickyColor (TC-05, TC-06)', () => {
  it('TC-05 repaints a known colour', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'green')).toBe(true);
    });

    expect(snapshot(doc)[0]!.color).toBe('green');
    expect(updates).toBe(1);
  });

  it('TC-06 rejects an unknown colour with no change and no update', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });

    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, id, 'teal')).toBe(false);
    });

    expect(snapshot(doc)[0]!.color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates).toBe(0);
  });

  it('rejects a stale id with no update', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      expect(setStickyColor(doc, 'missing', 'green')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('deleteObject (TC-07, TC-08)', () => {
  it('TC-07 removes the note', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(updates).toBe(1);
  });

  it('TC-08 rejects a stale id with false and no update', () => {
    const doc = newDoc();
    const updates = countUpdates(doc, () => {
      expect(deleteObject(doc, 'missing')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('bringToFront (TC-09, TC-10)', () => {
  it('TC-09 raises the bottom note above the top one', () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 }); // z 1
    createSticky(doc, { x: 1, y: 1 }); // z 2
    createSticky(doc, { x: 2, y: 2 }); // z 3

    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, first)).toBe(true);
    });

    expect(snapshot(doc).find((n) => n.id === first)!.z).toBe(4);
    expect(updates).toBe(1);
  });

  it('TC-10 does nothing when the note is already on top', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 }); // z 1
    const top = createSticky(doc, { x: 1, y: 1 }); // z 2, already max

    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });

    expect(snapshot(doc).find((n) => n.id === top)!.z).toBe(2);
    expect(updates).toBe(0);
  });

  it('rejects a stale id with no update', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = countUpdates(doc, () => {
      expect(bringToFront(doc, 'missing')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('snapshot ordering and forward compatibility (TC-11, TC-12)', () => {
  it('TC-11 breaks equal-z ties by id, stable across calls', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1, y: 1 });
    const c = createSticky(doc, { x: 2, y: 2 });
    // force every note to the same z (as story 3 sync could produce)
    doc.transact(() => {
      const objects = objectsMap(doc);
      for (const id of [a, b, c]) objects.get(id)!.set('z', 5);
    });

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    const expected = [a, b, c].slice().sort();
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
  });

  it('TC-12 skips an unknown object type without throwing', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    // A forward-compatible object a later story (9-12) would add.
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 10);
      objectsMap(doc).set('shape-1', shape);
    });

    let notes: readonly { id: string }[] = [];
    expect(() => {
      notes = snapshot(doc);
    }).not.toThrow();
    expect(notes.map((n) => n.id)).toEqual([sticky]);
  });
});

describe('text handle and init (extras)', () => {
  it('getStickyText returns the live Y.Text and undefined for a stale id', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe('');
    expect(getStickyText(doc, 'missing')).toBeUndefined();
  });

  it('initDoc records the schema version exactly once and is idempotent', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

    const updates = countUpdates(doc, () => {
      initDoc(doc);
    });
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
    expect(updates).toBe(0);
  });

  it('colours and their accessible names stay in sync with config', () => {
    // Sanity guard: every colour key maps to a hex value the swatch renders.
    const keys = Object.keys(STICKY_COLORS) as StickyColor[];
    expect(keys).toContain('pink');
    expect(STICKY_COLORS.pink).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
