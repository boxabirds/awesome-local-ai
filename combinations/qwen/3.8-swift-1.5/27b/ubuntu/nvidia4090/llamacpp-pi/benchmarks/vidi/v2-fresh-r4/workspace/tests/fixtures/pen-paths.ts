/**
 * Recorded realistic pointer paths for pen tool tests (story 11).
 */
import type { Point } from '../../src/shared/geometry';

/**
 * A handwritten loop: ~400 jittery points forming a rough circle/loop.
 * Simulates a user drawing a circle around a cluster of notes.
 */
export function handwrittenLoop(): Point[] {
  const points: Point[] = [];
  const cx = 200, cy = 200, rx = 80, ry = 60;
  const numPoints = 400;
  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2;
    // Add jitter to simulate hand-drawn imprecision
    const jx = Math.sin(i * 7.3) * 2 + Math.cos(i * 3.1) * 1.5;
    const jy = Math.cos(i * 5.7) * 2 + Math.sin(i * 2.9) * 1.5;
    points.push({
      x: cx + Math.cos(t) * rx + jx,
      y: cy + Math.sin(t) * ry + jy,
    });
  }
  return points;
}

/**
 * An underline: ~120 points in a roughly horizontal line with slight wobble.
 */
export function underline(): Point[] {
  const points: Point[] = [];
  const startX = 100, startY = 300;
  const length = 200;
  const numPoints = 120;
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const wobble = Math.sin(t * Math.PI * 3) * 1.5;
    points.push({
      x: startX + t * length,
      y: startY + wobble,
    });
  }
  return points;
}

/**
 * A synthetic spiral with exactly 5010 points (exceeds STROKE_MAX_POINTS).
 */
export function longSpiral(): Point[] {
  const points: Point[] = [];
  const cx = 500, cy = 500;
  const numPoints = 5010;
  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 10; // 5 full turns
    const r = 20 + (i / numPoints) * 100;
    points.push({
      x: cx + Math.cos(t) * r,
      y: cy + Math.sin(t) * r,
    });
  }
  return points;
}
