/**
 * Recorded pointer-path fixtures for the pen/stroke tests (story 11).
 *
 * - handwrittenLoop: ~400 jittery points forming a rough circle/loop
 * - underline: ~120 points along a roughly horizontal line with slight wobble
 * - spiral: synthetic 5010-point spiral (for STROKE_MAX_POINTS split tests)
 */
import type { Point } from '../../src/shared/geometry';

/** Generate a handwritten loop (~400 points) with jitter. */
function generateHandwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const cx = 200;
  const cy = 200;
  const rx = 120;
  const ry = 80;
  const n = 400;
  let seed = 42;
  function jitter(): number {
    // Simple deterministic pseudo-random for reproducibility
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed / 2147483647 - 0.5) * 3;
  }
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    const x = cx + rx * Math.cos(t) + jitter();
    const y = cy + ry * Math.sin(t) + jitter();
    pts.push({ x, y });
  }
  return pts;
}

/** Generate an underline path (~120 points) with slight wobble. */
function generateUnderline(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  const startX = 50;
  const endX = 350;
  const y = 200;
  let seed = 123;
  function jitter(): number {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2;
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = startX + (endX - startX) * t;
    const jitterY = y + jitter() + Math.sin(t * 5) * 0.5;
    pts.push({ x, y: jitterY });
  }
  return pts;
}

/** Generate a synthetic spiral of exactly STROKE_MAX_POINTS + 10 points (5010). */
function generateSpiral(count: number): Point[] {
  const pts: Point[] = [];
  const cx = 300;
  const cy = 300;
  for (let i = 0; i < count; i++) {
    const t = i * 0.02;
    const r = 1 + t * 2;
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    pts.push({ x, y });
  }
  return pts;
}

/** ~400 jittery points forming a handwritten loop. */
export const handwrittenLoop: readonly Point[] = generateHandwrittenLoop();

/** ~120 points along a rough horizontal underline. */
export const underline: readonly Point[] = generateUnderline();

/** Synthetic 5010-point spiral for STROKE_MAX_POINTS boundary tests. */
export const spiral5010: readonly Point[] = generateSpiral(5010);
