import type { Point } from '../../src/shared/geometry';
import { STROKE_MAX_POINTS } from '../../src/shared/config';

/**
 * Recorded pointer paths (story 11 design "Fixtures").
 *
 * A pen test is only as good as the hand it imitates: a mathematically perfect
 * circle would be simplified away by every tolerance, and a purely random scribble
 * would make the numbers move from run to run. These are drawn from a fixed seed,
 * so a test that expects "fewer points after simplifying" or "every raw point within
 * 0.5 units" expects something true on every machine, in every run.
 */

/** mulberry32: a small deterministic PRNG, so the jitter is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jitter of ±`amplitude` board units, deterministic for a given seed. */
function jitter(random: () => number, amplitude: number): Point {
  return { x: (random() * 2 - 1) * amplitude, y: (random() * 2 - 1) * amplitude };
}

/**
 * A handwritten loop around a cluster of notes: ~400 points that overshoot the
 * closing point the way a hand does, each wobbling by up to 1.2 units.
 */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const random = prng(0x5eed11);
  const points: Point[] = [];
  const cx = 320;
  const cy = 240;
  const steps = 400;
  const from = -0.35 * Math.PI;
  const to = 1.75 * Math.PI; // past a full turn: a hand overshoots where it started
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const angle = from + (to - from) * t;
    // Slightly egg-shaped and off-centre, because a wrist is not a compass.
    const rx = 150 + 8 * Math.sin(angle * 3);
    const ry = 118 + 6 * Math.cos(angle * 2);
    const wobble = jitter(random, 1.2);
    points.push({
      x: Math.round((cx + Math.cos(angle) * rx + wobble.x) * 1000) / 1000,
      y: Math.round((cy + Math.sin(angle) * ry + wobble.y) * 1000) / 1000,
    });
  }
  return points;
})();

/** A quick underline under a sticky note: ~120 points along a slightly bowed line. */
export const UNDERLINE: readonly Point[] = (() => {
  const random = prng(0x5eed22);
  const points: Point[] = [];
  const steps = 120;
  const x0 = 60;
  const y0 = 40;
  const length = 500;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const wobble = jitter(random, 0.8);
    points.push({
      x: Math.round((x0 + length * t + wobble.x) * 1000) / 1000,
      y: Math.round((y0 + 6 * Math.sin(t * Math.PI) + wobble.y) * 1000) / 1000,
    });
  }
  return points;
})();

/**
 * A spiral long enough to hit the point limit and step past it (PRD
 * `pen.long_stroke`, TC-03/TC-12): exactly `STROKE_MAX_POINTS + 10` points.
 */
export const LONG_SPIRAL: readonly Point[] = (() => {
  const random = prng(0x5eed33);
  const total = STROKE_MAX_POINTS + 10;
  const points: Point[] = [];
  const cx = 900;
  const cy = 700;
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const angle = t * 60 * Math.PI;
    const radius = 4 + 220 * t;
    const wobble = jitter(random, 0.4);
    points.push({
      x: Math.round((cx + Math.cos(angle) * radius + wobble.x) * 100) / 100,
      y: Math.round((cy + Math.sin(angle) * radius + wobble.y) * 100) / 100,
    });
  }
  return points;
})();

/** A stroke's own `Point` list, copied so a test can move it without editing the fixture. */
export function copyPath(points: readonly Point[]): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}
