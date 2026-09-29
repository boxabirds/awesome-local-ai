/**
 * Story 11 e2e/unit fixtures: recorded realistic pointer paths in WORLD units
 * (design "Fixtures"). Deterministic (seeded PRNG) so every run replays the
 * exact same strokes.
 *
 * - HANDWRITTEN_LOOP: a handwritten loop (one full turn) with ~400 jittery
 *   points, centred on the world origin (the e2e initial camera (-640, -360)
 *   zoom 1 puts it at screen (580..700, 300..420)).
 * - UNDERLINE: a ~120-point slightly wavy underline, 120 world units long,
 *   centred on the world origin.
 * - LONG_STROKE: exactly STROKE_MAX_POINTS + 10 points (the pen.long_stroke
 *   boundary) as a slowly growing spiral.
 */
import type { Point } from '@/shared/geometry';
import { STROKE_MAX_POINTS } from '@/shared/config';

/** Deterministic PRNG (mulberry32; mirrors tests/integration/random-ops). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Handwritten loop: ~400 jittery points, one full turn around the origin. */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const rnd = mulberry32(11);
  const N = 400;
  const pts: Point[] = [];
  for (let i = 0; i < N; i += 1) {
    const t = (i / (N - 1)) * Math.PI * 2;
    // Hand feel: slow radius wobble plus per-point jitter (~±1.5 units).
    const wobble = 6 * Math.sin(3 * t + 0.7) + 4 * Math.sin(7 * t);
    const r = 60 + wobble;
    pts.push({
      x: r * Math.cos(t) + (rnd() - 0.5) * 3,
      y: r * Math.sin(t) * 0.9 + (rnd() - 0.5) * 3,
    });
  }
  return pts;
})();

/** Underline: ~120 points, 120 units long, gentle wave + jitter. */
export const UNDERLINE: readonly Point[] = (() => {
  const rnd = mulberry32(23);
  const N = 120;
  const pts: Point[] = [];
  for (let i = 0; i < N; i += 1) {
    const t = i / (N - 1);
    pts.push({
      x: -60 + t * 120,
      y: Math.sin(t * Math.PI * 2) * 2 + (rnd() - 0.5) * 1.2,
    });
  }
  return pts;
})();

/** Exactly STROKE_MAX_POINTS + 10 points (the split boundary, pen.long_stroke). */
export const LONG_STROKE: readonly Point[] = (() => {
  const N = STROKE_MAX_POINTS + 10;
  const pts: Point[] = [];
  for (let i = 0; i < N; i += 1) {
    const t = i * 0.02;
    const r = 4 + t * 0.35;
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return pts;
})();
