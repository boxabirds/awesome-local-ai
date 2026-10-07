import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { resizeObjects, snapshot, type ObjectSnapshot } from "../../src/shared/board-model";
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from "../../src/shared/config";
import { distanceToPolyline } from "../../src/shared/geometry/connector-geometry";
import type { Point } from "../../src/shared/geometry";
import { simplify, smoothPath, splitPoints } from "../../src/shared/geometry/simplify";
import { createStroke, scaledPoints, type StrokeSnap } from "../../src/shared/objects/stroke";
import { handwrittenLoop, spiralPath, straightPath, underlinePath } from "../fixtures/pen-paths";

/**
 * Story 11, task 1 (TC-01 to TC-08) — the stroke model and its geometry.
 *
 * These are pure maths and one real Y.Doc: what a stroke stores, how a recorded
 * drag is simplified without moving the line more than a screen pixel, how a long
 * drag is split, and how a stroke scales when it is resized. Nothing here touches
 * the DOM, the tool or the network.
 */

/**
 * The exact distance from `point` to `polyline`, in board units.
 *
 * `distanceToPolyline` stops as soon as its tolerance is met, so measuring needs a
 * tolerance nothing can satisfy: -1 makes it walk every segment and report the
 * true nearest distance.
 */
function exactDistance(polyline: readonly Point[], point: Point): number {
  return distanceToPolyline(polyline, point, -1);
}

/** The worst distance from any raw point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  let worst = 0;
  for (const point of raw) {
    const distance = exactDistance(result, point);
    if (distance > worst) worst = distance;
  }
  return worst;
}

function strokeSnap(doc: Y.Doc, id: string): StrokeSnap {
  const object = snapshot(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`no object ${id} in the model`);
  return object as StrokeSnap;
}

/** Counts every Y.Doc update a call would put on the wire. */
function countUpdates(doc: Y.Doc, run: () => void): number {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on("update", observer);
  try {
    run();
  } finally {
    doc.off("update", observer);
  }
  return updates;
}

describe("stroke.model: smoothing (pen.smooth)", () => {
  it("TC-01 a handwritten loop simplified at tolerance 1 stays within 1 unit of what was drawn and gets shorter", () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);

    expect(raw.length).toBeGreaterThan(300);
    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    // RDP keeps the ends: the stroke starts and ends where the drag did.
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it("TC-01b an underline keeps its shape at tolerance 1", () => {
    const raw = underlinePath();
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
  });

  it("TC-02 the same drag at 200% zoom (tolerance 1/zoom = 0.5) stays within 0.5 units", () => {
    const zoom = 2;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const raw = handwrittenLoop();
    const result = simplify(raw, tolerance);

    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(tolerance);
  });

  it("simplify keeps a path that is already inside the tolerance and handles degenerate input", () => {
    // A straight drag needs only its two ends: everything between them is exactly
    // on the line the two ends draw.
    const line = straightPath();
    expect(simplify(line, 1)).toEqual([line[0], line[line.length - 1]]);
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    expect(simplify([{ x: 1, y: 2 }, { x: 5, y: 6 }], 1)).toEqual([{ x: 1, y: 2 }, { x: 5, y: 6 }]);
  });

  it("a 5,010-point spiral simplifies without recursion trouble and within tolerance", () => {
    const raw = spiralPath();
    const result = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(raw.length).toBe(STROKE_MAX_POINTS + 10);
    expect(result.length).toBeLessThan(raw.length);
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
  });
});

