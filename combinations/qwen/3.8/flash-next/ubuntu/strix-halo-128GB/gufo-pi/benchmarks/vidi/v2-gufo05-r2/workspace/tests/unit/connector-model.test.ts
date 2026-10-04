/**
 * Story 10: the arrow in the document — the two ends it stores, the calls that make
 * and move them, and what happens to an arrow when the object it hangs on disappears.
 *
 * An arrow stores no path, so these tests are about ends and about the rules that
 * keep them sane: no arrow to itself, no arrow too short to have meant, and no end
 * left pointing at an object that is gone. The last one is the only place in the
 * model where deleting one object writes another, so it is counted on the doc: the
 * detach and the delete are one step, and everybody sees them as one.
 */

import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import {
  deleteObject,
  deleteObjects,
  initDoc,
  moveObject,
  objectSnapshot,
  objectSnapshots,
} from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  connectorDistance,
  connectorPoints,
  createConnector,
  detachConnectorsTo,
  readConnector,
  readConnectors,
  setConnectorEndpoint,
  type ConnectorEndpoint,
  type ConnectorSnapshot,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { createSticky } from '../../src/shared/board-model';

/** Run `fn`, counting how many `update` events the doc emits. */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', observer);
  }
}

const attached = (objectId: string, fallbackX = 0, fallbackY = 0): ConnectorEndpoint => ({
  kind: 'attached',
  objectId,
  fallbackX,
  fallbackY,
});
const free = (x: number, y: number): ConnectorEndpoint => ({ kind: 'free', x, y });

/** A shape with a known box, drawn at the top-left of the board. */
function shapeAt(doc: Y.Doc, x: number, y: number, size = 100): string {
  return createShape(
    doc,
    { kind: 'rect', rect: { x, y, width: size, height: size }, at: { x, y }, square: false },
    'g_a',
  )!;
}

