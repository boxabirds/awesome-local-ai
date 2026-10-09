import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import { objectSnapshots, resizeObjects } from '../../src/shared/board-model';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import type { Point } from '../../src/shared/geometry';
import {
  createStroke,
  isStrokeSnapshot,
  readStroke,
  scaledPoints,
  STROKE_TYPE,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP, LONG_SPIRAL, UNDERLINE } from '../fixtures/pen-paths';

/**
 * Story 11, `stroke.model` (TC-01 to TC-08): the geometry a freehand line goes through before
 * it becomes a board object, and the object itself.
 *
 * All of it is deterministic maths on a real document, so it is tested here rather than through
 * a browser: simplifying a recorded loop at a given tolerance, splitting a long run of points at
 * the limit, scaling a stroke's points when its box changed, and the distance a click may be
 * from a line and still be a click on it.
 */

const BY = 'tester';

/** Every number in an SVG path, in order, so a path can be read back as coordinates. */
function numbersIn(path: string): number[] {
  return path
    .split(/[MQL\s,]+/)
    .filter((token) => token.length > 0)
    .map(Number);
}

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

/** How many updates this call made to the document — a rejected stroke must make none. */
function updatesMade(run: () => void): number {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return count;
}

function draw(
  points: readonly Point[],
  opts: { color?: PenColor; thickness?: PenThickness } = {},
): string | null {
  return createStroke(
    doc,
    { points, color: opts.color ?? DEFAULT_PEN_COLOR, thickness: opts.thickness ?? DEFAULT_PEN_THICKNESS },
    BY,
  );
}

/** The stroke in the document, read back the way the board reads it. */
function strokeOf(id: string): StrokeSnap {
  const found = objectSnapshots(doc).find((object) => object.id === id);
  if (!found || !isStrokeSnapshot(found)) throw new Error(`no stroke ${id} in the document`);
  return found;
}

function strokes(): StrokeSnap[] {
  return objectSnapshots(doc).filter(isStrokeSnapshot);
}

/** Every raw point, and how far the nearest point of `path` is from it. */
function maxDeviation(points: readonly Point[], path: readonly Point[]): number {
  return Math.max(...points.map((point) => distanceToPolyline(path, point)));
}