describe("stroke.model: splitting a long stroke (pen.long_stroke)", () => {
  it("TC-03 splitPoints at STROKE_MAX_POINTS - 1, exactly, and + 1 (boundary)", () => {
    const points = spiralPath(STROKE_MAX_POINTS + 1);

    const justUnder = splitPoints(points.slice(0, STROKE_MAX_POINTS - 1));
    expect(justUnder).toHaveLength(1);
    expect(justUnder[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exactly = splitPoints(points.slice(0, STROKE_MAX_POINTS));
    expect(exactly).toHaveLength(1);
    expect(exactly[0]).toHaveLength(STROKE_MAX_POINTS);

    const oneOver = splitPoints(points);
    expect(oneOver).toHaveLength(2);
    expect(oneOver[0]).toHaveLength(STROKE_MAX_POINTS);
    // The join point is shared, so the two strokes meet with no gap.
    expect(oneOver[1]![0]).toEqual(oneOver[0]![oneOver[0]!.length - 1]);
    const total = oneOver.reduce((sum, part) => sum + part.length, 0);
    expect(total).toBe(STROKE_MAX_POINTS + 2); // the join point counted twice
  });

  it("a limit given by the caller splits the same way, and empty input splits to nothing", () => {
    const points = straightPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    const parts = splitPoints(points, 4);
    expect(parts.map((part) => part.length)).toEqual([4, 4, 4]);
    expect(parts[1]![0]).toEqual(parts[0]![3]);
    expect(parts[2]![0]).toEqual(parts[1]![3]);
    expect(splitPoints([], 4)).toEqual([]);
  });
});

describe("stroke.model: a click draws a dot (pen.dot)", () => {
  it("TC-04 one point and 'thick' becomes a thickness-sized square holding one point", () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }], color: "black", thickness: "thick" }, "priya");
    expect(typeof id).toBe("string");
    if (typeof id !== "string") return;

    const stroke = strokeSnap(doc, id);
    const size = PEN_THICKNESS_WORLD.thick;
    expect(stroke.type).toBe("stroke");
    expect(stroke.x).toBe(100 - size / 2);
    expect(stroke.y).toBe(100 - size / 2);
    expect(stroke.width).toBe(size);
    expect(stroke.height).toBe(size);
    expect(stroke.baseWidth).toBe(size);
    expect(stroke.baseHeight).toBe(size);
    expect(stroke.points).toHaveLength(2);
    // The point sits in the middle of its own box.
    expect(stroke.points).toEqual([size / 2, size / 2]);
    expect(stroke.color).toBe("black");
    expect(stroke.thickness).toBe("thick");
    expect(stroke.createdBy).toBe("priya");
  });
});

describe("stroke.model: rejecting bad input (errors, negative)", () => {
  it("TC-05 empty points, a NaN point, an unknown colour and an unknown thickness are refused with no update", () => {
    const doc = new Y.Doc();
    const before = snapshot(doc).length;

    const updates = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [], color: "black", thickness: "medium" }, "priya")).toBeNull();
      expect(
        createStroke(doc, { points: [{ x: 10, y: Number.NaN }, { x: 20, y: 20 }], color: "black", thickness: "medium" }, "priya"),
      ).toBeNull();
      expect(createStroke(doc, { points: [{ x: 10, y: 10 }], color: "pink" as PenColor, thickness: "medium" }, "priya")).toBeNull();
      expect(createStroke(doc, { points: [{ x: 10, y: 10 }], color: "black", thickness: "huge" as PenThickness }, "priya")).toBeNull();
      expect(createStroke(doc, { points: [{ x: 10, y: Infinity }], color: "black", thickness: "medium" }, "priya")).toBeNull();
      // Not an array of points at all.
      expect(createStroke(doc, { points: [{ x: 10 } as Point], color: "black", thickness: "medium" }, "priya")).toBeNull();
    });

    expect(updates).toBe(0);
    expect(snapshot(doc).length).toBe(before);
  });
});

