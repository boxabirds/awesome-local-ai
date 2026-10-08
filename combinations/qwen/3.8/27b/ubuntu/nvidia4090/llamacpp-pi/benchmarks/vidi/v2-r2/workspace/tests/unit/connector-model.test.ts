/**
 * Story 10, connector model + geometry unit tests (design connector.*,
 * TC-07 to TC-14 and TC-29).
 *
 * The 'connector' object type: an arrow between two endpoints (free points
 * or object attachments with fallback anchors), side anchors and
 * nearest-side selection, resolution against live rects (arrows follow
 * their objects; orphans render at the fallback), detach-on-delete and
 * endpoint re-setting.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObjects,
  snapshotAll,
} from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import {
  arrowheadPoints,
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Side,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createConnector,
  detachConnectorsTo,
  readEndpoint,
  setConnectorEndpoint,
  type Endpoint,
} from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { objectRects } from '../../src/shared/board-model';
import { type Rect } from '../../src/shared/geometry';

const CREATOR = 'g_test';

function newDoc(): Y.Doc {
  return new Y.Doc();
}

function countUpdates(doc: Y.Doc): { updates: number; off: () => void } {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  return {
    get updates() {
      return updates;
    },
    off: () => doc.off('update', handler),
  };
}

/** A 100x100 square at (0,0). */
const SQ: Rect = { x: 0, y: 0, width: 100, height: 100 };

/** A point on a circle of radius r around SQ's centre, at angleDeg measured
 *  from the right axis (0 deg) TOWARD THE TOP (90 deg). The world is y-down,
 *  so reaching the top means a *negative* y offset. */
function onCircle(angleDeg: number, r = 200): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + r * Math.cos(a), y: 50 - r * Math.sin(a) };
}

