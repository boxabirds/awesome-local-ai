// Recorded pen paths for story 11 tests: a handwritten loop, an underline
// and a 5,010-point spiral (long-stroke boundary).
//
// The paths are "recorded" in the sense that they are fixed, realistic
// pointer traces (with per-point jitter, like a real mouse/trackpad
// capture). They are generated deterministically from a seeded PRNG so the
// suite is reproducible without checking in large data files.

import type { Point } from '../../src/shared/geometry';

/** mulberry32: small deterministic PRNG. */
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
 * Handwritten loop: one lap around a wobbly ellipse with radius variation
 * and per-point jitter. ~400 points, centred near the origin.
 */
export const handwrittenLoop: Point[] = (() => {
  const rand = mulberry32(0x5eed);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    // Slightly overshoot 360° like a real loop closure.
    const t = (i / (n - 1)) * Math.PI * 2 * 1.05;
    const r = 80 + 10 * Math.sin(t * 3) + (rand() - 0.5) * 6;
    pts.push({
      x: Math.cos(t) * r + (rand() - 0.5) * 4,
      y: Math.sin(t) * r * 0.8 + (rand() - 0.5) * 4,
    });
  }
  return pts;
})();

/** Underline: ~120 near-horizontal points with light jitter. */
export const underline: Point[] = (() => {
  const rand = mulberry32(0x71d3);
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({
      x: -90 + t * 180 + (rand() - 0.5) * 2,
      y: 130 + Math.sin(t * Math.PI) * 3 + (rand() - 0.5) * 2,
    });
  }
  return pts;
})();

/** Synthetic long stroke: a 5,010-point spiral (STROKE_MAX_POINTS + 10). */
export const longSpiral: Point[] = (() => {
  const pts: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2 * 4; // four turns
    const r = 10 + t * 3;
    pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return pts;
})();