describe('simplifying a stroke (TC-01, TC-02)', () => {
  it('TC-01: a recorded loop simplified at tolerance 1 keeps every point within 1 unit and fewer of them', () => {
    const result = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(result.length).toBeGreaterThan(2);
    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(maxDeviation(HANDWRITTEN_LOOP, result)).toBeLessThanOrEqual(
      STROKE_SIMPLIFY_TOLERANCE_PX + 1e-9,
    );
    // The first and last points are the ones the pointer actually visited.
    expect(result[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(result[result.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);
  });

  it('TC-02: at 200% zoom the tolerance is halved, and every point is still within it', () => {
    const zoom = 2;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const result = simplify(UNDERLINE, tolerance);
    expect(result.length).toBeLessThan(UNDERLINE.length);
    expect(maxDeviation(UNDERLINE, result)).toBeLessThanOrEqual(tolerance + 1e-9);
    // A tighter tolerance keeps at least as many points as a looser one.
    expect(result.length).toBeGreaterThanOrEqual(simplify(UNDERLINE, STROKE_SIMPLIFY_TOLERANCE_PX).length);
  });

  it('a point, a pair and an empty run come back as they went in', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    expect(simplify([{ x: 0, y: 0 }, { x: 10, y: 10 }], 1)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('a straight run of 5,000 points does not overflow the stack, and comes back as two points', () => {
    const straight: Point[] = Array.from({ length: STROKE_MAX_POINTS }, (_, index) => ({
      x: index,
      y: index * 0.001, // inside 1 unit of the line from start to end
    }));
    const result = simplify(straight, 1);
    expect(result.length).toBe(2);
    expect(maxDeviation(straight, result)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('splitting a long stroke (TC-03)', () => {
  const points = LONG_SPIRAL;

  it('TC-03: the point limit minus one, exactly and plus one make 1, 1 and 2 parts', () => {
    const under = points.slice(0, STROKE_MAX_POINTS - 1);
    const exact = points.slice(0, STROKE_MAX_POINTS);
    const over = points.slice(0, STROKE_MAX_POINTS + 1);

    expect(splitPoints(under)).toHaveLength(1);
    expect(splitPoints(exact)).toHaveLength(1);
    const parts = splitPoints(over);
    expect(parts).toHaveLength(2);
    // The part limit is honoured, and part 2 begins where part 1 ended — that shared point is
    // what makes two consecutive strokes join with no gap (pen.long_stroke).
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    expect(parts[1]).toHaveLength(2);
    expect(splitPoints(under)[0]).toHaveLength(STROKE_MAX_POINTS - 1);
    expect(splitPoints(exact)[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('nothing to split comes back as no parts, and a short run as one', () => {
    expect(splitPoints([])).toEqual([]);
    expect(splitPoints([{ x: 0, y: 0 }])).toEqual([[{ x: 0, y: 0 }]]);
  });
});

describe('drawing a stroke (TC-04, TC-05)', () => {
  it('TC-04: a single point becomes a round dot whose box is the thickness square', () => {
    const thickness = PEN_THICKNESS_WORLD.thick;
    const id = draw([{ x: 40, y: 60 }], { thickness: 'thick' });
    expect(id).not.toBeNull();
    const stroke = strokeOf(id!);
    expect(stroke.type).toBe(STROKE_TYPE);
    expect([stroke.width, stroke.height]).toEqual([thickness, thickness]);
    expect([stroke.x, stroke.y]).toEqual([40 - thickness / 2, 60 - thickness / 2]);
    expect(stroke.points).toHaveLength(2);
    // The one point sits in the middle of its box, so the dot is centred where it was clicked.
    const [px, py] = stroke.points;
    expect([px, py]).toEqual([thickness / 2, thickness / 2]);
    expect(stroke.baseWidth).toBe(thickness);
    expect(stroke.baseHeight).toBe(thickness);
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe('thick');
    expect(scaledPoints(stroke)).toEqual([{ x: 40, y: 60 }]);
  });

  it('a drag becomes one stroke whose box is the path padded by half its thickness', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 30, y: 20 },
      { x: 50, y: 40 },
    ];
    const id = draw(points, { color: 'red', thickness: 'thin' });
    const stroke = strokeOf(id!);
    const half = PEN_THICKNESS_WORLD.thin / 2;
    expect([stroke.x, stroke.y]).toEqual([10 - half, 10 - half]);
    expect([stroke.width, stroke.height]).toEqual([40 + PEN_THICKNESS_WORLD.thin, 30 + PEN_THICKNESS_WORLD.thin]);
    expect(stroke.baseWidth).toBe(stroke.width);
    expect(stroke.baseHeight).toBe(stroke.height);
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thin');
    // The points are relative to the box origin, in the order they were drawn.
    expect(stroke.points).toEqual([10 - stroke.x, 10 - stroke.y, 30 - stroke.x, 20 - stroke.y, 50 - stroke.x, 40 - stroke.y]);
    expect(scaledPoints(stroke)).toEqual(points);
    expect(stroke.createdBy).toBe(BY);
  });

  it('TC-05: no points, a NaN point, an unknown colour or an unknown thickness make nothing', () => {
    const cases: Array<[string, () => string | null]> = [
      ['no points', () => draw([])],
      ['a NaN point', () => draw([{ x: Number.NaN, y: 1 }, { x: 2, y: 3 }])],
      ['an infinite point', () => draw([{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 3 }])],
      ['a colour that is not one', () => draw([{ x: 0, y: 0 }], { color: 'pink' as PenColor })],
      ['a thickness that is not one', () => draw([{ x: 0, y: 0 }], { thickness: 'huge' as PenThickness })],
      ['no points at all', () => createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, BY)],
    ];
    for (const [what, run] of cases) {
      let result: string | null = 'not run';
      const updates = updatesMade(() => {
        result = run();
      });
      expect(result, what).toBeNull();
      expect(updates, what).toBe(0);
    }
    expect(strokes()).toHaveLength(0);
  });

  it('every colour and thickness the settings name is accepted, and the palette is the six the toolbar shows', () => {
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toEqual(['thin', 'medium', 'thick']);
    let index = 0;
    for (const color of Object.keys(PEN_COLORS) as PenColor[]) {
      for (const thickness of Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]) {
        const id = draw([{ x: index * 40, y: 0 }, { x: index * 40 + 20, y: 10 }], { color, thickness });
        const stroke = strokeOf(id!);
        expect(stroke.color).toBe(color);
        expect(stroke.thickness).toBe(thickness);
        index += 1;
      }
    }
    expect(strokes()).toHaveLength(18);
  });

  it('a new stroke is on top of everything, so it is drawn over what was already there', () => {
    const first = draw([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const second = draw([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(strokeOf(second!).z).toBeGreaterThan(strokeOf(first!).z);
  });
});

describe('scaling a stroke (TC-06)', () => {
  const points = [
    { x: 20, y: 30 },
    { x: 60, y: 34 },
    { x: 120, y: 90 },
    { x: 100, y: 120 },
  ];

  it('TC-06: doubling the box doubles the drawn line and leaves the thickness alone', () => {
    const id = draw(points, { thickness: 'thick' });
    const before = strokeOf(id!);
    const beforePoints = scaledPoints(before);
    const rects = new Map([[id!, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]);
    expect(resizeObjects(doc, rects)).toBe(1);
    const after = strokeOf(id!);

    expect(after.width).toBeCloseTo(before.width * 2, 6);
    // Thickness is a property of the line, not of its box, so a resized stroke keeps it (pen.resize).
    expect(after.thickness).toBe(before.thickness);
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);

    const afterPoints = scaledPoints(after);
    expect(afterPoints).toHaveLength(beforePoints.length);
    // Every distance between two points of the line has doubled, whichever way round the
    // measurement is taken — which is what "in proportion" means for a freehand path.
    for (let index = 0; index < afterPoints.length; index += 1) {
      expect(afterPoints[index].x - afterPoints[0].x).toBeCloseTo(
        (beforePoints[index].x - beforePoints[0].x) * 2,
        6,
      );
      expect(afterPoints[index].y - afterPoints[0].y).toBeCloseTo(
        (beforePoints[index].y - beforePoints[0].y) * 2,
        6,
      );
    }
    // And the ratio of the box survives a proportional resize.
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 6);
  });

  it('a stroke that has not been resized scales by exactly one', () => {
    const id = draw(points);
    expect(scaledPoints(strokeOf(id!))).toEqual(points);
  });

  it('the smallest box a stroke may be resized to is a named setting', () => {
    expect(STROKE_MIN_SIZE_WORLD).toBeGreaterThan(0);
  });
});

describe('clicking near a stroke (TC-07)', () => {
  // A straight horizontal line, so "how far above the line" is exactly how far from it.
  const points = [
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 200, y: 100 },
  ];

  /** A point on the line at `x = 150`, `units` board units above it. */
  function aboveLine(units: number): Point {
    return { x: 150, y: 100 - units };
  }

  it('TC-07: 0, 5.9 and 6.1 units from the line are within, within and outside the tolerance at zoom 1', () => {
    const id = draw(points);
    const stroke = strokeOf(id!);
    const zoom = 1;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[stroke.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX);

    for (const [units, within] of [
      [0, true],
      [5.9, true],
      [6.1, false],
    ] as const) {
      const distance = distanceToPolyline(scaledPoints(stroke), aboveLine(units));
      expect(distance, `${units} units`).toBeCloseTo(units, 6);
      expect(distance <= tolerance, `${units} units within ${tolerance}`).toBe(within);
    }
  });

  it('a dot is clicked by how close the pointer came to it', () => {
    const id = draw([{ x: 40, y: 40 }], { thickness: 'thick' });
    const stroke = strokeOf(id!);
    expect(distanceToPolyline(scaledPoints(stroke), { x: 40, y: 40 })).toBe(0);
    expect(distanceToPolyline(scaledPoints(stroke), { x: 40 + 8, y: 40 })).toBeCloseTo(8, 6);
  });
});

describe('the stroke path (TC-08)', () => {
  it('TC-08: three points become a path that starts at M and curves through Q segments', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const path = smoothPath(points);
    const again = smoothPath(points);
    expect(path).toBe(again);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    // Each curve's control point is the recorded point and its end the middle of the segment
    // after it, which is what keeps the rendered line inside the hull of what was drawn.
    expect(path).toMatch(/Q 10 10 15 5/);
    expect(path.trim().endsWith('L 20 0')).toBe(true);
    expect(numbersIn(path)).toEqual([0, 0, 10, 10, 15, 5, 20, 0]);
  });

  it('a single point is a zero-length path, which a round line cap turns into a dot', () => {
    expect(smoothPath([{ x: 5, y: 6 }])).toBe('M 5 6');
  });

  it('no points at all is no path', () => {
    expect(smoothPath([])).toBe('');
  });

  it('the recorded loop and the underline both produce a path that starts and ends on them', () => {
    for (const points of [HANDWRITTEN_LOOP, UNDERLINE]) {
      const path = smoothPath(points);
      const numbers = numbersIn(path);
      const start = points[0];
      const end = points[points.length - 1];
      expect(numbers.slice(0, 2), 'the first pair').toEqual([start.x, start.y]);
      expect(numbers.slice(-2), 'the last pair').toEqual([end.x, end.y]);
      // A curve per pair of points, and the path is a lot of them.
      expect((path.match(/Q/g) ?? []).length).toBeGreaterThan(100);
    }
  });
});

describe('the stroke snapshot', () => {
  it('a stroke reads back through the same document the board renders', () => {
    const id = draw(UNDERLINE, { color: 'green', thickness: 'thin' });
    const throughRead = readStroke(doc, id!);
    const throughSnapshots = strokes();
    expect(throughRead).toEqual(strokeOf(id!));
    expect(throughSnapshots).toHaveLength(1);
    expect(throughSnapshots[0]?.id).toBe(id);
    expect(throughSnapshots[0]?.points.length).toBe(UNDERLINE.length * 2);
  });

  it('the settings the story names are all there, with the defaults the PRD says', () => {
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_MAX_POINTS).toBe(5_000);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
    expect(PEN_COLORS.black).toBe('#212121');
    expect(PEN_THICKNESS_WORLD).toEqual({ thin: 2, medium: 4, thick: 8 });
  });
});
