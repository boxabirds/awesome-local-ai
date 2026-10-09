import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import {
  allObjectIds,
  deleteObject,
  deleteObjects,
  moveObjects,
  objectSnapshots,
} from '../../src/shared/board-model';
import { rectContains, type Point, type Rect } from '../../src/shared/geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  detachConnectorsTo,
  readConnector,
  setConnectorEndpoint,
  type ConnectorEnd,
  type ConnectorSnapshot,
  type Endpoint,
  type EndpointInput,
} from '../../src/shared/objects/connector';

const BY = 'tester';

let doc: Y.Doc;

/** A, B and C are shapes with known boxes, 300 units apart horizontally. */
let A: string;
let B: string;
let C: string;
const RECT_A: Rect = { x: 0, y: 0, width: 200, height: 100 };
const RECT_B: Rect = { x: 500, y: 0, width: 200, height: 100 };
const RECT_C: Rect = { x: 0, y: 400, width: 200, height: 100 };

beforeEach(() => {
  doc = new Y.Doc();
  A = shape(RECT_A);
  B = shape(RECT_B);
  C = shape(RECT_C);
});

function shape(rect: Rect): string {
  const id = createShape(doc, { kind: 'rect', rect, at: { x: rect.x, y: rect.y }, square: false }, BY);
  if (!id) throw new Error('fixture: shape was refused');
  return id;
}

/** How many updates this call made to the document. */
function updatesMade(run: () => void): number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return count;
}

function connectorOf(id: string): ConnectorSnapshot {
  const found = readConnector(doc, id);
  if (!found) throw new Error(`no connector ${id} in the document`);
  return found;
}

/** The two ends exactly as the document holds them. */
function storedEnds(id: string): { from: Endpoint; to: Endpoint } {
  const item = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!item) throw new Error(`no object ${id}`);
  return {
    from: item.get('from') as Endpoint,
    to: item.get('to') as Endpoint,
  };
}

