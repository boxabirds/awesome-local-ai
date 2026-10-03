/**
 * Recorded realistic pointer paths for pen tests (story 11).
 * All coordinates are in world units.
 */

import type { Point } from '../../src/shared/geometry';

/**
 * A handwritten loop with jitter, ~400 points.
 * Simulates a rough circle drawn by hand.
 */
export function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const cx = 100;
  const cy = 100;
  const radius = 50;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    // Add jitter to simulate hand tremor
    const jitterX = Math.sin(i * 7.3) * 1.2 + Math.cos(i * 3.1) * 0.8;
    const jitterY = Math.cos(i * 5.7) * 1.1 + Math.sin(i * 4.3) * 0.9;
    // Slight radius variation for organic feel
    const r = radius + Math.sin(t * 3) * 3 + jitterX * 0.5;
    pts.push({
      x: cx + r * Math.cos(t) + jitterX,
      y: cy + r * Math.sin(t) + jitterY,
    });
  }
  return pts;
}

/**
 * An underline stroke, ~120 points.
 * A mostly horizontal line with slight waviness.
 */
export function underline(): Point[] {
  const pts: Point[] = [];
  const x0 = 20;
  const y0 = 200;
  const width = 180;
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const jitterY = Math.sin(t * Math.PI * 4) * 1.5 + Math.cos(t * 13.7) * 0.5;
    pts.push({
      x: x0 + t * width,
      y: y0 + jitterY,
    });
  }
  return pts;
}

/**
 * A synthetic 5,010-point spiral (for testing the STROKE_MAX_POINTS split).
 */
export function longSpiral(count = 5010): Point[] {
  const pts: Point[] = [];
  const cx = 200;
  const cy = 200;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 20; // 10 turns
    const r = 10 + (i / count) * 180;
    pts.push({
      x: cx + r * Math.cos(t),
      y: cy + r * Math.sin(t),
    });
  }
  return pts;
}
