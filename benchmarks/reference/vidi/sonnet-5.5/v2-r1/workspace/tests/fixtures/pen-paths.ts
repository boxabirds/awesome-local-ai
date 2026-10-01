import type { Point } from '../../src/shared/geometry';

/** Deterministic pseudo-random jitter so the "recorded" paths are identical on every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

/** A hand-drawn loop around a cluster (about 400 points, ~1.5 px of jitter). */
export function handwrittenLoop(cx = 400, cy = 300, rx = 160, ry = 110): Point[] {
  const r = rng(7);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2.05;
    pts.push({ x: cx + Math.cos(a) * rx + r() * 3, y: cy + Math.sin(a) * ry + r() * 3 });
  }
  return pts;
}

/** A wobbly underline of about 120 points. */
export function underline(x = 200, y = 500, length = 300): Point[] {
  const r = rng(11);
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i <= n; i++) pts.push({ x: x + (i / n) * length, y: y + Math.sin(i / 9) * 2 + r() * 1.5 });
  return pts;
}

/** A synthetic spiral with 5,010 points (just over STROKE_MAX_POINTS). */
export function spiral(count = 5010): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 0.05;
    const r = 5 + i * 0.03;
    pts.push({ x: 400 + Math.cos(a) * r, y: 300 + Math.sin(a) * r });
  }
  return pts;
}
