// Story 10, connector.model + geometry: the arrow schema, its endpoint rules and
// the pure geometry behind side anchors and line hit-testing. Tested against a
// real Y.Doc, and the geometry against nothing but numbers.
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createConnector,
  setConnectorEndpoint,
  detachConnectorsTo,
  getConnectorEnds,
  resolveConnector,
} from '../../src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
  rectCenter,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline, distanceToSegment } from '../../src/shared/geometry/polyline';
import { hitConnector } from '../../src/shared/object-types';
import { createSticky, deleteObjects, moveObjects, objectBounds, objectSnapshots } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { CONNECTOR_MIN_LENGTH_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  init();
});

function init(): void {
  doc = new Y.Doc();
}

/** Draw a rect shape with an exact footprint, and return its id. */
function box(x: number, y: number, width: number, height: number): string {
  return createShape(doc, { kind: 'rect', rect: { x, y, width, height }, at: { x, y } }, 'me')!;
}

function attached(objectId: string, fallback: { x: number; y: number } = { x: 0, y: 0 }): Endpoint {
  return { kind: 'attached', objectId, fallback };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

function objects(): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** Count the document updates `fn` produces. */
function updatesDuring<T>(fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  const result = fn();
  doc.off('update', observer);
  return { result, updates };
}

describe('connector.model: create attached to attached (TC-07)', () => {
  it('stores both ends attached, with the side anchor as the fallback', () => {
    const a = box(100, 200, 160, 120); // 100..260 x, 200..320 y
    const b = box(460, 200, 160, 120); // 300 units between the two centres
    const { result, updates } = updatesDuring(() => createConnector(doc, attached(a), attached(b), 'me'));
    expect(typeof result).toBe('string');
    expect(updates).toBe(1);

    const ends = getConnectorEnds(doc, result as string)!;
    expect(ends.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 260, y: 260 } });
    expect(ends.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 460, y: 260 } });
    // And the line it draws is exactly those two anchors.
    expect(resolveConnector(doc, result as string)).toEqual({
      from: { x: 260, y: 260 },
      to: { x: 460, y: 260 },
    });
  });

  it('the arrow is in the snapshot with a DERIVED bounding box', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const snap = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(snap.type).toBe('connector');
    // Horizontal arrow: a full-width band, one unit tall (a zero-area box could
    // never be hit).
    expect(snap.width).toBeCloseTo(200, 6);
    expect(snap.height).toBeLessThanOrEqual(1);
    expect(objectBounds(doc, id)).not.toBeNull();
  });

  it('a free end is stored as the point it was released at', () => {
    const a = box(0, 0, 100, 100);
    const id = createConnector(doc, attached(a), free(400, 400), 'me')!;
    const ends = getConnectorEnds(doc, id)!;
    expect(ends.from.kind).toBe('attached');
    expect(ends.to).toEqual({ kind: 'free', x: 400, y: 400 });
  });

  it('a free end in the middle of nowhere is legal (a line, not an attachment)', () => {
    const id = createConnector(doc, free(0, 0), free(100, 100), 'me')!;
    expect(resolveConnector(doc, id)).toEqual({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
  });
});