describe("stroke.model: scaling a resized stroke (pen.resize)", () => {
  /** A stroke whose box starts at the board origin, so scaling is easy to read. */
  function strokeAtOrigin(doc: Y.Doc): { id: string; stroke: StrokeSnap } {
    // The box is the path grown by half the thickness (and never less than half
    // the model minimum), so starting the path 2 units in starts the box at 0.
    const points = straightPath({ x: 2, y: 2 }, { x: 302, y: 2 }, 11);
    const id = createStroke(doc, { points, color: "black", thickness: "thin" }, "priya");
    if (typeof id !== "string") throw new Error("createStroke rejected a valid stroke");
    const stroke = strokeSnap(doc, id);
    expect(stroke.x).toBe(0);
    expect(stroke.y).toBe(0);
    return { id, stroke };
  }

  it("TC-06 doubling width and height doubles every stored coordinate and leaves the thickness alone", () => {
    const doc = new Y.Doc();
    const { id, stroke } = strokeAtOrigin(doc);
    const before = scaledPoints(stroke);

    const resized = resizeObjects(
      doc,
      new Map([[id, { x: 0, y: 0, width: stroke.width * 2, height: stroke.height * 2 }]]),
    );
    expect(resized).toBe(1);

    const grown = strokeSnap(doc, id);
    const after = scaledPoints(grown);
    expect(after).toHaveLength(before.length);
    before.forEach((point, index) => {
      const scaled = after[index]!;
      expect(scaled.x).toBeCloseTo(point.x * 2, 6);
      expect(scaled.y).toBeCloseTo(point.y * 2, 6);
    });
    expect(grown.thickness).toBe(stroke.thickness);
    // The stored points themselves never change: only the box does.
    expect(grown.points).toEqual(stroke.points);
    expect(grown.baseWidth).toBe(stroke.baseWidth);
    expect(grown.baseHeight).toBe(stroke.baseHeight);
  });

  it("a stroke that has not been resized scales by exactly 1", () => {
    const doc = new Y.Doc();
    const { stroke } = strokeAtOrigin(doc);
    const points = scaledPoints(stroke);
    expect(points[0]).toEqual({ x: 2, y: 2 });
    expect(points[points.length - 1]).toEqual({ x: 302, y: 2 });
  });
});

describe("stroke.model: selecting by the line (pen.select)", () => {
  /** The world polyline of a horizontal stroke drawn along y = 1. */
  function line(): { snap: StrokeSnap; points: Point[] } {
    const doc = new Y.Doc();
    const points = straightPath({ x: 1, y: 1 }, { x: 301, y: 1 }, 11);
    const id = createStroke(doc, { points, color: "black", thickness: "thin" }, "priya");
    if (typeof id !== "string") throw new Error("createStroke rejected a valid stroke");
    const snap = strokeSnap(doc, id);
    return { snap, points: scaledPoints(snap) };
  }

  function selectsWithin(snap: StrokeSnap, point: Point, zoom: number): boolean {
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[snap.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    return distanceToPolyline(scaledPoints(snap), point, tolerance) <= tolerance;
  }

  it("TC-07 0, 5.9 and 6.1 board units from the line at zoom 1 are within, within and outside the tolerance", () => {
    const { snap, points } = line();

    expect(distanceToPolyline(points, { x: 150, y: 1 }, -1)).toBeCloseTo(0, 6);
    expect(distanceToPolyline(points, { x: 150, y: 1 + 5.9 }, -1)).toBeCloseTo(5.9, 6);
    expect(distanceToPolyline(points, { x: 150, y: 1 + 6.1 }, -1)).toBeCloseTo(6.1, 6);

    expect(selectsWithin(snap, { x: 150, y: 1 }, 1)).toBe(true);
    expect(selectsWithin(snap, { x: 150, y: 1 + 5.9 }, 1)).toBe(true);
    expect(selectsWithin(snap, { x: 150, y: 1 + 6.1 }, 1)).toBe(false);
  });

  it("the tolerance follows the zoom, so a click aims at the same number of screen pixels", () => {
    const { snap } = line();
    // 6 screen pixels is 3 board units at 200%, so 3.1 units away is a miss there
    // while 2.9 units away is a hit.
    expect(selectsWithin(snap, { x: 150, y: 1 + 2.9 }, 2)).toBe(true);
    expect(selectsWithin(snap, { x: 150, y: 1 + 3.1 }, 2)).toBe(false);
  });

  it("inside the box but far from the line is not a hit (pen.select, pen.dot)", () => {
    // A V: its box is wide and tall, but the middle of the box is well away from
    // both arms.
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      { points: [{ x: 10, y: 10 }, { x: 60, y: 110 }, { x: 110, y: 10 }], color: "black", thickness: "thin" },
      "priya",
    );
    if (typeof id !== "string") throw new Error("createStroke rejected a valid stroke");
    const snap = strokeSnap(doc, id);
    const centre = { x: snap.x + snap.width / 2, y: snap.y + snap.height / 2 };
    expect(exactDistance(scaledPoints(snap), centre)).toBeGreaterThan(
      STROKE_HIT_TOLERANCE_PX,
    );
    expect(selectsWithin(snap, centre, 1)).toBe(false);
    // On one of the arms it is a hit.
    expect(selectsWithin(snap, { x: 35, y: 60 }, 1)).toBe(true);
  });

  it("a thick stroke is hit half its thickness away when that beats the pixel tolerance (zoom 4)", () => {
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      { points: straightPath({ x: 1, y: 1 }, { x: 101, y: 1 }, 5), color: "black", thickness: "thick" },
      "priya",
    );
    if (typeof id !== "string") throw new Error("createStroke rejected a valid stroke");
    const snap = strokeSnap(doc, id);
    // Half of 8 board units (4) beats 6 screen pixels / 4 zoom (1.5).
    expect(selectsWithin(snap, { x: 50, y: 1 + 4 }, 4)).toBe(true);
    expect(selectsWithin(snap, { x: 50, y: 1 + 4.1 }, 4)).toBe(false);
  });
});

