import type { Point } from '../../src/shared/geometry';

/**
 * Deterministic PRNG (mulberry32) so the "recorded" pointer paths below are
 * stable across runs and machines.
 */
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
 * A handwritten loop: ~400 jittery points, one and a quarter turns around a
 * rough circle of radius ~120 centred on the origin. Resembles a finger
 * tracing a loop on a whiteboard.
 */
export const handwrittenLoop: Point[] = (() => {
  const rand = mulberry32(11);
  const pts: Point[] = [];
  const N = 400;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI * 2 * 1.25;
    const r = 120 + (rand() - 0.5) * 8;
    pts.push({
      x: Math.cos(t) * r + (rand() - 0.5) * 3,
      y: Math.sin(t) * r + (rand() - 0.5) * 3,
    });
  }
  return pts;
})();

/**
 * An underline: ~120 points, a mostly-horizontal stroke 160 units long
 * centred on the origin with light hand wobble.
 */
export const underline: Point[] = (() => {
  const rand = mulberry32(22);
  const pts: Point[] = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    pts.push({
      x: -80 + t * 160 + (rand() - 0.5) * 1.5,
      y: (rand() - 0.5) * 2,
    });
  }
  return pts;
})();

/**
 * A synthetic very long stroke: 5,010 points on a 40-turn expanding spiral
 * (exceeds STROKE_MAX_POINTS = 5,000 to exercise the part-commit boundary).
 */
export const longSpiral: Point[] = (() => {
  const rand = mulberry32(33);
  const pts: Point[] = [];
  const N = 5010;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI * 2 * 40;
    const r = 10 + t * 30;
    pts.push({
      x: Math.cos(t) * r + (rand() - 0.5) * 1,
      y: Math.sin(t) * r + (rand() - 0.5) * 1,
    });
  }
  return pts;
})();
