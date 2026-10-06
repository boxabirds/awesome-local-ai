/**
 * Connector model unit tests (TC-07 to TC-13) against a real Y.Doc.
 *
 * A connector stores which objects its ends are attached to, never a side and never an absolute
 * point (design key decision 4): the line is resolved from the objects' live rectangles, which is
 * what makes it follow them. Each accepted change is one `LOCAL_ORIGIN` transaction; each
 * rejection - same object at both ends, an arrow shorter than `CONNECTOR_MIN_LENGTH_WORLD`, a
 * stale id, a non-finite point, re-attaching an end to the object at its other end - happens
 * before a transaction is opened, so it produces no update at all.
 */
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import {
  createConnector,
  detachConnectorsTo,
  getConnectorRecord,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  allObjectIds,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import { normalizeRect, type Rect } from '../../src/shared/geometry';

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Every update this screen wrote, counted at the document. */
function watchLocalWrites(doc: Y.Doc): { count: number } {
  const seen = { count: 0 };
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) seen.count += 1;
  });
  return seen;
}

function connectorOf(doc: Y.Doc, id: string): ConnectorSnapshot | undefined {
  return snapshot(doc).find((obj) => obj.id === id) as ConnectorSnapshot | undefined;
}

/** The endpoint as the document stores it, not as the snapshot resolves it. */
function storedEnd(doc: Y.Doc, id: string, end: 'from' | 'to'): Endpoint | undefined {
  return getConnectorRecord(doc, id)?.get(end) as Endpoint | undefined;
}

/** A note centred on (x, y) - `createSticky` places it by its centre - returning its id. */
function noteAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x, y });
}

describe('connector.model.create', () => {
  test('TC-07 object to object stores both ends attached, with their side anchors as fallbacks', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0); // -100..100, centre (0, 0)
    const b = noteAt(doc, 500, 0); // 400..600: A's right edge is 300 from B's left edge
    const writes = watchLocalWrites(doc);

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    );
    expect(id).toBeTruthy();
    expect(writes.count).toBe(1);

    expect(storedEnd(doc, id!, 'from')).toEqual({
      kind: 'attached',
      objectId: a,
      fallback: { x: 100, y: 0 }, // A's right side, the one nearest B
    });
    expect(storedEnd(doc, id!, 'to')).toEqual({
      kind: 'attached',
      objectId: b,
      fallback: { x: 400, y: 0 }, // B's left side
    });

    const connector = connectorOf(doc, id!)!;
    expect(connector.type).toBe('connector');
    expect(connector.createdBy).toBe('g_test');
    // the snapshot's box is the resolved line, not the raw endpoints
    expect(objectBounds(connector)).toEqual({ x: 100, y: 0, width: 300, height: 0 });
    expect(connector.ends).toEqual({ from: { x: 100, y: 0 }, to: { x: 400, y: 0 } });
  });

  test('TC-08 both ends on the same object is refused without a transaction', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const writes = watchLocalWrites(doc);

    expect(
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: a, fallback: { x: 1, y: 1 } },
        'g_test',
      ),
    ).toBeNull();
    expect(writes.count).toBe(0);
    expect(allObjectIds(snapshot(doc))).toEqual([a]);
  });

  test('TC-09 a resolved length under the minimum creates no arrow; exactly the minimum does', () => {
    const doc = board();
    const writes = watchLocalWrites(doc);

    expect(
      createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 },
        'g_test',
      ),
    ).toBeNull();
    expect(writes.count).toBe(0);

    const id = createConnector(
      doc,
      { kind: 'free', x: 0, y: 0 },
      { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
      'g_test',
    );
    expect(id).toBeTruthy();
    expect(writes.count).toBe(1);
    expect(objectBounds(connectorOf(doc, id!)!)).toEqual({
      x: 0,
      y: 0,
      width: CONNECTOR_MIN_LENGTH_WORLD,
      height: 0,
    });
  });

  test('a release in empty space keeps a free end; an unknown object keeps the given fallback', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);

    const loose = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 500, y: 300 },
      'g_test',
    )!;
    expect(storedEnd(doc, loose, 'from')).toEqual({
      kind: 'attached',
      objectId: a,
      fallback: { x: 100, y: 0 }, // the right side, being the one nearest (500, 300)
    });
    expect(storedEnd(doc, loose, 'to')).toEqual({ kind: 'free', x: 500, y: 300 });

    // TC-27's model half: the target vanished between pointerdown and pointerup, and the arrow is
    // still made, from where that end is being drawn
    const orphan = createConnector(
      doc,
      { kind: 'attached', objectId: 'never-existed', fallback: { x: 7, y: 9 } },
      { kind: 'free', x: 400, y: 9 },
      'g_test',
    );
    expect(orphan).toBeTruthy();
    expect(connectorOf(doc, orphan!)!.ends).toEqual({ from: { x: 7, y: 9 }, to: { x: 400, y: 9 } });
  });

  test('a malformed endpoint is refused without a transaction', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const writes = watchLocalWrites(doc);

    expect(
      createConnector(
        doc,
        { kind: 'attached', objectId: 42 as unknown as string, fallback: { x: 0, y: 0 } },
        { kind: 'free', x: 100, y: 0 },
        'g_test',
      ),
    ).toBeNull();
    expect(
      createConnector(
        doc,
        { kind: 'free', x: Number.NaN, y: 0 },
        { kind: 'free', x: 100, y: 0 },
        'g_test',
      ),
    ).toBeNull();
    expect(
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: Number.POSITIVE_INFINITY, y: 0 } },
        { kind: 'free', x: 100, y: 0 },
        'g_test',
      ),
    ).toBeNull();
    expect(
      createConnector(doc, { kind: 'somewhere' } as unknown as Endpoint, { kind: 'free', x: 1, y: 1 }, 'g_test'),
    ).toBeNull();
    expect(writes.count).toBe(0);
  });

  test('an arrow sits above the objects that were already there', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const order = snapshot(doc).map((obj) => obj.id);
    expect(order[order.length - 1]).toBe(id);
  });
});