describe("stroke.model: the rendered path (smoothPath)", () => {
  it("TC-08 three points give a deterministic path that starts with M and uses Q segments", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 4 },
    ];
    const path = smoothPath(points);
    expect(path).toBe(smoothPath(points));
    expect(path.startsWith("M")).toBe(true);
    expect(path).toContain("Q");
    // Every curve ends at the midpoint of the segment it is drawing towards, and
    // the path finishes on the last point.
    expect(path.endsWith("30 4")).toBe(true);
    expect(path).toContain("20 12");
  });

  it("a single point becomes a zero-length path (a round dot) and two points a straight line", () => {
    expect(smoothPath([{ x: 5, y: 7 }])).toBe("M 5 7 L 5 7");
    expect(smoothPath([{ x: 0, y: 0 }, { x: 4, y: 8 }])).toBe("M 0 0 L 4 8");
    expect(smoothPath([])).toBe("");
  });

  it("the smoothed curve stays inside the segments it replaces (pen.smooth)", () => {
    const raw = simplify(underlinePath(), STROKE_SIMPLIFY_TOLERANCE_PX);
    const path = smoothPath(raw);
    // The curves are built from the simplified points and the midpoints between
    // them, so they cannot wander outside the hull of what was drawn.
    const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const xs = raw.map((point) => point.x);
    const ys = raw.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    expect(numbers.length).toBeGreaterThan(0);
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      const x = numbers[index]!;
      const y = numbers[index + 1]!;
      expect(x).toBeGreaterThanOrEqual(minX - 0.001);
      expect(x).toBeLessThanOrEqual(maxX + 0.001);
      expect(y).toBeGreaterThanOrEqual(minY - 0.001);
      expect(y).toBeLessThanOrEqual(maxY + 0.001);
    }
  });
});

describe("stroke.model: a stroke in the board snapshot", () => {
  it("a created stroke reads back as a StrokeSnap through the shared snapshot", () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: underlinePath(), color: "red", thickness: "thick" }, "priya");
    if (typeof id !== "string") throw new Error("createStroke rejected a valid stroke");

    const objects: readonly ObjectSnapshot[] = snapshot(doc);
    expect(objects).toHaveLength(1);
    const stroke = objects[0] as StrokeSnap;
    expect(stroke.id).toBe(id);
    expect(stroke.type).toBe("stroke");
    expect(stroke.color).toBe("red");
    expect(stroke.thickness).toBe("thick");
    expect(stroke.width).toBeGreaterThan(300);
    expect(stroke.z).toBe(1);
    expect(Array.isArray(stroke.points)).toBe(true);
    // Every stored point lies inside its own box.
    for (let index = 0; index + 1 < stroke.points.length; index += 2) {
      expect(stroke.points[index]!).toBeGreaterThanOrEqual(0);
      expect(stroke.points[index]!).toBeLessThanOrEqual(stroke.baseWidth);
      expect(stroke.points[index + 1]!).toBeGreaterThanOrEqual(0);
      expect(stroke.points[index + 1]!).toBeLessThanOrEqual(stroke.baseHeight);
    }
  });

  it("the model knows a stroke's minimum size, so a resize below it is refused", () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: straightPath(), color: "black", thickness: "thin" }, "priya");
    if (typeof id !== "string") throw new Error("createStroke rejected a valid stroke");
    const updates = countUpdates(doc, () => {
      expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 2, height: 2 }]]))).toBe(0);
    });
    expect(updates).toBe(0);
  });
});
