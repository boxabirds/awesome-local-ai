import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  snapshot,
  type Endpoint,
  type ObjectSnapshot,
} from "../../src/shared/board-model";
import { CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_MIN_LENGTH_WORLD, SHAPE_MIN_SIZE_WORLD } from "../../src/shared/config";
import type { Point, Rect } from "../../src/shared/geometry";
import {
  connectorBBox,
  distanceToPolyline,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  SIDES,
} from "../../src/shared/geometry/connector-geometry";
import {
  connectorSnapshot,
  type EndpointInput,
  createConnector,
  detachConnectorsTo,
  setConnectorEndpoint,
  type ConnectorSnap,
} from "../../src/shared/objects/connector";
import { createShape } from "../../src/shared/objects/shape";

/**
 * Story 10, task 9 — the connector model (`connector.model`), the connector
 * geometry (`connector.geometry`) and detach-on-delete: TC-07 to TC-14 and TC-29.
 *
 * Real `Y.Doc`s and real shapes. The property all of this is really about is that
 * a connector stores **which objects** its ends hang on and never a line: every
 * number used to draw it is derived from the objects as they are now, so a move —
 * this client's or a colleague's — is followed without writing the connector at
 * all.
 */

const PAD = CONNECTOR_ARROWHEAD_SIZE_WORLD;

let doc: Y.Doc;
let updates: { update: Uint8Array; origin: unknown }[];

beforeEach(() => {
  doc = new Y.Doc();
  updates = [];
  doc.on("update", (update, origin) => updates.push({ update, origin }));
  initDoc(doc);
  updates.length = 0;
});

function updateCount(): number {
  return updates.length;
}

function newShapeAt(x: number, y: number, width = 100, height = 100): string {
  const id = createShape(doc, { kind: "rect", rect: { x, y, width, height }, at: { x, y } }, "dana");
  if (typeof id !== "string") throw new Error(`createShape rejected ${x},${y}`);
  return id;
}

/** The contract's endpoints, spelled the short way. */
const at = (objectId: string): EndpointInput => ({ kind: "attached", objectId });
function newConnector(fromId: string, toId: string): string {
  const id = createConnector(doc, at(fromId), at(toId), "dana");
  if (typeof id !== "string") throw new Error(`createConnector rejected ${fromId} -> ${toId}`);
  return id;
}

function objectOf(id: string): ObjectSnapshot {
  const entry = snapshot(doc).find((object) => object.id === id);
  if (!entry) throw new Error(`no object ${id} in the model`);
  return entry;
}

function connectorOf(id: string): ConnectorSnap {
  const entry = objectOf(id);
  if (entry.type !== "connector" || entry.from === undefined || entry.to === undefined) {
    throw new Error(`object ${id} is not a readable connector`);
  }
  return entry as ConnectorSnap;
}

function rectsOf(...ids: string[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const id of ids) rects.set(id, objectBounds(objectOf(id)));
  return rects;
}

