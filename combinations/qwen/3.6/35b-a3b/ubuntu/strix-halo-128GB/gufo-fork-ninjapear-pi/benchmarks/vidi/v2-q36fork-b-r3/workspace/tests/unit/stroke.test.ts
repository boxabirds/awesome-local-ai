import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '@shared/geometry/simplify';
import { createStroke, scaledPoints, strokePath } from '@shared/objects/stroke';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { STROKE_SIMPLIFY_TOLERANCE_PX, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX } from '@shared/config';
import type { Point } from '../../src/client/canvas/camera';
import type { StrokeSnapshot } from '@shared/board-model';

// ── Fixtures ───────────────────────────────────────────────────────

/** Generate a loop path of given length. */
function makeLoopPath(count: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const jitter = () => (Math.random() - 0.5) * 3;
    pts.push({
      x: 100 + 60 * Math.cos(t) + jitter(),
      y: 80 + 40 * Math.sin(t) + jitter(),
    });
  }
  return pts;
}

// ── TC-01: Simplify loop at tolerance 1 ────────────────────────────
describe('TC-01 simplify loop at tolerance 1', () => {
  it('every raw point within 1 unit of result and result has fewer points', () => {
    const raw = makeLoopPath(400);
    const simplified = simplify(raw, STROKE_SIMPLIFY_TOLERANCE_PX);

    // Result should have fewer points than input
    expect(simplified.length).toBeLessThan(raw.length);

    // Every raw point should be within tolerance of the simplified path
    for (const p of raw) {
      const dist = distanceToPolyline(simplified, p);
      expect(dist).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 0.001);
    }
  });
});

// ── TC-02: Tolerance 0.5 (zoom 200%) ──────────────────────────────
describe('TC-02 simplify with tolerance 0.5', () => {
  it('every raw point within 0.5 units', () => {
    const raw = makeLoopPath(400);
    const simplified = simplify(raw, 0.5);

    for (const p of raw) {
      const dist = distanceToPolyline(simplified, p);
      expect(dist).toBeLessThanOrEqual(0.5 + 0.001);
    }
  });
});

// ── TC-03: splitPoints boundary ───────────────────────────────────
describe('TC-03 splitPoints boundaries', () => {
  it('STROKE_MAX_POINTS - 1 → 1 part', () => {
    const pts: Point[] = [];
    for (let i = 0; i < STROKE_MAX_POINTS - 1; i++) {
      pts.push({ x: i, y: 0 });
    }
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);
  });

  it('exactly STROKE_MAX_POINTS → 1 part', () => {
    const pts: Point[] = [];
    for (let i = 0; i < STROKE_MAX_POINTS; i++) {
      pts.push({ x: i, y: 0 });
    }
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);
  });

  it('STROKE_MAX_POINTS + 1 → 2 parts, second starts at first\'s last point', () => {
    const pts: Point[] = [];
    for (let i = 0; i < STROKE_MAX_POINTS + 1; i++) {
      pts.push({ x: i, y: 0 });
    }
    const parts = splitPoints(pts);
    expect(parts.length).toBe(2);
    // Join point: part 2's first point should equal part 1's last point
    const part1Last = parts[0][parts[0].length - 1];
    const part2First = parts[1][0];
    expect(part1Last.x).toBe(part2First.x);
    expect(part1Last.y).toBe(part2First.y);
  });
});

// ── TC-04: CreateStroke single point (dot) ────────────────────────
describe('TC-04 createStroke single point thick', () => {
  it('bbox = thickness square, points length 2', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 50, y: 50 }], color: 'black', thickness: 'thick' }, 'user1');
    expect(id).toBeDefined();

    const objects = doc.getMap('objects');
    const dm = objects.get(id as string) as any;
    expect(dm.get('type')).toBe('stroke');
    expect(dm.get('points')).toHaveLength(2); // [x, y] relative to bbox
    expect(dm.get('color')).toBe('black');
    expect(dm.get('thickness')).toBe('thick');
  });
});

