// tests/fixtures/pen-paths.ts
// Recorded realistic pointer paths for pen tool tests.

import type { Point } from '../../src/shared/geometry';

/**
 * Generates a handwritten loop with jitter (~400 points).
 * Simulates a rough circle drawn by hand.
 */
export function handwrittenLoop(): Point[] {
  const points: Point[] = [];
  const cx = 100, cy = 100, r = 50;
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    // Add jitter to simulate hand-drawn quality
    const jitterX = (Math.sin(i * 7.3) * 2 + Math.cos(i * 3.1) * 1.5);
    const jitterY = (Math.cos(i * 5.7) * 2 + Math.sin(i * 4.3) * 1.5);
    points.push({
      x: cx + r * Math.cos(t) + jitterX,
      y: cy + r * Math.sin(t) + jitterY,
    });
  }
  return points;
}

/**
 * Generates an underline path (~120 points).
 * A roughly horizontal line with slight wobble.
 */
export function underline(): Point[] {
  const points: Point[] = [];
  const startX = 50, startY = 200, length = 150;
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push({
      x: startX + length * t,
      y: startY + Math.sin(t * Math.PI * 3) * 2,
    });
  }
  return points;
}

/**
 * Generates a synthetic 5010-point spiral.
 * Used for testing the STROKE_MAX_POINTS split boundary.
 */
export function longSpiral(numPoints = 5010): Point[] {
  const points: Point[] = [];
  const cx = 200, cy = 200;
  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 8;
    const r = 10 + i * 0.1;
    points.push({
      x: cx + r * Math.cos(t),
      y: cy + r * Math.sin(t),
    });
  }
  return points;
}