describe("connector.model: createConnector", () => {
  it("TC-07 shapes 300 apart store both ends, with fallbacks equal to the side anchors", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(250, 0);
    updates.length = 0;

    const id = newConnector(a, b);

    expect(updateCount()).toBe(1);
    const connector = connectorOf(id);
    expect(connector.type).toBe("connector");
    expect(connector.createdBy).toBe("dana");
    expect(connector.z).toBeGreaterThan(1);

    expect(connector.from.kind).toBe("attached");
    expect(connector.to.kind).toBe("attached");
    if (connector.from.kind !== "attached" || connector.to.kind !== "attached") return;
    expect(connector.from.objectId).toBe(a);
    expect(connector.to.objectId).toBe(b);
    // A is left of B, so A faces it from its right edge and B from its left.
    expect(connector.from.fallback).toEqual({ x: 100, y: 50 });
    expect(connector.to.fallback).toEqual({ x: 250, y: 50 });

    // The line itself is not stored: the snapshot derives the box from the ends.
    expect(connector.x).toBeCloseTo(100 - PAD, 6);
    expect(connector.y).toBeCloseTo(50 - PAD, 6);
    expect(connector.width).toBeCloseTo(150 + 2 * PAD, 6);
    expect(connector.height).toBeCloseTo(2 * PAD, 6);
  });

  it("TC-08 an object connected to itself is refused, with no transaction", () => {
    const a = newShapeAt(0, 0);
    updates.length = 0;

    expect(createConnector(doc, at(a), at(a), "dana")).toBeNull();
    expect(updateCount()).toBe(0);
    expect(connectorSnapshot(doc)).toHaveLength(0);
  });

  it("TC-08 a missing, empty or stale id is refused, with no transaction", () => {
    const a = newShapeAt(0, 0);
    updates.length = 0;

    expect(createConnector(doc, at(a), at("never-existed"), "dana")).toBeNull();
    expect(createConnector(doc, at("never-existed"), at(a), "dana")).toBeNull();
    expect(createConnector(doc, at(""), at(a), "dana")).toBeNull();
    expect(createConnector(doc, at(a), at(""), "dana")).toBeNull();
    expect(updateCount()).toBe(0);
  });

  it("TC-09 the length boundary: facing anchors 7.9 apart are refused, 8 apart are created", () => {
    const a = newShapeAt(0, 0, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD);

    // A shape whose left edge is 7.9 from A's right edge.
    const justShort = newShapeAt(20 + CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD);
    updates.length = 0;
    expect(createConnector(doc, at(a), at(justShort), "dana")).toBeNull();
    expect(updateCount()).toBe(0);

    // The same one tenth of a board unit further away: exactly the minimum.
    const exact = newShapeAt(20 + CONNECTOR_MIN_LENGTH_WORLD, 0, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD);
    updates.length = 0;
    expect(typeof createConnector(doc, at(a), at(exact), "dana")).toBe("string");
    expect(updateCount()).toBe(1);
    expect(connectorSnapshot(doc)).toHaveLength(1);
  });

  it("TC-09 objects whose anchors coincide (a stray click-drag) create nothing", () => {
    const a = newShapeAt(0, 100, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD);
    const b = newShapeAt(0, 120, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD);
    // A's bottom anchor and B's top anchor are the same point: distance 0.
    const boxA = objectBounds(objectOf(a));
    expect(boxA.y + boxA.height).toBe(120);
    updates.length = 0;
    expect(createConnector(doc, at(a), at(b), "dana")).toBeNull();
    expect(updateCount()).toBe(0);
  });

  it("connector.one_per_pair: one arrow per pair, in either direction", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    newConnector(a, b);
    updates.length = 0;

    expect(createConnector(doc, at(a), at(b), "dana")).toBeNull();
    expect(createConnector(doc, at(b), at(a), "dana")).toBeNull();
    expect(updateCount()).toBe(0);
    expect(connectorSnapshot(doc)).toHaveLength(1);

    // A different pair is allowed, and an arrow may share one object.
    const c = newShapeAt(600, 0);
    expect(typeof createConnector(doc, at(b), at(c), "dana")).toBe("string");
    expect(connectorSnapshot(doc)).toHaveLength(2);
  });

  it("connector.no_chain: an end never sits on another arrow", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const arrow = newConnector(a, b);
    updates.length = 0;

    expect(createConnector(doc, at(arrow), at(b), "dana")).toBeNull();
    expect(createConnector(doc, at(a), at(arrow), "dana")).toBeNull();
    expect(
      setConnectorEndpoint(doc, arrow, "from", { kind: "attached", objectId: arrow, fallback: { x: 0, y: 0 } }),
    ).toBe(false);
    expect(updateCount()).toBe(0);
  });

  it("TC-12 setConnectorEndpoint replaces one end only", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const c = newShapeAt(300, 300);
    const id = newConnector(a, b);
    const before = connectorOf(id);
    if (before.from.kind !== "attached") throw new Error("a new connector starts attached to its object");
    updates.length = 0;

    // To a board point.
    expect(setConnectorEndpoint(doc, id, "to", { kind: "free", x: 500, y: 500 })).toBe(true);
    expect(updateCount()).toBe(1);
    let connector = connectorOf(id);
    expect(connector.to).toEqual({ kind: "free", x: 500, y: 500 });
    if (connector.from.kind !== "attached") throw new Error("the other end moved unexpectedly");
    expect(connector.from.objectId).toBe(a);
    expect(connector.from.fallback).toEqual(before.from.fallback);

    // To another object.
    expect(setConnectorEndpoint(doc, id, "to", { kind: "attached", objectId: c, fallback: { x: 350, y: 300 } })).toBe(
      true,
    );
    connector = connectorOf(id);
    if (connector.to.kind !== "attached") throw new Error("the end did not become attached");
    expect(connector.to.objectId).toBe(c);
    expect(connector.to.fallback).toEqual({ x: 350, y: 300 });
  });

  it("TC-12 moving an end onto the object at the other end is refused, with nothing written", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    updates.length = 0;

    expect(setConnectorEndpoint(doc, id, "to", { kind: "attached", objectId: a, fallback: { x: 100, y: 50 } })).toBe(
      false,
    );
    expect(setConnectorEndpoint(doc, id, "from", { kind: "attached", objectId: b, fallback: { x: 250, y: 50 } })).toBe(
      false,
    );
    expect(updateCount()).toBe(0);

    const connector = connectorOf(id);
    if (connector.from.kind !== "attached" || connector.to.kind !== "attached") throw new Error("ends changed");
    expect(connector.from.objectId).toBe(a);
    expect(connector.to.objectId).toBe(b);
  });

  it("TC-29 setConnectorEndpoint on a deleted connector is false and writes nothing", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    expect(deleteObjects(doc, [id])).toBe(1);
    updates.length = 0;

    expect(setConnectorEndpoint(doc, id, "from", { kind: "free", x: 10, y: 10 })).toBe(false);
    expect(updateCount()).toBe(0);
  });

  it("setConnectorEndpoint refuses an unreadable endpoint, a sticky-note-free world it cannot read and a non-connector", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    const note = createSticky(doc, { x: 900, y: 900 });
    if (typeof note !== "string") throw new Error("createSticky failed");
    updates.length = 0;

    expect(setConnectorEndpoint(doc, id, "from", { kind: "free", x: Number.NaN, y: 0 } as Endpoint)).toBe(false);
    expect(setConnectorEndpoint(doc, id, "to", { kind: "attached", objectId: "", fallback: { x: 0, y: 0 } })).toBe(false);
    expect(
      setConnectorEndpoint(doc, id, "to", { kind: "attached", objectId: "gone", fallback: { x: 0, y: 0 } }),
    ).toBe(false);
    expect(setConnectorEndpoint(doc, note, "to", { kind: "free", x: 1, y: 1 })).toBe(false);
    expect(setConnectorEndpoint(doc, "no-such-connector", "to", { kind: "free", x: 1, y: 1 })).toBe(false);
    expect(updateCount()).toBe(0);
  });
});

