/**
 * Recorded pointer paths for story 11 (`pen.*` tests).
 *
 * These stand in for a hand on a mouse: a jittery handwritten loop (~400
 * points), an underline (~120 points) and a synthetic 5,010-point spiral that
 * crosses `STROKE_MAX_POINTS`. All are generated from a seeded PRNG, so every
 * test run replays exactly the same path — a smoothing assertion that passes
 * by luck is not a smoothing assertion.
 */
import type { Point } from '../../src/shared/geometry';

/** mulberry32: a tiny deterministic PRNG (32-bit state, uniform output). */
function seeded(seed: number): () => number {
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
 * A handwritten loop around a cluster: one ellipse, ~400 points, jitter of a
 * couple of units, ending where it started like a real circle does not quite.
 */
export function handwrittenLoop(): Point[] {
  const random = seeded(0xa11ce);
  const points: Point[] = [];
  const steps = 400;
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * Math.PI * 2 * 1.04; // slightly over one lap
    const wobble = 1 + 0.04 * Math.sin(t * 5);
    const x = 200 + Math.cos(t) * 170 * wobble + (random() - 0.5) * 3;
    const y = 140 + Math.sin(t) * 110 * wobble + (random() - 0.5) * 3;
    points.push({ x, y });
  }
  return points;
}

/** An underline: left to right with a slight droop and hand jitter (~120 points). */
export function underline(): Point[] {
  const random = seeded(0xbeef);
  const points: Point[] = [];
  const steps = 120;
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1);
    const x = f * 300 + (random() - 0.5) * 1.5;
    const y = 40 + f * 6 + Math.sin(f * 9) * 1.2 + (random() - 0.5) * 2;
    points.push({ x, y });
  }
  return points;
}

/**
 * A synthetic spiral of exactly 5,010 points: far past `STROKE_MAX_POINTS`,
 * smooth enough that simplification collapses each part to a short list.
 */
export function spiral(): Point[] {
  const points: Point[] = [];
  const steps = 5010;
  for (let i = 0; i < steps; i++) {
    const t = i * 0.02;
    const r = 2 + t * 3;
    points.push({ x: 500 + Math.cos(t) * r, y: 400 + Math.sin(t) * r });
  }
  return points;
}

/** Translate a path so its first point sits at `at`. */
export function moveTo(points: readonly Point[], at: Point): Point[] {
  const dx = at.x - points[0].x;
  const dy = at.y - points[0].y;
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Scale a path about its first point (for zoomed-in e2e drags). */
export function scaleAboutFirst(points: readonly Point[], factor: number): Point[] {
  const first = points[0];
  return points.map((p) => ({
    x: first.x + (p.x - first.x) * factor,
    y: first.y + (p.y - first.y) * factor,
  }));
}
