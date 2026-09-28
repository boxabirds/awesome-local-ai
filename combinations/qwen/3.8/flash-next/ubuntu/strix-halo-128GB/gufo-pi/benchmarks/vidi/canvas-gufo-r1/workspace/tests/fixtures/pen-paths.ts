import type { Point } from '../../src/shared/geometry';

/**
 * Recorded handwritten loop path (~400 points with jitter).
 * Simulates a user drawing a circle around sticky notes.
 */
export function handwrittenLoop(): Point[] {
  const points: Point[] = [];
  const cx = 300, cy = 300, r = 120;
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const jitter = (Math.sin(i * 7.3) * 0.8 + Math.cos(i * 13.1) * 0.5);
    points.push({
      x: cx + (r + jitter) * Math.cos(angle),
      y: cy + (r + jitter) * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Recorded underline path (~120 points with slight wobble).
 */
export function underlinePath(): Point[] {
  const points: Point[] = [];
  const n = 120;
  const startX = 100, endX = 350, y = 200;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wobble = Math.sin(t * 20) * 0.6;
    points.push({
      x: startX + (endX - startX) * t,
      y: y + wobble,
    });
  }
  return points;
}

/**
 * Synthetic spiral with 5,010 points for testing STROKE_MAX_POINTS splitting.
 */
export function spiral5010(): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 5010; i++) {
    const t = i / 5010;
    const angle = t * Math.PI * 20;
    const r = 50 + t * 100;
    points.push({
      x: 500 + r * Math.cos(angle),
      y: 500 + r * Math.sin(angle),
    });
  }
  return points;
}
