// Story 11: recorded-style pen paths for the stroke unit and e2e tests.
//
// Deterministic generators (no Math.random) so the tests are reproducible.
// All points are in world units (board units).

import type { Point } from '../../src/shared/geometry';

/** A tiny deterministic pseudo-random in [0,1) from an integer seed. */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A "handwritten loop": roughly an ellipse traced with ~400 jittery points,
 * starting and ending at the right side (a slightly open loop, like circling
 * a cluster of notes). The jitter keeps it un-smoothable to a small number of
 * points (it is genuinely freehand), while the RDP tolerance (1 px) still
 * bounds the simplification error.
 */
export function handwrittenLoop(): Point[] {
  const cx = 0;
  const cy = 0;
  const rx = 90;
  const ry = 55;
  const n = 400;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2; // 0..2pi
    // A loop that does not quite close: ease the end back toward the start.
    const angle = t;
    const jx = (rand(i * 2 + 1) - 0.5) * 2.2; // jitter within ~1 world unit
    const jy = (rand(i * 2 + 2) - 0.5) * 2.2;
    points.push({ x: cx + Math.cos(angle) * rx + jx, y: cy + Math.sin(angle) * ry + jy });
  }
  return points;
}

/**
 * An "underline": ~120 points along a shallow horizontal line with a slight
 * vertical wobble (a hand-drawn underline under a note).
 */
export function underline(): Point[] {
  const n = 120;
  const y0 = 0;
  const x0 = 0;
  const width = 220;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + t * width;
    const y = y0 + Math.sin(t * Math.PI * 3) * 1.5 + (rand(i * 3 + 7) - 0.5) * 1.2;
    points.push({ x, y });
  }
  return points;
}

/**
 * A synthetic 5,010-point spiral (just over STROKE_MAX_POINTS) used for the
 * long-stroke split test: it is long enough to force a split, and its
 * consecutive points are close enough that the split join is seamless.
 */
export function longSpiral(): Point[] {
  const n = 5010;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 24; // 12 turns
    const r = 4 + i * 0.02; // radius grows slowly
    points.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return points;
}