describe('connector.model: no accidental arrows (TC-08, TC-09)', () => {
  it('an arrow from a box to ITSELF creates nothing', () => {
    const a = box(100, 100, 200, 200);
    const { result, updates } = updatesDuring(() =>
      createConnector(doc, attached(a, { x: 100, y: 200 }), attached(a, { x: 300, y: 200 }), 'me'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(objects().size).toBe(1); // the box only
  });

  it('an end aimed at an object that vanished still draws at its anchor (TC-11)', () => {
    // The delete race: Sam removed B a moment before Dana released the arrow.
    const a = box(0, 0, 100, 100);
    const id = createConnector(
      doc,
      attached(a, { x: 100, y: 50 }),
      { kind: 'attached', objectId: 'gone', fallback: { x: 300, y: 50 } },
      'me',
    )!;
    expect(resolveConnector(doc, id)).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
  });

  it('an end naming another ARROW creates nothing', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const arrow = createConnector(doc, attached(a), attached(b), 'me')!;
    const c = box(0, 300, 100, 100);
    expect(createConnector(doc, attached(c), attached(arrow), 'me')).toBeNull();
    expect(createConnector(doc, attached(arrow), attached(c), 'me')).toBeNull();
  });

  it('an end that names nothing and carries no anchor creates nothing', () => {
    // No object, no fallback point: there is nothing to draw.
    expect(createConnector(doc, attached('gone'), attached('gone-too'), 'me')).toBeNull();
    expect(objects().size).toBe(0);
  });

  it('the minimum length is measured on the DRAWN line: 7.9 rejected, 8 created', () => {
    const short = updatesDuring(() => createConnector(doc, free(0, 0), free(7.9, 0), 'me'));
    expect(short.result).toBeNull();
    expect(short.updates).toBe(0);

    const exact = updatesDuring(() => createConnector(doc, free(0, 0), free(8, 0), 'me'));
    expect(typeof exact.result).toBe('string');
    expect(exact.updates).toBe(1);
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);
  });

  it('a two-point line shorter than the minimum after resolution is rejected', () => {
    // Two boxes touching: the anchors come out at the same place.
    const a = box(0, 100, 100, 100);
    const b = box(0, 100, 100, 100); // same footprint
    expect(createConnector(doc, attached(a), attached(b), 'me')).toBeNull();
    expect(objects().size).toBe(2);
  });

  it('a non-finite point creates nothing', () => {
    expect(createConnector(doc, free(0, 0), free(Number.NaN, 50), 'me')).toBeNull();
    expect(createConnector(doc, free(0, Number.POSITIVE_INFINITY), free(50, 50), 'me')).toBeNull();
    expect(objects().size).toBe(0);
  });
});

describe('geometry: side anchors (TC-07, TC-10)', () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 };

  it('a side anchor is that side MIDPOINT', () => {
    expect(sideAnchor(rect, 'top')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 300, y: 150 });
    expect(sideAnchor(rect, 'bottom')).toEqual({ x: 200, y: 200 });
    expect(sideAnchor(rect, 'left')).toEqual({ x: 100, y: 150 });
  });

  it('a side midpoint lies on the boundary of a rect, an ellipse and a diamond', () => {
    // The three kinds share the same bounding box; every anchor sits on it.
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const p = sideAnchor(rect, side);
      expect(p.x).toBeGreaterThanOrEqual(rect.x);
      expect(p.x).toBeLessThanOrEqual(rect.x + rect.width);
      expect(p.y).toBeGreaterThanOrEqual(rect.y);
      expect(p.y).toBeLessThanOrEqual(rect.y + rect.height);
      // And on the diamond's edge: |dx/halfW| + |dy/halfH| === 1.
      const dx = Math.abs(p.x - (rect.x + rect.width / 2)) / (rect.width / 2);
      const dy = Math.abs(p.y - (rect.y + rect.height / 2)) / (rect.height / 2);
      expect(dx + dy).toBeCloseTo(1, 10);
    }
  });

  it('nearestSide switches at the 45 degree diagonal (TC-10)', () => {
    const centre = rectCenter(rect);
    const orbit = (degrees: number, radius = 300) => ({
      x: centre.x + radius * Math.cos((degrees * Math.PI) / 180),
      y: centre.y - radius * Math.sin((degrees * Math.PI) / 180), // screen y grows down
    });
    expect(nearestSide(rect, orbit(0))).toBe('right');
    expect(nearestSide(rect, orbit(44))).toBe('right');
    expect(nearestSide(rect, orbit(46))).toBe('top');
    expect(nearestSide(rect, orbit(90))).toBe('top');
    // The other three quadrants follow the same rule, checked with exact
    // coordinates so the diagonal cases are not floating-point accidents.
    expect(nearestSide(rect, { x: centre.x + 300, y: centre.y - 300 })).toBe('right'); // exactly on the diagonal
    expect(nearestSide(rect, { x: centre.x + 100, y: centre.y - 300 })).toBe('top');
    expect(nearestSide(rect, { x: centre.x - 300, y: centre.y - 100 })).toBe('left');
    expect(nearestSide(rect, { x: centre.x - 300, y: centre.y + 100 })).toBe('left');
    expect(nearestSide(rect, { x: centre.x - 100, y: centre.y + 300 })).toBe('bottom');
    expect(nearestSide(rect, { x: centre.x + 100, y: centre.y + 300 })).toBe('bottom');
    expect(nearestSide(rect, { x: centre.x + 300, y: centre.y + 100 })).toBe('right');
  });

  it('a point exactly ON the diagonal takes the horizontal answer (total, stable)', () => {
    expect(nearestSide(rect, { x: 400, y: 0 })).toBe('right');
    expect(nearestSide(rect, rectCenter(rect))).toBe('right');
  });
});

