import type { Point } from '../../src/shared/geometry';

/**
 * Recorded handwritten loop (~400 points with jitter).
 * Simulates a user circling a cluster of sticky notes.
 */
export function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const cx = 300, cy = 300;
  const radiusX = 150, radiusY = 100;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const jitterX = (Math.sin(i * 7.3) * 0.8 + Math.cos(i * 13.1) * 0.5);
    const jitterY = (Math.cos(i * 11.7) * 0.8 + Math.sin(i * 9.3) * 0.5);
    pts.push({
      x: cx + radiusX * Math.cos(t) + jitterX,
      y: cy + radiusY * Math.sin(t) + jitterY,
    });
  }
  return pts;
}

/**
 * Underline path (~120 points): roughly horizontal with slight wobble.
 */
export function underline(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  const startX = 100, startY = 500;
  const endX = 500, endY = 502;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wobbleY = Math.sin(t * Math.PI * 6) * 0.6;
    pts.push({
      x: startX + (endX - startX) * t,
      y: startY + (endY - startY) * t + wobbleY,
    });
  }
  return pts;
}

/**
 * Synthetic 5,010-point spiral (for testing STROKE_MAX_POINTS splitting).
 */
export function syntheticSpiral(): Point[] {
  const pts: Point[] = [];
  const n = 5010;
  const cx = 400, cy = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 20; // 10 revolutions
    const r = 5 + (i / n) * 200;
    pts.push({
      x: cx + r * Math.cos(t),
      y: cy + r * Math.sin(t),
    });
  }
  return pts;
}
