// The connector object model (story 10): an arrow that stores the objects its ends
// are attached to and never where its ends are, so it follows them; one undo step
// per intent; and arrows that outlive the objects they pointed at.
//
// TC ids are the Acceptance Cases in
// spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md.
// TC-07 to TC-12, the geometry the arrow is drawn from, are in
// tests/unit/connector-geometry.test.ts.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  canAttachEnd,
  connectorRects,
  connectorSnapshot,
  connectorSnapshots,
  createConnector,
  detachConnectorsTo,
  dropEndpointOn,
  attachTarget,
  endpointsEqual,
  isEndpoint,
  readConnector,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { TYPE_CONNECTOR, TYPE_STICKY, TYPE_TEXT } from '../../src/shared/config';
import {
  createSticky,
  deleteObjects,
  moveObjects,
  resizeObjects,
  snapshotByCreation,
} from '../../src/shared/board-model';
import { putRawObject, rawObject } from '../helpers/yjs';

/** How many object entries the document holds, of any type. */
function objectCount(doc: Y.Doc): number {
  return doc.getMap<unknown>('objects').size;
}

/** How many `update` events one call produced. */
function updatesOf(doc: Y.Doc, write: () => unknown): number {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  write();
  doc.off('update', listener);
  return updates;
}

function attached(objectId: string, fallback: { x: number; y: number } = { x: 0, y: 0 }): Endpoint {
  return { kind: 'attached', objectId, fallback };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

/** The point an end was attached at, or a free end's own point. */
function fallbackOf(end: Endpoint): { x: number; y: number } {
  return end.kind === 'attached' ? end.fallback : { x: end.x, y: end.y };
}

/** A board with two shapes 100 × 100, side by side, and the arrow between them. */
function twoShapesAndAnArrow(doc = new Y.Doc()) {
  const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_dana')!;
  const c = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'g_dana')!;
  const id = createConnector(doc, attached(a), attached(c), 'g_dana')!;
  return { doc, a, c, id };
}