/** The box around an arrow, as an object in the board's own list. */
function listedBox(id: string): Rect {
  const object = listed(id);
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

function attached(objectId: string): EndpointInput {
  return { kind: 'attached', objectId };
}

function free(x: number, y: number): EndpointInput {
  return { kind: 'free', x, y };
}

function makeConnector(from: EndpointInput, to: EndpointInput): string {
  const id = createConnector(doc, from, to, BY);
  if (!id) throw new Error('fixture: connector was refused');
  return id;
}

/** Every object the document holds, as the board sees it. */
function listed(id: string) {
  const found = objectSnapshots(doc).find((object) => object.id === id);
  if (!found) throw new Error(`no snapshot for ${id}`);
  return found;
}

function rectsOf(...entries: [string, Rect][]): Map<string, Rect> {
  return new Map(entries);
}

describe('creating a connector between two objects (TC-07, TC-08)', () => {
  it('TC-07: an arrow from A to B stores both ends attached, with the side anchors as fallbacks', () => {
    const before = allObjectIds(objectSnapshots(doc)).length;
    let id = '';
    const updates = updatesMade(() => {
      const made = createConnector(doc, attached(A), attached(B), BY);
      expect(made).not.toBeNull();
      id = made!;
    });
    expect(updates).toBe(1);
    expect(allObjectIds(objectSnapshots(doc)).length).toBe(before + 1);

    const stored = storedEnds(id);
    expect(stored.from).toEqual({ kind: 'attached', objectId: A, fallback: { x: 200, y: 50 } });
    expect(stored.to).toEqual({ kind: 'attached', objectId: B, fallback: { x: 500, y: 50 } });

    const connector = connectorOf(id);
    expect(connector.type).toBe('connector');
    expect(connector.z).toBeGreaterThan(0);
    expect(connector.createdBy).toBe(BY);
    expect(connector.ends.from).toEqual({ x: 200, y: 50 });
    expect(connector.ends.to).toEqual({ x: 500, y: 50 });
    // 300 board units from side to side, which is what "300 apart" meant.
    expect(Math.hypot(connector.ends.to.x - connector.ends.from.x, connector.ends.to.y - connector.ends.from.y)).toBeCloseTo(300, 6);
  });

  it('TC-07: the arrow is in the board list with a box around its ends, and no box of its own', () => {
    const id = makeConnector(attached(A), attached(B));
    const box = listed(id);
    expect(box.type).toBe('connector');
    expect(connectorBBox({ x: 200, y: 50 }, { x: 500, y: 50 })).toEqual({
      x: 200,
      y: 50,
      width: 300,
      height: 0,
    });
    expect(listedBox(id)).toEqual({ x: 200, y: 50, width: 300, height: 0 });
    expect(box.known).toBe(true);
  });

  it('TC-08: an arrow from A to A is refused, and nothing at all is written', () => {
    const before = allObjectIds(objectSnapshots(doc)).length;
    const updates = updatesMade(() => {
      expect(createConnector(doc, attached(A), attached(A), BY)).toBeNull();
    });
    expect(updates).toBe(0);
    expect(allObjectIds(objectSnapshots(doc)).length).toBe(before);
  });
});

describe('an arrow with a free end, and one that is too short (TC-09)', () => {
  it('TC-09: a drag one hundredth of a unit too short creates nothing; exactly 8 does', () => {
    const before = allObjectIds(objectSnapshots(doc)).length;
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBe(8);
    const updates = updatesMade(() => {
      expect(createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), BY)).toBeNull();
    });
    expect(updates).toBe(0);
    const id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), BY);
    expect(id).not.toBeNull();
    expect(allObjectIds(objectSnapshots(doc)).length).toBe(before + 1);
    expect(connectorOf(id!).ends.from).toEqual({ x: 0, y: 0 });
    expect(connectorOf(id!).ends.to).toEqual({ x: 8, y: 0 });
  });

  it('a free end is stored as itself, and stays where it was put when the other end moves', () => {
    const id = makeConnector(attached(A), free(350, 250));
    expect(storedEnds(id).to).toEqual({ kind: 'free', x: 350, y: 250 });
    expect(connectorOf(id).ends.to).toEqual({ x: 350, y: 250 });
    // Moving A moves the attached end and leaves the free one exactly where it is.
    moveObjects(doc, new Map([[A, { x: 0, y: 200 }]]));
    const after = connectorOf(id);
    expect(after.ends.to).toEqual({ x: 350, y: 250 });
    expect(after.ends.from).toEqual({ x: 200, y: 250 });
  });

  it('an end pointing at an object that is not there is refused unless it has a fallback', () => {
    expect(createConnector(doc, { kind: 'attached', objectId: 'nobody' }, free(0, 0), BY)).toBeNull();
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: 'nobody', fallback: { x: 12, y: 13 } },
      free(100, 13),
      BY,
    );
    expect(id).not.toBeNull();
    expect(connectorOf(id!).ends.from).toEqual({ x: 12, y: 13 });
  });
});

