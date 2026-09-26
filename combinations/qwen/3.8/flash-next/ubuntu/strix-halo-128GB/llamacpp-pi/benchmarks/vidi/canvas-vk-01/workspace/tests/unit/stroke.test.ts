import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { initDoc, registerBoardObjectType, objectSnapshots } from '../../src/shared/board-model';

registerBoardObjectType('stroke');
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline, spiral5010 } from '../fixtures/pen-paths';

/**
 * Story 11 unit tests: stroke model and geometry (TC-01 to TC-08).
 */

/** Maximum distance from any point in `raw` to the polyline through `result`. */
function maxDeviation(raw: readonly Point[], result: readonly Point[]): number {
  let max = 0;
  for (const p of raw) {
    const d = distanceToPolyline(result, p);
    if (d > max) max = d;
  }
  return max;
}

describe('TC-01: simplify handwritten loop at tolerance 1', () => {
  const raw = handwrittenLoop();
  const result = simplify(raw, 1);
  it('every raw point is within 1 unit of the result', () => {
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(1);
  });
  it('result has fewer points than the input', () => {
    expect(result.length).toBeLessThan(raw.length);
  });
  it('first and last points are preserved', () => {
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
  });
});

describe('TC-02: simplify with tolerance 0.5 (zoom 200%)', () => {
  const raw = handwrittenLoop();
  const result = simplify(raw, 0.5);
  it('every raw point is within 0.5 units', () => {
    expect(maxDeviation(raw, result)).toBeLessThanOrEqual(0.5);
  });
  it('result has fewer points than input', () => {
    expect(result.length).toBeLessThan(raw.length);
  });
});

describe('TC-03: splitPoints at STROKE_MAX_POINTS boundary', () => {
  const pts = spiral5010(); // 5010 points

  it('STROKE_MAX_POINTS - 1 points → 1 part', () => {
    const slice = pts.slice(0, STROKE_MAX_POINTS - 1);
    const parts = splitPoints(slice, STROKE_MAX_POINTS);
    expect(parts).toHaveLength(1);
  });

  it('exactly STROKE_MAX_POINTS points → 1 part', () => {
    const slice = pts.slice(0, STROKE_MAX_POINTS);
    const parts = splitPoints(slice, STROKE_MAX_POINTS);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
  });

  it('STROKE_MAX_POINTS + 1 points → 2 parts', () => {
    const slice = pts.slice(0, STROKE_MAX_POINTS + 1);
    const parts = splitPoints(slice, STROKE_MAX_POINTS);
    expect(parts).toHaveLength(2);
    // Part 2 starts with part 1's last point (shared join point).
    const lastOfFirst = parts[0]![parts[0]!.length - 1]!;
    const firstOfSecond = parts[1]![0]!;
    expect(firstOfSecond).toEqual(lastOfFirst);
  });
});

describe('TC-04: createStroke single point (dot)', () => {
  it('bbox = thickness square, points length 2', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 100, y: 200 }], color: 'black', thickness: 'thick' },
      'user1',
    );
    expect(id).not.toBeNull();
    const snaps = objectSnapshots(doc);
    const stroke = snaps.find((s) => s.id === id) as StrokeSnap;
    expect(stroke).toBeDefined();
    expect(stroke.type).toBe('stroke');
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.points).toHaveLength(2);
    // Point at center of bbox
    expect(stroke.points[0]).toBeCloseTo(PEN_THICKNESS_WORLD.thick / 2);
    expect(stroke.points[1]).toBeCloseTo(PEN_THICKNESS_WORLD.thick / 2);
  });
});

describe('TC-05: invalid inputs produce null, zero updates', () => {
  function assertNull(label: string, args: { points: Point[]; color: any; thickness: any }) {
    const doc = new Y.Doc();
    initDoc(doc);
    let updateCount = 0;
    doc.on('update', () => updateCount++);
    const result = createStroke(doc, args, 'user1');
    it(`${label} → null`, () => {
      expect(result).toBeNull();
    });
    it(`${label} → zero updates`, () => {
      expect(updateCount).toBe(0);
    });
  }

  assertNull('empty points', { points: [], color: 'black', thickness: 'thin' });
  assertNull('NaN point', { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'thin' });
  assertNull('Infinity point', { points: [{ x: Infinity, y: 0 }], color: 'black', thickness: 'thin' });
  assertNull('unknown colour', { points: [{ x: 0, y: 0 }], color: 'pink', thickness: 'thin' });
  assertNull('unknown thickness', { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' });
});

describe('TC-06: scaledPoints after resize 2x', () => {
  it('coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const pts = underline();
    const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'user1');
    expect(id).not.toBeNull();
    const snaps = objectSnapshots(doc);
    const stroke = snaps.find((s) => s.id === id) as StrokeSnap;
    const original = scaledPoints(stroke);

    // Double width and height (simulating resize via story 7)
    const resized: StrokeSnap = {
      ...stroke,
      width: stroke.width! * 2,
      height: stroke.height! * 2,
    };
    const scaled = scaledPoints(resized);
    expect(scaled).toHaveLength(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(scaled[i]!.x).toBeCloseTo(original[i]!.x * 2, 5);
      expect(scaled[i]!.y).toBeCloseTo(original[i]!.y * 2, 5);
    }
    // Thickness unchanged
    expect(resized.thickness).toBe('medium');
  });
});

describe('TC-07: distanceToPolyline at hit tolerance boundary', () => {
  it('distance 0, 5.9, 6.1 units at zoom 1', () => {
    // Create a simple horizontal line
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], color: 'black', thickness: 'thin' },
      'user1',
    );
    expect(id).not.toBeNull();
    const snaps = objectSnapshots(doc);
    const stroke = snaps.find((s) => s.id === id) as StrokeSnap;
    const pts = scaledPoints(stroke);
    // Point at (50, 50): in world, the line is from (points[0].x + stroke.x, points[0].y + stroke.y)
    // scaledPoints are relative to bbox. Let's test distance directly.
    const midOnLine = { x: pts[0]!.x + (pts[1]!.x - pts[0]!.x) / 2, y: pts[0]!.y };
    const d0 = distanceToPolyline(pts, midOnLine);
    expect(d0).toBeLessThanOrEqual(6); // within STROKE_HIT_TOLERANCE_PX / zoom at zoom 1

    const d59 = distanceToPolyline(pts, { x: midOnLine.x, y: midOnLine.y + 5.9 });
    expect(d59).toBeLessThanOrEqual(6); // within

    const d61 = distanceToPolyline(pts, { x: midOnLine.x, y: midOnLine.y + 6.1 });
    expect(d61).toBeGreaterThan(6); // outside
  });
});

describe('TC-08: smoothPath deterministic SVG', () => {
  it('starts with M and uses Q segments for 3+ points', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d).toMatch(/^M\s/);
    expect(d).toContain('Q');
    // Deterministic: calling twice gives same result
    expect(smoothPath(pts)).toBe(d);
  });

  it('single point gives a valid zero-length path', () => {
    const d = smoothPath([{ x: 10, y: 20 }]);
    expect(d).toContain('M');
    expect(d).toContain('10');
    expect(d).toContain('20');
  });

  it('empty points gives empty string', () => {
    expect(smoothPath([])).toBe('');
  });
});