describe("createConnector (TC-13)", () => {
  // TC-13
  it("TC-13 stores one attached end and one free end, above every object, and draws them where they belong", () => {
    const doc = new Y.Doc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_dana')!;
    putRawObject(doc, 'text_high', { type: TYPE_TEXT, z: 40, createdAt: 2 });

    const before = Date.now();
    const id = createConnector(doc, attached(a, { x: 100, y: 50 }), free(500, 40), 'g_sam');
    expect(id).not.toBeNull();

    expect(objectCount(doc)).toBe(3);
    const object = rawObject(doc, id!)!;
    expect(object.get('type')).toBe(TYPE_CONNECTOR);
    expect(Number(object.get('z'))).toBeGreaterThan(40);
    expect(object.get('createdBy')).toBe('g_sam');
    expect(object.get('createdAt')).toBeGreaterThanOrEqual(before);
    expect(object.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(object.get('to')).toEqual({ kind: 'free', x: 500, y: 40 });
    // where the ends are is never stored: the box is derived, so it cannot go stale
    expect([object.get('x'), object.get('y'), object.get('width'), object.get('height')]).toEqual([0, 0, 0, 0]);

    const snap = connectorSnapshot(doc, id!) as ConnectorSnapshot;
    expect(snap.ends.from).toEqual({ x: 100, y: 50 }); // A's right side, facing the free end
    expect(snap.ends.to).toEqual({ x: 500, y: 40 });
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(40);
    expect(snap.width).toBe(400);
    expect(snap.height).toBe(10);
    expect(snap.type).toBe(TYPE_CONNECTOR);
    expect(connectorSnapshots(doc)).toHaveLength(1);
    expect(snapshotByCreation(doc)).toHaveLength(0); // an arrow is not a note
  });

  it("TC-13 attaches to any board object, not only to shapes", () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 }); // centred: its box is (-100, -100) 200 × 200
    const text = createTextLike(doc, 'text_1', 400, 0);
    const id = createConnector(doc, attached(note), attached(text), 'g_dana')!;
    const snap = connectorSnapshot(doc, id)!;
    expect(snap.ends.from).toEqual({ x: 100, y: 0 }); // the note's right side
    expect(snap.ends.to).toEqual({ x: 400, y: 50 }); // the text's left side
    expect(canAttachEnd(TYPE_STICKY)).toBe(true);
    expect(canAttachEnd(TYPE_TEXT)).toBe(true);
    expect(canAttachEnd(TYPE_CONNECTOR)).toBe(false); // an arrow's place is borrowed
  });

  function createTextLike(doc: Y.Doc, id: string, x: number, y: number): string {
    putRawObject(doc, id, {
      type: TYPE_TEXT,
      x,
      y,
      width: 120,
      height: 100,
      z: 1,
      createdAt: 1,
      text: new Y.Text('word'),
    });
    return id;
  }

  it("TC-13 keeps an end that names an object that is not on the board", () => {
    // the other person deleted the shape at this very moment: the arrow is still
    // drawn, from the point the end was attached at
    const doc = new Y.Doc();
    const id = createConnector(doc, attached('g_one', { x: 7, y: 11 }), free(300, 40), 'g_dana');
    expect(id).not.toBeNull();
    const snap = connectorSnapshot(doc, id!)!;
    expect(snap.ends.from).toEqual({ x: 7, y: 11 });
  });

  it("TC-13 refuses ends that are not ends, without a transaction", () => {
    const doc = new Y.Doc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_dana')!;
    const bad: unknown[] = [
      null,
      undefined,
      'attached',
      { kind: 'free', x: Number.NaN, y: 0 },
      { kind: 'free', x: '10', y: 2 },
      { kind: 'attached' },
      { kind: 'attached', objectId: '' },
      { kind: 'attached', objectId: 42 },
      { kind: 'glued', objectId: a },
    ];
    for (const end of bad) {
      expect(updatesOf(doc, () => createConnector(doc, end as Endpoint, free(1, 2), 'g_dana'))).toBe(0);
      expect(updatesOf(doc, () => createConnector(doc, attached(a), end as Endpoint, 'g_dana'))).toBe(0);
    }
    expect(connectorSnapshots(doc)).toHaveLength(0);
    expect(objectCount(doc)).toBe(1); // only the shape
    expect(isEndpoint(free(1, 2))).toBe(true);
    expect(isEndpoint({ kind: 'free', x: 1 })).toBe(false);
  });

  it("TC-13 draws arrows in creation order and skips a damaged entry", () => {
    const { doc, id } = twoShapesAndAnArrow();
    const second = createConnector(doc, free(0, 0), free(10, 10), 'g_dana')!;
    expect(connectorSnapshots(doc).map((c) => c.id)).toEqual([id, second]);

    putRawObject(doc, 'connector_broken', {
      type: TYPE_CONNECTOR,
      x: 0,
      y: 0,
      z: 1,
      createdAt: 1,
      from: attached('g_one'),
      // no `to` at all: half an arrow is not an arrow, so it is not drawn
    });
    expect(connectorSnapshots(doc).map((c) => c.id)).toEqual([id, second]);
    expect(readConnector('connector_broken', rawObject(doc, 'connector_broken')!)).toBeNull();
  });
});

describe("setConnectorEndpoint (TC-14)", () => {
  // TC-14
  it("TC-14 re-attaches one end in one update and leaves the other end alone", () => {
    const { doc, a, c, id } = twoShapesAndAnArrow();
    const d = createShape(doc, { kind: 'diamond', rect: { x: 500, y: 300, width: 100, height: 100 }, at: { x: 500, y: 300 } }, 'g_dana')!;

    const updates = updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', attached(d, { x: 550, y: 350 })));
    expect(updates).toBe(1);
    const object = rawObject(doc, id)!;
    expect((object.get('to') as { objectId: string }).objectId).toBe(d);
    expect(object.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } });
    expect(Number(object.get('x'))).toBe(0);

    const snap = connectorSnapshot(doc, id)!;
    expect(snap.ends.from).toEqual({ x: 100, y: 50 }); // still A's right side, now facing D
    expect(snap.ends.to).toEqual({ x: 500, y: 350 }); // D's left side, facing A
    expect([snap.x, snap.y, snap.width, snap.height]).toEqual([100, 50, 400, 300]);
    void c;
  });

  it("TC-14 detaches an end onto a board point in one update", () => {
    const { doc, id } = twoShapesAndAnArrow();
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'from', free(12, 34)))).toBe(1);
    const snap = connectorSnapshot(doc, id)!;
    expect(snap.from).toEqual({ kind: 'free', x: 12, y: 34 });
    expect(snap.ends.from).toEqual({ x: 12, y: 34 });
  });

  it("TC-14 writes nothing for an end dropped where it already was, nor for a bad request", () => {
    const { doc, a, c, id } = twoShapesAndAnArrow();
    // the same object, the same side: a handle tapped back onto its own anchor
    const before = connectorSnapshot(doc, id)!;
    expect(setConnectorEndpoint(doc, id, 'to', attached(c, fallbackOf(before.to)))).toBe(true);
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', attached(c, fallbackOf(before.to))))).toBe(0);
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'from', attached(a, { x: 0, y: 0 })))).toBe(0);
    expect(connectorSnapshot(doc, id)!.ends).toEqual(before.ends);

    expect(endpointsEqual(attached(c, { x: 1, y: 2 }), attached(c, { x: 1, y: 2 }))).toBe(true);
    // the point an end was attached at is part of it: it is where the end stays if
    // its object is deleted, so a different one is a different end
    expect(endpointsEqual(attached(c, { x: 1, y: 2 }), attached(c, { x: 9, y: 9 }))).toBe(false);
    expect(endpointsEqual(free(1, 2), free(1, 3))).toBe(false);
    expect(endpointsEqual(free(1, 2), attached('x'))).toBe(false);
  });

  it("TC-14 refuses a stale id, a missing end name and an end that is not one, with no update", () => {
    const { doc, id, c } = twoShapesAndAnArrow();
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, 'g_gone', 'to', attached(c)))).toBe(0);
    expect(setConnectorEndpoint(doc, 'g_gone', 'to', attached(c))).toBe(false);
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, '', 'to', attached(c)))).toBe(0);
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'middle' as never, attached(c)))).toBe(0);
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, id, 'to', { kind: 'nope' } as never))).toBe(0);
    expect(connectorSnapshot(doc, id)!.to.kind).toBe('attached');
    // an arrow's own end name belongs to a shape: a shape is not an arrow
    expect(updatesOf(doc, () => setConnectorEndpoint(doc, c, 'to', free(0, 0)))).toBe(0);
  });
});

