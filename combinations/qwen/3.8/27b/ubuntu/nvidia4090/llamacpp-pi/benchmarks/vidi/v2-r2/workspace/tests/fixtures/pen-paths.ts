/**
 * Story 11 pen fixtures: deterministic world-space point paths for the
 * simplify / long-stroke unit tests (design TC-01 to TC-03) and the e2e
 * drag replays (TC-17):
 *
 * - `handwrittenLoop`: an open ellipse (~400 points) with small per-point
 *   jitter, as a hand-drawn loop of a circle would look.
 * - `underline`: a mostly straight horizontal line (~120 points) with a
 *   slight wave and jitter.
 * - `longSpiral`: an Archimedean spiral of exactly n points, for the
 *   STROKE_MAX_POINTS split (5010 > 5000).
 *
 * A fixed-seed mulberry32 PRNG keeps every run reproducible.
 */
import type { Point } from '../../src/shared/geometry';

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand-drawn loop: a jittery open ellipse of ~400 points. */
export function handwrittenLoop(): Point[] {
  const rand = mulberry32(0x5eed);
  const points: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    const jitterX = (rand() - 0.5) * 6; // ±3 world units
    const jitterY = (rand() - 0.5) * 6;
    points.push({
      x: 120 * Math.cos(t) + jitterX,
      y: 70 * Math.sin(t) + jitterY,
    });
  }
  return points;
}

/** A mostly straight underline of ~120 points (a slight wave, ±1 jitter). */
export function underline(): Point[] {
  const rand = mulberry32(0x5e01);
  const points: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    points.push({
      x: t * 240,
      y: 4 * Math.sin(t * Math.PI) + (rand() - 0.5) * 2,
    });
  }
  return points;
}

/** An Archimedean spiral of exactly n points (all finite). */
export function longSpiral(n: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.02;
    const r = 2 + t * 1.5;
    points.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return points;
}
