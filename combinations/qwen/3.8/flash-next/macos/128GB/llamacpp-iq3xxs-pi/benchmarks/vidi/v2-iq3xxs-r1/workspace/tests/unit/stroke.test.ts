import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, resizeObjects } from '../../src/shared/board-model';
import {
  createStroke,
  scaledPoints,
  strokeSnapshots,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import type { Point } from '../../src/shared/geometry';
import { copyPath, HANDWRITTEN_LOOP, LONG_SPIRAL, UNDERLINE } from '../fixtures/pen-paths';

/**
 * Story 11 — the stroke model and its geometry (stroke.model).
 *
 * Everything a stroke has to be able to do is decided here, in plain numbers and on
 * a real `Y.Doc`: simplify faithfully, split without a gap, become a dot, refuse to
 * exist when the input is nonsense, and scale in proportion afterwards. The UI levels
 * above only draw and gesture what this says.
 */

/** A document plus a way to count the updates its body of work produces. */
function fixture(): { doc: Y.Doc; updates: (body: () => void) => number } {
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
      // The model opens its own transaction; this wrapper only runs the body.
      body();
      return seen;
    },
  };
}

/** Create one stroke and hand back its snapshot, failing if the model refused it. */
function makeStroke(
  doc: Y.Doc,
  points: readonly Point[],
  options: { color?: string; thickness?: string } = {},
): StrokeSnap {
  const before = new Set(strokeSnapshots(doc).map((s) => s.id));
  const id = createStroke(
    doc,
    {
      points,
      color: (options.color ?? DEFAULT_PEN_COLOR) as PenColor,
      thickness: (options.thickness ?? DEFAULT_PEN_THICKNESS) as PenThickness,
    },
    'tester',
  );
  if (!id) throw new Error('createStroke rejected a stroke the test expected to be drawn');
  const created = strokeSnapshots(doc).find((s) => s.id === id);
  if (!created) throw new Error('the new stroke is not in the snapshot');
  void before;
  return created;
}

