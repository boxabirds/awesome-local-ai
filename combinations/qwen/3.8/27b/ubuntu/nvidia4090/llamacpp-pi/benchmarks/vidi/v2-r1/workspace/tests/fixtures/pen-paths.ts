// Story 11 fixtures (design "Fixtures"): recorded realistic pointer paths.
//
//  - HANDWRITTEN_LOOP: a handwritten circle-the-cluster loop, ~400 points
//    with per-sample jitter (the kind of path a mouse drag records).
//  - UNDERLINE: a roughly horizontal underline, ~120 points.
//  - SPIRAL_5010: a synthetic 5,010-point spiral (STROKE_MAX_POINTS + 10)
//    for the very-long-stroke boundary tests (TC-03, TC-12).
//
// The paths are world-space points, generated deterministically (fixed
// seed) so every run — unit, component and e2e — replays the same path.

import type { Point } from '../../src/shared/geometry';

/** Deterministic PRNG (mulberry32) so the "recorded" paths are stable. */
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
 * A handwritten loop: one circuit around a rough circle of radius ~60
 * centred at (0, 0), 400 samples. The radius wobbles, the angular speed
 * varies and each sample carries ±1.5 world units of jitter — the classic
 * shaky freehand input the smoothing must tame.
 */
function handwrittenLoop(): Point[] {
  const rnd = mulberry32(0x5eed1);
  const n = 400;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    // Slightly eased angle so the writer "lingers" on the left side.
    const u = i / (n - 1);
    const theta = u * Math.PI * 2 + 0.04 * Math.sin(u * Math.PI * 6);
    const radius =
      60 + 5 * Math.sin(theta * 3 + 1.1) + 3 * Math.sin(theta * 7) + (rnd() - 0.5) * 3;
    pts.push({
      x: radius * Math.cos(theta) + (rnd() - 0.5) * 2.4,
      y: radius * Math.sin(theta) + (rnd() - 0.5) * 2.4,
    });
  }
  return pts;
}

/**
 * An underline: 120 samples across x = 0..240 at y ≈ 0 with a gentle wave
 * and ±0.6 world units of jitter.
 */
function underline(): Point[] {
  const rnd = mulberry32(0x5eed2);
  const n = 120;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const u = i / (n - 1);
    pts.push({
      x: u * 240 + (rnd() - 0.5) * 0.8,
      y: 2 * Math.sin(u * Math.PI * 3) + (rnd() - 0.5) * 1.2,
    });
  }
  return pts;
}

/**
 * A synthetic Archimedean spiral with exactly 5,010 points
 * (STROKE_MAX_POINTS + 10) for the long-stroke boundary tests.
 */
function spiral5010(): Point[] {
  const n = 5010;
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const theta = i * 0.12;
    const radius = 4 + 0.085 * i;
    pts.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta) });
  }
  return pts;
}

export const HANDWRITTEN_LOOP: readonly Point[] = Object.freeze(handwrittenLoop());
export const UNDERLINE: readonly Point[] = Object.freeze(underline());
export const SPIRAL_5010: readonly Point[] = Object.freeze(spiral5010());
