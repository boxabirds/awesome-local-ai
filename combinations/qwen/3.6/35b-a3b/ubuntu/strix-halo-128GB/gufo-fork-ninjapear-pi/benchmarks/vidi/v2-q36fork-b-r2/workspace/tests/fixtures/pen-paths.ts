import type { Point } from '../../src/shared/geometry';

/**
 * Handwritten loop (~400 points) with jitter — realistic finger trace.
 */
export function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const cx = 500;
  const cy = 400;
  const rx = 120;
  const ry = 90;
  const count = 400;

  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    // Slight jitter on a circle
    const jitterX = (Math.sin(t * 37 + i) * 2.3 + Math.cos(t * 53) * 1.7);
    const jitterY = (Math.cos(t * 41 + i * 0.7) * 1.8 + Math.sin(t * 61) * 1.4);
    pts.push({
      x: cx + rx * Math.cos(t) + jitterX,
      y: cy + ry * Math.sin(t) + jitterY,
    });
  }
  return pts;
}

/**
 * Underline path (~120 points) — slightly wavy horizontal line.
 */
export function underlinePath(): Point[] {
  const pts: Point[] = [];
  const startY = 300;
  const count = 120;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = 100 + t * 500;
    const jitter = Math.sin(t * 40) * 0.8 + Math.cos(t * 23 + 1) * 0.5;
    pts.push({ x, y: startY + jitter });
  }
  return pts;
}

/**
 * Synthetic spiral reaching exactly 5010 points.
 */
export function spiral5010(): Point[] {
  const pts: Point[] = [];
  const cx = 300;
  const cy = 300;

  for (let i = 0; i < 5010; i++) {
    const angle = i * 0.05;
    const radius = 5 + i * 0.15;
    pts.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return pts;
}
