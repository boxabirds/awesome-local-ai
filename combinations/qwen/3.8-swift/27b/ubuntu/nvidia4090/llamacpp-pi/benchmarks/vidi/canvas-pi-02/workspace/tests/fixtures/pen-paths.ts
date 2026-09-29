// Recorded / synthetic pointer paths for the story 11 pen tests.
//
// handwrittenLoop: a realistic hand-drawn loop (~400 points) — a rough
// circle with per-point jitter and non-uniform speed, as captured from a
// real mouse drag around a cluster of sticky notes.
// underline: a hand-drawn underline sweep (~120 points) with the slight
// vertical waviness a real stroke has.
// longSpiral: a synthetic 5,010-point spiral, for the STROKE_MAX_POINTS
// split boundary tests (5,000 → 1 part; 5,001+ → 2 parts).
//
// Points are in world units (1:1 with screen pixels at 100% zoom).

import type { Point } from '../../src/shared/geometry';

function jitter(seed: number): number {
  // Deterministic pseudo-noise in [-0.5, 0.5] (tests must be reproducible).
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

/** A rough hand-drawn loop (~400 points) around the origin. */
function handwrittenLoop(): Point[] {
  const pts: Point[] = [];
  const n = 400;
  const laps = 1.02; // a hand never closes the loop exactly
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2 * laps;
    const r = 90 + Math.sin(t * 3.1) * 6 + jitter(i) * 3;
    const x = Math.cos(t) * r + jitter(i + 1000) * 2.5;
    const y = Math.sin(t) * r * 0.82 + jitter(i + 2000) * 2.5;
    pts.push({ x, y });
  }
  return pts;
}

/** A hand-drawn underline sweep (~120 points) with slight waviness. */
function underline(): Point[] {
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = -80 + t * 160 + jitter(i + 5000) * 1.5;
    const y = Math.sin(t * Math.PI * 2.2) * 2 + jitter(i + 6000) * 1.2;
    pts.push({ x, y });
  }
  return pts;
}

/** A synthetic spiral of exactly `n` points (default 5,010). */
function spiral(n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 * 6; // six turns
    const r = 4 + i * 0.02;
    pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return pts;
}

export const handwrittenLoopPath: readonly Point[] = handwrittenLoop();
export const underlinePath: readonly Point[] = underline();
export const longSpiralPath: readonly Point[] = spiral(5010);