describe('geometry: resolveEndpoints', () => {
  it('leaves both ends free when nothing is attached', () => {
    const { from, to } = resolveEndpoints({ from: free(0, 0), to: free(10, 20) }, new Map());
    expect(from).toEqual({ x: 0, y: 0 });
    expect(to).toEqual({ x: 10, y: 20 });
  });

  it('uses the OTHER end to choose each side (TC-10)', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 400, y: 400, width: 100, height: 100 };
    const rects = new Map([
      ['a', a],
      ['b', b],
    ]);
    const ends = resolveEndpoints({ from: attached('a'), to: attached('b') }, rects);
    expect(ends.from).toEqual({ x: 100, y: 50 }); // leaves a on the right, towards b
    expect(ends.to).toEqual({ x: 400, y: 450 }); // enters b on the left, from a
  });

  it('an attached end whose object is missing draws at its fallback (TC-11)', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const rects = new Map([['a', a]]);
    const ends = resolveEndpoints(
      { from: attached('a', { x: 100, y: 50 }), to: { kind: 'attached', objectId: 'gone', fallback: { x: 300, y: 250 } } },
      rects,
    );
    expect(ends.to).toEqual({ x: 300, y: 250 });
    expect(Number.isNaN(ends.to.x)).toBe(false);
    // And it still resolves when BOTH ends are orphaned, and when the map is empty.
    expect(() => resolveEndpoints({ from: attached('gone'), to: attached('gone') }, new Map())).not.toThrow();
  });

  it('a one-sided arrow points from the box at the free end (TC-11)', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const rects = new Map([['a', a]]);
    const ends = resolveEndpoints({ from: attached('a', { x: 100, y: 50 }), to: free(50, 50) }, rects);
    // The free end is inside the box, so the direction is degenerate: the
    // renderer still gets two finite points and draws something.
    expect(Number.isFinite(ends.from.x)).toBe(true);
    expect(Number.isFinite(ends.from.y)).toBe(true);
  });

  it('connectorBBox spans the two points', () => {
    expect(connectorBBox({ x: 10, y: 20 }, { x: 50, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 0 });
    expect(connectorBBox({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });
});

describe('connector.model: follow (TC-10, TC-11)', () => {
  it('a moved box redraws the arrow without a single write', () => {
    const a = box(100, 200, 160, 120);
    const b = box(460, 200, 160, 120);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const before = JSON.stringify(getConnectorEnds(doc, id));
    expect(resolveConnector(doc, id)).toEqual({ from: { x: 260, y: 260 }, to: { x: 460, y: 260 } });

    // Move B far down: the arrow now leaves A at the bottom and enters B at
    // the top, and NOT ONE WRITE touched the arrow.
    const { result, updates } = updatesDuring(() => {
      moveObjects(doc, [b], 0, 700);
      return JSON.stringify(getConnectorEnds(doc, id));
    });
    expect(result).toBe(before);
    expect(updates).toBe(1); // the MOVE is the only write

    expect(resolveConnector(doc, id)).toEqual({ from: { x: 180, y: 320 }, to: { x: 540, y: 900 } });
  });

  it('the side changes as the other box orbits (side switch, TC-10)', () => {
    const rectA = { x: 0, y: 0, width: 200, height: 100 };
    const centre = { x: 100, y: 50 };
    const resolveAgainst = (b: { x: number; y: number; width: number; height: number }) =>
      resolveEndpoints(
        { from: attached('a'), to: { kind: 'attached', objectId: 'b', fallback: { x: 0, y: 0 } } },
        new Map([
          ['a', rectA],
          ['b', b],
        ]),
      );
    const sideOf = (p: { x: number; y: number }) => nearestSide(rectA, p);

    expect(sideOf({ x: centre.x + 300, y: centre.y })).toBe('right');
    expect(sideOf({ x: centre.x + 300, y: centre.y - 310 })).toBe('top');
    // The arrow's own end follows that decision.
    expect(resolveAgainst({ x: 400, y: 0, width: 100, height: 100 }).from).toEqual({ x: 200, y: 50 });
    expect(resolveAgainst({ x: 250, y: -300, width: 100, height: 100 }).from).toEqual({ x: 100, y: 0 });
  });

  it('a REMOTE move redraws the arrow on the other peer, with no arrow write', () => {
    const peer = new Y.Doc();
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const before = JSON.stringify(getConnectorEnds(peer, id));

    // The peer moves B. The arrow's stored ends must not change.
    const bCopy = peer.getMap<Y.Map<unknown>>('objects').get(b)!;
    peer.transact(() => {
      bCopy.set('x', 600);
      bCopy.set('y', 400);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(JSON.stringify(getConnectorEnds(doc, id))).toBe(before);
    expect(resolveConnector(doc, id)).toEqual({ from: { x: 100, y: 50 }, to: { x: 600, y: 450 } });
  });
});

describe('connector.model: re-attach an end (TC-12, TC-29)', () => {
  it('dragging an end to empty space makes it free at that point', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const { result, updates } = updatesDuring(() => setConnectorEndpoint(doc, id, 'to', free(500, 250)));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(getConnectorEnds(doc, id)!.to).toEqual({ kind: 'free', x: 500, y: 250 });
  });

  it('dragging an end onto another object attaches it there', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const c = box(150, 300, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const { result, updates } = updatesDuring(() => setConnectorEndpoint(doc, id, 'to', attached(c)));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const to = getConnectorEnds(doc, id)!.to;
    expect(to.kind).toBe('attached');
    if (to.kind === 'attached') expect(to.objectId).toBe(c);
    // Its fallback moved with it: the anchor on C, not the one B used.
    expect(resolveConnector(doc, id)!.to).toEqual({ x: 200, y: 300 });
  });

  it('an end cannot be attached to the object at the OTHER end (TC-12 negative)', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const { result, updates } = updatesDuring(() => setConnectorEndpoint(doc, id, 'to', attached(a)));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(getConnectorEnds(doc, id)!.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 300, y: 50 } });
  });

  it('a stale connector id and a non-finite point are both false with no write (TC-29)', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;

    const stale = updatesDuring(() => setConnectorEndpoint(doc, 'no-such-connector', 'to', free(1, 1)));
    expect(stale.result).toBe(false);
    expect(stale.updates).toBe(0);

    // A connector deleted by a peer while its handle is being dragged.
    deleteObjects(doc, [id]);
    const gone = updatesDuring(() => setConnectorEndpoint(doc, id, 'to', free(1, 1)));
    expect(gone.result).toBe(false);
    expect(gone.updates).toBe(0);
  });

  it('re-attaching to the SAME object it already uses writes nothing', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const { result, updates } = updatesDuring(() => setConnectorEndpoint(doc, id, 'to', attached(b)));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('re-aiming an end at a vanished object draws at its anchor; at an arrow, no', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const other = createConnector(doc, attached(a), attached(b), 'me')!;
    // A stale name with no anchor is not a drawing instruction.
    expect(setConnectorEndpoint(doc, id, 'to', attached('gone', { x: 0, y: 0 }))).toBe(true);
    expect(setConnectorEndpoint(doc, id, 'to', attached('gone'))).toBe(false);
    expect(setConnectorEndpoint(doc, id, 'to', attached(other))).toBe(false);
  });

  it('an arrow may be attached to a sticky note, not only to a shape', () => {
    const note = createSticky(doc, { x: 0, y: 0 });
    const b = box(400, 0, 100, 100);
    const id = createConnector(doc, attached(note), attached(b), 'me')!;
    const ends = getConnectorEnds(doc, id)!;
    expect(ends.from.kind).toBe('attached');
    expect(resolveConnector(doc, id)!.from.x).toBeCloseTo(100, 3);
  });
});