describe('connector.model — createConnector', () => {
  it('TC-07: stores the two ends, with fallbacks, in one update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const { result: id, updates } = withUpdateCount(doc, () =>
      createConnector(doc, attached(a), attached(b), 'g_a'),
    );
    expect(updates).toBe(1);
    const entry = doc.getMap<Y.Map<unknown>>('objects').get(id!)!;
    expect(entry.get('x')).toBe(0);
    expect(entry.get('y')).toBe(0);
    expect(entry.get('width')).toBe(0);
    expect(entry.get('height')).toBe(0);
    expect(entry.get('z')).toBe(3);
    expect(entry.get('createdBy')).toBe('g_a');
    expect(readConnector(doc, id!)).toMatchObject({ type: 'connector', from: { kind: 'attached', objectId: a }, to: { kind: 'attached', objectId: b } });
  });

  it('TC-09: refuses an arrow shorter than the minimum, and keeps one exactly at it', () => {
    const doc = new Y.Doc();
    // One end hangs from the shape's right side, at (100, 50), so the length of the
    // arrow is the distance from there to the free end.
    const a = shapeAt(doc, 0, 0);
    const short = withUpdateCount(doc, () =>
      createConnector(
        doc,
        attached(a, 999, 999),
        free(100 + CONNECTOR_MIN_LENGTH_WORLD - 0.1, 50),
        'g_a',
      ),
    );
    expect(short.result).toBeNull();
    expect(short.updates).toBe(0);

    const exactly = createConnector(doc, attached(a, 999, 999), free(100 + CONNECTOR_MIN_LENGTH_WORLD, 50), 'g_a');
    expect(exactly).toBeTruthy();
    expect(readConnectors(doc)).toHaveLength(1);
  });

  it('measures the length between where the ends are drawn, not where they were aimed', () => {
    const doc = new Y.Doc();
    // Two shapes stacked on each other: attaching to both of them is a point.
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 0, 0);
    const { result, updates } = withUpdateCount(doc, () =>
      createConnector(doc, attached(a), attached(b), 'g_a'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-08: refuses an arrow that connects an object to itself', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const note = createSticky(doc, { x: 500, y: 500 })!;
    const { result, updates } = withUpdateCount(doc, () =>
      createConnector(doc, attached(a, 10, 10), attached(a, 20, 20), 'g_a'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
    // The same object by another type's id is still the same object.
    expect(createConnector(doc, attached(note, 0, 0), attached(note, 1, 1), 'g_a')).toBeNull();
    expect(readConnectors(doc)).toHaveLength(0);
  });

  it('refuses a line that belongs to nothing at either end', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createConnector(doc, free(0, 0), free(400, 0), 'g_a'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(readConnectors(doc)).toHaveLength(0);
    // One end attached and it is an arrow: the same length is then accepted.
    const a = shapeAt(doc, 0, 0);
    expect(createConnector(doc, attached(a, 0, 0), free(400, 0), 'g_a')).not.toBeNull();
  });

  it('refuses an end attached to an object that is not on the board', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const { result, updates } = withUpdateCount(doc, () =>
      createConnector(doc, attached('never-was', 5, 5), attached(a), 'g_a'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('records the fallback of an attached end as the side it faces', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const id = createConnector(doc, attached(a, 999, 999), attached(b, 999, 999), 'g_a')!;
    const connector = readConnector(doc, id)!;
    // A faces B to its right; B faces A to its left.
    expect(connector.from).toEqual({ kind: 'attached', objectId: a, fallbackX: 100, fallbackY: 50 });
    expect(connector.to).toEqual({ kind: 'attached', objectId: b, fallbackX: 300, fallbackY: 50 });
  });

  it('rejects an end that is not a place', () => {
    const doc = new Y.Doc();
    expect(createConnector(doc, free(NaN, 0), free(50, 0), 'g_a')).toBeNull();
    expect(createConnector(doc, free(0, 0), free(0, Infinity), 'g_a')).toBeNull();
    expect(readConnectors(doc)).toHaveLength(0);
  });
});

describe('connector.model — where it is drawn', () => {
  it('follows the objects it joins', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;
    expect(connectorPoints(readConnector(doc, id)!, rectsOf(doc))).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ]);

    // B to underneath A: the ends move to the sides that face each other again.
    moveObject(doc, b, 0, 300);
    expect(connectorPoints(readConnector(doc, id)!, rectsOf(doc))).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 300 },
    ]);
  });

  it('derives its box from its ends, in the snapshots and on its own', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 200);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;
    const fromSnapshots = objectSnapshots(doc).find((object) => object.id === id);
    const onItsOwn = objectSnapshot(doc, id);
    expect(fromSnapshots).toMatchObject({
      type: 'connector',
      x: 100,
      y: 50,
      width: 200,
      height: 200,
    });
    expect(onItsOwn).toMatchObject(fromSnapshots!);
  });

  it('TC-11: draws an end whose object is gone at its stored fallback', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const id = createConnector(doc, attached(a), free(400, 50), 'g_a')!;
    // An end written by a client that no longer has the object: the arrow survives.
    const entry = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    entry.set(
      'from',
      new Y.Map<unknown>([
        ['kind', 'attached'],
        ['objectId', 'deleted-long-ago'],
        ['fallbackX', 12],
        ['fallbackY', 34],
      ]),
    );
    expect(connectorPoints(readConnector(doc, id)!, rectsOf(doc))[0]).toEqual({ x: 12, y: 34 });
    expect(objectSnapshot(doc, id)!.x).toBe(12);
  });

  it('reads a broken end as a free end at the origin, so it stays grabbable', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const id = createConnector(doc, attached(a), free(400, 50), 'g_a')!;
    doc.getMap<Y.Map<unknown>>('objects').get(id)!.set('to', new Y.Map([['kind', 'sideways']]));
    expect(readConnector(doc, id)!.to).toEqual({ kind: 'free', x: 0, y: 0 });
  });

  it('is how far a point is from its line, not from its box', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 0, 300);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;
    const connector = readConnector(doc, id)!;
    const rects = rectsOf(doc);
    // The line runs down the middle of both boxes, from A's bottom side to B's top.
    expect(connectorPoints(connector, rects)).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 300 },
    ]);
    expect(connectorDistance(connector, rects, { x: 50, y: 200 })).toBeCloseTo(0, 6);
    expect(connectorDistance(connector, rects, { x: 55, y: 200 })).toBeCloseTo(5, 6);
    // Inside the bounding box but a long way from the line: this is what a
    // bounding-box hit test would have claimed.
    expect(connectorDistance(connector, rects, { x: 100, y: 200 })).toBeCloseTo(50, 6);
  });
});

describe('connector.model — setConnectorEndpoint', () => {
  it('moves one end, leaving the other alone', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const c = shapeAt(doc, 0, 300);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;

    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', free(120, 240)),
    );
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(readConnector(doc, id)).toMatchObject({
      from: { kind: 'attached', objectId: a },
      to: { kind: 'free', x: 120, y: 240 },
    });

    expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
    const reattached = readConnector(doc, id)!;
    expect(reattached.to).toEqual({ kind: 'attached', objectId: c, fallbackX: 50, fallbackY: 300 });
  });

  it('refuses an arrow attached to the object its other end is on (TC-12)', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;
    const { result, updates } = withUpdateCount(doc, () =>
      setConnectorEndpoint(doc, id, 'to', attached(a)),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(readConnector(doc, id)!.to).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('TC-29: refuses a gone arrow, a non-arrow, an unknown end and a point that is not a place', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const id = createConnector(doc, attached(a), free(400, 50), 'g_a')!;
    expect(setConnectorEndpoint(doc, 'gone', 'to', free(1, 1))).toBe(false);
    expect(setConnectorEndpoint(doc, a, 'to', free(1, 1))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'middle' as 'to', free(1, 1))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', free(NaN, 1))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(a, Infinity, 0))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached('', 0, 0))).toBe(false);
  });
});

