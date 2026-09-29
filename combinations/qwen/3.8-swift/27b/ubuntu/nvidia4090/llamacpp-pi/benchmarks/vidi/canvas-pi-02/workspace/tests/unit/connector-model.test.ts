// Unit tests for the connector object model (story 10, connector.model,
// TC-07 to TC-14) and the shared board-model detach hook (TC-29). Uses a
// real Y.Doc (no mocks); each mutation also counts `update` events:
// exactly 1 for a successful mutation, 0 for a rejection.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  objectBounds,
  objectsSnapshot,
} from '../../src/shared/board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';

interface UpdateSpy {
  count: number;
  off: () => void;
}

/** Counts Yjs update events on the doc (one per transaction). */
function spyUpdates(doc: Y.Doc): UpdateSpy {
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Two stickies 120 world units apart, left to right, centred on y = 0. */
function pair(doc: Y.Doc): { a: string; b: string } {
  const gap = 120;
  const a = createSticky(doc, { x: -STICKY_SIZE_WORLD / 2 - gap / 2, y: 0 });
  const b = createSticky(doc, { x: STICKY_SIZE_WORLD / 2 + gap / 2, y: 0 });
  return { a, b };
}

const att = (objectId: string, fallback: { x: number; y: number }): Endpoint => ({
  kind: 'attached',
  objectId,
  fallback,
});
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

describe('connector.model (real Y.Doc)', () => {
  // pair() layout: A = (-260..-60)×(-100..100), B = (60..260)×(-100..100).
  // A's right anchor (-60, 0), B's left anchor (60, 0).
  it('TC-07: createConnector attached A→B → 1 update, endpoints stored, resolvable bbox', () => {
    const doc = newDoc();
    const { a, b } = pair(doc);
    const updates = spyUpdates(doc);

    const id = createConnector(doc, att(a, { x: 0, y: 0 }), att(b, { x: 0, y: 0 }), 'me');

    expect(updates.count).toBe(1);
    expect(id).not.toBeNull();

    const snap = objectsSnapshot(doc).find((o) => o.id === id)!;
    expect(snap.type).toBe('connector');
    // Derived bbox of the resolved anchors: (-60, 0) → (60, 0).
    expect(snap.x).toBe(-60);
    expect(snap.y).toBe(0);
    expect(snap.width).toBe(120);
    expect(snap.height).toBe(0);
    updates.off();
  });

  it('TC-08: free ends stored as given; bbox = endpoints', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);
    const id = createConnector(doc, free(0, 0), free(100, 50), 'me');
    expect(updates.count).toBe(1);
    const snap = objectsSnapshot(doc).find((o) => o.id === id!);
    expect(snap!.x).toBe(0);
    expect(snap!.y).toBe(0);
    expect(snap!.width).toBe(100);
    expect(snap!.height).toBe(50);
    updates.off();
  });

  it('TC-09: both ends attached to the same object → null, 0 updates', () => {
    const doc = newDoc();
    const { a } = pair(doc);
    const updates = spyUpdates(doc);
    expect(createConnector(doc, att(a, { x: 0, y: 0 }), att(a, { x: 1, y: 1 }), 'me')).toBeNull();
    expect(updates.count).toBe(0);
    expect(objectsSnapshot(doc).filter((o) => o.type === 'connector')).toHaveLength(0);
    updates.off();
  });

  it('TC-10: nearestSide matches the side a human sees (B orbits A through 360°)', () => {
    const a = { x: -50, y: -50, width: 100, height: 100 }; // centre at origin
    const expected: { deg: number; side: 'top' | 'right' | 'bottom' | 'left' }[] = [];
    for (let deg = 0; deg < 360; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      const b = { x: 300 * Math.cos(rad) - 50, y: -300 * Math.sin(rad) - 50 };
      expected.push({ deg, side: nearestSide(a, { x: b.x + 50, y: b.y + 50 }) });
    }
    // Cardinal directions are unambiguous.
    expect(expected.find((e) => e.deg === 0)!.side).toBe('right');
    expect(expected.find((e) => e.deg === 90)!.side).toBe('top');
    expect(expected.find((e) => e.deg === 180)!.side).toBe('left');
    expect(expected.find((e) => e.deg === 270)!.side).toBe('bottom');
    // No flips (hysteresis) inside ±3° of a cardinal direction: the side
    // 3° away from a cardinal must still be that cardinal's side.
    expect(expected.find((e) => e.deg === 3)!.side).toBe('right');
    expect(expected.find((e) => e.deg === 87)!.side).toBe('top');
    expect(expected.find((e) => e.deg === 177)!.side).toBe('left');
    expect(expected.find((e) => e.deg === 267)!.side).toBe('bottom');
    // The full orbit contains all four sides.
    const sides = new Set(expected.map((e) => e.side));
    expect(sides.size).toBe(4);
  });

  it('TC-11: target missing from rects → fallback anchor, no throw', () => {
    const a = { x: -50, y: -50, width: 100, height: 100 };
    const from: Endpoint = { kind: 'attached', objectId: 'missing', fallback: { x: 0, y: 0 } };
    const to: Endpoint = free(40, 40);
    const resolved = resolveEndpoints({ from, to }, new Map([[ 'a', a ]]));
    expect(resolved.from).toEqual({ x: 0, y: 0 });
    expect(resolved.to).toEqual({ x: 40, y: 40 });
  });

  it('TC-12: setConnectorEndpoint to free → 1 update; to the attached object at the opposite end → false, 0 updates', () => {
    const doc = newDoc();
    const { a, b } = pair(doc);
    const id = createConnector(doc, att(a, { x: -20, y: 0 }), att(b, { x: 20, y: 0 }), 'me');
    expect(id).not.toBeNull();

    // Detach the 'from' end to a free point.
    const updates = spyUpdates(doc);
    expect(setConnectorEndpoint(doc, id!, 'from', free(-60, -10))).toBe(true);
    expect(updates.count).toBe(1);
    updates.off();

    // Re-attach the 'from' end to B — the object at the OPPOSITE end.
    const updates2 = spyUpdates(doc);
    expect(setConnectorEndpoint(doc, id!, 'from', att(b, { x: 20, y: 0 }))).toBe(false);
    expect(updates2.count).toBe(0);
    updates2.off();
  });

  it('TC-13: resolveEndpoints on the current rectangles after a move (no writes)', () => {
    const doc = newDoc();
    const { a, b } = pair(doc);
    const id = createConnector(doc, att(a, { x: -60, y: 0 }), att(b, { x: 60, y: 0 }), 'me');

    // Initial anchors: A right (-60, 0) → B left (60, 0).
    expect(bboxOf(doc, id!)).toEqual({ x: -60, y: 0, width: 120, height: 0 });

    // Move B far BELOW A (no doc writes about the connector): the arrow
    // must now run A-bottom → B-top.
    const snapB = objectsSnapshot(doc).find((o) => o.id === b)!;
    moveInDoc(doc, b, { x: snapB.x, y: snapB.y + 400 });

    const rects = new Map(
      objectsSnapshot(doc).map((o) => [o.id, objectBounds(o)] as const),
    );
    const { from, to } = resolveEndpoints(
      { from: att(a, { x: -60, y: 0 }), to: att(b, { x: 60, y: 0 }) },
      rects,
    );
    // A = (-260..-60)×(-100..100): bottom anchor (-160, 100).
    // B = (60..260)×(300..500): top anchor (160, 300).
    expect(from).toEqual({ x: -160, y: 100 });
    expect(to).toEqual({ x: 160, y: 300 });
    // And the doc was NOT written for the follow: the connector entry's
    // x/y/width/height are untouched (stored 0).
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(entry.get('x')).toBe(0);
  });

  it('TC-14: distanceToPolyline at 0, 5.99 and 6.01 units from a segment → exact distance', () => {
    const seg = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 10);
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 10);
  });

  it('sideAnchor: the four side midpoints', () => {
    const r = { x: 10, y: 20, width: 100, height: 40 };
    expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 40 });
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 60 });
    expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 40 });
  });

  it('connectorBBox: degenerate line → zero-area box', () => {
    expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
    expect(connectorBBox({ x: 10, y: 5 }, { x: 5, y: 8 })).toEqual({ x: 5, y: 5, width: 5, height: 3 });
  });
});

