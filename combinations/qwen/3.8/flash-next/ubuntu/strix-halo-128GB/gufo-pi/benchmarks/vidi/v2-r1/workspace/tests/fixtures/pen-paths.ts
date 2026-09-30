/**
 * Recorded and synthetic pointer paths for stroke tests (story 11).
 */

import type { Point } from '../../src/shared/board-model';

/**
 * A handwritten-style loop (~400 points with jitter).
 * Draws a roughly circular path with noise, like a hand-drawn circle.
 */
export function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const n = 400;
  const cx = 100, cy = 100, r = 50;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    // Add some hand jitter
    const jitterX = Math.sin(i * 0.7) * 2 + Math.cos(i * 1.3) * 1.5;
    const jitterY = Math.cos(i * 0.9) * 2 + Math.sin(i * 1.1) * 1.5;
    pts.push({
      x: cx + Math.cos(t) * r + jitterX,
      y: cy + Math.sin(t) * r + jitterY,
    });
  }
  return pts;
}

/**
 * An underline stroke (~120 points).
 * A roughly horizontal line with slight wobble.
 */
export function underlinePath(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  const startX = 10, y = 200, length = 300;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({
      x: startX + t * length,
      y: y + Math.sin(t * 12) * 1.5 + (Math.random() * 0.5 - 0.25),
    });
  }
  return pts;
}

/**
 * A deterministic synthetic spiral of `count` points (default 5010).
 * Used for testing STROKE_MAX_POINTS splitting.
 */
export function syntheticSpiral(count: number = 5010): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * 0.01;
    const r = 10 + t * 2;
    pts.push({
      x: 200 + Math.cos(t) * r,
      y: 200 + Math.sin(t) * r,
    });
  }
  return pts;
}