describe('connector.model.endpoint', () => {
  test('TC-11 an end re-attaches to another object, storing that object and its new anchor', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const c = noteAt(doc, 0, 420);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const writes = watchLocalWrites(doc);

    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } })).toBe(
      true,
    );
    expect(writes.count).toBe(1);
    expect(storedEnd(doc, id, 'to')).toEqual({
      kind: 'attached',
      objectId: c,
      fallback: { x: 0, y: 320 }, // C's top side, the one nearest A
    });
    expect(connectorOf(doc, id)!.ends).toEqual({ from: { x: 0, y: 100 }, to: { x: 0, y: 320 } });
  });

  test('TC-11 an end can be pulled off into empty space and stays where it was dropped', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    expect(setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: -80, y: 20 })).toBe(true);
    expect(storedEnd(doc, id, 'from')).toEqual({ kind: 'free', x: -80, y: 20 });
    expect(connectorOf(doc, id)!.ends).toEqual({ from: { x: -80, y: 20 }, to: { x: 400, y: 0 } });
  });

  test('TC-12 stale id, non-finite point and the object at the other end are all refused', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const before = storedEnd(doc, id, 'to');
    const writes = watchLocalWrites(doc);

    expect(setConnectorEndpoint(doc, 'never-existed', 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, a, 'to', { kind: 'free', x: 0, y: 0 })).toBe(false); // not a connector
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } })).toBe(
      false,
    );
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 4 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'middle' as 'from', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } })).toBe(
      false,
    ); // already is

    expect(writes.count).toBe(0);
    expect(storedEnd(doc, id, 'to')).toEqual(before);
  });
});

