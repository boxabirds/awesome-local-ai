import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  isConnectorSnapshot,
  moveObject,
  objectBounds,
  objectSnapshots,
  resizeObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  connectorRect,
  createConnector,
  detachConnectorsTo,
  isEndpoint,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
  type EndpointInput,
} from '../../src/shared/objects/connector';
import {
  SIDES,
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Side,
} from '../../src/shared/geometry/connector-geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';

/**
 * Tasks 7-14 and 29 (`connector.endpoints`, `connector.follow`,
 * `connector.detach`): the connector model and its geometry.
 *
 * A connector stores **endpoints**, never resolved coordinates, so every case
 * reads both the stored entry and the render model: what the document holds, and
 * what the board therefore draws.
 */

function updatesIn(doc: Y.Doc, run: () => unknown): number {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    run();
  } finally {
    doc.off('update', listener);
  }
  return count;
}

/** An ordinary board object at an exact rectangle, to attach arrows to. */
function makeObject(doc: Y.Doc, rect: Rect): string {
  const id = createSticky(doc, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  resizeObjects(doc, new Map([[id, rect]]));
  return id;
}

const entryOf = (doc: Y.Doc, id: string): Y.Map<unknown> =>
  doc.getMap<unknown>('objects').get(id) as Y.Map<unknown>;

function onlyConnector(doc: Y.Doc): ConnectorSnapshot {
  const connectors = objectSnapshots(doc).filter(isConnectorSnapshot);
  expect(connectors).toHaveLength(1);
  return connectors[0]!;
}

const connectorCount = (doc: Y.Doc): number =>
  objectSnapshots(doc).filter(isConnectorSnapshot).length;

const rectsOf = (doc: Y.Doc): Map<string, Rect> =>
  new Map(objectSnapshots(doc).map((obj: ObjectSnapshot) => [obj.id, objectBounds(obj)]));

const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });
/**
 * An attached endpoint: the object the arrow touched, and nothing else. Which side
 * it lands on, and the anchor that implies, is the model's answer, not the caller's
 * (`connector.endpoints` - attached ends store no side).
 */
const attached = (objectId: string): EndpointInput => ({ kind: 'attached', objectId });

