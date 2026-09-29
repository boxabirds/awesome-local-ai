import type { Point } from '../../src/client/canvas/camera';

/**
 * Recorded-style pointer paths for the pen (story 11) tests.
 *
 * All paths are world-space Point sequences produced deterministically by a
 * seeded PRNG (mulberry32), so every run — unit, component and e2e — replays
 * the exact same "handwriting".
 */

/** Deterministic PRNG (mulberry32): stable across runs and engines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A handwritten loop: 400 jittery points tracing a loose loop (radius ~80
 * world units with a third-harmonic wobble and ±2 units of hand jitter).
 * Centred on the origin, so with the home camera it sits at the screen centre.
 */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const rand = mulberry32(0x5eed);
  const n = 400;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    const r = 80 + 12 * Math.sin(3 * t) + (rand() - 0.5) * 4;
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return pts;
})();

/**
 * A quick underline: 120 points across 200 world units with a gentle wave
 * (amplitude 30) and small jitter — the "underline under a note" gesture.
 */
export const UNDERLINE: readonly Point[] = (() => {
  const rand = mulberry32(0x2114);
  const n = 120;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = -100 + (200 * i) / (n - 1);
    const y = 30 * Math.sin((i / 18) * Math.PI) + (rand() - 0.5) * 1.5;
    pts.push({ x, y });
  }
  return pts;
})();

/**
 * A synthetic long stroke: 5,010 points on a tight 20-turn spiral — just over
 * STROKE_MAX_POINTS (5,000) so the split boundary (STROKE_MAX_POINTS + 1 raw
 * points) is exercised with realistic spacing.
 */
export const LONG_SPIRAL: readonly Point[] = (() => {
  const n = 5010;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * 40 * Math.PI;
    const r = 5 + i * 0.05;
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return pts;
})();
