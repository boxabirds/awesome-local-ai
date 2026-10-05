import type { Point } from '../../src/shared/geometry';

/**
 * Deterministic pseudo-random generator (LCG) so the recorded paths are
 * stable across runs and machines.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Recorded realistic pointer path: a handwritten loop of ~400 jittery points
 * tracing an ellipse centred at (300, 200).
 */
export function handwrittenLoop(): Point[] {
  const rand = lcg(42);
  const pts: Point[] = [];
  const cx = 300;
  const cy = 200;
  const rx = 120;
  const ry = 80;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    pts.push({
      x: cx + rx * Math.cos(t) + (rand() - 0.5) * 6,
      y: cy + ry * Math.sin(t) + (rand() - 0.5) * 6,
    });
  }
  return pts;
}

/**
 * Recorded realistic pointer path: an underline of ~120 slightly jittery
 * points running from (100, 400) to (400, 400).
 */
export function underline(): Point[] {
  const rand = lcg(7);
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({
      x: 100 + t * 300,
      y: 400 + Math.sin(t * Math.PI * 2) * 3 + (rand() - 0.5) * 2,
    });
  }
  return pts;
}

/**
 * Synthetic long stroke: a 5,010-point spiral (exceeds STROKE_MAX_POINTS by
 * 10) for the long-stroke split boundary.
 */
export function longSpiral(count = 5010): Point[] {
  const rand = lcg(99);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * 0.05;
    const r = 10 + i * 0.05;
    pts.push({
      x: 400 + r * Math.cos(t) + (rand() - 0.5),
      y: 300 + r * Math.sin(t) + (rand() - 0.5),
    });
  }
  return pts;
}
