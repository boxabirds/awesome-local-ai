/**
 * Recorded pointer paths for pen/stroke tests.
 *
 * - handwrittenLoop: ~400 jittery points forming a loop (~200x200 units).
 * - underline: ~120 points forming a nearly-straight underline (~150 units).
 * - spiral5010: synthetic 5,010-point spiral (for STROKE_MAX_POINTS boundary tests).
 */

import type { Point } from '../../src/shared/geometry';

/** Generate a handwritten-loop path with deterministic jitter. */
function generateHandwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const n = 400;
  const cx = 100, cy = 100, rx = 80, ry = 70;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    // Base ellipse + small pseudo-random jitter
    const jitterX = Math.sin(i * 7.3) * 2 + Math.cos(i * 13.1) * 1.5;
    const jitterY = Math.cos(i * 5.7) * 2 + Math.sin(i * 11.3) * 1.5;
    pts.push({
      x: cx + Math.cos(t) * rx + jitterX,
      y: cy + Math.sin(t) * ry + jitterY,
    });
  }
  return pts;
}

/** Generate an underline path: ~120 points going left→right with slight wobble. */
function generateUnderline(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = 50 + t * 150;
    const y = 200 + Math.sin(i * 0.8) * 1.5 + Math.cos(i * 2.3) * 0.8;
    pts.push({ x, y });
  }
  return pts;
}

/** Generate a synthetic 5,010-point spiral for boundary tests. */
function generateSpiral(): Point[] {
  const pts: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const angle = t * Math.PI * 20; // 10 full rotations
    const radius = 10 + t * 90;
    pts.push({
      x: 100 + Math.cos(angle) * radius,
      y: 100 + Math.sin(angle) * radius,
    });
  }
  return pts;
}

export const handwrittenLoop: Point[] = generateHandwrittenLoop();
export const underline: Point[] = generateUnderline();
export const spiral5010: Point[] = generateSpiral();
