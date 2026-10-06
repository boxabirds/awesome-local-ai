/**
 * board.model unit tests (TC-01 to TC-12, TC-39) against a real Y.Doc.
 *
 * Yjs is the store under test, so nothing is mocked: every mutation is checked
 * for its effect on the document *and* for the number of `update` events it
 * emits (exactly 1 on success, 0 when the model rejects the call — pointless
 * sync traffic would show up in story 3).
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  bringToFront,
  boardObjects,
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import {
  createConnector,
  detachConnectorsTo,
  CONNECTOR_OBJECT_TYPE
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor
} from '../../src/shared/config';
import { PROSE_1000, SHORT_PHRASE } from '../fixtures/texts';

/** Watch `doc`'s update events; `count()` is how many fired since the call. */
function watchUpdates(doc: Y.Doc): { count(): number; origins(): unknown[]; stop(): void } {
  let updates = 0;
  const seenOrigins: unknown[] = [];
  const listener = (update: Uint8Array, origin: unknown) => {
    void update;
    updates += 1;
    seenOrigins.push(origin);
  };
  doc.on('update', listener);
  return {
    count: () => updates,
    origins: () => seenOrigins,
    stop: () => doc.off('update', listener)
  };
}

/** A doc with `n` notes, created through the model, in creation order. */
function docWithNotes(n: number): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(createSticky(doc, { x: i * 10, y: i * 20 }));
  return { doc, ids };
}

function findNote(doc: Y.Doc, id: string): StickySnapshot {
  const note = snapshot(doc).find((object) => object.id === id);
  if (!note) throw new Error(`note ${id} is missing from the snapshot`);
  return note;
}

describe('document schema', () => {
  it('initDoc creates meta and objects and sets schemaVersion once', () => {
    const doc = new Y.Doc();
    const updates = watchUpdates(doc);

    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(BOARD_SCHEMA_VERSION);
    expect(doc.getMap('objects').size).toBe(0);

    // A second initDoc (or a doc that already has a version) never overwrites it.
    updates.stop();
    doc.getMap('meta').set('schemaVersion', 99);
    initDoc(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(99);
  });

  it('TC-01: createSticky on an empty doc yields one yellow note centred on the point, z 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = watchUpdates(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    expect(id).toBeTruthy();
    expect(updates.count()).toBe(1);
    expect(updates.origins()).toEqual([LOCAL_ORIGIN]);

    const objects = doc.getMap('objects');
    expect(objects.size).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);

    const note = findNote(doc, id);
    expect(note.type).toBe('sticky');
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');
    expect(note.z).toBe(1);
    // Centred on the click: the stored position is the top-left.
    expect(note.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 9);
    expect(note.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 9);
    expect(note.createdAt).toBeGreaterThan(0);
    expect(Number.isFinite(note.createdAt)).toBe(true);
  });

  it('TC-02: a new note stacks above existing ones (z 1, 2 -> new z 3)', () => {
    const { doc } = docWithNotes(2);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2]);
    const updates = watchUpdates(doc);

    const id = createSticky(doc, { x: 5, y: 5 });

    expect(updates.count()).toBe(1);
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);
    expect(findNote(doc, id).z).toBe(3);
    expect(snapshot(doc).at(-1)?.id).toBe(id);
  });

  it('a new note is created on top even after the topmost note was deleted', () => {
    const { doc, ids } = docWithNotes(3);
    deleteObject(doc, ids[2] as string);
    const id = createSticky(doc, { x: 0, y: 0 });
    const othersMax = Math.max(...snapshot(doc).filter((n) => n.id !== id).map((n) => n.z));
    expect(findNote(doc, id).z).toBe(othersMax + 1);
  });
});

