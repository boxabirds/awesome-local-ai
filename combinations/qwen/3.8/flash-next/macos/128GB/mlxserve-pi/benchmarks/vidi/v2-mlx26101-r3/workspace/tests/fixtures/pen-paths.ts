import type { Point } from '../../src/shared/geometry';

/**
 * Strokes as a hand makes them, for the pen tests.
 *
 * A captured stroke is not a circle: it is a few hundred points that wobble around the shape the
 * person meant, sampled at whatever rate the device reported. Simplification is judged against
 * exactly that kind of input — a clean circle would prove nothing about the noise — so these paths
 * are generated with jitter, from a fixed seed, so that a failure names the same point every time.
 *
 * The three paths are the three shapes the story has to survive: a loop (a closed-ish curve with
 * thousands of near-duplicates), an underline (mostly straight, which is where simplification earns
 * its keep), and a spiral long enough to cross `STROKE_MAX_POINTS`, which is the only way to test
 * the split without drawing 5001 points by hand.
 */

/** A small deterministic generator: the same wobble in every run, from a seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // mulberry32: short, fast, and good enough for noise nobody is betting money on.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Symmetric noise in `[-size, size]`. */
function jitter(random: () => number, size: number): number {
  return (random() * 2 - 1) * size;
}

/**
 * A hand-drawn loop: one turn of a slightly squashed circle, 402 points, each pushed about 3 units
 * off the true curve, with a slow wobble so it is not simply noisy at one scale.
 */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const random = seeded(20240711);
  const points: Point[] = [];
  const turns = 402;
  for (let step = 0; step < turns; step += 1) {
    const angle = (step / turns) * Math.PI * 2;
    const wobble = Math.sin(angle * 7) * 2;
    const radiusX = 180 + wobble + jitter(random, 3);
    const radiusY = 120 + wobble + jitter(random, 3);
    points.push({
      x: 420 + Math.cos(angle) * radiusX,
      y: 300 + Math.sin(angle) * radiusY,
    });
  }
  return points;
})();

/**
 * A hand-drawn underline: 128 points along a line that sags slightly, with 1.5 units of wobble.
 * Mostly straight, which is the case simplification is actually for.
 */
export const UNDERLINE: readonly Point[] = (() => {
  const random = seeded(7);
  const points: Point[] = [];
  const steps = 128;
  for (let step = 0; step < steps; step += 1) {
    const along = step / (steps - 1);
    points.push({
      x: 100 + along * 540 + jitter(random, 0.5),
      y: 500 + along * 14 + Math.sin(along * Math.PI) * 6 + jitter(random, 1.5),
    });
  }
  return points;
})();

/**
 * A 5010-point spiral: longer than `STROKE_MAX_POINTS` (5000) by ten points, which is the smallest
 * input that can prove the split rule and the reason it is not a 10000-point path waiting for a
 * slower test suite.
 */
export const LONG_SPIRAL: readonly Point[] = (() => {
  const points: Point[] = [];
  const steps = 5010;
  for (let step = 0; step < steps; step += 1) {
    const angle = step * 0.02;
    const radius = 2 + step * 0.03;
    points.push({ x: 600 + Math.cos(angle) * radius, y: 240 + Math.sin(angle) * radius });
  }
  return points;
})();

/** A perfectly straight horizontal line: the degenerate case every path builder has to survive. */
export const FLAT_LINE: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 100, y: 0 },
  { x: 150, y: 0 },
];

/** Three points of a corner: the smallest path a quadratic smoothing can be asked about. */
export const CORNER: readonly Point[] = [
  { x: 10, y: 10 },
  { x: 60, y: 90 },
  { x: 110, y: 10 },
];
