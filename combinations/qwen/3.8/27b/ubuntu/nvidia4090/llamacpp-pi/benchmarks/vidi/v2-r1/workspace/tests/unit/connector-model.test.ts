// TC-07..TC-14: connector model + connector-geometry + polyline distance.

import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObject,
  moveObjects,
  objectsSnapshot,
  registerKnownObjectType,
} from '../../src/shared/board-model';
import {
  createConnector,
  parseEndpoint,
  setConnectorEndpoint,
  type Endpoint,
} from '../../src/shared/objects/connector';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

registerKnownObjectType('connector');

const BY = 'tester';

function countingDoc(): { doc: Y.Doc; counter: { n: number } } {
  const doc = new Y.Doc();
  const counter = { n: 0 };
  doc.on('update', () => {
    counter.n += 1;
  });
  return { doc, counter };
}

let doc: Y.Doc;
let counter: { n: number };

beforeEach(() => {
  ({ doc, counter } = countingDoc());
});

function snapById(id: string) {
  return objectsSnapshot(doc).find((s) => s.id === id);
}

describe('connector.model', () => {
  it('TC-07: A to B saves both endpoints with the current fallback in one update', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 500, y: 0 })!;
    expect(counter.n).toBe(2);

    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      BY,
    );
    expect(id).not.toBeNull();
    expect(counter.n).toBe(3); // exactly one update

    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(obj.get('type')).toBe('connector');
    expect(obj.get('x')).toBe(0);
    expect(obj.get('y')).toBe(0);
    const from = parseEndpoint(obj.get('from'));
    const to = parseEndpoint(obj.get('to'));
    expect(from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } });
    expect(to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } });
  });

  it('TC-08: an arrow from an object to itself is never created', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const same = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 0 } },
      BY,
    );
    expect(same).toBeNull();
    expect(counter.n).toBe(1); // only the sticky; zero updates for the arrow
  });

  it('connector.follow: the arrow follows its target: the snapshot bbox re-derives after the target moves', () => {
    // Stickies are centred on their creation point: A's box is
    // (-100,-100,200,200) centred on (0,0); B's box is (400,-100,200,200)
    // centred on (500,0).
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 500, y: 0 })!;
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      BY,
    )!;

    // A -> B: A's right side midpoint (100,0) to B's left side midpoint
    // (400,0). The stored fallbacks are kept verbatim.
    let snap = snapById(id)!;
    expect(snap.from).toEqual({ kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } });
    expect(snap.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } });
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(0);
    expect(snap.width).toBe(300);
    expect(snap.height).toBe(0);

    // Move B so its top-left sits at (800,100): the arrow stretches and
    // tilts, and the endpoint fallbacks in the document are untouched.
    moveObjects(doc, new Map([[b, { x: 800, y: 100 }]]));
    snap = snapById(id)!;
    // from: A's right side facing B's new centre (900,200) → (100,0);
    // to:   B's left side facing A's centre (0,0) → (800,200).
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(0);
    expect(snap.width).toBe(700);
    expect(snap.height).toBe(200);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(parseEndpoint(obj.get('to'))).toEqual({
      kind: 'attached',
      objectId: b,
      fallback: { x: 500, y: 100 },
    });
  });

  it('TC-09: a drag under 8 world units creates nothing; 8 creates the arrow', () => {
    const short = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 7.9, y: 0 }, BY);
    expect(short).toBeNull();
    expect(counter.n).toBe(0);
    const exact = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 8, y: 0 }, BY);
    expect(exact).not.toBeNull();
    expect(counter.n).toBe(1);

  });

  it('TC-12: setConnectorEndpoint re-attaches, frees, and refuses self-attachment', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 500, y: 0 })!;
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'free', x: 400, y: 300 },
      BY,
    )!;
    expect(counter.n).toBe(3);

    // Free move: changed, one update.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 400, y: 301 })).toBe(true);
    expect(counter.n).toBe(4);

    // Re-attach to B: changed, one update.
    expect(
      setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: b,
        fallback: { x: 500, y: 100 },
      }),
    ).toBe(true);
    expect(counter.n).toBe(5);

    // Attach the "to" end to the object the "from" end already sits on:
    // refused, no update.
    expect(
      setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: a,
        fallback: { x: 0, y: 100 },
      }),
    ).toBe(false);
    expect(counter.n).toBe(5);

    // No-op (equal endpoint): false, no update.
    expect(
      setConnectorEndpoint(doc, id, 'to', {
        kind: 'attached',
        objectId: b,
        fallback: { x: 500, y: 100 },
      }),
    ).toBe(false);
    expect(counter.n).toBe(5);

    // Malformed / missing: false, no update.
    expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: NaN, y: 0 })).toBe(false);
    expect(setConnectorEndpoint(doc, 'missing', 'from', { kind: 'free', x: 1, y: 1 })).toBe(false);
    expect(counter.n).toBe(5);
  });

  it('TC-13: deleting a target re-homes its connectors to the current anchor in the same update', () => {
    const a = createSticky(doc, { x: 0, y: 0 })!;
    const b = createSticky(doc, { x: 500, y: 0 })!;
    const c = createSticky(doc, { x: 0, y: 500 })!;
    const ab = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } },
      BY,
    )!;
    const ca = createConnector(
      doc,
      { kind: 'attached', objectId: c, fallback: { x: 100, y: 500 } },
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 200 } },
      BY,
    )!;
    expect(counter.n).toBe(5);

    // Stickies are centred on their creation point: A's box is
    // (-100,-100,200,200) centred on (0,0); B's centre is (500,0); C's
    // centre is (0,500). A's right side faces B, its bottom side faces C.
    expect(deleteObject(doc, a)).toBe(true);
    expect(counter.n).toBe(6); // the detach is part of the ONE delete update

    const abSnap = snapById(ab)!;
    expect(abSnap.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 500, y: 100 } });
    expect(abSnap.from).toEqual({ kind: 'free', x: 100, y: 0 }); // A's right side

    const caSnap = snapById(ca)!;
    expect(caSnap.from).toEqual({ kind: 'attached', objectId: c, fallback: { x: 100, y: 500 } });
    expect(caSnap.to).toEqual({ kind: 'free', x: 0, y: 100 }); // A's bottom side

    // Both arrows still exist and still resolve (no dangling references).
    expect(objectsSnapshot(doc)).toHaveLength(4); // b, c, ab, ca
  });
});