describe('which side an arrow attaches to (TC-10)', () => {
  /** A square, so the sides switch at exactly 45°. */
  const square: Rect = { x: 0, y: 0, width: 200, height: 200 };

  it('TC-10: as the other end orbits, the side changes at the diagonal', () => {
    const centre = { x: 100, y: 100 };
    const toward = (degrees: number): Point => {
      const radians = (degrees * Math.PI) / 180;
      // Screen coordinates: y grows downwards, so 90° is above the square.
      return {
        x: centre.x + Math.cos(radians) * 400,
        y: centre.y - Math.sin(radians) * 400,
      };
    };
    expect(nearestSide(square, toward(0))).toBe('right');
    expect(nearestSide(square, toward(44))).toBe('right');
    expect(nearestSide(square, toward(46))).toBe('top');
    expect(nearestSide(square, toward(90))).toBe('top');
    // And the anchor is the midpoint of that side, on the boundary.
    expect(sideAnchor(square, 'top')).toEqual({ x: 100, y: 0 });
    expect(sideAnchor(square, 'right')).toEqual({ x: 200, y: 100 });
    expect(sideAnchor(square, 'bottom')).toEqual({ x: 100, y: 200 });
    expect(sideAnchor(square, 'left')).toEqual({ x: 0, y: 100 });
  });

  it('TC-10: moving the other object past the diagonal switches the side the arrow is drawn from', () => {
    const id = makeConnector(attached(A), attached(B));
    expect(connectorOf(id).ends.from).toEqual({ x: 200, y: 50 });
    // B goes above A: the arrow now leaves A's top side and enters B's bottom side.
    moveObjects(doc, new Map([[B, { x: 0, y: -400 }]]));
    const after = connectorOf(id);
    expect(after.ends.from).toEqual({ x: 100, y: 0 });
    expect(after.ends.to).toEqual({ x: 100, y: -300 });
  });

  it('the anchor is a point on the object, so a hit test on it counts as a hit', () => {
    const id = makeConnector(attached(A), attached(B));
    const end = connectorOf(id).ends.from;
    expect(rectContains(RECT_A, { x: end.x, y: end.y, width: 0, height: 0 })).toBe(true);
  });
});

describe('an arrow whose object has gone away (TC-11)', () => {
  it('TC-11: with B missing, resolveEndpoints draws that end at its fallback and does not throw', () => {
    const ends = {
      from: { kind: 'attached', objectId: A, fallback: { x: 200, y: 50 } } as Endpoint,
      to: { kind: 'attached', objectId: B, fallback: { x: 640, y: 120 } } as Endpoint,
    };
    const rects = rectsOf([A, RECT_A]);
    const resolved = resolveEndpoints(ends, rects);
    expect(resolved.from).toEqual({ x: 200, y: 50 });
    expect(resolved.to).toEqual({ x: 640, y: 120 });
    // The other end still uses the side of A that faces the point it is pointing at.
    expect(resolveEndpoints(ends, new Map()).from).toEqual({ x: 200, y: 50 });
  });

  it('TC-11: an arrow attached to an object that went away in the meantime still renders', () => {
    const id = makeConnector(attached(A), attached(B));
    // Somebody else's delete arrives as it would in a race: the object is simply gone, and
    // the arrow's end is still `attached` to an id this document no longer holds. (Going
    // through `deleteObjects` would detach it, which is TC-13.)
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('objects').delete(B);
    });
    const connector = connectorOf(id);
    expect(connector.orphaned.to).toBe(true);
    expect(connector.ends.to).toEqual({ x: 500, y: 50 });
  });
});

describe('moving an end of an arrow (TC-12, TC-29)', () => {
  let id: string;

  beforeEach(() => {
    id = makeConnector(attached(A), attached(B));
  });

  it('TC-12: an end dropped on empty board is free at that point', () => {
    expect(setConnectorEndpoint(doc, id, 'to', free(420, 300))).toBe(true);
    expect(storedEnds(id).to).toEqual({ kind: 'free', x: 420, y: 300 });
    expect(connectorOf(id).ends.to).toEqual({ x: 420, y: 300 });
  });

  it('TC-12: an end dropped on another object attaches to it, with that object as its fallback', () => {
    expect(setConnectorEndpoint(doc, id, 'to', attached(C))).toBe(true);
    const stored = storedEnds(id).to;
    if (stored.kind !== 'attached') throw new Error('the end did not attach to anything');
    expect(stored.objectId).toBe(C);
    // C is below A, so the arrow now enters C from the top.
    expect(stored.fallback).toEqual({ x: 100, y: 400 });
    expect(connectorOf(id).ends.to).toEqual({ x: 100, y: 400 });
  });

  it('TC-12: an end cannot be attached to the object at the other end of the same arrow', () => {
    const before = JSON.stringify(storedEnds(id));
    const updates = updatesMade(() => {
      expect(setConnectorEndpoint(doc, id, 'to', attached(A))).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'from', attached(B))).toBe(false);
    });
    expect(updates).toBe(0);
    expect(JSON.stringify(storedEnds(id))).toBe(before);
  });

  it('an end with no numbers in it is refused', () => {
    const updates = updatesMade(() => {
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: Number.NaN, y: 3 })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: '' })).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'to', undefined as unknown as EndpointInput)).toBe(false);
      expect(setConnectorEndpoint(doc, id, 'sideways' as ConnectorEnd, free(1, 1))).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-29: an arrow somebody else deleted in the meantime is left alone', () => {
    expect(deleteObject(doc, id)).toBe(true);
    const updates = updatesMade(() => {
      expect(setConnectorEndpoint(doc, id, 'to', free(30, 30))).toBe(false);
    });
    expect(updates).toBe(0);
    expect(readConnector(doc, id)).toBeUndefined();
  });
});

