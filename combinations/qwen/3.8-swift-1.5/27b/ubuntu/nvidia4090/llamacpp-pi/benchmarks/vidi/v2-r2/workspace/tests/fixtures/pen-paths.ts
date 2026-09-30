/**
 * Recorded realistic pointer paths for the pen (story 11 fixtures).
 *
 * Generated deterministically (seeded PRNG) to stand in for recorded input:
 * - `handwrittenLoop`: a loop-the-hoop gesture, ~400 jittery points.
 * - `underline`: a slightly wavering underline, ~120 points.
 * - `longSpiral`: a synthetic 5,010-point spiral (long-stroke boundary).
 */
import type { Point } from '../../src/shared/geometry';

/** Deterministic PRNG (mulberry32) so the "recordings" are stable. */
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

function makeLoop(): Point[] {
  const rnd = mulberry32(0x5eed);
  const pts: Point[] = [];
  const N = 400;
  // A hand-drawn loop: ellipse-ish path with radius wobble + jitter,
  // overlapping its start (like circling a cluster of notes).
  const cx = 100;
  const cy = 80;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI * 2 * 1.05; // slightly more than one turn
    const r = 1 + 0.12 * Math.sin(t * 3 + 0.7);
    const x = cx + 90 * r * Math.cos(t) + (rnd() - 0.5) * 3;
    const y = cy + 70 * r * Math.sin(t) + (rnd() - 0.5) * 3;
    pts.push({ x, y });
  }
  return pts;
}

function makeUnderline(): Point[] {
  const rnd = mulberry32(0x53c1);
  const pts: Point[] = [];
  const N = 120;
  // A left-to-right underline with a gentle wave and jitter.
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = 20 + t * 160;
    const y = 140 + 4 * Math.sin(t * Math.PI * 2) + (rnd() - 0.5) * 1.5;
    pts.push({ x, y });
  }
  return pts;
}

function makeSpiral(): Point[] {
  const rnd = mulberry32(0x11ab);
  const pts: Point[] = [];
  const N = 5010; // STROKE_MAX_POINTS + 10
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI * 2 * 20; // 20 turns
    const r = 5 + t * 2;
    pts.push({
      x: 300 + r * Math.cos(t) + (rnd() - 0.5) * 0.5,
      y: 200 + r * Math.sin(t) + (rnd() - 0.5) * 0.5,
    });
  }
  return pts;
}

export const handwrittenLoop: Point[] = makeLoop();
export const underline: Point[] = makeUnderline();
export const longSpiral: Point[] = makeSpiral();
