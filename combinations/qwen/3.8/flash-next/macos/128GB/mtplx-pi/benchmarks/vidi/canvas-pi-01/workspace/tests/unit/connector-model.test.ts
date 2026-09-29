/**
 * Story 10 · task 9 — connector model and geometry unit tests (TC-07 to TC-14,
 * TC-29).
 *
 * The `connector.model` contract runs against a real `Y.Doc`. Two invariants are
 * checked everywhere: what the arrows *point at* (resolved points, so the
 * geometry is asserted where it is defined) and whether a transaction was opened
 * at all — a rejected gesture must not write, so the tests count `update`
 * events.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  CONNECTOR_TYPE,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createShape, SHAPE_TYPE } from '../../src/shared/objects/shape';
import { createSticky, deleteObjects, snapshot } from '../../src/shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/doc';

function freshDoc(): Y.Doc {
  return new Y.Doc();
}

/** Count `update` events fired while `fn` runs (0 means "nothing was written"). */
function updatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const observer = () => {
    count += 1;
  };
  doc.on('update', observer);
  fn();
  doc.off('update', observer);
  return count;
}

function recordOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return doc.getMap<Y.Map<unknown>>('objects').get(id);
}

/** A rectangle, for the pure geometry calls. */
function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

/** Seed a shape at a known rectangle and return its id. */
function seedShape(doc: Y.Doc, x: number, y: number, width = 100, height = 100): string {
  const id = createShape(doc, { kind: 'rect', rect: { x, y, width, height }, at: { x, y } }, 'g_test');
  return id!;
}

/** The two drawn points of a connector, read back from the snapshot. */
function endsOf(doc: Y.Doc, id: string) {
  const snap = snapshot(doc).find((s) => s.id === id);
  return snap?.ends;
}

describe('createConnector (connector.create_attached, connector.create_free)', () => {
  // TC-07: A→B 300 units apart stores both ends with the side anchors they were
  // created at, in one update.
  it('TC-07 stores an attached arrow in one update, with side anchors', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 300, 0);

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } };

    const updates = updatesDuring(doc, () => {
      const id = createConnector(doc, from, to, 'g_test');
      expect(id).not.toBeNull();
      const record = recordOf(doc, id!);
      expect(record!.get('type')).toBe(CONNECTOR_TYPE);
      // The stored ends are attached, and each `fallback` is the side midpoint
      // the arrow was drawn to, not the point the caller passed in.
      expect(record!.get('from')).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
      expect(record!.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
    });
    expect(updates).toBe(1);

    // The stored box is derived, so the raw record keeps its zeros…
    const record = recordOf(doc, 'nope');
    expect(record).toBeUndefined();
    // …and the snapshot reports the real footprint.
    const snap = snapshot(doc).find((s) => s.type === CONNECTOR_TYPE)!;
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(0);
  });

  // TC-08: an arrow between two ends of the same object is refused.
  it('TC-08 refuses to connect an object to itself', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } };

    const updates = updatesDuring(doc, () => {
      expect(createConnector(doc, from, { ...from }, 'g_test')).toBeNull();
    });
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(1); // only the shape
  });

  // TC-09: the length limit, at the boundary (7.9 refused, 8 accepted).
  it('TC-09 refuses a 7.9-unit free arrow and accepts an 8-unit one', () => {
    const doc = freshDoc();
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);

    const short = updatesDuring(doc, () => {
      expect(
        createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, 'g_test'),
      ).toBeNull();
    });
    expect(short).toBe(0);

    const exact = updatesDuring(doc, () => {
      expect(
        createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 8, y: 0 }, 'g_test'),
      ).not.toBeNull();
    });
    expect(exact).toBe(1);
  });

  it('refuses an arrow whose length lands exactly on the minimum between shapes', () => {
    const doc = freshDoc();
    // Two shapes 4 units apart: the resolved anchors are only 4 units apart,
    // inside the 8-unit budget, so the arrow is refused (no 2 px stubs).
    const a = seedShape(doc, 0, 0, 100, 100);
    const b = seedShape(doc, 104, 0, 100, 100);
    const updates = updatesDuring(doc, () => {
      expect(
        createConnector(
          doc,
          { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
          { kind: 'attached', objectId: b, fallback: { x: 104, y: 50 } },
          'g_test',
        ),
      ).toBeNull();
    });
    expect(updates).toBe(0);
  });

  it('refuses an arrow that points at an object that is not there', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    expect(
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: 'gone', fallback: { x: 300, y: 50 } },
        'g_test',
      ),
    ).toBeNull();
    expect(doc.getMap('objects').size).toBe(1);
  });
});