describe("connector.model: an arrow follows its objects", () => {
  it("a move writes nothing on the connector, and the derived line and box follow it", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    const before = connectorOf(id);
    updates.length = 0;

    expect(moveObjects(doc, new Map([[b, { x: 800, y: 400 }]]))).toBe(1);
    // The only write in the whole board was the moved object.
    expect(updateCount()).toBe(1);

    const after = connectorOf(id);
    if (after.from.kind !== "attached" || after.to.kind !== "attached") throw new Error("the ends changed");
    expect(after.from.objectId).toBe(a);
    expect(after.to.objectId).toBe(b);
    // B moved to below-right of A: its centre is still nearer A's right edge
    // than its bottom edge, so the arrow leaves A on the right and enters B on
    // its left.
    expect(resolveEndpoints(after, rectsOf(a, b))).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 800, y: 450 },
    });

    // TC-29's sibling (`connector.fresh_snapshots`): the snapshot after a move is
    // a new object holding new numbers.
    expect(after).not.toBe(before);
    expect(after.width).not.toBe(before.width);
    expect(after.height).not.toBe(before.height);
  });

  it("TC-13 deleting an object frees the ends attached to it, in the same transaction", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    updates.length = 0;

    expect(deleteObjects(doc, [a])).toBe(1);
    // One update for the delete *and* the detach.
    expect(updateCount()).toBe(1);

    const connector = connectorOf(id);
    expect(connector.from.kind).toBe("free");
    if (connector.from.kind !== "free") return;
    // A's anchor at the moment it was deleted: the side that faced B.
    expect(connector.from).toEqual({ kind: "free", x: 100, y: 50 });
    if (connector.to.kind !== "attached") throw new Error("the surviving end should still be attached");
    expect(connector.to.objectId).toBe(b);

    // The arrow is still on the board, and it starts where A used to be.
    expect(connectorSnapshot(doc)).toHaveLength(1);
    expect(snapshot(doc).map((object) => object.id).sort()).toEqual([id, b].sort());
    expect(resolveEndpoints(connector, rectsOf(b)).from).toEqual({ x: 100, y: 50 });
  });
  it("TC-13 deleting both objects leaves an arrow with two free ends, still one update", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    updates.length = 0;

    expect(deleteObjects(doc, [a, b])).toBe(2);
    expect(updateCount()).toBe(1);
    const connector = connectorOf(id);
    expect(connector.from).toEqual({ kind: "free", x: 100, y: 50 });
    expect(connector.to).toEqual({ kind: "free", x: 300, y: 50 });
    expect(connectorSnapshot(doc)).toHaveLength(1);
  });

  it("detachConnectorsTo writes nothing when no end points at the deleted ids", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    const before = connectorOf(id);
    updates.length = 0;

    detachConnectorsTo(doc, ["someone-else"]);
    detachConnectorsTo(doc, []);
    expect(updateCount()).toBe(0);
    expect(connectorOf(id).from).toEqual(before.from);
    expect(connectorOf(id).to).toEqual(before.to);
  });

  it("an arrow is never re-attached to an object that appears where its fallback points", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    deleteObjects(doc, [b]);
    const detached = connectorOf(id);
    updates.length = 0;

    const c = newShapeAt(300, 0);
    expect(connectorOf(id).to).toEqual(detached.to);
    expect(connectorOf(id).to.kind).toBe("free");
    expect(resolveEndpoints(connectorOf(id), rectsOf(a, c)).to).toEqual({ x: 300, y: 50 });
    expect(updateCount()).toBe(1);
    void c;
  });
});

