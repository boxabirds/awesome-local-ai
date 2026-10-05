/**
 * Recorded pointer paths for the pen (story 11 fixtures). Deterministic:
 * generated with a seeded PRNG so every run replays the exact same "recorded"
 * gesture. Points are world coordinates at zoom 1, centred near the default
 * board centre (640, 400) so they land on screen with the default camera.
 */
import type { Point } from '../../src/shared/geometry';

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CX = 640;
const CY = 400;

/**
 * A handwritten loop: roughly one-and-a-half turns around the centre with
 * varying radius, hand jitter and non-uniform speed. ~400 points.
 */
function makeHandwrittenLoop(): Point[] {
  const rnd = mulberry32(0x5eed11);
  const points: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    // Slightly super-linear angle so the loop lingers near the start.
    const t = i / (n - 1);
    const angle = t * Math.PI * 3 + 0.6 * Math.sin(t * 7);
    // Radius wobbles like a hand: base 90 + slow swell + fast ripple.
    const radius =
      90 + 18 * Math.sin(t * Math.PI * 2) + 7 * Math.sin(t * Math.PI * 9);
    const jitterX = (rnd() - 0.5) * 3.5;
    const jitterY = (rnd() - 0.5) * 3.5;
    points.push({
      x: CX + radius * Math.cos(angle) + jitterX,
      y: CY + radius * 0.82 * Math.sin(angle) + jitterY,
    });
  }
  return points;
}

/**
 * An underline: a near-horizontal stroke with slight hand wobble. ~120 points.
 */
function makeUnderline(): Point[] {
  const rnd = mulberry32(0x5eed22);
  const points: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    points.push({
      x: 540 + t * 200,
      y: 470 + 2.5 * Math.sin(t * Math.PI * 3) + (rnd() - 0.5) * 1.5,
    });
  }
  return points;
}

/**
 * A synthetic long stroke: an expanding spiral with 5,010 points (one more
 * than STROKE_MAX_POINTS) for the long-stroke split cases.
 */
function makeLongSpiral(): Point[] {
  const rnd = mulberry32(0x5eed33);
  const points: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const angle = t * Math.PI * 24;
    const radius = 8 + t * 60;
    points.push({
      x: CX + radius * Math.cos(angle) + (rnd() - 0.5) * 0.8,
      y: CY + radius * Math.sin(angle) + (rnd() - 0.5) * 0.8,
    });
  }
  return points;
}

export const penPaths = {
  /** ~400-point handwritten loop with jitter. */
  handwrittenLoop: makeHandwrittenLoop(),
  /** ~120-point underline. */
  underline: makeUnderline(),
  /** 5,010-point spiral (STROKE_MAX_POINTS + 10). */
  longSpiral: makeLongSpiral(),
};