describe('connector.model + board.model integration (TC-29)', () => {
  it('TC-29: deleting a connected object detaches its connectors to the current anchor', () => {
    const doc = newDoc();
    const { a, b } = pair(doc);
    const id = createConnector(doc, att(a, { x: -20, y: 0 }), att(b, { x: 20, y: 0 }), 'me');
    expect(id).not.toBeNull();

    const updates = spyUpdates(doc);
    expect(deleteObject(doc, b)).toBe(true);
    expect(updates.count).toBe(1); // one transaction: delete + detach
    updates.off();

    const snap = objectsSnapshot(doc).find((o) => o.id === id)!;
    expect(snap.type).toBe('connector');
    // The 'to' end is now free, at B's current anchor (left-mid (60, 0)).
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    const to = entry.get('to') as Y.Map<unknown>;
    expect(to.get('kind')).toBe('free');
    expect(to.get('x')).toBe(60);
    expect(to.get('y')).toBe(0);
    // The 'from' end is untouched.
    const from = entry.get('from') as Y.Map<unknown>;
    expect(from.get('kind')).toBe('attached');
    expect(from.get('objectId')).toBe(a);
  });

  it('TC-29: detachConnectorsTo runs inside the caller transaction (batched delete)', () => {
    const doc = newDoc();
    const { a, b } = pair(doc);
    const c = createSticky(doc, { x: 0, y: 0 });
    const id = createConnector(doc, att(a, { x: -20, y: 0 }), att(b, { x: 20, y: 0 }), 'me');

    const updates = spyUpdates(doc);
    expect(deleteObjects(doc, [b, c])).toBe(2);
    expect(updates.count).toBe(1);
    updates.off();

    const snap = objectsSnapshot(doc).find((o) => o.id === id)!;
    expect(snap.type).toBe('connector');
    expect(snap.x).toBe(-60); // still resolvable from the stored anchor
    expect(snap.width).toBe(120);
  });

  it('connector.no_accidental: endpoints closer than CONNECTOR_MIN_LENGTH_WORLD → null', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }); // (-100..100)²; right anchor (100, 0)
    const updates = spyUpdates(doc);
    // A free end 5 world units from the anchor: too short.
    expect(
      createConnector(doc, free(95, 0), att(a, { x: 100, y: 0 }), 'me'),
    ).toBeNull();
    expect(updates.count).toBe(0);
    // Exactly the minimum length (8): boundary allowed.
    expect(createConnector(doc, free(92, 0), att(a, { x: 100, y: 0 }), 'me')).not.toBeNull();
    // Free ends at exactly the minimum length are allowed too.
    expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'me')).not.toBeNull();
    updates.off();
  });
});

function moveInDoc(doc: Y.Doc, id: string, p: { x: number; y: number }): void {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
  doc.transact(() => {
    entry.set('x', p.x);
    entry.set('y', p.y);
  }, doc.clientID);
}

/** The connector's stored (derived) bbox via the board snapshot. */
function bboxOf(doc: Y.Doc, id: string) {
  const o = objectsSnapshot(doc).find((s) => s.id === id)!;
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}