describe("detachConnectorsTo, through deleteObjects (TC-29)", () => {
  // TC-29: the arrow outlives the shape, pinned where the shape's side was.
  it("TC-29 keeps the arrow and frees its end at the anchor it was drawn at", () => {
    const { doc, a, c, id } = twoShapesAndAnArrow();
    const before = connectorSnapshot(doc, id)!;
    expect(before.ends.to).toEqual({ x: 300, y: 50 }); // C's left side

    // one transaction for the delete and the detach together: one update on the wire,
    // one step for undo, so undoing the delete puts the shape back with the arrow
    // still pointing at it
    const updates = updatesOf(doc, () => deleteObjects(doc, [c]));
    expect(updates).toBe(1);

    const snap = connectorSnapshot(doc, id) as ConnectorSnapshot;
    expect(snap).not.toBeNull();
    expect(snap.to).toEqual({ kind: 'free', x: 300, y: 50 });
    expect(snap.from.kind).toBe('attached'); // A still holds its end
    expect(connectorSnapshots(doc)).toHaveLength(1);
    // the arrow still has a length: it did not collapse onto its remaining end
    const length = Math.hypot(snap.ends.to.x - snap.ends.from.x, snap.ends.to.y - snap.ends.from.y);
    expect(length).toBeGreaterThan(0);
    expect(snap.ends.from).toEqual({ x: 100, y: 50 });
    expect(snap.width).toBe(200);
    void a;
  });

  it("TC-29 frees both ends when both objects go, and leaves the arrow on the board", () => {
    const { doc, a, c, id } = twoShapesAndAnArrow();
    const before = connectorSnapshot(doc, id)!;
    deleteObjects(doc, [a, c]);
    const snap = connectorSnapshot(doc, id)!;
    expect(snap.from).toEqual({ kind: 'free', x: before.ends.from.x, y: before.ends.from.y });
    expect(snap.to).toEqual({ kind: 'free', x: before.ends.to.x, y: before.ends.to.y });
    expect(snapshotByCreation(doc)).toHaveLength(0);
    expect(connectorSnapshots(doc)).toHaveLength(1);
  });

  it("TC-29 pins an end at the side it was on, not at the object it was on", () => {
    const doc = new Y.Doc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_dana')!;
    const c = createShape(doc, { kind: 'rect', rect: { x: 0, y: 300, width: 100, height: 100 }, at: { x: 0, y: 300 } }, 'g_dana')!;
    const id = createConnector(doc, attached(a), attached(c), 'g_dana')!;
    expect(connectorSnapshot(doc, id)!.ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 300 } });
    deleteObjects(doc, [c]);
    expect(connectorSnapshot(doc, id)!.to).toEqual({ kind: 'free', x: 50, y: 300 });
  });

  it("TC-29 adds no update when nothing on the board pointed at what was deleted", () => {
    const { doc, a, c } = twoShapesAndAnArrow();
    const note = createSticky(doc, { x: 900, y: 900 });
    expect(updatesOf(doc, () => deleteObjects(doc, [note]))).toBe(1);
    // a delete that frees two arrow ends is no more an update than one that frees none
    expect(updatesOf(doc, () => deleteObjects(doc, [a, c]))).toBe(1);
    expect(updatesOf(doc, () => deleteObjects(doc, []))).toBe(0);
    expect(updatesOf(doc, () => deleteObjects(doc, ['g_never']))).toBe(0);
  });

  it("TC-29 leaves a free end untouched and only touches the end that pointed away", () => {
    const doc = new Y.Doc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_dana')!;
    const c = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'g_dana')!;
    const id = createConnector(doc, attached(a), free(900, 40), 'g_dana')!;
    deleteObjects(doc, [c]);
    const snap = connectorSnapshot(doc, id)!;
    expect(snap.to).toEqual({ kind: 'free', x: 900, y: 40 });
    expect(snap.from.kind).toBe('attached');
    // and the arrow still follows A, which is the only object it has left
    moveObjects(doc, new Map([[a, { x: 10, y: 0 }]]));
    expect(connectorSnapshot(doc, id)!.ends.from).toEqual({ x: 110, y: 50 });
  });

  it("TC-29 does nothing for a call that names no objects, and works on a copy of a peer board", () => {
    const { doc, a, id } = twoShapesAndAnArrow();
    expect(updatesOf(doc, () => detachConnectorsTo(doc, []))).toBe(0);
    expect(updatesOf(doc, () => detachConnectorsTo(doc, ['g_gone']))).toBe(0);
    expect(updatesOf(doc, () => detachConnectorsTo(doc, undefined as never))).toBe(0);
    expect(updatesOf(doc, () => detachConnectorsTo(doc, [null as never]))).toBe(0);

    // a peer deletes the shape: the same thing happens on this side, from the
    // remote update alone, because the arrow is drawn from the board it shares
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    deleteObjects(doc, [a]);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const here = connectorSnapshot(doc, id)!;
    const there = connectorSnapshot(peer, id)!;
    expect(there.from).toEqual(here.from);
    expect(there.from.kind).toBe('free');
  });

  it("TC-29 keeps following an object that is resized as well as one that is moved", () => {
    const { doc, c, id } = twoShapesAndAnArrow();
    resizeObjects(doc, new Map([[c, { x: 400, y: 0, width: 120, height: 100 }]]));
    expect(connectorSnapshot(doc, id)!.ends.to).toEqual({ x: 400, y: 50 });
    moveObjects(doc, new Map([[c, { x: 50, y: 300 }]]));
    const snap = connectorSnapshot(doc, id)!;
    // C is below A now: both ends switched to the vertical sides
    expect(snap.ends.from).toEqual({ x: 50, y: 100 });
    expect(snap.ends.to).toEqual({ x: 110, y: 300 });
  });
});

