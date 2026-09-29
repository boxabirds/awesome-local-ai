import type { Point } from '@client/canvas/camera';

/**
 * Handwritten loop fixture (~400 points with jitter).
 * Simulates a user circling a cluster of objects with a mouse/trackpad.
 */
export function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const cx = 300, cy = 300, r = 120;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    // Base ellipse
    const bx = cx + r * Math.cos(t);
    const by = cy + r * 0.8 * Math.sin(t);
    // Jitter: small random-feeling displacement
    const jx = Math.sin(i * 7.3) * 1.5 + Math.cos(i * 3.1) * 0.8;
    const jy = Math.cos(i * 5.7) * 1.5 + Math.sin(i * 2.9) * 0.8;
    pts.push({ x: bx + jx, y: by + jy });
  }
  return pts;
}

/**
 * Underline fixture (~120 points): a slightly wavy horizontal line.
 */
export function underlineFixture(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  const x0 = 100, y0 = 200, length = 400;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + length * t;
    const y = y0 + Math.sin(t * Math.PI * 4) * 0.7 + Math.cos(i * 9.1) * 0.3;
    pts.push({ x, y });
  }
  return pts;
}

/**
 * Synthetic spiral with exactly STROKE_MAX_POINTS + 10 points for testing the split boundary.
 */
export function spiralFixture(count?: number): Point[] {
  const pts: Point[] = [];
  const n = count ?? 5010;
  const cx = 500, cy = 500;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 8;
    const r = 10 + (i / n) * 200;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}