describe('deleting an object an arrow points at (TC-13)', () => {
  it('TC-13: the arrow survives with its end free where the object was, in one update', () => {
    const id = makeConnector(attached(A), attached(B));
    let updates = 0;
    let removed = 0;
    updates = updatesMade(() => {
      removed = deleteObjects(doc, [A]);
    });
    expect(removed).toBe(1);
    expect(updates).toBe(1);
    const ids = allObjectIds(objectSnapshots(doc));
    expect(ids).not.toContain(A);
    expect(ids).toContain(id);
    // A's right side was where the arrow was attached, and that is where it stays.
    expect(storedEnds(id).from).toEqual({ kind: 'free', x: 200, y: 50 });
    expect(connectorOf(id).ends.from).toEqual({ x: 200, y: 50 });
    expect(connectorOf(id).ends.to).toEqual({ x: 500, y: 50 });
  });

  it('TC-13: both ends of an arrow between two deleted objects come loose', () => {
    const id = makeConnector(attached(A), attached(B));
    const updates = updatesMade(() => deleteObjects(doc, [A, B]));
    expect(updates).toBe(1);
    const stored = storedEnds(id);
    expect(stored.from).toEqual({ kind: 'free', x: 200, y: 50 });
    expect(stored.to).toEqual({ kind: 'free', x: 500, y: 50 });
  });

  it('TC-13: detachConnectorsTo on its own leaves arrows that do not touch those objects alone', () => {
    const keeps = makeConnector(attached(B), attached(C));
    const loses = makeConnector(attached(A), attached(C));
    doc.transact(() => {
      detachConnectorsTo(doc, [A]);
    });
    expect(storedEnds(keeps).from.kind).toBe('attached');
    // C is below A, so this arrow left A through its bottom side, and that is the point
    // it is left standing at.
    expect(storedEnds(loses).from).toEqual({ kind: 'free', x: 100, y: 100 });
  });
});

describe('distance from an arrow, which is what clicking one means (TC-14)', () => {
  const segment = [{ x: 0, y: 0 }, { x: 100, y: 0 }] as const;

  it('TC-14: 0, 5.99 and 6.01 units from a segment are exactly those distances', () => {
    expect(distanceToPolyline(segment, { x: 50, y: 0 })).toBe(0);
    expect(distanceToPolyline(segment, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(segment, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 6);
  });

  it('past the end of the line the distance is to the end, not along it', () => {
    expect(distanceToPolyline(segment, { x: -10, y: 0 })).toBeCloseTo(10, 6);
    expect(distanceToPolyline(segment, { x: 130, y: 40 })).toBeCloseTo(50, 6);
  });

  it('a polyline with corners is measured to the nearest segment', () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPolyline(path, { x: 100, y: 50 })).toBe(0);
    expect(distanceToPolyline(path, { x: 50, y: -6 })).toBeCloseTo(6, 6);
  });

  it('a single point is a dot, and no points at all is nowhere', () => {
    expect(distanceToPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBeCloseTo(5, 6);
    expect(Number.isFinite(distanceToPolyline([], { x: 0, y: 0 }))).toBe(false);
  });
});