describe('connector model (design connector.*)', () => {
  it('TC-07: A and B 300 apart: attached endpoints are stored with side-anchor fallbacks; exactly one update; the line resolves to the facing sides', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, CREATOR)!;
    const updates = countUpdates(doc);

    const from: Endpoint = { kind: 'attached', objectId: a, fallback: sideAnchor({ x: 0, y: 0, width: 100, height: 100 }, 'right') };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: sideAnchor({ x: 400, y: 0, width: 100, height: 100 }, 'left') };
    const id = createConnector(doc, { from, to }, CREATOR);
    expect(id).not.toBeNull();
    expect(updates.updates).toBe(1); // exactly one update

    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(entry.get('type')).toBe('connector');
    expect(entry.get('x')).toBe(0);
    expect(entry.get('y')).toBe(0);
    const storedFrom = readEndpoint(entry.get('from'))!;
    const storedTo = readEndpoint(entry.get('to'))!;
    expect(storedFrom).toEqual({ kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } });
    expect(storedTo).toEqual({ kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } });

    // The snapshot derives the resolved points: A's right side, B's left side.
    const snap = snapshotAll(doc).find((o) => o.id === id)!;
    expect(snap.fromPoint).toEqual({ x: 100, y: 50 });
    expect(snap.toPoint).toEqual({ x: 400, y: 50 });
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
    expect(snap.width).toBe(300);
    expect(snap.height).toBe(0);
    updates.off();
  });

  it('TC-08: free endpoints are stored as points, attached as objectId; one update', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const updates = countUpdates(doc);
    const id = createConnector(
      doc,
      { from: { kind: 'free', x: 10, y: 20 }, to: { kind: 'attached', objectId: a, fallback: { x: 50, y: 0 } } },
      CREATOR,
    );
    expect(id).not.toBeNull();
    expect(updates.updates).toBe(1);
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(readEndpoint(entry.get('from'))).toEqual({ kind: 'free', x: 10, y: 20 });
    expect(readEndpoint(entry.get('to'))).toEqual({ kind: 'attached', objectId: a, fallback: { x: 50, y: 0 } });
    updates.off();
  });

  it('TC-09: 7.9 units apart is not created (0 updates), 8 units is', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const tooShort = createConnector(
      doc,
      { from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 } },
      CREATOR,
    );
    expect(tooShort).toBeNull();
    expect(updates.updates).toBe(0);
    const justOk = createConnector(
      doc,
      { from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 } },
      CREATOR,
    );
    expect(justOk).not.toBeNull();
    expect(updates.updates).toBe(1);
    // Non-finite free points are rejected too.
    const nan = createConnector(
      doc,
      { from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'free', x: Number.NaN, y: 0 } } as never,
      CREATOR,
    );
    expect(nan).toBeNull();
    updates.off();
  });

  it('TC-10: nearest side switches at the diagonal — B circling A at 0/44/46/90 degrees gives right/right/top/top', () => {
    expect(nearestSide(SQ, onCircle(0))).toBe('right');
    expect(nearestSide(SQ, onCircle(44))).toBe('right');
    expect(nearestSide(SQ, onCircle(46))).toBe('top');
    expect(nearestSide(SQ, onCircle(90))).toBe('top');
    // The other octants behave symmetrically.
    expect(nearestSide(SQ, onCircle(180))).toBe('left');
    expect(nearestSide(SQ, onCircle(270))).toBe('bottom');
    // A non-square rect follows its aspect. For a wide (200x50) rect the
    // right side only owns directions within atan(h/w) ~ 14 deg of
    // horizontal; beyond that the tall top/bottom faces win. (y-down: a
    // positive angle below the axis heads toward the bottom face.)
    const wide: Rect = { x: 0, y: 0, width: 200, height: 50 };
    const at = (angleDeg: number, r: number): Side =>
      nearestSide(wide, { x: 100 + r * Math.cos((angleDeg * Math.PI) / 180), y: 25 + r * Math.sin((angleDeg * Math.PI) / 180) });
    expect(at(10, 100)).toBe('right'); // within ~14 deg of horizontal
    expect(at(20, 100)).toBe('bottom'); // the wide top/bottom faces win
  });

  it('TC-11: resolving with B missing gives the fallback without throwing; A still resolves to its side anchor facing B', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, CREATOR)!;
    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, { from, to }, CREATOR)!;

    // B disappears (e.g. deleted on another client while this doc is stale).
    deleteObjects(doc, [b]);
    const snap = snapshotAll(doc).find((o) => o.id === id)!;
    expect(snap.toPoint).toEqual({ x: 400, y: 50 }); // B's fallback
    // A is still live: its anchor is the side facing B's (fallback) centre,
    // i.e. A's right side.
    expect(snap.fromPoint).toEqual(sideAnchor({ x: 0, y: 0, width: 100, height: 100 }, 'right'));
  });

  it('TC-12: setConnectorEndpoint — free is updated, attached C is updated, the opposite end object is rejected (0 updates)', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const c = createShape(doc, { kind: 'rect', rect: { x: 0, y: 400, width: 100, height: 100 }, at: { x: 0, y: 400 } }, CREATOR)!;
    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 50, y: 100 } };
    const to: Endpoint = { kind: 'free', x: 300, y: 50 };
    const id = createConnector(doc, { from, to }, CREATOR)!;
    const updates = countUpdates(doc);

    // to -> free at a new point.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 200, y: 200 })).toBe(true);
    expect(updates.updates).toBe(1);
    expect(readEndpoint((doc.getMap('objects').get(id) as Y.Map<unknown>).get('to'))).toEqual({
      kind: 'free',
      x: 200,
      y: 200,
    });

    // to -> attached to C.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: c, fallback: { x: 0, y: 450 } })).toBe(true);
    expect(updates.updates).toBe(2);
    expect(readEndpoint((doc.getMap('objects').get(id) as Y.Map<unknown>).get('to'))).toEqual({
      kind: 'attached',
      objectId: c,
      fallback: { x: 0, y: 450 },
    });

    // to -> attached to A (the object holding the opposite end): rejected.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } })).toBe(false);
    expect(updates.updates).toBe(2);
    // Stale connector id: rejected.
    expect(setConnectorEndpoint(doc, 'missing', 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(updates.updates).toBe(2);
    updates.off();
  });

  it('TC-13: deleteObjects([A]) removes A and turns the connector end into a free point at A anchor; exactly one update', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, CREATOR)!;
    const from: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } };
    const id = createConnector(doc, { from, to }, CREATOR)!;
    const updates = countUpdates(doc);

    const deleted = deleteObjects(doc, [a]);
    expect(deleted).toBe(1);
    expect(updates.updates).toBe(1); // detach + delete in one update

    const snap = snapshotAll(doc).find((o) => o.id === id)!;
    expect(snap.from).toEqual({ kind: 'free', x: 100, y: 50 }); // A's right-side anchor
    expect(snap.fromPoint).toEqual({ x: 100, y: 50 });
    // The other end is untouched.
    expect(snap.to).toEqual(to);
    expect(snap.toPoint).toEqual({ x: 400, y: 50 });
    updates.off();
  });

  it('TC-29: setConnectorEndpoint on a deleted connector id returns false', () => {
    const doc = newDoc();
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const b = createShape(doc, { kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 } }, CREATOR)!;
    const id = createConnector(
      doc,
      {
        from: { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
        to: { kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } },
      },
      CREATOR,
    )!;
    const updates = countUpdates(doc);
    deleteObjects(doc, [id]);
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 0, y: 0 })).toBe(false);
    expect(updates.updates).toBe(1); // only the deletion itself
    updates.off();
  });

  it('TC-14: arrowhead points and the 6 screen-px tolerance hold at any zoom', () => {
    // Horizontal arrow: tip at the target, base 10 behind and 10 wide.
    const h = arrowheadPoints({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(h.tip).toEqual({ x: 100, y: 0 });
    expect(h.baseLeft).toEqual({ x: 90, y: 5 });
    expect(h.baseRight).toEqual({ x: 90, y: -5 });

    // 45-degree arrow: base offset along the unit diagonal.
    const d = Math.SQRT1_2;
    const diag = arrowheadPoints({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(diag.tip).toEqual({ x: 100, y: 100 });
    expect(diag.baseLeft.x).toBeCloseTo(100 - 10 * d - 5 * d);
    expect(diag.baseLeft.y).toBeCloseTo(100 - 10 * d + 5 * d);
    expect(diag.baseRight.x).toBeCloseTo(100 - 10 * d + 5 * d);
    expect(diag.baseRight.y).toBeCloseTo(100 - 10 * d - 5 * d);

    // Tolerance: hit when the screen-space distance is within 6 px.
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const hit = (screenPx: number, zoom: number): boolean =>
      distanceToPolyline(line, { x: 50, y: screenPx / zoom }) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
    expect(hit(5, 1)).toBe(true);
    expect(hit(7, 1)).toBe(false);
    expect(hit(5, 0.5)).toBe(true); // 50% zoom: 5 px screen = 10 world <= 12
    expect(hit(7, 0.5)).toBe(false); // 7 px screen = 14 world > 12
    expect(hit(11, 0.5)).toBe(false); // 11 px screen = 22 world > 12
  });

  it('the connector bounding box spans both endpoints (straight lines may be zero-area)', () => {
    expect(connectorBBox({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: 0, width: 100, height: 0 });
    expect(connectorBBox({ x: 50, y: 80 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 50, height: 80 });
  });

  it('objectRects excludes connectors and falls back to the sticky size', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 100, y: 100 });
    const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    const id = createConnector(
      doc,
      {
        from: { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
        to: { kind: 'free', x: 300, y: 50 },
      },
      CREATOR,
    )!;
    const rects = objectRects(doc);
    expect(rects.get(note)).toEqual({ x: 0, y: 0, width: 200, height: 200 }); // sticky default size
    expect(rects.get(a)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(rects.get(id)).toBeUndefined(); // connectors are not connection targets
  });

  it('detachConnectorsTo called inside a transaction detaches every affected end at once', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 200, y: 200 });
    const b = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, CREATOR)!;
    // A sticky centred at (200,200): rect (100,100,200,200); B at the left.
    const from: Endpoint = { kind: 'attached', objectId: b, fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: a, fallback: { x: 100, y: 200 } };
    const id1 = createConnector(doc, { from, to }, CREATOR)!;
    const id2 = createConnector(
      doc,
      {
        from: { kind: 'attached', objectId: a, fallback: { x: 300, y: 200 } },
        to: { kind: 'free', x: 500, y: 500 },
      },
      CREATOR,
    )!;
    const updates = countUpdates(doc);
    doc.transact(
      () => {
        detachConnectorsTo(doc, [a]);
      },
    );
    expect(updates.updates).toBe(1);
    const snap1 = snapshotAll(doc).find((o) => o.id === id1)!;
    // The A end of id1 becomes free at A's left-side anchor (facing B).
    expect(snap1.to).toEqual({ kind: 'free', x: 100, y: 200 });
    const snap2 = snapshotAll(doc).find((o) => o.id === id2)!;
    // The A end of id2 becomes free at A's right-side anchor (facing the free end).
    expect(snap2.from).toEqual({ kind: 'free', x: 300, y: 200 });
    // The free end of id2 is untouched.
    expect(snap2.to).toEqual({ kind: 'free', x: 500, y: 500 });
    updates.off();
  });
});