describe('connector model (`connector.endpoints`, `connector.follow`, `connector.detach`)', () => {
  describe('TC-07: a connector stores its endpoints, not resolved coordinates', () => {
    it('the attached end keeps kind, objectId and the anchor it attached to', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), free(500, 200), 'user-1')!;

      const stored = entryOf(doc, id);
      const from = stored.get('from') as Record<string, unknown>;
      expect(from.kind).toBe('attached');
      expect(from.objectId).toBe(a);
      // The anchor the arrow was attached to is kept, for the case where the object
      // is gone; the side it was attached to is not, because it is recomputed.
      expect(from.fallback).toEqual({ x: 300, y: 160 });
      expect(Object.keys(from).sort()).toEqual(['fallback', 'kind', 'objectId']);
      // The connector never stores a position: x and y stay the placeholders the
      // model writes, and the box the board sees is derived from the endpoints.
      expect(stored.get('x')).toBe(0);
      expect(stored.get('y')).toBe(0);
      expect(stored.get('type')).toBe('connector');

      const connector = onlyConnector(doc);
      expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
      expect(connector.to).toEqual({ kind: 'free', x: 500, y: 200 });
      expect(connector.createdBy).toBe('user-1');
      expect(connector.z).toBe(2); // maxZ + 1, above the object it points at
    });

    it('a free end stores its point', () => {
      const doc = new Y.Doc();
      const id = createConnector(doc, free(0, 0), free(200, 100), 'user-1')!;
      const stored = entryOf(doc, id);
      expect(stored.get('from')).toEqual({ kind: 'free', x: 0, y: 0 });
      expect(stored.get('to')).toEqual({ kind: 'free', x: 200, y: 100 });
    });

    it('the derived box in the render model is the bbox of the resolved ends', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), free(500, 300), 'user-1')!;
      const connector = onlyConnector(doc);
      // The A end faces the free end, so it is drawn at A's right side midpoint
      // (300,160): the bbox is (300,160)-(500,300).
      expect(connectorBBox({ x: 300, y: 160 }, { x: 500, y: 300 })).toEqual({
        x: 300,
        y: 160,
        width: 200,
        height: 140,
      });
      expect(objectBounds(connector)).toEqual({ x: 300, y: 160, width: 200, height: 140 });
      expect(connector.id).toBe(id);
    });
  });

  describe('TC-08: nearestSide and sideAnchor', () => {
    it.each([
      { toward: { x: 500, y: 200 }, wanted: 'right', why: 'wider than it is tall, target to the right' },
      { toward: { x: 200, y: -100 }, wanted: 'top', why: 'target above it' },
      { toward: { x: -50, y: 160 }, wanted: 'left', why: 'target to the left, same height' },
      { toward: { x: 200, y: 400 }, wanted: 'bottom', why: 'target below it' },
    ])('$why', ({ toward, wanted }) => {
      expect(nearestSide({ x: 100, y: 100, width: 200, height: 120 }, toward)).toBe(wanted);
    });

    it.each([
      { rect: { x: 0, y: 0, width: 100, height: 400 }, toward: { x: 300, y: 200 }, wanted: 'right' },
      { rect: { x: 0, y: 0, width: 400, height: 100 }, toward: { x: 200, y: 300 }, wanted: 'bottom' },
    ])('the comparison is aspect-correct for a $rect.width x $rect.height rect', ({ rect, toward, wanted }) => {
      expect(nearestSide(rect, toward)).toBe(wanted);
    });

    it.each([...SIDES])('sideAnchor of the %s side is that side midpoint', (side) => {
      const rect = { x: 100, y: 100, width: 200, height: 120 };
      const expected: Record<string, Point> = {
        top: { x: 200, y: 100 },
        right: { x: 300, y: 160 },
        bottom: { x: 200, y: 220 },
        left: { x: 100, y: 160 },
      };
      expect(sideAnchor(rect, side)).toEqual(expected[side]);
    });

    it('nearestSide returns one of the four sides for a degenerate target', () => {
      expect(SIDES).toContain(nearestSide({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50 }));
    });
  });

  describe('TC-09: a free-to-free connector shorter than CONNECTOR_MIN_LENGTH_WORLD is rejected', () => {
    it(`${CONNECTOR_MIN_LENGTH_WORLD - 0.1} world units creates nothing and writes nothing`, () => {
      const doc = new Y.Doc();
      let id: string | null = 'unset';
      const count = updatesIn(doc, () => {
        id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'user-1');
      });
      expect(id).toBeNull();
      expect(count).toBe(0);
      expect(connectorCount(doc)).toBe(0);
    });

    it(`exactly ${CONNECTOR_MIN_LENGTH_WORLD} world units creates it`, () => {
      const doc = new Y.Doc();
      const count = updatesIn(doc, () => {
        expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'user-1')).not.toBeNull();
      });
      expect(count).toBe(1);
      expect(connectorCount(doc)).toBe(1);
    });

    it('the length is measured between the resolved endpoints, not the stored ones', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 0, y: 0, width: 200, height: 200 });
      // The attached end resolves to (200,100), so a free end at (207,100) is 7
      // world units away: too short, even though the stored points are far apart.
      let id: string | null = 'unset';
      const count = updatesIn(doc, () => {
        id = createConnector(doc, attached(a), free(207, 100), 'user-1');
      });
      expect(id).toBeNull();
      expect(count).toBe(0);
    });

    it('a diagonal connector is measured by its true length', () => {
      const doc = new Y.Doc();
      expect(createConnector(doc, free(0, 0), free(4.8, 6.4), 'user-1')).not.toBeNull(); // 8.0
      expect(connectorCount(doc)).toBe(1);
    });
  });

  it('TC-08: both ends attached to the same object creates nothing and writes nothing', () => {
    const doc = new Y.Doc();
    const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
    let id: string | null = 'unset';
    const count = updatesIn(doc, () => {
      id = createConnector(doc, attached(a), attached(a), 'user-1');
    });
    expect(id).toBeNull();
    expect(count).toBe(0);
    expect(connectorCount(doc)).toBe(0);
    expect(objectSnapshots(doc)).toHaveLength(1); // only the object is left
  });

  it.each([
    { deg: 0, wanted: 'right' as Side },
    { deg: 44, wanted: 'right' as Side },
    { deg: 46, wanted: 'top' as Side },
    { deg: 90, wanted: 'top' as Side },
  ])(
    'TC-10: B orbiting A at $deg degrees attaches A on its $wanted side (switch at the diagonal)',
    ({ deg, wanted }) => {
      // A is the square 200 x 200 every object starts as, centred on the origin; B
      // sits 300 units from it, at `deg` degrees above the horizontal.
      const a = { x: -100, y: -100, width: 200, height: 200 };
      const radians = (deg * Math.PI) / 180;
      const toward = { x: 300 * Math.cos(radians), y: -300 * Math.sin(radians) };
      expect(nearestSide(a, toward)).toBe(wanted);
      // And the end is drawn at the midpoint of that side.
      expect(sideAnchor(a, wanted)).toEqual(
        wanted === 'right' ? { x: 100, y: 0 } : { x: 0, y: -100 },
      );
    },
  );

  describe('TC-11: resolveEndpoints', () => {
    it('an attached end resolves to the side of its object that faces the other end', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), attached(b), 'user-1')!;
      const connector = onlyConnector(doc);
      const resolved = resolveEndpoints(connector, rectsOf(doc));
      expect(resolved.from).toEqual(sideAnchor({ x: 100, y: 100, width: 200, height: 120 }, 'right'));
      expect(resolved.to).toEqual(sideAnchor({ x: 600, y: 100, width: 200, height: 120 }, 'left'));
      expect(connector.id).toBe(id);
    });

    it('an end follows its object, and changes to the side now nearest the other end', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 200 });
      const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 200 });
      const id = createConnector(doc, attached(a), attached(b), 'user-1')!;
      const rects = rectsOf(doc);
      expect(resolveEndpoints(onlyConnector(doc), rects).from).toEqual({ x: 300, y: 200 });
      expect(resolveEndpoints(onlyConnector(doc), rects).to).toEqual({ x: 600, y: 200 });

      // B is moved to the far left of A. Nothing is written to the connector; the
      // ends are simply drawn on the sides that face each other now, and they have
      // swapped sides (`connector.follow`).
      expect(moveObject(doc, b, -600, 100)).toBe(true);
      const moved = resolveEndpoints(onlyConnector(doc), rectsOf(doc));
      expect(onlyConnector(doc).id).toBe(id);
      expect(moved.to).toEqual({ x: -400, y: 200 }); // B's right side, facing A
      expect(moved.from).toEqual({ x: 100, y: 200 }); // A's left side, facing B
      // The stored endpoints are the same two attachments they were before.
      expect(onlyConnector(doc).from).toMatchObject({ kind: 'attached', objectId: a });
      expect(onlyConnector(doc).to).toMatchObject({ kind: 'attached', objectId: b });
    });

    it('a missing object falls back to the stored anchor, and does not throw', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), attached(b), 'user-1')!;
      const snap = onlyConnector(doc);
      const withoutB = new Map([[a, { x: 100, y: 100, width: 200, height: 120 }]]);
      const resolved = resolveEndpoints(snap, withoutB);
      expect(resolved.from).toEqual({ x: 300, y: 160 });
      // The B end is drawn at the last anchor it had, not at a made-up point.
      expect(snap.to.kind).toBe('attached');
      if (snap.to.kind === 'attached') {
        expect(resolved.to).toEqual(snap.to.fallback);
      }
      expect(Number.isFinite(resolved.to.x)).toBe(true);
      expect(Number.isFinite(resolved.to.y)).toBe(true);
      expect(snap.id).toBe(id);
    });

    it('a free end resolves to its own point', () => {
      const snap = onlyConnector((() => {
        const d = new Y.Doc();
        createConnector(d, free(10, 20), free(210, 120), 'user-1');
        return d;
      })());
      expect(resolveEndpoints(snap, new Map())).toEqual({
        from: { x: 10, y: 20 },
        to: { x: 210, y: 120 },
      });
    });
  });

  describe('TC-12: setConnectorEndpoint', () => {
    const setup = (): { doc: Y.Doc; a: string; b: string; id: string } => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), attached(b), 'user-1')!;
      return { doc, a, b, id };
    };

    it('re-attaching an end to the object it is already attached to writes nothing', () => {
      const { doc, b, id } = setup();
      const count = updatesIn(doc, () => {
        expect(setConnectorEndpoint(doc, id, 'to', attached(b))).toBe(false);
      });
      // An attached end stores no side, so "the same object, another side" is not a
      // change: the side is recomputed from the live rectangles when it is drawn.
      expect(count).toBe(0);
      expect(onlyConnector(doc).to).toMatchObject({ kind: 'attached', objectId: b });
    });

    it('a free end becoming attached is one transaction', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const c = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), free(500, 160), 'user-1')!;
      const count = updatesIn(doc, () => {
        expect(setConnectorEndpoint(doc, id, 'to', attached(c))).toBe(true);
      });
      expect(count).toBe(1);
      expect(onlyConnector(doc).to).toMatchObject({
        kind: 'attached',
        objectId: c,
        // The anchor it attached to: C's left side midpoint, the side facing A.
        fallback: { x: 600, y: 160 },
      });
    });

    it('an attached end becoming free is one transaction', () => {
      const { doc, id } = setup();
      const count = updatesIn(doc, () => {
        expect(setConnectorEndpoint(doc, id, 'to', free(777, 888))).toBe(true);
      });
      expect(count).toBe(1);
      expect(onlyConnector(doc).to).toEqual({ kind: 'free', x: 777, y: 888 });
    });

    it('an unchanged endpoint writes nothing', () => {
      const { doc, b, id } = setup();
      const count = updatesIn(doc, () => {
        expect(setConnectorEndpoint(doc, id, 'to', attached(b))).toBe(false);
      });
      expect(count).toBe(0);
    });

    it('attaching an end to the object the other end is attached to is refused', () => {
      const { doc, a, b, id } = setup();
      const count = updatesIn(doc, () => {
        expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
      });
      expect(count).toBe(0);
      expect(onlyConnector(doc).to).toMatchObject({ kind: 'attached', objectId: b });
    });

    it('a non-finite free point is refused', () => {
      const { doc, id } = setup();
      const count = updatesIn(doc, () => {
        expect(setConnectorEndpoint(doc, id, 'to', free(Number.NaN, 10))).toBe(false);
        expect(setConnectorEndpoint(doc, id, 'from', free(10, Number.POSITIVE_INFINITY))).toBe(false);
      });
      expect(count).toBe(0);
    });

    it('an unknown end or a malformed endpoint is refused', () => {
      const { doc, id } = setup();
      expect(setConnectorEndpoint(doc, id, 'middle' as never, free(1, 2))).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached' } as never)).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', null as never)).toBe(false);
      expect(connectorCount(doc)).toBe(1);
    });
  });

  describe('TC-13: detachConnectorsTo turns attached ends into free ends at the last anchor', () => {
    const setup = (): { doc: Y.Doc; a: string; id: string } => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), free(500, 200), 'user-1')!;
      return { doc, a, id };
    };

    it('called directly inside an open transaction, it writes in that transaction', () => {
      const { doc, a, id } = setup();
      const count = updatesIn(doc, () => {
        doc.transact(() => {
          detachConnectorsTo(doc, [a]);
        });
      });
      expect(count).toBe(1);
      const from = onlyConnector(doc).from;
      expect(from.kind).toBe('free');
      // A's anchor at the moment it was deleted: the right side midpoint.
      expect(from).toEqual({ kind: 'free', x: 300, y: 160 });
      expect(onlyConnector(doc).id).toBe(id);
    });

    it('deleteObjects deletes the object and detaches the arrow in exactly one update', () => {
      const { doc, a, id } = setup();
      const count = updatesIn(doc, () => {
        expect(deleteObjects(doc, [a])).toBe(1);
      });
      expect(count).toBe(1);
      expect(objectSnapshots(doc).some((obj) => obj.id === a)).toBe(false);
      const connector = onlyConnector(doc);
      expect(connector.id).toBe(id);
      expect(connector.from).toEqual({ kind: 'free', x: 300, y: 160 });
      // The other end was already free, and stays exactly where it was.
      expect(connector.to).toEqual({ kind: 'free', x: 500, y: 200 });
    });

    it('both ends go free when both objects go', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), attached(b), 'user-1')!;
      const count = updatesIn(doc, () => deleteObjects(doc, [a, b]));
      expect(count).toBe(1);
      const connector = onlyConnector(doc);
      expect(connector.from).toEqual({ kind: 'free', x: 300, y: 160 });
      expect(connector.to).toEqual({ kind: 'free', x: 600, y: 160 });
      expect(connector.id).toBe(id);
    });

    it('an arrow whose other end is attached elsewhere keeps that end attached', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
      createConnector(doc, attached(a), attached(b), 'user-1');
      deleteObjects(doc, [a]);
      expect(onlyConnector(doc).to).toMatchObject({ kind: 'attached', objectId: b });
    });

    it('deleting an object with no arrows writes nothing extra', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 0, y: 0, width: 100, height: 100 });
      const count = updatesIn(doc, () => deleteObjects(doc, [a]));
      expect(count).toBe(1);
      expect(connectorCount(doc)).toBe(0);
    });
  });

  it('TC-29: setConnectorEndpoint on an id deleted by the other client returns false and writes nothing', () => {
    const doc = new Y.Doc();
    const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
    const b = makeObject(doc, { x: 600, y: 100, width: 200, height: 120 });
    const id = createConnector(doc, attached(a), attached(b), 'user-1')!;
    deleteObjects(doc, [id]);
    expect(connectorCount(doc)).toBe(0);
    const count = updatesIn(doc, () => {
      expect(setConnectorEndpoint(doc, id, 'to', free(10, 10))).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', attached(a))).toBe(false);
    });
    expect(count).toBe(0);
    expect(connectorCount(doc)).toBe(0);
  });

  describe('connectorBBox and connectorRect', () => {
    it('connectorBBox is the exact bbox of the two points, no padding', () => {
      expect(connectorBBox({ x: 100, y: 200 }, { x: 300, y: 120 })).toEqual({
        x: 100,
        y: 120,
        width: 200,
        height: 80,
      });
      expect(connectorBBox({ x: 5, y: 5 }, { x: 5, y: 85 })).toEqual({
        x: 5,
        y: 5,
        width: 0,
        height: 80,
      });
      expect(connectorBBox({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });

    it('connectorRect follows the object it is attached to', () => {
      const doc = new Y.Doc();
      const a = makeObject(doc, { x: 100, y: 100, width: 200, height: 120 });
      const id = createConnector(doc, attached(a), free(500, 200), 'user-1')!;
      const before = connectorRect(doc, id);
      expect(before).toEqual({ x: 300, y: 160, width: 200, height: 40 });
      expect(moveObject(doc, a, 200, 100)).toBe(true);
      const after = connectorRect(doc, id);
      // The object moved 100 right, so its right-side anchor moved with it.
      expect(after).toEqual({ x: 400, y: 160, width: 100, height: 40 });
      expect(objectBounds(onlyConnector(doc))).toEqual(after!);
    });

    it('connectorRect is undefined for a stale id', () => {
      const doc = new Y.Doc();
      expect(connectorRect(doc, 'missing')).toBeUndefined();
    });
  });

  describe('isEndpoint', () => {
    it.each([
      { value: { kind: 'free', x: 0, y: 0 }, wanted: true },
      { value: { kind: 'free', x: 1, y: Number.NaN }, wanted: false },
      { value: { kind: 'attached', objectId: 'a', side: 'right' }, wanted: true },
      { value: { kind: 'attached', objectId: 'a', side: 'diagonal' }, wanted: false },
      { value: { kind: 'attached', objectId: '', side: 'top' }, wanted: false },
      { value: { kind: 'attached', objectId: 'a' }, wanted: true },
      { value: { kind: 'somewhere', x: 0, y: 0 }, wanted: false },
      { value: null, wanted: false },
      { value: 'free', wanted: false },
    ])('$value is $wanted', ({ value, wanted }) => {
      expect(isEndpoint(value)).toBe(wanted);
    });
  });

  it('a connector is an object of a new type, visible to selection and movable z-order', () => {
    const doc = new Y.Doc();
    const a = makeObject(doc, { x: 0, y: 0, width: 100, height: 100 });
    createConnector(doc, attached(a), free(300, 50), 'user-1');
    const types = objectSnapshots(doc).map((obj) => obj.type);
    expect(types).toContain('connector');
    expect(types).toContain('sticky');
    expect(isConnectorSnapshot(objectSnapshots(doc)[1]!)).toBe(true);
  });
});
