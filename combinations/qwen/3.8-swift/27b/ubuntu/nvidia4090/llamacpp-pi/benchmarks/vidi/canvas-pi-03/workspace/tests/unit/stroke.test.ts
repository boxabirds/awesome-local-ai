/**
 * Story 11 unit tests — stroke.model (TC-01 to TC-08): the pure geometry
 * (simplify, splitPoints, smoothPath) and the stroke model on a real Y.Doc
 * (createStroke, scaledPoints, hit distance via distanceToPolyline).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from 'src/shared/geometry/simplify';
import { createStroke, scaledPoints, getStroke } from 'src/shared/objects/stroke';
import { distanceToPolyline } from 'src/shared/geometry/polyline';
import { resizeObjects } from 'src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from 'src/shared/config';
import type { Point } from 'src/shared/geometry';
import { handwrittenLoop } from '../fixtures/pen-paths';

/** The maximum distance of any RAW point to the simplified polyline. */
function maxDeviation(raw: readonly Point[], simplified: readonly Point[]): number {
  let max = 0;
  for (const p of raw) max = Math.max(max, distanceToPolyline(simplified, p));
  return max;
}

describe('stroke.model: simplify (pen.smooth)', () => {
  it('TC-01: the handwritten loop at tolerance 1 → every raw point within 1 unit, fewer points', () => {
    const out = simplify(handwrittenLoop, 1);
    expect(out.length).toBeLessThan(handwrittenLoop.length);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(maxDeviation(handwrittenLoop, out)).toBeLessThanOrEqual(1);
    // First and last are kept.
    expect(out[0]).toEqual(handwrittenLoop[0]);
    expect(out[out.length - 1]).toEqual(handwrittenLoop[handwrittenLoop.length - 1]);
  });

  it('TC-02: at 200% zoom (tolerance 1/2 = 0.5) → every raw point within 0.5 units', () => {
    const out = simplify(handwrittenLoop, 0.5);
    expect(maxDeviation(handwrittenLoop, out)).toBeLessThanOrEqual(0.5);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('stroke.model: splitPoints (pen.long_stroke)', () => {
  const spiral = Array.from({ length: STROKE_MAX_POINTS + 10 }, (_, i) => ({
    x: i,
    y: Math.sin(i / 10),
  }));

  it('TC-03: STROKE_MAX_POINTS - 1 / exactly / + 1 → 1 / 1 / 2 parts; part 2 starts at the join point (boundary)', () => {
    const one = splitPoints(spiral.slice(0, STROKE_MAX_POINTS - 1));
    expect(one).toHaveLength(1);
    expect(one[0]).toHaveLength(STROKE_MAX_POINTS - 1);

    const exact = splitPoints(spiral.slice(0, STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(spiral);
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    // The parts share the join point: part 2 starts with part 1's last point.
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
    // Together they cover every raw point exactly (no gaps, no skips).
    const joined = [...over[0], ...over[1].slice(1)];
    expect(joined).toEqual(spiral);
  });
});

describe('stroke.model: createStroke (pen.dot, error paths)', () => {
  it('TC-04: a single point with thickness thick → bbox is a thickness square, points length 2', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' }, 'test');
    expect(id).not.toBeNull();
    const s = getStroke(doc, id!);
    expect(s).toBeDefined();
    const t = PEN_THICKNESS_WORLD.thick;
    expect(s!.x).toBe(10 - t / 2);
    expect(s!.y).toBe(20 - t / 2);
    expect(s!.width).toBe(t);
    expect(s!.height).toBe(t);
    expect(s!.baseWidth).toBe(t);
    expect(s!.baseHeight).toBe(t);
    // One point flattened → two numbers.
    expect(s!.points).toHaveLength(2);
    expect(scaledPoints(s!)).toEqual([{ x: 10, y: 20 }]);
    expect(s!.color).toBe('black');
    expect(s!.thickness).toBe('thick');
  });

  it('TC-05: empty points, a NaN point, colour "pink", thickness "huge" → null and zero doc updates (negative)', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => updates++);

    expect(
      createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, {
        points: [{ x: 0, y: 0 }, { x: NaN, y: 0 }],
        color: 'black',
        thickness: 'medium',
      }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as never, thickness: 'medium' }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, {
        points: [{ x: 0, y: 0 }],
        color: 'black',
        thickness: 'huge' as never,
      }, 'test'),
    ).toBeNull();

    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('stroke.model: scaledPoints (pen.resize)', () => {
  it('TC-06: after width and height are doubled → coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    // The line starts at (2,2) so the thickness-padded bbox origin is
    // exactly (0,0): doubling the bbox from that origin doubles every line
    // point about the world origin.
    const id = createStroke(
      doc,
      {
        points: [
          { x: 2, y: 2 },
          { x: 102, y: 2 },
          { x: 102, y: 102 },
        ],
        color: 'blue',
        thickness: 'medium',
      },
      'test',
    );
    const before = getStroke(doc, id!);
    expect(before!.x).toBe(0);
    expect(before!.y).toBe(0);
    const ptsBefore = scaledPoints(before!);
    expect(ptsBefore).toHaveLength(3);

    // Double the bbox (same origin → uniform scale 2), as the story 7
    // aspect-locked resize does.
    resizeObjects(doc, new Map([[id!, { x: before!.x, y: before!.y, width: before!.width! * 2, height: before!.height! * 2 }]]));
    const after = getStroke(doc, id!);
    const ptsAfter = scaledPoints(after!);
    ptsBefore.forEach((p, i) => {
      expect(ptsAfter[i].x).toBeCloseTo(p.x * 2, 10);
      expect(ptsAfter[i].y).toBeCloseTo(p.y * 2, 10);
    });
    // The thickness is not scaled.
    expect(after!.thickness).toBe('medium');
    expect(after!.baseWidth).toBe(before!.baseWidth);
    expect(after!.baseHeight).toBe(before!.baseHeight);
  });
});

describe('stroke.model: hit distance (pen.select)', () => {
  it('TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside the tolerance at zoom 1', () => {
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'test',
    );
    const s = getStroke(doc, id!);
    const pts = scaledPoints(s!);
    const zoom = 1;
    const tolerance = Math.max(PEN_THICKNESS_WORLD[s!.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX); // max(2, 6)

    const hits = (dx: number) => distanceToPolyline(pts, { x: 50, y: dx }) <= tolerance;
    expect(hits(0)).toBe(true);
    expect(hits(5.9)).toBe(true);
    expect(hits(6.1)).toBe(false);
  });
});

describe('stroke.model: smoothPath (pen.draw, pen.dot)', () => {
  it('TC-08: 3 points → deterministic string starting with M and using Q segments, ending at the last point', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const a = smoothPath(pts);
    const b = smoothPath(pts);
    expect(a).toBe(b); // deterministic
    expect(a.startsWith('M')).toBe(true);
    expect(a).toContain('Q');
    expect(a).toContain('L 20 0'); // ends at the last point
  });

  it('a single point renders as a zero-length round-cap path at the point', () => {
    const d = smoothPath([{ x: 5, y: 7 }]);
    expect(d.startsWith('M 5 7')).toBe(true);
  });

  it('an empty point list renders as an empty path', () => {
    expect(smoothPath([])).toBe('');
  });
});