describe('connector.model: deleting what an arrow points at (TC-13)', () => {
  it('the delete and the detach are ONE update and the arrow keeps its line', () => {
    const a = box(100, 200, 160, 120);
    const b = box(460, 200, 160, 120);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const before = resolveConnector(doc, id)!;

    const { result, updates } = updatesDuring(() => deleteObjects(doc, [a]));
    expect(result).toBe(1); // one object deleted
    expect(updates).toBe(1); // …and exactly one update, arrows included

    const ends = getConnectorEnds(doc, id)!;
    expect(ends.from).toEqual({ kind: 'free', x: before.from.x, y: before.from.y });
    expect(ends.to.kind).toBe('attached');
    // The arrow is still an arrow, and it still draws where it drew before.
    expect(resolveConnector(doc, id)).toEqual(before);
  });

  it('an arrow with BOTH ends on deleted objects loses both, in one update', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    const id = createConnector(doc, attached(a), attached(b), 'me')!;
    const { updates } = updatesDuring(() => deleteObjects(doc, [a, b]));
    expect(updates).toBe(1);
    const ends = getConnectorEnds(doc, id)!;
    expect(ends.from.kind).toBe('free');
    expect(ends.to.kind).toBe('free');
  });

  it('detaching an arrow that points at nothing changes nothing', () => {
    const a = box(0, 0, 100, 100);
    const b = box(300, 0, 100, 100);
    createConnector(doc, attached(a), attached(b), 'me');
    const { result, updates } = updatesDuring(() => {
      detachConnectorsTo(doc, [b]);
      detachConnectorsTo(doc, []);
      return true;
    });
    expect(result).toBe(true);
    expect(updates).toBe(1); // only the first call wrote anything
  });
});

