import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  resizeObjects,
} from '../../src/shared/board-model';
import {
  connectorRects,
  connectorSnapshots,
  createConnector,
  detachConnectorsTo,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  SIDES,
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { shapeSnapshots } from '../../src/shared/objects/shape';
import { buildCheckoutFlow } from '../fixtures/checkout-flow';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';

/**
 * Story 10 — connectors and their geometry (connector.model).
 *
 * Pure model and pure geometry on a real `Y.Doc`: an endpoint is stored as an
 * object id, so a moved object moves the arrow; an object that vanished leaves the
 * arrow at its stored fallback point. Every case that expects a refusal also counts
 * document updates, because a refused request must never reach the other tabs.
 */

function fixture(): {
  doc: Y.Doc;
  updates: (body: () => void) => number;
  stickies: (rects: Rect[]) => string[];
} {
  const doc = new Y.Doc();
  initDoc(doc);
  let seen = 0;
  doc.on('update', () => {
    seen += 1;
  });
  return {
    doc,
    updates(body: () => void): number {
      seen = 0;
      body();
      return seen;
    },
    stickies(rects: Rect[]): string[] {
      const ids: string[] = [];
      const toResize = new Map<string, Rect>();
      for (const r of rects) {
        // createSticky centres on a point, so place it by its centre and resize after.
        const id = createSticky(
          doc,
          { x: r.x + r.width / 2, y: r.y + r.height / 2 },
          'yellow',
        );
        ids.push(id);
        toResize.set(id, r);
      }
      resizeObjects(doc, toResize);
      return ids;
    },
  };
}

/** Two objects 300 board units apart horizontally, both 200x100. */
const A_RECT: Rect = { x: 0, y: 0, width: 200, height: 100 };
const B_RECT: Rect = { x: 500, y: 0, width: 200, height: 100 };

describe('connector model and geometry (connector.model)', () => {
  // TC-07: connecting two objects stores both ends as attached, each with its anchor as fallback.
  it('TC-07 createConnector between A and B stores two attached ends and their fallbacks in one update', () => {
    const { doc, updates, stickies } = fixture();
    const [a, b] = stickies([A_RECT, B_RECT]);

    let id: string | null = 'x';
    const count = updates(() => {
      id = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
        'dana',
      );
    });
    expect(count).toBe(1);

    const connectors = connectorSnapshots(doc);
    expect(connectors).toHaveLength(1);
    const c = connectors[0]!;
    expect(c.id).toBe(id);
    expect(c.type).toBe('connector');
    expect(c.createdBy).toBe('dana');
    // Each end: the object, plus the midpoint of the side that faces the other object.
    expect(c.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } });
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } });
    // The box is derived from the resolved endpoints, so selection and the SVG agree.
    expect(c.x).toBe(200);
    expect(c.y).toBe(50);
    expect(c.width).toBe(300);
    expect(c.height).toBe(0);
  });

  // TC-08: an arrow from an object to itself is refused without writing.
  it('TC-08 createConnector A to A returns null with zero updates', () => {
    const { doc, updates, stickies } = fixture();
    const [a] = stickies([A_RECT]);
    let created: string | null = 'x';
    const count = updates(() => {
      created = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: a, fallback: { x: 10, y: 10 } },
        'dana',
      );
    });
    expect(created).toBeNull();
    expect(count).toBe(0);
    expect(connectorSnapshots(doc)).toHaveLength(0);
  });

  // TC-09: a drag that barely moved creates nothing; exactly the minimum does.
  it('TC-09 free-to-free length 7.9 creates nothing, length 8 creates an arrow', () => {
    const { doc, updates } = fixture();
    let tooShort: string | null = 'x';
    let justRight: string | null = 'x';
    const count = updates(() => {
      tooShort = createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD - 0.1, y: 0 },
        'dana',
      );
      justRight = createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 },
        'dana',
      );
    });
    expect(tooShort).toBeNull();
    expect(justRight).not.toBeNull();
    expect(count).toBe(1); // the rejected drag wrote nothing of its own
    const c = connectorSnapshots(doc)[0]!;
    expect(c.from).toEqual({ kind: 'free', x: 0, y: 0 });
    expect(c.to).toEqual({ kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 });
  });

  // TC-10: the side an arrow leaves from switches where the object's diagonal does.
  it('TC-10 nearestSide as an object orbits at 0, 44, 46 and 90 degrees is right, right, top, top', () => {
    // A square object: its diagonal is the 45 degree line, which is where the side changes.
    const square: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const centre: Point = { x: 100, y: 100 };
    const radius = 300;
    const orbit = (deg: number): Point => {
      const rad = (deg * Math.PI) / 180;
      // Angles are the usual mathematical ones (0° right, 90° up), so y, which grows
      // downwards on screen, is subtracted.
      return { x: centre.x + radius * Math.cos(rad), y: centre.y - radius * Math.sin(rad) };
    };
    expect(nearestSide(square, orbit(0))).toBe('right');
    expect(nearestSide(square, orbit(44))).toBe('right');
    expect(nearestSide(square, orbit(46))).toBe('top');
    expect(nearestSide(square, orbit(90))).toBe('top');
    // The other quadrants follow the same rule, and every side has an anchor.
    expect(nearestSide(square, orbit(180))).toBe('left');
    expect(nearestSide(square, orbit(270))).toBe('bottom');

    expect(sideAnchor(square, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(square, 'right')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(square, 'bottom')).toEqual({ x: 100, y: 200 });
    expect(sideAnchor(square, 'left')).toEqual({ x: 0, y: 100 });
    // The four sides are exactly the four a hover shows (PRD connector.hover_points).
    expect([...SIDES].sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  // TC-11: an object that vanished mid-drag still gets an arrow, at its fallback point.
  it('TC-11 resolveEndpoints with the attached object missing draws that end at its fallback', () => {
    const { doc, updates, stickies } = fixture();
    const [a] = stickies([A_RECT]);
    let id = '';
    updates(() => {
      id = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        // B was deleted by somebody else before this create arrived.
        { kind: 'attached', objectId: 'gone', fallback: { x: 600, y: 50 } },
        'dana',
      )!;
    });
    expect(id).not.toBe('');

    const c = connectorSnapshots(doc).find((s) => s.id === id)!;
    const rects = connectorRects(doc);
    expect(rects.has('gone')).toBe(false);
    let ends: { from: Point; to: Point } = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
    expect(() => {
      ends = resolveEndpoints(c, rects);
    }).not.toThrow();
    // The live end follows A; the orphaned end sits where it was attached.
    expect(ends.from).toEqual({ x: 200, y: 50 });
    expect(ends.to).toEqual({ x: 600, y: 50 });

    // A free end is used verbatim, and the box covers both resolved points.
    const free: ConnectorSnap = {
      ...c,
      from: { kind: 'free', x: 0, y: 0 },
      to: { kind: 'free', x: 10, y: -5 },
    };
    expect(resolveEndpoints(free, rects)).toEqual({
      from: { x: 0, y: 0 },
      to: { x: 10, y: -5 },
    });
    expect(connectorBBox({ x: 0, y: 0 }, { x: 10, y: -5 })).toEqual({
      x: 0,
      y: -5,
      width: 10,
      height: 5,
    });
  });

  // TC-12: re-attaching one end of an arrow, to free space, to an object, and the refused case.
  it('TC-12 setConnectorEndpoint moves one end and refuses the object at the other end', () => {
    const { doc, updates, stickies } = fixture();
    const [a, b, c] = stickies([A_RECT, B_RECT, { x: 200, y: 400, width: 200, height: 100 }]);
    let id = '';
    updates(() => {
      id = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } },
        'dana',
      )!;
    });

    let detached = false;
    const detachUpdates = updates(() => {
      detached = setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 700, y: 300 });
    });
    expect(detached).toBe(true);
    expect(detachUpdates).toBe(1);
    let snap = connectorSnapshots(doc).find((s) => s.id === id)!;
    expect(snap.to).toEqual({ kind: 'free', x: 700, y: 300 });
    expect(snap.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } });

    let attached = false;
    const attachUpdates = updates(() => {
      attached = setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: c,
        fallback: { x: 400, y: 450 },
      });
    });
    expect(attached).toBe(true);
    expect(attachUpdates).toBe(1);
    snap = connectorSnapshots(doc).find((s) => s.id === id)!;
    expect(snap.to).toMatchObject({ kind: 'attached', objectId: c });
    // Only this end moved: the other end is untouched (PRD connector.reattach).
    expect(snap.from).toMatchObject({ kind: 'attached', objectId: a });

    // Releasing onto the object the *other* end is attached to is refused, unwritten.
    let rejected = true;
    const rejectedUpdates = updates(() => {
      rejected = setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: a,
        fallback: { x: 200, y: 50 },
      });
    });
    expect(rejected).toBe(false);
    expect(rejectedUpdates).toBe(0);
    expect(connectorSnapshots(doc).find((s) => s.id === id)!.to).toMatchObject({
      kind: 'attached',
      objectId: c,
    });

    // A non-finite point is refused too, so nothing on the board can end up at NaN.
    let NaNEnd = true;
    const NaNUpdates = updates(() => {
      NaNEnd = setConnectorEndpoint(doc, id, 'from', {
        kind: 'free',
        x: Number.NaN,
        y: 3,
      });
    });
    expect(NaNEnd).toBe(false);
    expect(NaNUpdates).toBe(0);

    // Attaching both ends to the same object through the *other* end is refused as well.
    let sameObject = true;
    const sameUpdates = updates(() => {
      sameObject = setConnectorEndpoint(doc, id, 'from', {
        kind: 'attached',
        objectId: c,
        fallback: { x: 300, y: 450 },
      });
    });
    expect(sameObject).toBe(false);
    expect(sameUpdates).toBe(0);
  });

  // TC-13: deleting an object keeps the arrow and fixes its end where it was attached.
  it('TC-13 deleteObjects detaches the arrow end at the anchor and removes the object in one update', () => {
    const { doc, updates, stickies } = fixture();
    const [a, b] = stickies([A_RECT, B_RECT]);
    let id = '';
    updates(() => {
      id = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } },
        'dana',
      )!;
    });

    let deleted = 0;
    const count = updates(() => {
      deleted = deleteObjects(doc, [a]);
    });
    expect(deleted).toBe(1);
    // One update, so undoing the delete puts the arrow back exactly as it was (story 8).
    expect(count).toBe(1);

    const connectors = connectorSnapshots(doc);
    expect(connectors).toHaveLength(1);
    const c = connectors.find((s) => s.id === id)!;
    expect(c.from).toEqual({ kind: 'free', x: 200, y: 50 }); // A's right-hand anchor
    expect(c.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } });
    expect(connectorRects(doc).has(a)).toBe(false);
  });

  // TC-14: clicking an arrow is measured from the line, in board units.
  it('TC-14 distanceToPolyline reports 0, 5.99 and 6.01 units from a straight line', () => {
    const line: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: -6.01 })).toBeCloseTo(6.01, 10);
    // Past the end of the line the distance is to the endpoint, not to the infinite line.
    expect(distanceToPolyline(line, { x: 110, y: 0 })).toBeCloseTo(10, 10);
    // A polyline of more than one segment measures the nearest one.
    const elbow: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline(elbow, { x: 100, y: 50 })).toBe(0);
    expect(distanceToPolyline(elbow, { x: 106, y: 50 })).toBeCloseTo(6, 10);
    // A single point degenerates to the distance to that point.
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 3, y: 0 })).toBeCloseTo(4, 10);
    // The tolerance in the config is a screen-space radius; board units come from zoom.
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
  });

  // TC-29: a connector deleted in the meantime is a stale id, not a crash.
  it('TC-29 setConnectorEndpoint on a deleted connector returns false with zero updates', () => {
    const { doc, updates, stickies } = fixture();
    const [a, b] = stickies([A_RECT, B_RECT]);
    let id = '';
    updates(() => {
      id = createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } },
        'dana',
      )!;
    });
    updates(() => {
      deleteObjects(doc, [id]);
    });

    let applied = true;
    const count = updates(() => {
      applied = setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 10, y: 10 });
    });
    expect(applied).toBe(false);
    expect(count).toBe(0);
    expect(connectorSnapshots(doc)).toHaveLength(0);
  });

  // The story's promise: anybody's move redraws the arrow, because ends resolve per read.
  it('arrows follow a moved object, switching to the side that now faces the other end', () => {
    const { doc, updates, stickies } = fixture();
    const [a, b] = stickies([A_RECT, B_RECT]);
    updates(() => {
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } },
        'dana',
      );
    });
    const before = resolveEndpoints(connectorSnapshots(doc)[0]!, connectorRects(doc));
    expect(before.from).toEqual({ x: 200, y: 50 });
    expect(before.to).toEqual({ x: 500, y: 50 });

    // Drag B to the left of A: the arrow now leaves A on its left and enters B on its right.
    updates(() => {
      moveObjects(doc, new Map([[b, { x: -400, y: 0 }]]));
    });
    const after = resolveEndpoints(connectorSnapshots(doc)[0]!, connectorRects(doc));
    expect(after.from).toEqual({ x: 0, y: 50 }); // A's left anchor
    expect(after.to).toEqual({ x: -200, y: 50 }); // B's right anchor, at its new place
    // The stored fallback is unchanged: only the resolved geometry moved.
    expect(connectorSnapshots(doc)[0]!.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  // detachConnectorsTo is also callable on its own, inside an already open transaction.
  it('detachConnectorsTo leaves an end attached to a surviving object alone', () => {
    const { doc, updates, stickies } = fixture();
    const [a, b] = stickies([A_RECT, B_RECT]);
    updates(() => {
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 50 } },
        'dana',
      );
    });
    const idleUpdates = updates(() => {
      doc.transact(() => detachConnectorsTo(doc, ['whoever-is-not-here']), LOCAL_ORIGIN);
    });
    const c = connectorSnapshots(doc)[0]!;
    expect(c.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    // Nothing to detach wrote nothing at all, so no traffic went out either.
    expect(idleUpdates).toBe(0);

    const detachedUpdates = updates(() => {
      doc.transact(() => detachConnectorsTo(doc, [a]), LOCAL_ORIGIN);
    });
    expect(detachedUpdates).toBe(1);
    expect(connectorSnapshots(doc)[0]!.from).toEqual({ kind: 'free', x: 200, y: 50 });
  });

  // Requests that cannot mean anything are refused without writing.
  it('createConnector refuses malformed endpoints', () => {
    const { doc, updates } = fixture();
    const bad: Endpoint[] = [
      { kind: 'free', x: Number.NaN, y: 0 },
      { kind: 'free', x: 0, y: Number.POSITIVE_INFINITY },
      { kind: 'attached', objectId: '', fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: 'x', fallback: { x: 0, y: Number.NaN } },
    ];
    let count = 0;
    updates(() => {
      for (const end of bad) {
        for (const other of [
          { kind: 'free', x: 100, y: 0 } as Endpoint,
          { kind: 'attached', objectId: 'x', fallback: { x: 1, y: 1 } } as Endpoint,
        ]) {
          for (const pair of [
            [end, other] as const,
            [other, end] as const,
          ]) {
            expect(createConnector(doc, pair[0], pair[1], 'dana')).toBeNull();
            count += 1;
          }
        }
      }
    });
    expect(count).toBe(bad.length * 2 * 2);
    expect(connectorSnapshots(doc)).toHaveLength(0);
  });

  // The story's own diagram, built the way the app builds one, so the browser tests
  // start from a flow whose numbers are already known to be right.
  it('builds the checkout flow: four shapes, three attached arrows and one free end', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { shapes, connectors } = buildCheckoutFlow(doc);

    expect(shapes).toHaveLength(4);
    expect(connectors).toHaveLength(4);
    expect(shapeSnapshots(doc).map((s) => s.kind)).toEqual(['rect', 'diamond', 'ellipse', 'rect']);
    expect(shapeSnapshots(doc).map((s) => s.label)).toEqual([
      'Browse items',
      'Signed in?',
      'Payment taken',
      'Receipt sent',
    ]);

    const arrows = connectorSnapshots(doc);
    // The three arrows in the line are attached at both ends and stand on the sides
    // the shapes present to each other.
    for (const link of arrows.slice(0, 3)) {
      expect(link.from.kind).toBe('attached');
      expect(link.to.kind).toBe('attached');
    }
    expect(arrows[0]!.ends).toEqual({ from: { x: -340, y: -65 }, to: { x: -240, y: -65 } });
    expect(arrows[1]!.ends).toEqual({ from: { x: -20, y: -65 }, to: { x: 80, y: -65 } });
    // The third arrow goes down the page, so it leaves through the bottom edge and
    // enters through the top one.
    expect(arrows[2]!.ends).toEqual({ from: { x: 190, y: -10 }, to: { x: 430, y: 120 } });
    // The fourth arrow leaves the last shape and stops at a point of the board.
    const loose = arrows[3]!;
    expect(loose.from.kind).toBe('attached');
    expect(loose.ends.from).toEqual({ x: 430, y: 230 });
    expect(loose.to).toEqual({ kind: 'free', x: 520, y: 300 });
    // Its box is derived from the two ends, so a selection round it has a size.
    expect(loose.width).toBeGreaterThan(0);
    expect(loose.height).toBeGreaterThan(0);
  });
});
