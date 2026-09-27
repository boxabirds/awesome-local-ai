// Recorded (deterministic, seeded) pointer paths for the pen tests
// (story 11 fixtures): a handwritten loop, an underline and a synthetic
// 5,010-point spiral for the long-stroke split.

import type { Point } from '../../src/shared/geometry';

/** Deterministic PRNG (mulberry32) so the fixtures are stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Handwritten loop: 400 jittery points around an ellipse (world units),
 * slightly overshooting a full turn so the loop is open like a real mark.
 */
export const HANDWRITTEN_LOOP: Point[] = (() => {
  const rand = mulberry32(11);
  const n = 400;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2.1;
    pts.push({
      x: 100 + 80 * Math.cos(t) + (rand() - 0.5) * 3,
      y: 60 + 50 * Math.sin(t) + (rand() - 0.5) * 3,
    });
  }
  return pts;
})();

/** Underline: 120 points, mostly horizontal with a small hand wobble. */
export const UNDERLINE: Point[] = (() => {
  const rand = mulberry32(23);
  const n = 120;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    pts.push({
      x: i,
      y: (rand() - 0.5) * 2 + 0.5 * Math.sin(i / 8),
    });
  }
  return pts;
})();

/** Synthetic spiral with exactly 5,010 points (STROKE_MAX_POINTS + 10). */
export const LONG_SPIRAL: Point[] = (() => {
  const n = 5010;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i * 0.03;
    const r = 4 + i * 0.01;
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return pts;
})();