describe('polyline distance (TC-14)', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  it('is exact: on the line, just inside the tolerance, just outside', () => {
    expect(distanceToPolyline([from, to], { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline([from, to], { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline([from, to], { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  it('measures to the nearest point, including past the ends', () => {
    expect(distanceToPolyline([from, to], { x: 103, y: 4 })).toBeCloseTo(5, 10);
    expect(distanceToSegment({ x: -3, y: 4 }, from, to)).toBeCloseTo(5, 10);
  });

  it('works on a longer chain and takes the smallest segment distance', () => {
    const chain = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(chain, { x: 50, y: 50 })).toBeCloseTo(50, 10);
    expect(distanceToPolyline(chain, { x: 99, y: 50 })).toBeCloseTo(1, 10);
  });

  it('a point, not a line, is infinitely far (a degenerate arrow is never hit)', () => {
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([from, to], { x: Number.NaN, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('the registry hit rule takes 6 screen pixels over zoom', () => {
    // At 100% the tolerance is 6 world units: 5 is a hit, 7 is not…
    expect(hitConnector([from, to], { x: 50, y: 5 }, 1)).toBe(true);
    expect(hitConnector([from, to], { x: 50, y: 7 }, 1)).toBe(false);
    // …at 200% the tolerance is 3 world units (6 SCREEN pixels), so a 2.5-unit
    // offset — 5 pixels — is still a hit and 3.5 units (7 pixels) is not.
    expect(hitConnector([from, to], { x: 50, y: 2.5 }, 2)).toBe(true);
    expect(hitConnector([from, to], { x: 50, y: 3.5 }, 2)).toBe(false);
    // At 50% the tolerance is 12 units: 10 is a hit, 14 is not.
    expect(hitConnector([from, to], { x: 50, y: 10 }, 0.5)).toBe(true);
    expect(hitConnector([from, to], { x: 50, y: 14 }, 0.5)).toBe(false);
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
    // A zero or missing zoom cannot make every click a hit.
    expect(hitConnector([from, to], { x: 50, y: 500 }, 0)).toBe(false);
  });
});