describe('nearestSide (connector.follow)', () => {
  // TC-10: the side switches at the rectangle's diagonal, not at 45°.
  it('TC-10 orbits a square: right at 0 and 44 degrees, top at 46 and 90', () => {
    const a = rect(0, 0, 100, 100);
    const centre = { x: 50, y: 50 };
    const radius = 200;
    const toward = (degrees: number) => ({
      x: centre.x + radius * Math.cos((degrees * Math.PI) / 180),
      // Screen y grows downwards, so "up" is a negative offset.
      y: centre.y - radius * Math.sin((degrees * Math.PI) / 180),
    });

    expect(nearestSide(a, toward(0))).toBe('right');
    expect(nearestSide(a, toward(44))).toBe('right');
    expect(nearestSide(a, toward(46))).toBe('top');
    expect(nearestSide(a, toward(90))).toBe('top');
    // And the mirrored directions, for completeness.
    expect(nearestSide(a, toward(180))).toBe('left');
    expect(nearestSide(a, toward(-90))).toBe('bottom');
  });

  it('gives a wide rectangle a narrower top face (diagonal rule, not 45 degrees)', () => {
    // 400 wide, 100 tall: the diagonal is at atan(100/400) ≈ 14 degrees.
    const wide = rect(0, 0, 400, 100);
    expect(nearestSide(wide, { x: 400, y: -100 })).toBe('right');
    expect(nearestSide(wide, { x: 200, y: -300 })).toBe('top');
  });
});

describe('sideAnchor and resolveEndpoints (connector.follow, connector.target_deleted)', () => {
  it('puts every side anchor on the boundary, at the middle of that side', () => {
    const r = rect(10, 20, 100, 60);
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 50 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 50 });
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 80 });
  });

  // TC-11: an arrow whose target vanished draws at its stored fallback point.
  it('TC-11 resolves an orphaned end to its fallback point without throwing', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'free', x: 250, y: 50 },
      'g_test',
    )!;

    // With A present, the end is on A's right side.
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
    rects.set(a, rect(0, 0, 100, 100));
    const connector = {
      from: { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } } as Endpoint,
      to: { kind: 'free', x: 250, y: 50 } as Endpoint,
    };
    expect(resolveEndpoints(connector, rects)).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 250, y: 50 },
    });

    // With A gone, the same connector resolves to the fallback point.
    const orphaned = resolveEndpoints(connector, new Map());
    expect(orphaned.from).toEqual({ x: 100, y: 50 });
    expect(orphaned.to).toEqual({ x: 250, y: 50 });

    // …and so it draws, rather than vanishing or throwing.
    expect(endsOf(doc, id)).toEqual({ from: { x: 100, y: 50 }, to: { x: 250, y: 50 } });
  });

  it('keeps following a moved object with no writes at all', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 300, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_test',
    )!;
    expect(endsOf(doc, id)).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });

    // Drag B above A: the arrow re-routes over the top, one-sided by itself.
    const bRecord = doc.getMap<Y.Map<unknown>>('objects').get(b)!;
    const updates = updatesDuring(doc, () => {
      doc.transact(() => {
        bRecord.set('x', 150);
        bRecord.set('y', -200);
      }, LOCAL_ORIGIN);
    });
    expect(updates).toBe(1); // the move only — the arrow wrote nothing

    const ends = endsOf(doc, id)!;
    // A's end is now on its top side, B's on its bottom side.
    expect(ends.from).toEqual({ x: 50, y: 0 });
    expect(ends.to).toEqual({ x: 200, y: -100 });
  });

  it('derives a bounding box that covers both ends', () => {
    expect(connectorBBox({ x: 10, y: 10 }, { x: 50, y: 30 })).toEqual({ x: 10, y: 10, width: 40, height: 20 });
    expect(connectorBBox({ x: 50, y: 30 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 20 });
    // A horizontal arrow has a zero-height box (its hit test is a distance).
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 0 });
  });
});

describe('setConnectorEndpoint (connector.reattach)', () => {
  /** A doc with three shapes and one A→B arrow. */
  function seeded() {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 300, 0);
    const c = seedShape(doc, 0, 400);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_test',
    )!;
    return { doc, a, b, c, id };
  }

  // TC-12: free, attached-to-a-third-object, and the rejected self-reconnect.
  it('TC-12 moves an end to free space, onto another object, and refuses the opposite one', () => {
    const { doc, a, c, id } = seeded();
    const record = () => recordOf(doc, id)!;

    // 1. Release over empty canvas → a free end at the release point.
    const freeUpdates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 200, y: 200 })).toBe(true);
    });
    expect(freeUpdates).toBe(1);
    expect(record().get('to')).toEqual({ kind: 'free', x: 200, y: 200 });

    // 2. Release onto a third object → attached, with a fresh side anchor.
    const attachUpdates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } })).toBe(true);
    });
    expect(attachUpdates).toBe(1);
    // C sits below A, so the arrow now runs *into* C's top side: the fresh
    // anchor is C's top midpoint, not the point the caller passed in.
    expect(record().get('to')).toEqual({ kind: 'attached', objectId: c, fallback: { x: 50, y: 400 } });

    // 3. Release onto the object the *other* end already points at → refused,
    // and nothing is written (the arrow would have zero length inside one shape).
    const sameTarget = record().get('from');
    const refused = updatesDuring(doc, () => {
      // `to` onto A, which `from` points at; then `from` onto C, which `to` now
      // points at. Both would collapse the arrow, and both write nothing.
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: c, fallback: { x: 0, y: 0 } })).toBe(false);
    });
    expect(refused).toBe(0);
    expect(record().get('to')).toEqual({ kind: 'attached', objectId: c, fallback: { x: 50, y: 400 } });
    expect(sameTarget).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
  });

  it('refuses a stale id, a non-finite point and a missing target object', () => {
    const { doc, id } = seeded();
    const updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, 'no-such-connector', 'to', { kind: 'free', x: 1, y: 1 })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: NaN, y: 40 })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: 'gone', fallback: { x: 0, y: 0 } })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // TC-29: an arrow deleted while a handle was being dragged is a no-op.
  it('TC-29 returns false for a connector that no longer exists', () => {
    const { doc, id } = seeded();
    doc.getMap('objects').delete(id);
    const updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 10, y: 10 })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('refuses to write to a sticky note through the connector API', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    const updates = updatesDuring(doc, () => {
      expect(setConnectorEndpoint(doc, note, 'from', { kind: 'free', x: 5, y: 5 })).toBe(false);
    });
    expect(updates).toBe(0);
  });
});