describe('connector-geometry', () => {
  const A = { x: 0, y: 0, width: 100, height: 100 };
  const center = { x: 50, y: 50 };

  it('sideAnchor returns the midpoint of the named side', () => {
    expect(sideAnchor(A, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(A, 'right')).toEqual({ x: 100, y: 50 });
    expect(sideAnchor(A, 'bottom')).toEqual({ x: 50, y: 100 });
    expect(sideAnchor(A, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('TC-10: nearestSide switches between left/right and top at the 45-degree diagonal', () => {
    const orbit = (deg: number): { x: number; y: number } => {
      const rad = (deg * Math.PI) / 180;
      return { x: center.x + 300 * Math.cos(rad), y: center.y - 300 * Math.sin(rad) };
    };
    expect(nearestSide(A, orbit(0))).toBe('right');
    expect(nearestSide(A, orbit(44))).toBe('right'); // just before the diagonal
    expect(nearestSide(A, orbit(46))).toBe('top'); // just after the diagonal
    expect(nearestSide(A, orbit(90))).toBe('top');
    expect(nearestSide(A, orbit(136))).toBe('left'); // just before the diagonal
    expect(nearestSide(A, orbit(180))).toBe('left');
    expect(nearestSide(A, orbit(226))).toBe('bottom'); // just after the diagonal
    expect(nearestSide(A, orbit(270))).toBe('bottom');
    expect(nearestSide(A, orbit(316))).toBe('right');
  });

  it('TC-11: an attached endpoint resolves to the side nearest the OTHER endpoint; a stale target uses the fallback', () => {
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
      ['a', A],
    ]);
    const from = { kind: 'attached' as const, objectId: 'a', fallback: { x: 999, y: 999 } };

    // The other endpoint is above and only slightly off-centre: top side.
    expect(
      resolveEndpoints({ from, to: { kind: 'free', x: 60, y: -50 } }, rects).from,
    ).toEqual({ x: 50, y: 0 });

    // The other endpoint is far off-centre but close to the height middle:
    // right side.
    expect(
      resolveEndpoints({ from, to: { kind: 'free', x: 300, y: 45 } }, rects).from,
    ).toEqual({ x: 100, y: 50 });

    // Stale target (no rect): the stored fallback, no crash.
    expect(
      resolveEndpoints({ from, to: { kind: 'free', x: 10, y: 10 } }, new Map()).from,
    ).toEqual({ x: 999, y: 999 });
  });
});

describe('polyline', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it('TC-14: distanceToPolyline is 0 on the line and exact off it (the 6px boundary)', () => {
    expect(distanceToPolyline(line, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(line, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(line, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
    // Beyond the endpoints: the distance to the nearer endpoint.
    expect(distanceToPolyline(line, { x: 150, y: 0 })).toBe(50);
    expect(distanceToPolyline(line, { x: -10, y: 0 })).toBe(10);
    expect(distanceToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBe(5);
  });
});
