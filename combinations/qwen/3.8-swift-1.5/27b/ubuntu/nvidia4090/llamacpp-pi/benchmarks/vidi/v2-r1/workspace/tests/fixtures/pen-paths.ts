/**
 * Story 11: recorded (deterministically generated) realistic pointer paths
 * for pen tests.
 *
 * - handwrittenLoop: ~400 jittery points tracing a loop (a rough circle
 *   modulated by a second harmonic, with hand jitter).
 * - underline: ~120 slightly wobbly points in a horizontal line.
 * - longSpiral: exactly 5,010 points on an Archimedean spiral (for the
 *   STROKE_MAX_POINTS split boundary).
 *
 * Generation is seeded, so the fixtures are stable across runs.
 */
import type { Point } from '@shared/geometry';

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~400 jittery points around a loop, centred at (100, 100). */
export const handwrittenLoop: Point[] = (() => {
  const rand = mulberry32(11);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    const r = 80 + 18 * Math.sin(3 * t);
    const x = 100 + r * Math.cos(t) + (rand() - 0.5) * 4;
    const y = 100 + r * Math.sin(t) + (rand() - 0.5) * 4;
    pts.push({ x, y });
  }
  return pts;
})();

/** ~120 wobbly points drawing an underline from (0, 0) to (240, 0). */
export const underline: Point[] = (() => {
  const rand = mulberry32(22);
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = t * 240;
    const y = (rand() - 0.5) * 3 + 1.5 * Math.sin(t * Math.PI * 2);
    pts.push({ x, y });
  }
  return pts;
})();

/** Exactly 5,010 points on a spiral (for the long-stroke split). */
export const longSpiral: Point[] = (() => {
  const pts: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const angle = i * 0.15;
    const r = 2 + i * 0.05;
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  return pts;
})();
