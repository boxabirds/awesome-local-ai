/**
 * Recorded pointer paths for the pen (story 11).
 *
 * These are the shapes a hand actually makes, not perfect figures: a loop drawn round a cluster of
 * notes does not close, its radius wobbles, and a mouse or a trackpad adds a jag of a pixel or two on
 * every sample. That is the input the smoothing of `simplify` has to survive, so a synthetic circle
 * would test the maths and not the product - a path with no jitter simplifies to itself, and a path
 * of pure noise has no shape left to check.
 *
 * The numbers are generated, not typed, and generated from a fixed seed, so every run of every level
 * of the test suite replays exactly the same drag. Nothing here asserts; the unit tests measure the
 * paths, the component tests fire them at the tool, and the e2e tests move a real mouse through them.
 */
import type { Point } from '../../src/shared/geometry';

/** A deterministic PRNG (mulberry32): the same seed, the same hand, on every machine. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A loop drawn round a cluster: about 400 samples, one and an eighth turns of a wide oval, wobbling
 * in radius, drifting a little as it goes and never meeting its own tail.
 */
function handwrittenLoop(count = 400, seed = 20240511): Point[] {
  const random = prng(seed);
  const points: Point[] = [];
  const turns = 1.12;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const angle = t * Math.PI * 2 * turns - Math.PI / 2;
    // a slow wobble is the hand not holding the radius; the small term is the tremor of a mouse
    const radius = 150 + Math.sin(t * Math.PI * 5) * 7 + (random() - 0.5) * 2.5;
    points.push({
      x: Math.cos(angle) * radius + t * 12,
      y: Math.sin(angle) * radius * 0.78 + t * 6,
    });
  }
  return points;
}

/**
 * An underline drawn under a note: about 120 samples, mostly straight, sagging a little in the
 * middle the way a short horizontal stroke does.
 */
function underline(count = 120, seed = 991): Point[] {
  const random = prng(seed);
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    points.push({
      x: t * 320 + (random() - 0.5) * 1.5,
      y: Math.sin(t * Math.PI) * 3.5 + (random() - 0.5) * 1.8,
    });
  }
  return points;
}

/**
 * A drag that goes on for ever: 5,010 samples spiralling outwards, which is `STROKE_MAX_POINTS` plus
 * ten, so a tool that has to split a stroke has to do it before the last ten points land.
 */
function longSpiral(count = 5010, seed = 5): Point[] {
  const random = prng(seed);
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const angle = i * 0.05;
    const radius = 4 + t * 380;
    points.push({
      x: Math.cos(angle) * radius + (random() - 0.5) * 1.2,
      y: Math.sin(angle) * radius + (random() - 0.5) * 1.2,
    });
  }
  return points;
}

/** The loop, as a pointer path in world units (its middle is near the origin). */
export const HANDWRITTEN_LOOP: readonly Point[] = Object.freeze(handwrittenLoop());

/** The underline, starting at its own origin and running 320 units to the right. */
export const UNDERLINE_PATH: readonly Point[] = Object.freeze(underline());

/** The over-long drag, used by the point-limit boundary cases. */
export const LONG_SPIRAL: readonly Point[] = Object.freeze(longSpiral());