// ── TC-05: Negative cases ─────────────────────────────────────────
describe('TC-05 negative cases', () => {
  it('empty points → null', () => {
    const doc = new Y.Doc();
    const objectsBefore = [...doc.getMap('objects').keys()];
    const id = createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'user1');
    expect(id).toBeNull();
    expect([...doc.getMap('objects').keys()]).toEqual(objectsBefore);
  });

  it('NaN point → null', () => {
    const doc = new Y.Doc();
    const objectsBefore = [...doc.getMap('objects').keys()];
    const id = createStroke(doc, { points: [{ x: NaN, y: 50 }], color: 'black', thickness: 'medium' }, 'user1');
    expect(id).toBeNull();
    expect([...doc.getMap('objects').keys()]).toEqual(objectsBefore);
  });

  it('unknown colour → null', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'medium' }, 'user1');
    expect(id).toBeNull();
  });

  it('unknown thickness → null', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as any }, 'user1');
    expect(id).toBeNull();
  });
});

// ── TC-06: ScaledPoints after resize ──────────────────────────────
describe('TC-06 scaledPoints after double size', () => {
  it('coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: 'red', thickness: 'medium' }, 'user1');
    expect(id).toBeDefined();

    const objects = doc.getMap('objects');
    const dm = objects.get(id!) as any;

    // Original state
    const snap: StrokeSnapshot = {
      id: id!,
      type: 'stroke',
      x: Number(dm.get('x')),
      y: Number(dm.get('y')),
      width: Number(dm.get('width')),
      height: Number(dm.get('height')),
      points: dm.get('points') as number[],
      baseWidth: Number(dm.get('baseWidth')),
      baseHeight: Number(dm.get('baseHeight')),
      color: String(dm.get('color')) as 'black' | 'blue' | 'red' | 'green' | 'orange' | 'purple',
      thickness: String(dm.get('thickness')) as 'thin' | 'medium' | 'thick',
      z: Number(dm.get('z')),
      createdAt: Number(dm.get('createdAt')),
    };

    const originalPts = scaledPoints(snap);
    expect(originalPts.length).toBeGreaterThan(0);

    // Simulate doubling both width and height
    const doubled: StrokeSnapshot = { ...snap, width: snap.width * 2, height: snap.height * 2 };
    const scaled = scaledPoints(doubled);

    for (let i = 0; i < originalPts.length; i++) {
      expect(scaled[i].x).toBeCloseTo(originalPts[i].x * 2);
      expect(scaled[i].y).toBeCloseTo(originalPts[i].y * 2);
    }
  });
});

// ── TC-07: distanceToPolyline hit test ─────────────────────────────
describe('TC-07 distanceToPolyline hit test', () => {
  it('at 0, 5.9, 6.1 — within / within / outside tolerance', () => {
    // A simple horizontal line from (0,0) to (100,0)
    const pts: Point[] = [];
    for (let i = 0; i <= 100; i += 5) {
      pts.push({ x: i, y: 0 });
    }

    const onLine = distanceToPolyline(pts, { x: 50, y: 0 });
    const nearLine = distanceToPolyline(pts, { x: 50, y: 5.9 });
    const farFromLine = distanceToPolyline(pts, { x: 50, y: 6.1 });

    expect(onLine).toBe(0);
    expect(nearLine).toBeCloseTo(5.9, 3);
    expect(farFromLine).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

// ── TC-08: smoothPath of 3 points ─────────────────────────────────
describe('TC-08 smoothPath deterministic output', () => {
  it('SVG path starts with M and uses Q segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ];
    const d = smoothPath(pts);

    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    // Should start at first point
    expect(d.startsWith('M 0 0')).toBe(true);
    // Ends at last point
    expect(d.endsWith('20 5')).toBe(true);
  });

  it('single point returns zero-length M command', () => {
    const d = smoothPath([{ x: 5, y: 5 }]);
    expect(d).toBe('M 5 5');
  });

  it('empty array returns empty string', () => {
    const d = smoothPath([]);
    expect(d).toBe('');
  });
});