describe("connector.geometry", () => {
  it("TC-07 sideAnchor is the midpoint of the requested side", () => {
    const rect: Rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(sideAnchor(rect, "left")).toEqual({ x: 10, y: 45 });
    expect(sideAnchor(rect, "right")).toEqual({ x: 110, y: 45 });
    expect(sideAnchor(rect, "top")).toEqual({ x: 60, y: 20 });
    expect(sideAnchor(rect, "bottom")).toEqual({ x: 60, y: 70 });
  });

  it("TC-10 nearestSide as B orbits A: 0deg right, 44deg right, 46deg top, 90deg top", () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const orbit = (degrees: number, distance = 300): Rect => {
      const radians = (degrees * Math.PI) / 180;
      // Angles run from the +x axis towards **up**, and the board's y grows
      // downwards, so "up" subtracts from y.
      return {
        x: 50 + distance * Math.cos(radians) - 50,
        y: 50 - distance * Math.sin(radians) - 50,
        width: 100,
        height: 100,
      };
    };

    expect(nearestSide(a, orbit(0))).toBe("right");
    expect(nearestSide(a, orbit(44))).toBe("right");
    expect(nearestSide(a, orbit(46))).toBe("top");
    expect(nearestSide(a, orbit(90))).toBe("top");
    expect(nearestSide(a, orbit(134))).toBe("top");
    expect(nearestSide(a, orbit(136))).toBe("left");
    expect(nearestSide(a, orbit(180))).toBe("left");
    expect(nearestSide(a, orbit(224))).toBe("left");
    expect(nearestSide(a, orbit(226))).toBe("bottom");
    expect(nearestSide(a, orbit(270))).toBe("bottom");
    expect(nearestSide(a, orbit(314))).toBe("bottom");
    expect(nearestSide(a, orbit(316))).toBe("right");
  });

  it("TC-10 the switch is exactly on the diagonal whatever the distance", () => {
    const square: Rect = { x: 0, y: 0, width: 100, height: 100 };
    for (const distance of [60, 300, 5000]) {
      const other = (degrees: number): Rect => {
        const radians = (degrees * Math.PI) / 180;
        return {
          x: 50 + distance * Math.cos(radians) - 50,
          y: 50 - distance * Math.sin(radians) - 50,
          width: 100,
          height: 100,
        };
      };
      expect(nearestSide(square, other(44)), `distance ${distance} at 44deg`).toBe("right");
      expect(nearestSide(square, other(46)), `distance ${distance} at 46deg`).toBe("top");
    }
  });

  it("TC-10 a tall shape is faced from its long axis over a wider range of angles", () => {
    // The sides of a rectangle are 40 and 200 apart, so its left and right
    // midpoints sit 20 from its centre and its top and bottom midpoints 100:
    // a target above the diagonal still faces the right edge until it is nearly
    // straight above.
    const tall: Rect = { x: 0, y: 0, width: 40, height: 200 };
    const other = (degrees: number, distance = 300): Rect => {
      const radians = (degrees * Math.PI) / 180;
      return {
        x: 20 + distance * Math.cos(radians) - 25,
        y: 100 - distance * Math.sin(radians) - 25,
        width: 50,
        height: 50,
      };
    };
    expect(nearestSide(tall, other(30))).toBe("top");
    expect(nearestSide(tall, other(20))).toBe("right");
    expect(nearestSide(tall, other(89))).toBe("top");
    expect(nearestSide(tall, other(-30))).toBe("bottom");
    expect(nearestSide(tall, other(-20))).toBe("right");
  });

  it("TC-11 resolveEndpoints uses the stored fallback when an object is missing, and never throws", () => {
    const a = newShapeAt(0, 0);
    const b = newShapeAt(300, 0);
    const id = newConnector(a, b);
    const connector = connectorOf(id);

    // B is not in `rects`: what an arrow attached to an object this client has
    // never seen looks like.
    const half = resolveEndpoints(connector, new Map([[a, objectBounds(objectOf(a))]]));
    expect(half.from).toEqual({ x: 100, y: 50 });
    expect(half.to).toEqual({ x: 300, y: 50 });

    // Neither end is known: still a line, still drawable.
    const orphan = resolveEndpoints(connector, new Map());
    expect(orphan).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });

    // A free end is its own point.
    const free: Endpoint = { kind: "free", x: 7, y: 9 };
    expect(resolveEndpoints({ from: free, to: free }, new Map())).toEqual({
      from: { x: 7, y: 9 },
      to: { x: 7, y: 9 },
    });

    // An attached end follows the object it does know about: A moved far away,
    // still facing the point B was attached to.
    const moved = new Map([[a, { x: 1000, y: 1000, width: 100, height: 100 }]]);
    expect(resolveEndpoints(connector, moved).from).toEqual({ x: 1050, y: 1000 });
  });

  it("TC-14 distanceToPolyline reports 0, 5.99 and 6.01 from a segment", () => {
    const segment: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline(segment, { x: 40, y: 0 }, 6)).toBe(0);
    expect(distanceToPolyline(segment, { x: 40, y: 5.99 }, 6)).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(segment, { x: 40, y: -5.99 }, 6)).toBeCloseTo(5.99, 6);
    expect(distanceToPolyline(segment, { x: 40, y: 6.01 }, 6)).toBeCloseTo(6.01, 6);

    // Beyond the ends the distance is to the endpoint, not to the infinite line.
    expect(distanceToPolyline(segment, { x: -3, y: 4 }, 6)).toBeCloseTo(5, 6);

    // Several segments: the nearest one counts.
    const bent: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline(bent, { x: 105, y: 60 }, 6)).toBeCloseTo(5, 6);

    // A degenerate line is a point; no line at all is unreachable.
    expect(distanceToPolyline([{ x: 10, y: 10 }], { x: 13, y: 14 }, 6)).toBeCloseTo(5, 6);
    expect(distanceToPolyline([], { x: 0, y: 0 }, 6)).toBe(Infinity);
  });

  it("connectorBBox is the line's box, widened by the arrowhead so a flat arrow has a box", () => {
    const flat = connectorBBox({ x: 100, y: 50 }, { x: 250, y: 50 });
    expect(flat.x).toBeCloseTo(100 - PAD, 6);
    expect(flat.width).toBeCloseTo(150 + 2 * PAD, 6);
    expect(flat.height).toBeCloseTo(2 * PAD, 6);

    const vertical = connectorBBox({ x: 50, y: 100 }, { x: 50, y: 0 });
    expect(vertical.x).toBeCloseTo(50 - PAD, 6);
    expect(vertical.y).toBeCloseTo(-PAD, 6);
    expect(vertical.width).toBeCloseTo(2 * PAD, 6);
    expect(vertical.height).toBeCloseTo(100 + 2 * PAD, 6);

    // The box always contains both ends, whichever way the arrow points.
    for (const [from, to] of [
      [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      [{ x: 10, y: 10 }, { x: 0, y: 0 }],
      [{ x: -40, y: 20 }, { x: 40, y: -20 }],
    ] as [Point, Point][]) {
      const box = connectorBBox(from, to);
      for (const point of [from, to]) {
        expect(point.x).toBeGreaterThanOrEqual(box.x);
        expect(point.x).toBeLessThanOrEqual(box.x + box.width);
        expect(point.y).toBeGreaterThanOrEqual(box.y);
        expect(point.y).toBeLessThanOrEqual(box.y + box.height);
      }
    }
  });

  it("the sides are checked in the documented order, so a tie is decided without measuring the line", () => {
    expect(SIDES).toEqual(["left", "right", "top", "bottom"]);
    const square: Rect = { x: 0, y: 0, width: 100, height: 100 };
    // Up-left on the diagonal: the left and top midpoints tie, and left comes first.
    expect(nearestSide(square, { x: -100, y: -100, width: 100, height: 100 })).toBe("left");
    // Up-right on the diagonal: right ties with top, and right comes first.
    expect(nearestSide(square, { x: 100, y: -100, width: 100, height: 100 })).toBe("right");
  });
});