describe('connector.model — deleting what it points at', () => {
  it('TC-13: sets the ends free where they hung, in the delete itself', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;

    const { result, updates } = withUpdateCount(doc, () => deleteObject(doc, b));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const connector = readConnector(doc, id) as ConnectorSnapshot | undefined;
    expect(connector).toBeTruthy();
    expect(connector!.to).toEqual({ kind: 'free', x: 300, y: 50 });
    expect(connector!.from).toMatchObject({ kind: 'attached', objectId: a });
    // And it is still drawn where it was: its box spans the old anchor and the free end.
    expect(connector!.x).toBe(100);
    expect(connector!.width).toBe(200);
  });

  it('frees both ends of an arrow whose two objects go together', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;
    expect(deleteObjects(doc, [a, b, 'never-was'])).toBe(2);
    expect(readConnector(doc, id)).toMatchObject({
      from: { kind: 'free', x: 100, y: 50 },
      to: { kind: 'free', x: 300, y: 50 },
    });
  });

  it('leaves an arrow that pointed at nothing of its own', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const other = shapeAt(doc, 600, 0);
    const id = createConnector(doc, attached(a), attached(other), 'g_a')!;
    const before = JSON.stringify(readConnector(doc, id));
    const { updates } = withUpdateCount(doc, () => deleteObject(doc, 'never-was'));
    expect(updates).toBe(0);
    const after = withUpdateCount(doc, () => deleteObjects(doc, ['nope']));
    expect(after.updates).toBe(0);
    expect(JSON.stringify(readConnector(doc, id))).toBe(before);
  });

  it('reports nothing broken when an object with arrows on it is deleted', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const c = createSticky(doc, { x: 0, y: 400 })!;
    createConnector(doc, attached(a), attached(b), 'g_a');
    createConnector(doc, attached(b), attached(c), 'g_a');
    // An arrow that points at neither of them: one end on c, one end loose.
    createConnector(doc, attached(c, 0, 0), free(0, 900), 'g_a');
    deleteObject(doc, b);
    expect(console.error).not.toHaveBeenCalled();
    expect(readConnectors(doc)).toHaveLength(3);
    errors.mockRestore();
  });

  it('detaches only what the deleted ids ask for', () => {
    const doc = new Y.Doc();
    const a = shapeAt(doc, 0, 0);
    const b = shapeAt(doc, 300, 0);
    const id = createConnector(doc, attached(a), attached(b), 'g_a')!;
    doc.transact(() => detachConnectorsTo(doc, new Set(['someone-else'])), 'g_a');
    expect(readConnector(doc, id)!.to).toMatchObject({ kind: 'attached', objectId: b });
  });
});

describe('connector.model — a delete and a create that overlap', () => {
  it('keeps the arrow, ending where its object was, after both changes merge', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const start = new Y.Doc();
    initDoc(start);
    const a = shapeAt(start, 0, 0);
    const b = shapeAt(start, 300, 0);
    shapeAt(start, 600, 0);

    const dana = new Y.Doc();
    const sam = new Y.Doc();
    merge(dana, start);
    merge(sam, start);

    // Dana draws an arrow A→B while Sam deletes B, and neither hears about the
    // other first: the two changes are written against two different boards.
    const id = createConnector(dana, attached(a), attached(b), 'g_dana')!;
    deleteObject(sam, b);

    merge(dana, sam);
    merge(sam, dana);

    for (const doc of [dana, sam]) {
      expect(objectSnapshot(doc, b)).toBeUndefined();
      const arrow = readConnector(doc, id);
      expect(arrow).toBeTruthy();
      // Whether the delete reached this board before the arrow did or after it, the
      // end is drawn where B's side used to be, and the arrow is still selectable.
      expect(connectorPoints(arrow!, rectsOf(doc))[1]).toEqual({ x: 300, y: 50 });
      expect(connectorDistance(arrow!, rectsOf(doc), { x: 200, y: 50 })).toBeCloseTo(0, 6);
    }
    expect(console.error).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

/** The boxes of everything but the arrows, the way the client builds them. */
function rectsOf(doc: Y.Doc): Map<string, { x: number; y: number; width: number; height: number }> {
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const object of objectSnapshots(doc)) {
    if (object.type === 'connector') continue;
    rects.set(object.id, {
      x: object.x,
      y: object.y,
      width: object.width ?? STICKY_SIZE_WORLD,
      height: object.height ?? STICKY_SIZE_WORLD,
    });
  }
  return rects;
}

function merge(target: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
}
