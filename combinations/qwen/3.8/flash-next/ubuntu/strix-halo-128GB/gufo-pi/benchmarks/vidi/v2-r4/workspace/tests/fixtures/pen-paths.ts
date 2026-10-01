/**
 * Recorded realistic pointer paths for pen tests.
 * - handwrittenLoop: ~400 jittery points forming a loop
 * - underline: ~120 points forming a straight underline with slight jitter
 * - longSpiral: synthetic 5010-point spiral (for STROKE_MAX_POINTS tests)
 */
import type { Point } from '../../src/client/canvas/camera';

/**
 * Generate a handwritten loop (~400 points) with jitter.
 * Parametric circle with random noise added.
 */
export function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const n = 400;
  const cx = 300, cy = 300, r = 100;
  // Simple seeded PRNG for determinism
  let seed = 42;
  function rand(): number {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const jitterX = (rand() - 0.5) * 4;
    const jitterY = (rand() - 0.5) * 4;
    pts.push({
      x: cx + r * Math.cos(t) + jitterX,
      y: cy + r * Math.sin(t) + jitterY,
    });
  }
  return pts;
}

/**
 * Generate an underline path (~120 points) with slight jitter.
 */
export function underline(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  const startX = 50, endX = 350, y = 200;
  let seed = 123;
  function rand(): number {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const jitterY = (rand() - 0.5) * 2;
    pts.push({
      x: startX + t * (endX - startX),
      y: y + jitterY,
    });
  }
  return pts;
}

/**
 * Generate a synthetic spiral of exactly 5010 points.
 * Used to test STROKE_MAX_POINTS splitting.
 */
export function longSpiral(): Point[] {
  const pts: Point[] = [];
  const n = 5010;
  const cx = 500, cy = 500;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 20; // 10 full rotations
    const r = 5 + (i / n) * 200;
    pts.push({
      x: cx + r * Math.cos(t),
      y: cy + r * Math.sin(t),
    });
  }
  return pts;
}
