import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP_NAME,
  SCHEMA_VERSION,
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
} from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';

/** Run `fn`, returning the number of `update` events the doc emitted and the origins seen. */
function trackUpdates(doc: Y.Doc, fn: () => void): { updates: number; origins: unknown[] } {
  let updates = 0;
  const origins: unknown[] = [];
  const cb = (_update: Uint8Array, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', cb);
  fn();
  doc.off('update', cb);
  return { updates, origins };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<unknown> {
  // Y.Map<T> generics are invariant, so cast through unknown
  return doc.getMap(OBJECTS_MAP_NAME) as unknown as Y.Map<unknown>;
}

function fieldsOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  const value = objectsOf(doc).get(id);
  if (!(value instanceof Y.Map)) throw new Error(`missing object ${id}`);
  return value;
}

function createAt(doc: Y.Doc, x: number, y: number, color?: StickyColor): string {
  return createSticky(doc, { x, y }, color);
}

describe('board.model: initDoc', () => {
  it('sets meta.schemaVersion once', () => {
    const doc = new Y.Doc();
    const first = trackUpdates(doc, () => initDoc(doc));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(SCHEMA_VERSION);
    expect(first.updates).toBe(1);

    // Second call must be a no-op (does not overwrite a migrated version, no update)
    const second = trackUpdates(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(SCHEMA_VERSION);
  });
});

describe('board.model: createSticky', () => {
  // TC-01
  it('TC-01 creates the first note, yellow, empty text, z 1, centred on the point', () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    let id = '';
    const { updates, origins } = trackUpdates(doc, () => {
      id = createAt(doc, 0, 0);
    });

    expect(id).toBeTruthy();
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].type).toBe('sticky');
    expect(snap[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(snap[0].text).toBe('');
    expect(snap[0].z).toBe(1);
    // centred: top-left = point - size/2
    expect(snap[0].x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(snap[0].y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(Number.isFinite(snap[0].createdAt)).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  // TC-02
  it('TC-02 stacks the new note above existing notes (z 1,2 -> z 3)', () => {
    const doc = newDoc();
    createAt(doc, 0, 0);
    createAt(doc, 300, 0);

    let id = '';
    const { updates } = trackUpdates(doc, () => {
      id = createAt(doc, 600, 0);
    });

    const snap = snapshot(doc);
    expect(snap).toHaveLength(3);
    expect(snap.map((s) => s.z)).toEqual([1, 2, 3]);
    expect(snap[2].id).toBe(id);
    expect(updates).toBe(1);
  });

  it('accepts an explicit colour from STICKY_COLORS', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0, 'violet');
    expect(snapshot(doc)[0].color).toBe('violet');
    expect(id).toBeTruthy();
  });

  it('getStickyText returns the note Y.Text and text edits reach the snapshot', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    doc.transact(() => ytext!.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    expect(snapshot(doc)[0].text).toBe('Faster onboarding');
    expect(getStickyText(doc, 'no-such-id')).toBeUndefined();
  });
});

describe('board.model: moveObject', () => {
  // TC-03
  it('TC-03 updates x,y and leaves every other field unchanged', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    doc.transact(() => getStickyText(doc, id)!.insert(0, 'Keep me'), LOCAL_ORIGIN);
    const before = snapshot(doc)[0];

    let result = false;
    const { updates } = trackUpdates(doc, () => {
      result = moveObject(doc, id, 10, -20);
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.x).toBeCloseTo(10, 9);
    expect(after.y).toBeCloseTo(-20, 9);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  // TC-04 (negative)
  it('TC-04 rejects a stale id with false and emits no update', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    deleteObject(doc, id);

    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = moveObject(doc, id, 5, 5);
    });

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-39 (negative)
  it('TC-39 rejects non-finite coordinates for moveObject and createSticky', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const value of bad) {
      let result = true;
      const { updates } = trackUpdates(doc, () => {
        result = moveObject(doc, id, value, 0);
      });
      expect(result).toBe(false);
      expect(updates).toBe(0);

      let result2 = true;
      const { updates: updates2 } = trackUpdates(doc, () => {
        result2 = moveObject(doc, id, 0, value);
      });
      expect(result2).toBe(false);
      expect(updates2).toBe(0);

      let created: string | null = null;
      const { updates: updates3 } = trackUpdates(doc, () => {
        created = createAt(doc, value, 1);
      });
      // rejected: no id, no object, no update
      expect(created).toBeFalsy();
      expect(updates3).toBe(0);

      let created2: string | null = null;
      const { updates: updates4 } = trackUpdates(doc, () => {
        created2 = createAt(doc, 1, value);
      });
      expect(created2).toBeFalsy();
      expect(updates4).toBe(0);
    }

    // Nothing non-finite was ever written
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(Number.isFinite(snap[0].x)).toBe(true);
    expect(Number.isFinite(snap[0].y)).toBe(true);
    expect(objectsOf(doc).size).toBe(1);
  });
});

describe('board.model: setStickyColor', () => {
  // TC-05
  it('TC-05 changes only the colour', () => {
    const doc = newDoc();
    const id = createAt(doc, 100, 200);
    doc.transact(() => getStickyText(doc, id)!.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    moveObject(doc, id, 33, 44);
    const before = snapshot(doc)[0];

    let result = false;
    const { updates } = trackUpdates(doc, () => {
      result = setStickyColor(doc, id, 'green');
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const after = snapshot(doc)[0];
    expect(after.color).toBe('green');
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('accepts every one of the six named colours', () => {
    const doc = newDoc();
    for (const name of Object.keys(STICKY_COLORS) as StickyColor[]) {
      // Start from a different colour so the change is not a no-op
      const start: StickyColor = name === DEFAULT_STICKY_COLOR ? 'violet' : DEFAULT_STICKY_COLOR;
      const id = createAt(doc, 0, 0, start);
      expect(setStickyColor(doc, id, name)).toBe(true);
      expect(snapshot(doc).find((s) => s.id === id)!.color).toBe(name);
    }
  });

  it('treating setting the current colour as a no-op (false, no update)', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = setStickyColor(doc, id, DEFAULT_STICKY_COLOR);
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-06 (negative)
  it('TC-06 rejects an unknown colour with false, no change and no update', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);

    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = setStickyColor(doc, id, 'teal');
    });

    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('rejects a stale id with false and no update', () => {
    const doc = newDoc();
    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = setStickyColor(doc, 'gone', 'blue');
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: deleteObject', () => {
  // TC-07
  it('TC-07 removes the note', () => {
    const doc = newDoc();
    const keep = createAt(doc, 0, 0);
    const drop = createAt(doc, 300, 0);

    let result = false;
    const { updates } = trackUpdates(doc, () => {
      result = deleteObject(doc, drop);
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(keep);
  });

  // TC-08 (negative)
  it('TC-08 rejects a stale id with false and no update', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    deleteObject(doc, id);

    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = deleteObject(doc, id);
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);

    let result2 = true;
    const { updates: updates2 } = trackUpdates(doc, () => {
      result2 = deleteObject(doc, 'never-existed');
    });
    expect(result2).toBe(false);
    expect(updates2).toBe(0);
  });
});

describe('board.model: bringToFront', () => {
  // TC-09
  it('TC-09 raises the bottom note of three to the top (z 1 -> 4)', () => {
    const doc = newDoc();
    const bottom = createAt(doc, 0, 0);
    createAt(doc, 300, 0);
    createAt(doc, 600, 0);
    expect(snapshot(doc).map((s) => s.z)).toEqual([1, 2, 3]);

    let result = false;
    const { updates } = trackUpdates(doc, () => {
      result = bringToFront(doc, bottom);
    });

    expect(result).toBe(true);
    expect(updates).toBe(1);
    const snap = snapshot(doc);
    expect(snap[snap.length - 1].id).toBe(bottom);
    expect(snap[snap.length - 1].z).toBe(4);
    expect(snap.map((s) => s.z).sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  // TC-10 (negative)
  it('TC-10 does nothing for the note that is already on top', () => {
    const doc = newDoc();
    createAt(doc, 0, 0);
    createAt(doc, 300, 0);
    const top = createAt(doc, 600, 0);

    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = bringToFront(doc, top);
    });

    expect(result).false;
    expect(updates).toBe(0);
    expect(snapshot(doc).find((s) => s.id === top)!.z).toBe(3);
  });

  it('rejects a stale id with false and no update', () => {
    const doc = newDoc();
    createAt(doc, 0, 0);
    let result = true;
    const { updates } = trackUpdates(doc, () => {
      result = bringToFront(doc, 'nope');
    });
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('board.model: snapshot ordering and forward compatibility', () => {
  // TC-11
  it('TC-11 breaks equal z ties by id, stably across calls', () => {
    const doc = newDoc();
    const ids = [createAt(doc, 0, 0), createAt(doc, 300, 0), createAt(doc, 600, 0)];
    // Force every note to the same z (as two concurrent clients could produce in story 3)
    doc.transact(() => {
      const objects = objectsOf(doc);
      for (const id of ids) fieldsOf(doc, id).set('z', 7);
      expect(objects.size).toBe(ids.length);
    }, LOCAL_ORIGIN);

    const expected = [...ids].sort();
    const first = snapshot(doc);
    const second = snapshot(doc);
    expect(first.map((s) => s.id)).toEqual(expected);
    expect(second.map((s) => s.id)).toEqual(expected);
    // sorted by (z, id)
    expect(first.map((s) => s.z)).toEqual([7, 7, 7]);
  });

  it('orders by z ascending regardless of insertion order', () => {
    const doc = newDoc();
    const a = createAt(doc, 0, 0);
    const b = createAt(doc, 300, 0);
    bringToFront(doc, a);
    const snap = snapshot(doc);
    expect(snap.map((s) => s.id)).toEqual([b, a]);
  });

  // TC-12
  it('TC-12 skips objects of an unknown type without throwing', () => {
    const doc = newDoc();
    const stickyId = createAt(doc, 0, 0);

    // A future object type (stories 9-12) written straight into the schema
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'shape');
      shape.set('x', 1);
      shape.set('y', 2);
      shape.set('z', 99);
      objectsOf(doc).set('shape-1', shape);
      // and a value that is not even a Y.Map
      objectsOf(doc).set('garbage', 'not-an-object' as unknown as Y.Map<unknown>);
    }, LOCAL_ORIGIN);

    let snap: readonly { id: string }[] = [];
    expect(() => {
      snap = snapshot(doc);
    }).not.toThrow();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(stickyId);
  });

  it('returns immutable snapshots that do not alias later edits', () => {
    const doc = newDoc();
    const id = createAt(doc, 0, 0);
    const before = snapshot(doc);
    moveObject(doc, id, 500, 500);
    expect(before[0].x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 9);
    expect(snapshot(doc)[0].x).toBeCloseTo(500, 9);
  });
});