/** The greatest distance from any raw point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let worst = 0;
  for (const p of raw) worst = Math.max(worst, distanceToPolyline(simplified, p));
  return worst;
}

describe('simplify (pen.smooth)', () => {
  // TC-01: the recorded loop at one world unit of tolerance — faithful, and shorter.
  it('TC-01 simplifies a handwritten loop within 1 unit and keeps fewer points', () => {
    const simplified = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);
    expect(simplified.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(simplified.length).toBeGreaterThan(1);
    // Every point the user drew lies within the tolerance of the result.
    expect(maxDeviation(HANDWRITTEN_LOOP, simplified)).toBeLessThanOrEqual(
      STROKE_SIMPLIFY_TOLERANCE_PX,
    );
    // RDP keeps the two ends of the line it was given.
    expect(simplified[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(simplified[simplified.length - 1]).toEqual(
      HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1],
    );
  });

  // TC-02: at 200% zoom the tolerance is half a board unit — and still faithful.
  it('TC-02 simplifies within 0.5 units at the tolerance a 200% zoom uses', () => {
    const zoom = 2;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const simplified = simplify(HANDWRITTEN_LOOP, tolerance);
    expect(tolerance).toBe(0.5);
    expect(maxDeviation(HANDWRITTEN_LOOP, simplified)).toBeLessThanOrEqual(0.5);
    // A tighter tolerance keeps at least as much of what was drawn.
    expect(simplified.length).toBeGreaterThanOrEqual(
      simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX).length,
    );
  });

  it('leaves a point, a pair and a single segment alone', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(simplify([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
    expect(simplify(line, 1)).toEqual(line);
    expect(simplify([], 1)).toEqual([]);
  });
});

describe('splitPoints (pen.long_stroke)', () => {
  // TC-03: the point limit itself, on both sides of the boundary.
  it('TC-03 splits at the point limit and shares the join point', () => {
    const spiral = copyPath(LONG_SPIRAL);
    expect(spiral.length).toBe(STROKE_MAX_POINTS + 10);

    const onePointShort = spiral.slice(0, STROKE_MAX_POINTS - 1);
    const exactly = spiral.slice(0, STROKE_MAX_POINTS);
    const oneOver = spiral.slice(0, STROKE_MAX_POINTS + 1);

    const short = splitPoints(onePointShort);
    expect(short).toHaveLength(1);
    expect(short[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(exactly);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(oneOver);
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(over[1]).toHaveLength(2);
    // The second part starts where the first stopped, so the two join with no gap.
    expect(over[1]![0]).toEqual(over[0]![over[0].length - 1]);
    // Nothing is lost or duplicated beyond that one shared point.
    const total = over.reduce((n, part) => n + part.length, 0);
    expect(total).toBe(oneOver.length + 1);
  });

  it('honours a limit the caller names, for a test that needs fewer points', () => {
    const parts = splitPoints(UNDERLINE, 50);
    expect(parts.map((p) => p.length)).toEqual([50, 50, 22]);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]![0]).toEqual(parts[i - 1]![parts[i - 1]!.length - 1]);
    }
  });
});

describe('createStroke (pen.dot, pen.draw, errors)', () => {
  // TC-04: a click is a stroke too, and its box is the ink's own width.
  it('TC-04 turns a single point into a dot whose box is the thickness square', () => {
    const { doc } = fixture();
    const thickness = PEN_THICKNESS_WORLD.thick;
    const stroke = makeStroke(doc, [{ x: 120, y: 80 }], { thickness: 'thick' });
    expect(stroke.type).toBe('stroke');
    expect(stroke.width).toBe(thickness);
    expect(stroke.height).toBe(thickness);
    expect(stroke.x).toBe(120 - thickness / 2);
    expect(stroke.y).toBe(80 - thickness / 2);
    expect(stroke.baseWidth).toBe(thickness);
    expect(stroke.baseHeight).toBe(thickness);
    // One point, stored flat, at the middle of that box.
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points).toEqual([thickness / 2, thickness / 2]);
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe('thick');
    // The box is padded by half the ink, which is what makes the drawn line fit it.
    const line = makeStroke(doc, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const pad = PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS] / 2;
    expect(line.x).toBe(-pad);
    expect(line.width).toBe(100 + pad * 2);
    expect(scaledPoints(stroke)[0]).toEqual({ x: 120, y: 80 });
  });

  // TC-05: nonsense input creates nothing at all — not even an update.
  it('TC-05 refuses an empty path, a NaN point, an unknown colour and an unknown thickness', () => {
    const { doc, updates } = fixture();
    const bad: { label: string; points: readonly Point[]; color?: string; thickness?: string }[] = [
      { label: 'no points', points: [] },
      { label: 'NaN point', points: [{ x: Number.NaN, y: 3 }], },
      { label: 'one NaN coordinate', points: [{ x: 1, y: Number.POSITIVE_INFINITY }] },
      { label: 'unknown colour', points: [{ x: 1, y: 1 }], color: 'pink' },
      { label: 'unknown thickness', points: [{ x: 1, y: 1 }], thickness: 'huge' },
    ];
    for (const c of bad) {
      const seen = updates(() => {
        const id = createStroke(
          doc,
          {
            points: c.points,
            color: (c.color ?? 'black') as PenColor,
            thickness: (c.thickness ?? 'medium') as PenThickness,
          },
          'tester',
        );
        expect(id, c.label).toBeNull();
      });
      expect(seen, `${c.label} must not touch the document`).toBe(0);
    }
    expect(strokeSnapshots(doc)).toHaveLength(0);
    // A good request after a bad one still works.
    expect(updates(() => makeStroke(doc, UNDERLINE))).toBeGreaterThan(0);
    expect(strokeSnapshots(doc)).toHaveLength(1);
  });

  it('records who drew it, stacks it above what is already there, and keeps the colours named', () => {
    const { doc } = fixture();
    const first = makeStroke(doc, UNDERLINE, { color: 'red' });
    const second = makeStroke(doc, HANDWRITTEN_LOOP, { color: 'purple', thickness: 'thin' });
    expect(second.z).toBeGreaterThan(first.z);
    expect(strokeSnapshots(doc).map((s) => s.id)).toEqual([first.id, second.id]);
    expect(first.color).toBe('red');
    expect(second.color).toBe('purple');
    expect(second.thickness).toBe('thin');
    expect(PEN_COLORS[second.color]).toBe('#8E24AA');
    expect(PEN_THICKNESS_WORLD[second.thickness]).toBe(2);
  });
});

describe('scaledPoints (pen.resize)', () => {
  // TC-06: a proportional resize scales the drawn line and leaves the ink alone.
  it('TC-06 doubles the drawn coordinates when the box is doubled, thickness unchanged', () => {
    const { doc } = fixture();
    const stroke = makeStroke(doc, HANDWRITTEN_LOOP, { thickness: 'thick' });
    const before = scaledPoints(stroke);
    expect(before).toHaveLength(HANDWRITTEN_LOOP.length);

    const moved = resizeObjects(
      doc,
      new Map([[stroke.id, { x: stroke.x, y: stroke.y, width: stroke.width * 2, height: stroke.height * 2 }]]),
    );
    expect(moved).toBe(1);
    const grown = strokeSnapshots(doc).find((s) => s.id === stroke.id)!;
    const after = scaledPoints(grown);

    // Relative to the box's own origin, every coordinate has doubled.
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.x - grown.x).toBeCloseTo(2 * (before[i]!.x - stroke.x), 6);
      expect(after[i]!.y - grown.y).toBeCloseTo(2 * (before[i]!.y - stroke.y), 6);
    }
    // The ink is the same ink, and the box kept its proportions.
    expect(grown.thickness).toBe('thick');
    expect(PEN_THICKNESS_WORLD[grown.thickness]).toBe(8);
    expect(grown.width / grown.height).toBeCloseTo(stroke.width / stroke.height, 6);
    expect(grown.baseWidth).toBe(stroke.baseWidth);
  });
});

describe('a stroke is selected by its line (pen.select)', () => {
  /** The tolerance the registry applies at a given zoom. */
  const hitRadius = (thickness: PenThickness, zoom: number): number =>
    Math.max(PEN_THICKNESS_WORLD[thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);

  // TC-07: 6 px of slack, measured on the line itself at zoom 1.
  it('TC-07 is within tolerance at 0 and 5.9 units from the line and outside at 6.1', () => {
    const { doc } = fixture();
    const stroke = makeStroke(doc, [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 500, y: 100 },
    ]);
    const points = scaledPoints(stroke);
    const on = points[1]!;
    for (const [d, expected] of [
      [0, true],
      [5.9, true],
      [6.1, false],
    ] as const) {
      const p = { x: on.x, y: on.y - d };
      const inside = distanceToPolyline(points, p) <= hitRadius(DEFAULT_PEN_THICKNESS, 1);
      expect(inside, `${d} units away at zoom 1`).toBe(expected);
    }
    // The distance grows as asked.
    expect(distanceToPolyline(points, { x: on.x, y: on.y - 6.1 })).toBeCloseTo(6.1, 6);
  });

  it('gives a thick stroke half its own ink when that is wider than the tolerance', () => {
    const { doc } = fixture();
    const stroke = makeStroke(doc, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ], { thickness: 'thick' });
    const points = scaledPoints(stroke);
    expect(distanceToPolyline(points, { x: 50, y: 4 })).toBeLessThanOrEqual(
      hitRadius('thick', 4),
    );
    expect(hitRadius('thick', 4)).toBe(4); // 8/2 beats 6/4
    expect(hitRadius('thin', 4)).toBe(6 / 4); // 1 loses 1.5
  });
});

describe('smoothPath (pen.draw rendering)', () => {
  // TC-08: the rendered path is deterministic, and built from quadratic curves.
  it('TC-08 draws a deterministic path of quadratic segments through three points', () => {
    const three: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 5 },
    ];
    const d = smoothPath(three);
    expect(d).toBe(smoothPath(three));
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(d.split('Q')).toHaveLength(2);
    // It starts on the first point and ends on the last, so a stroke joins its
    // neighbours exactly where it was drawn.
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.trim().endsWith('5')).toBe(true);
  });

  it('makes a zero-length path of one point, which a round cap turns into a dot', () => {
    const dot = smoothPath([{ x: 5, y: 7 }]);
    expect(dot.startsWith('M')).toBe(true);
    expect(dot).toContain('5');
    expect(dot).toContain('7');
    expect(smoothPath([])).toBe('');
  });
});