describe("connectorRects", () => {
  it("boxes every object an arrow can point at, with the board’s own defaults", () => {
    const { doc, a, id } = twoShapesAndAnArrow();
    const note = createSticky(doc, { x: 600, y: 0 });
    const rects = connectorRects(doc);
    expect(rects.get(a)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(rects.get(note)).toEqual({ x: 500, y: -100, width: 200, height: 200 });
    expect(rects.has(id)).toBe(false); // an arrow is not a thing to attach to
    expect(rects.size).toBe(3); // two shapes and the note
  });

  it("leaves out an object without a place of its own", () => {
    const doc = new Y.Doc();
    putRawObject(doc, 'sticky_nowhere', { type: TYPE_STICKY, createdAt: 1 });
    expect(connectorRects(doc).size).toBe(0);
  });
});

describe("dropEndpointOn, the end a drop makes", () => {
  it("TC-13 refuses a drop on the object its other end is on, and no other one", () => {
    const { doc, a, c, id } = twoShapesAndAnArrow();

    // the model refuses the write, so the caller asks first and writes nothing at all:
    // a handle dropped where the other end already lives goes back to its own side
    expect(setConnectorEndpoint(doc, id, 'to', attached(a, { x: 20, y: 20 }))).toBe(false);
    expect(dropEndpointOn(doc, endsOf(doc, id), 'to', { x: 20, y: 20 })).toBeNull();
    expect(connectorSnapshot(doc, id)!.to).toMatchObject({ kind: 'attached', objectId: c });
    expect(connectorSnapshot(doc, id)!.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });

    // a drop on empty board is a point on the board, and is always allowed
    const onBoard = dropEndpointOn(doc, endsOf(doc, id), 'to', { x: 200, y: 40 });
    expect(onBoard).toEqual(free(200, 40));
    expect(setConnectorEndpoint(doc, id, 'to', must(onBoard))).toBe(true);
    expect(connectorSnapshot(doc, id)!.to).toEqual({ kind: 'free', x: 200, y: 40 });

    // and once the *other* end is off the object, that object is a drop like any other
    expect(setConnectorEndpoint(doc, id, 'from', free(-40, 0))).toBe(true);
    expect(dropEndpointOn(doc, endsOf(doc, id), 'to', { x: 20, y: 20 })).toEqual(
      attached(a, { x: 0, y: 50 }), // the side of a that faces the end fixed at (-40, 0)
    );

    // the same rule holds at the other end of the arrow
    expect(setConnectorEndpoint(doc, id, 'to', attached(c, { x: 300, y: 50 }))).toBe(true);
    expect(dropEndpointOn(doc, endsOf(doc, id), 'from', { x: 320, y: 20 })).toBeNull();
  });

  it("TC-13 makes no arrow between one object and itself, and moves none either", () => {
    const { doc, a, c, id } = twoShapesAndAnArrow();

    // the rule is the model's, so a tool, a paste, an undo and a dragged handle are
    // all held to it: the object the other end is on is not a drop, and not a birth
    expect(createConnector(doc, attached(a), attached(a), 'g_sam')).toBeNull();
    expect(objectCount(doc)).toBe(3);
    expect(setConnectorEndpoint(doc, id, 'to', attached(a, { x: 20, y: 20 }))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'from', attached(c, { x: 320, y: 20 }))).toBe(false);
    expect(connectorSnapshot(doc, id)!.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });

    // an end pinned to the board is not an object, so these are both ordinary arrows
    expect(createConnector(doc, attached(a), free(300, 0), 'g_sam')).not.toBeNull();
    expect(createConnector(doc, free(0, 0), free(300, 0), 'g_sam')).not.toBeNull();
  });

  it("TC-13 anchors a dropped end where the arrow is drawn, not where the pointer fell", () => {
    const { doc, c, id } = twoShapesAndAnArrow();

    // dropped on `c`, drawn from `a`: the anchor is the side of c that faces a, which
    // is the point the arrow is drawn at right now - so releasing a handle overwrites
    // the end with what it already says and the arrow does not move or flicker
    const dropped = dropEndpointOn(doc, endsOf(doc, id), 'to', { x: 320, y: 20 });
    expect(dropped).toEqual(attached(c, { x: 300, y: 50 }));
    expect(fallbackOf(must(dropped))).toEqual(connectorSnapshot(doc, id)!.ends.to);

    // it is not the side the pointer fell nearest to: a drop on c's far side still
    // arrives by the side that faces a
    expect(fallbackOf(must(dropEndpointOn(doc, endsOf(doc, id), 'to', { x: 399, y: 4 })))).toEqual({
      x: 300,
      y: 50,
    });

    // and an end fixed on the board is aimed at by its own point
    expect(setConnectorEndpoint(doc, id, 'to', free(700, 20))).toBe(true);
    expect(fallbackOf(must(dropEndpointOn(doc, endsOf(doc, id), 'from', { x: 90, y: 10 })))).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("the object a drop falls onto is the top one, and nothing at all on empty board", () => {
    const { doc, a, c } = twoShapesAndAnArrow();
    const on = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 60, height: 60 }, at: { x: 0, y: 0 } }, 'g_dana')!;

    expect(attachTarget(doc, { x: 10, y: 10 })?.id).toBe(on); // later than a, and above it
    expect(attachTarget(doc, { x: 200, y: 10 })).toBeNull(); // between the two shapes
    expect(attachTarget(doc, { x: 300, y: 10 })?.id).toBe(c); // its edge is c's
    expect(attachTarget(doc, { x: 70, y: 10 })?.id).toBe(a); // outside the shape drawn over it

    // an object of a kind the model does not know is not something to drop onto
    doc.getMap('objects').set('ghost', new Y.Map<unknown>([['type', 'ghost']]));
    expect(attachTarget(doc, { x: 10, y: 10 })?.id).toBe(on);
  });
});

function must<T>(value: T | null): T {
  if (value === null) throw new Error('the model refused a write the test expected it to take');
  return value;
}

function endsOf(doc: Y.Doc, id: string): { from: Endpoint; to: Endpoint } {
  const snap = connectorSnapshot(doc, id);
  if (snap === null) throw new Error('the connector is not on the board');
  return { from: snap.from, to: snap.to };
}