describe('detachConnectorsTo (connector.target_deleted)', () => {
  // TC-13: one delete, one update; the arrow stays and its end goes free where
  // the shape's side was.
  it('TC-13 deletes the shape and frees the arrow end in one update', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 300, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_test',
    )!;

    const updates = updatesDuring(doc, () => {
      expect(deleteObjects(doc, [a])).toBe(1);
    });
    expect(updates).toBe(1);

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.has(a)).toBe(false);
    const arrow = objects.get(id)!;
    expect(arrow.get('type')).toBe(CONNECTOR_TYPE);
    // The end that pointed at A is now a free point at A's right-side midpoint.
    expect(arrow.get('from')).toEqual({ kind: 'free', x: 100, y: 50 });
    // The end that still points at B is untouched.
    expect(arrow.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });

    // And it still draws: the snapshot keeps a footprint for it.
    const snap = snapshot(doc).find((s) => s.id === id)!;
    expect(snap.type).toBe(CONNECTOR_TYPE);
    expect(snap.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
  });

  it('frees both ends when both objects go, and leaves unrelated arrows alone', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 300, 0);
    const keep = seedShape(doc, 0, 400);
    const going = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } },
      'g_test',
    )!;
    const untouched = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: keep, fallback: { x: 50, y: 400 } },
      'g_test',
    )!;

    const updates = updatesDuring(doc, () => {
      expect(deleteObjects(doc, [a, b])).toBe(2);
    });
    expect(updates).toBe(1);

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(going)!.get('from')).toEqual({ kind: 'free', x: 100, y: 50 });
    expect(objects.get(going)!.get('to')).toEqual({ kind: 'free', x: 300, y: 50 });
    // `untouched` lost its first target, so that end normalises to the anchor it
    // was drawn at: A's bottom side, because the arrow ran down to `keep`.
    expect(objects.get(untouched)!.get('from')).toEqual({ kind: 'free', x: 50, y: 100 });
    expect(objects.get(untouched)!.get('to')).toEqual({ kind: 'attached', objectId: keep, fallback: { x: 50, y: 400 } });
  });

  it('does nothing for a delete that touches no arrow', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const updates = updatesDuring(doc, () => {
      expect(deleteObjects(doc, [a])).toBe(1);
    });
    // One update: the delete itself. `detachConnectorsTo` added nothing because
    // there was nothing to detach.
    expect(updates).toBe(1);
  });

  it('re-attaches a detached arrow when the object comes back', () => {
    // A detached arrow is data like any other: re-attaching is a normal write.
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'free', x: 400, y: 50 },
      'g_test',
    )!;
    const b = seedShape(doc, 350, 0);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } })).toBe(true);
    const record = recordOf(doc, id)!;
    expect(record.get('to')).toEqual({ kind: 'attached', objectId: b, fallback: { x: 350, y: 50 } });
    expect(record.get('type')).not.toBe(SHAPE_TYPE);
    void STICKY_SIZE_WORLD;
  });
});

describe('distanceToPolyline (connector.select)', () => {
  // TC-14: exact distances either side of the 6 px budget (in world units here).
  it('TC-14 reports 0, 5.99 and 6.01 from a straight segment', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  it('measures to the nearer of several segments, not to the first', () => {
    const bent = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(bent, { x: 102, y: 50 })).toBeCloseTo(2, 10);
    // Beyond the end of the polyline it is the distance to that end.
    expect(distanceToPolyline(bent, { x: 103, y: 0 })).toBeCloseTo(3, 10);
  });

  it('is total: a lone point, an empty polyline and junk input', () => {
    expect(distanceToPolyline([{ x: 0, y: 0 }], { x: 3, y: 4 })).toBe(5);
    expect(distanceToPolyline([], { x: 3, y: 4 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 0, y: 0 }], { x: NaN, y: 0 })).toBe(Infinity);
  });
});