describe('moveObject (sticky.move)', () => {
  it('TC-03: writes x and y and leaves every other field alone', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    setStickyColor(doc, id, 'green');
    const before = findNote(doc, id);

    const updates = watchUpdates(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);

    expect(updates.count()).toBe(1);
    const after = findNote(doc, id);
    expect([after.x, after.y]).toEqual([10, -20]);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.type).toBe('sticky');
  });

  it('TC-04: a stale id returns false and emits no update at all', () => {
    const { doc, ids } = docWithNotes(1);
    deleteObject(doc, ids[0] as string);
    const updates = watchUpdates(doc);

    expect(moveObject(doc, 'no-such-id', 3, 4)).toBe(false);
    expect(moveObject(doc, '', 3, 4)).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-39: non-finite coordinates are rejected without a write', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    const before = findNote(doc, id);
    const updates = watchUpdates(doc);

    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
      [Number.NaN, Number.NaN]
    ]) {
      expect(moveObject(doc, id, x as number, y as number)).toBe(false);
    }
    expect(updates.count()).toBe(0);
    const after = findNote(doc, id);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });

  it('TC-39: createSticky with non-finite coordinates is rejected without a write', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = watchUpdates(doc);

    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    expect(updates.count()).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('setStickyColor (sticky.color)', () => {
  it.each((Object.keys(STICKY_COLORS) as StickyColor[]).filter((name) => name !== DEFAULT_STICKY_COLOR))(
    'TC-05: %s is applied and nothing else changes',
    (color) => {
      const { doc, ids } = docWithNotes(1);
      const id = ids[0] as string;
      const before = findNote(doc, id);

      const updates = watchUpdates(doc);
      expect(setStickyColor(doc, id, color)).toBe(true);

      expect(updates.count()).toBe(1);
      const after = findNote(doc, id);
      expect(after.color).toBe(color);
      expect(after.text).toBe(before.text);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.z).toBe(before.z);
      expect(after.createdAt).toBe(before.createdAt);
    }
  );

  it('TC-05: all six palette names are accepted, in order, from any starting colour', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    setStickyColor(doc, id, 'green');
    const names = Object.keys(STICKY_COLORS) as StickyColor[];
    expect(names).toHaveLength(6);
    for (const color of names) {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(findNote(doc, id).color).toBe(color);
    }
  });

  it('painting a note the colour it already has is a no-op that emits nothing', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    setStickyColor(doc, id, 'green');
    const updates = watchUpdates(doc);

    expect(setStickyColor(doc, id, 'green')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(findNote(doc, id).color).toBe('green');
  });

  it('TC-05: the colour can be changed again and again, and back to the default', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    const updates = watchUpdates(doc);
    expect(setStickyColor(doc, id, 'pink')).toBe(true);
    expect(setStickyColor(doc, id, DEFAULT_STICKY_COLOR)).toBe(true);
    expect(findNote(doc, id).color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates.count()).toBe(2);
  });

  it('TC-06: an unknown colour name returns false, changes nothing and emits nothing', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    const updates = watchUpdates(doc);

    expect(setStickyColor(doc, id, 'teal')).toBe(false);
    expect(setStickyColor(doc, id, '')).toBe(false);
    expect(setStickyColor(doc, id, 'Yellow')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(findNote(doc, id).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('setStickyColor on a stale id returns false with no update', () => {
    const { doc } = docWithNotes(1);
    const updates = watchUpdates(doc);
    expect(setStickyColor(doc, 'gone', 'pink')).toBe(false);
    expect(updates.count()).toBe(0);
  });
});

describe('deleteObject (sticky.delete)', () => {
  it('TC-07: removes the note from the document', () => {
    const { doc, ids } = docWithNotes(2);
    const id = ids[0] as string;
    const updates = watchUpdates(doc);

    expect(deleteObject(doc, id)).toBe(true);

    expect(updates.count()).toBe(1);
    expect(snapshot(doc).map((note) => note.id)).toEqual([ids[1]]);
    expect(doc.getMap('objects').has(id)).toBe(false);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it('TC-08: deleting a stale id returns false and emits no update', () => {
    const { doc } = docWithNotes(1);
    const updates = watchUpdates(doc);

    expect(deleteObject(doc, 'no-such-id')).toBe(false);
    expect(deleteObject(doc, '')).toBe(false);
    expect(updates.count()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('stacking (bringToFront, render order)', () => {
  it('TC-09: bringToFront on the bottom note of three makes it topmost (z 1 -> 4)', () => {
    const { doc, ids } = docWithNotes(3);
    const bottom = ids[0] as string;
    const updates = watchUpdates(doc);

    expect(bringToFront(doc, bottom)).toBe(true);

    expect(updates.count()).toBe(1);
    expect(findNote(doc, bottom).z).toBe(4);
    expect(snapshot(doc).map((note) => note.id)).toEqual([ids[1], ids[2], bottom]);
  });

  it('TC-10: bringToFront on the topmost note is a no-op that emits nothing', () => {
    const { doc, ids } = docWithNotes(3);
    const top = ids[2] as string;
    const before = findNote(doc, top);
    const updates = watchUpdates(doc);

    expect(bringToFront(doc, top)).toBe(false);

    expect(updates.count()).toBe(0);
    const after = findNote(doc, top);
    expect(after.z).toBe(before.z);
  });

  it('bringToFront on a stale id returns false with no update', () => {
    const { doc } = docWithNotes(1);
    const updates = watchUpdates(doc);
    expect(bringToFront(doc, 'no-such-id')).toBe(false);
    expect(updates.count()).toBe(0);
  });

  it('bringToFront moves to the top by z, not by re-creating the note', () => {
    const { doc, ids } = docWithNotes(2);
    const id = ids[0] as string;
    setStickyColor(doc, id, 'violet');
    const before = findNote(doc, id);
    bringToFront(doc, id);
    const after = findNote(doc, id);
    expect(after.id).toBe(before.id);
    expect(after.color).toBe('violet');
    expect(after.text).toBe(before.text);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('TC-11: notes with equal z are ordered by id, stably across calls', () => {
    const { doc, ids } = docWithNotes(3);
    // Force the same z on every note, as two clients syncing could produce.
    doc.transact(() => {
      for (const id of ids) (doc.getMap('objects').get(id) as Y.Map<unknown>).set('z', 5);
    });

    const first = snapshot(doc).map((note) => note.id);
    const second = snapshot(doc).map((note) => note.id);
    const third = snapshot(doc).map((note) => note.id);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first).toEqual([...ids].sort());
  });

  it('snapshot is sorted by (z, id) with z winning over id', () => {
    const { doc, ids } = docWithNotes(3);
    // ids sort one way, z another: order must follow z first.
    const byId = [...ids];
    expect(snapshot(doc).map((note) => note.id)).toEqual(byId);
    doc.transact(() => {
      (doc.getMap('objects').get(byId[2] as string) as Y.Map<unknown>).set('z', -1);
    });
    expect(snapshot(doc).map((note) => note.id)).toEqual([byId[2], byId[0], byId[1]]);
  });

  it('snapshot returns immutable, detached data', () => {
    const { doc, ids } = docWithNotes(1);
    const notes = snapshot(doc) as StickySnapshot[];
    expect(() => {
      // Writing to the returned object/array must not corrupt the document.
      try {
        (notes[0] as { x: number }).x = 12345;
        (notes as StickySnapshot[]).push(notes[0] as StickySnapshot);
      } catch {
        // frozen in place is also acceptable
      }
    }).not.toThrow();
    expect(findNote(doc, ids[0] as string).x).not.toBe(12345);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('forward compatibility (stories 9-12)', () => {
  it('TC-12: an object of an unknown type is skipped by snapshot without throwing', () => {
    const { doc, ids } = docWithNotes(1);
    doc.getMap('objects').set(
      'shape-1',
      (() => {
        const shape = new Y.Map<unknown>();
        shape.set('type', 'shape');
        shape.set('x', 1);
        shape.set('y', 2);
        shape.set('z', 99);
        return shape;
      })()
    );

    expect(() => snapshot(doc)).not.toThrow();
    expect(snapshot(doc).map((note) => note.id)).toEqual(ids);
    expect(getStickyText(doc, 'shape-1')).toBeUndefined();
  });

  it('an object with no type at all is skipped too', () => {
    const { doc } = docWithNotes(1);
    const junk = new Y.Map<unknown>();
    junk.set('z', 1);
    doc.getMap('objects').set('junk', junk);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('getStickyText', () => {
  it('returns the shared Y.Text of a note, so edits land in the document', () => {
    const { doc, ids } = docWithNotes(1);
    const id = ids[0] as string;
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');

    doc.transact(() => text?.insert(0, SHORT_PHRASE), LOCAL_ORIGIN);
    expect(text?.toString()).toBe(SHORT_PHRASE);
    expect(findNote(doc, id).text).toBe(SHORT_PHRASE);
    expect(text?.length).toBe(SHORT_PHRASE.length);
  });

  it('holds long text verbatim, including newlines', () => {
    const { doc, ids } = docWithNotes(1);
    const text = getStickyText(doc, ids[0] as string) as Y.Text;
    doc.transact(() => text.insert(0, PROSE_1000), LOCAL_ORIGIN);
    expect(findNote(doc, ids[0] as string).text).toBe(PROSE_1000);
  });

  it('returns undefined for a stale id', () => {
    const { doc, ids } = docWithNotes(1);
    deleteObject(doc, ids[0] as string);
    expect(getStickyText(doc, ids[0] as string)).toBeUndefined();
  });
});

describe('document observers (what useBoardDoc subscribes to)', () => {
  it('every successful mutation fires exactly one observeDeep event', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const objects = doc.getMap('objects');
    let events = 0;
    objects.observeDeep(() => {
      events += 1;
    });

    const other = createSticky(doc, { x: 0, y: 0 });
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(events).toBe(2);
    moveObject(doc, id, 1, 2);
    expect(events).toBe(3);
    setStickyColor(doc, id, 'blue');
    expect(events).toBe(4);
    bringToFront(doc, other);
    expect(events).toBe(5);
    deleteObject(doc, id);
    expect(events).toBe(6);

    // Rejections fire nothing.
    moveObject(doc, id, 1, 2);
    setStickyColor(doc, id, 'teal');
    bringToFront(doc, id);
    deleteObject(doc, id);
    expect(events).toBe(6);
  });
});

/* ------------------------------------------------------------------ story 10 */

/**
 * `shape.model`, `connector.model`: a delete is the one thing that happens to two kinds of
 * object at once, so it is the shared model's job — the arrow's end is rewritten inside the
 * same transaction that removes the shape it pointed at, which is why nobody ever sees an
 * arrow tied to an object that is gone.
 */

function boardWithArrow(): { doc: Y.Doc; a: string; b: string; arrow: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'ana');
  const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, 'ana');
  const arrow = createConnector(doc, { from: { kind: 'attached', objectId: a! }, to: { kind: 'attached', objectId: b! } }, 'ana');
  if (!a || !b || !arrow) throw new Error('the fixture could not draw two shapes and an arrow');
  return { doc, a, b, arrow };
}

function endOf(doc: Y.Doc, id: string, key: 'from' | 'to'): unknown {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)?.get(key);
}

describe('deleting objects and their arrows (connector.model)', () => {
  it('TC-14: an arrow tied to a deleted shape is rewritten in the delete itself, one update', () => {
    const { doc, a, arrow } = boardWithArrow();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    expect(deleteObjects(doc, [a])).toBe(1);
    // One update for the delete and the rewrite together: an arrow is never seen tied to an
    // object that no longer exists, not even for the moment between two writes.
    expect(updates).toBe(1);
    expect(endOf(doc, arrow, 'from')).toBeInstanceOf(Y.Map);
    const from = endOf(doc, arrow, 'from') as Y.Map<unknown>;
    expect(from.get('kind')).toBe('free');
    // Free at the anchor it had while the shape was there: the arrow does not jump.
    expect(from.get('x')).toBe(100);
    expect(from.get('y')).toBe(50);
    // The other end is still tied to the shape that survived.
    expect((endOf(doc, arrow, 'to') as Y.Map<unknown>).get('kind')).toBe('attached');
    // And the arrow is still on the board, drawn to where its shape used to be.
    expect(boardObjects(doc).filter((object) => object.type === CONNECTOR_OBJECT_TYPE)).toHaveLength(1);
  });

  it('TC-14: a delete of both shapes frees both ends and still costs one update', () => {
    const { doc, a, b, arrow } = boardWithArrow();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(deleteObjects(doc, [a, b])).toBe(2);
    expect(updates).toBe(1);
    for (const key of ['from', 'to'] as const) {
      const end = endOf(doc, arrow, key) as Y.Map<unknown>;
      expect(end.get('kind')).toBe('free');
    }
    expect((endOf(doc, arrow, 'from') as Y.Map<unknown>).get('x')).toBe(100);
    expect((endOf(doc, arrow, 'to') as Y.Map<unknown>).get('x')).toBe(400);
  });

  it('TC-14: a mixed delete rewrites only the arrow that had an end on a deleted object', () => {
    const { doc, a, b, arrow } = boardWithArrow();
    const spare = createSticky(doc, { x: 900, y: 900 });
    const untouched = createSticky(doc, { x: 1000, y: 1000 });
    // A second arrow, tied to shapes nobody is deleting.
    const other = createConnector(doc, { from: { kind: 'attached', objectId: untouched }, to: { kind: 'attached', objectId: b } }, 'ana');
    if (!other) throw new Error('the fixture could not draw a second arrow');
    const before = endOf(doc, other, 'to');

    // One of the two ids carries an arrow, the other does not.
    expect(deleteObjects(doc, [spare, a])).toBe(2);
    expect((endOf(doc, arrow, 'from') as Y.Map<unknown>).get('kind')).toBe('free');
    // The arrow that never referred to a deleted object is byte for byte what it was.
    expect(endOf(doc, other, 'to')).toBe(before);
    expect((endOf(doc, other, 'to') as Y.Map<unknown>).get('kind')).toBe('attached');
    expect(boardObjects(doc).some((object) => object.id === a)).toBe(false);
    expect(boardObjects(doc).some((object) => object.id === b)).toBe(true);
  });

  it('TC-14: detaching twice is not a second change', () => {
    const { doc, a, arrow } = boardWithArrow();
    deleteObjects(doc, [a]);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(detachConnectorsTo(doc, [a])).toBe(0);
    // And a delete of an object that is already gone writes nothing either.
    expect(deleteObjects(doc, [a])).toBe(0);
    expect(updates).toBe(0);
    expect((endOf(doc, arrow, 'from') as Y.Map<unknown>).get('x')).toBe(100);
  });

  it('TC-14: a single-object delete frees the end too, because the toolbar bin uses it', () => {
    const { doc, b, arrow } = boardWithArrow();
    expect(deleteObject(doc, b)).toBe(true);
    expect((endOf(doc, arrow, 'to') as Y.Map<unknown>).get('kind')).toBe('free');
    expect((endOf(doc, arrow, 'to') as Y.Map<unknown>).get('y')).toBe(50);
  });

  it('the connector box in the snapshot is derived from its ends, notes and shapes included', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const note = createSticky(doc, { x: 0, y: 0 });
    const shape = createShape(doc, { kind: 'diamond', rect: { x: 400, y: 300, width: 200, height: 200 }, at: { x: 400, y: 300 } }, 'ana');
    if (!shape) throw new Error('the fixture could not draw a shape');
    const arrow = createConnector(doc, { from: { kind: 'attached', objectId: note }, to: { kind: 'attached', objectId: shape } }, 'ana');
    if (!arrow) throw new Error('the fixture could not draw an arrow');

    const objects = boardObjects(doc);
    const connector = objects.find((object) => object.id === arrow);
    if (!connector) throw new Error('an arrow this build can draw is missing from the snapshot');
    // The note spans -100..100, so its end leaves from its right side at (100,0); the shape
    // spans 400..600 and 300..500, and its end leaves from its left side at (400,400).
    expect({ x: connector.x, y: connector.y, width: connector.width, height: connector.height }).toEqual({
      x: 100,
      y: 0,
      width: 300,
      height: 400
    });
    // `snapshot()` is the sticky-note view: an arrow is not a note, and a shape is not either.
    expect(snapshot(doc).map((note2) => note2.id)).toEqual([note]);
    expect(objects.some((object) => object.id === shape)).toBe(true);
  });
});
