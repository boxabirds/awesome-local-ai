import type { Point } from '@shared/geometry';

/**
 * Generate a handwritten loop (~400 points with jitter).
 * Parametric circle with added noise to simulate a hand-drawn circle.
 */
export function handwrittenLoop(n = 400, cx = 200, cy = 200, r = 100): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const jitterX = (Math.sin(i * 7.3) * 0.4 + Math.sin(i * 13.1) * 0.3) * 2;
    const jitterY = (Math.cos(i * 11.7) * 0.5 + Math.sin(i * 5.3) * 0.2) * 2;
    pts.push({
      x: cx + Math.cos(t) * r + jitterX,
      y: cy + Math.sin(t) * r + jitterY,
    });
  }
  return pts;
}

/**
 * Generate an underline (~120 points).
 * A mostly-horizontal line with slight vertical wobble.
 */
export function underline(n = 120, x0 = 50, y0 = 300, len = 200): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wobbleY = Math.sin(t * Math.PI * 3) * 0.5;
    pts.push({
      x: x0 + t * len,
      y: y0 + wobbleY,
    });
  }
  return pts;
}

/**
 * Generate a synthetic spiral with exactly `count` points.
 * Used to test STROKE_MAX_POINTS splitting.
 */
export function spiral(count: number, cx = 0, cy = 0): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * 0.1;
    const r = 1 + t * 0.5;
    pts.push({
      x: cx + Math.cos(t) * r,
      y: cy + Math.sin(t) * r,
    });
  }
  return pts;
}