describe('connector.model.detachOnDelete', () => {
  test('TC-13 deleting an object frees its ends in the same transaction, and undo restores them', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;

    const undo = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    undo.stopCapturing(); // the delete is a step of its own, whatever happened just before it
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updates.push(update);
    });
    deleteObjects(doc, [a]);
    expect(updates).toHaveLength(1);

    const connector = connectorOf(doc, id)!;
    expect(connector).toBeTruthy(); // the arrow is still on the board
    expect(connector.from).toEqual({ kind: 'free', x: 100, y: 0 }); // where A's right side was
    expect(connector.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 0 } });

    // one undo brings the note back and the arrow with it
    undo.undo();
    const restored = connectorOf(doc, id)!;
    expect(restored.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 0 } });
    expect(snapshot(doc).map((obj) => obj.id)).toContain(a);
  });

  test('deleting one object frees the ends of every arrow on it, including both ends of one arrow', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const c = noteAt(doc, 0, 420);
    const one = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const two = createConnector(
      doc,
      { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const writes = watchLocalWrites(doc);

    deleteObject(doc, a);
    expect(writes.count).toBe(1);
    expect(connectorOf(doc, one)!.from.kind).toBe('free');
    expect(connectorOf(doc, two)!.to.kind).toBe('free');
    expect(connectorOf(doc, one)!.ends.from).toEqual({ x: 100, y: 0 });
    expect(connectorOf(doc, two)!.ends.to).toEqual({ x: 0, y: 100 });
  });

  test('an arrow with no attached object left on the board keeps both free ends, where they were drawn', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 400, y: 60 },
      'g_test',
    )!;
    deleteObjects(doc, [a]);
    const connector = connectorOf(doc, id)!;
    expect(connector.ends).toEqual({ from: { x: 100, y: 0 }, to: { x: 400, y: 60 } });
  });

  test('detachConnectorsTo is told which objects went, and touches nothing else', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const c = noteAt(doc, 0, 420);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const writes = watchLocalWrites(doc);

    detachConnectorsTo(doc, [c]); // an object with nothing attached to it
    expect(writes.count).toBe(0);
    expect(connectorOf(doc, id)!.ends).toEqual({ from: { x: 100, y: 0 }, to: { x: 400, y: 0 } });
  });
});

describe('connector.model.follows', () => {
  test('moving an object moves the endpoints of every arrow on it, in the snapshot', () => {
    const doc = board();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_test')!;
    const b = createShape(doc, { kind: 'ellipse', rect: { x: 400, y: 300, width: 100, height: 100 }, at: { x: 400, y: 300 } }, 'g_test')!;
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const before = connectorOf(doc, id)!.ends;
    expect(before).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 350 } });

    moveObjects(doc, new Map([[b, { x: 700, y: 300 }]]));
    const after = connectorOf(doc, id)!.ends;
    expect(after).toEqual({ from: { x: 100, y: 50 }, to: { x: 700, y: 350 } });
    expect(objectBounds(connectorOf(doc, id)!)).toEqual({ x: 100, y: 50, width: 600, height: 300 });
  });

  test('resizing an object moves the anchor it shares with an arrow', () => {
    const doc = board();
    const a = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'g_test',
    )!;
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'free', x: 400, y: 50 },
      'g_test',
    )!;
    expect(connectorOf(doc, id)!.ends.from).toEqual({ x: 100, y: 50 });
    resizeObjects(doc, new Map([[a, { x: 0, y: 0, width: 260, height: 100 }]]));
    expect(connectorOf(doc, id)!.ends.from).toEqual({ x: 260, y: 50 });
  });

  test('an arrow is not moved or resized as a box: dragging the selection leaves it alone', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const before = storedEnd(doc, id, 'from');
    const writes = watchLocalWrites(doc);

    expect(
      moveObjects(doc, new Map([[id, { x: 10, y: 10 }]])),
    ).toBe(0);
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 9, height: 9 }]]))).toBe(0);
    expect(writes.count).toBe(0);
    expect(storedEnd(doc, id, 'from')).toEqual(before);
  });

  test('an arrow is an ordinary object for id, z and the snapshot ordering', () => {
    const doc = board();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 500, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g_test',
    )!;
    const ids = allObjectIds(snapshot(doc) as readonly ObjectSnapshot[]);
    expect(ids).toContain(id);
    expect(ids).toHaveLength(3);
  });
});

/** `normalizeRect` is what the connector tool uses to build a drag box; used here to keep types honest. */
test('the drag box of a connector is a plain rectangle', () => {
  const box: Rect = normalizeRect({ x: 10, y: 10 }, { x: -30, y: 40 });
  expect(box).toEqual({ x: -30, y: 10, width: 40, height: 30 });
});
