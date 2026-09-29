// Story 11 fixtures: pointer paths a real hand would leave on the board.
//
// Nothing here is a straight line. Every path is a shape somebody could actually have
// drawn — a circle round a cluster of notes, an underline, one very long continuous
// stroke — with the wobble a mouse or a trackpad adds, generated from a fixed seed so
// the same points come out of every run (a test that measured a different stroke each
// time could not assert a distance to it).
//
// The points are in board units at zoom 1, which is what the Pen tool records: the
// story's maths (simplify, split, scale, hit-test) is all in the same units.

import type { Point } from '../../src/shared/geometry.ts';
import { STROKE_MAX_POINTS } from '../../src/shared/config.ts';

/** A tiny deterministic pseudo-random generator (numerical recipes' LCG). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * A hand-drawn circle round a cluster of notes: ~400 points, closed but not quite —
 * the pen crosses itself where the hand came back — with a slow wobble in the radius
 * plus sub-pixel jitter on every point.
 */
export const HANDWRITTEN_LOOP: Point[] = (() => {
  const rand = seeded(20250711);
  const cx = 420;
  const cy = 300;
  const r = 150;
  const turns = 400;
  const out: Point[] = [];
  for (let i = 0; i < turns; i++) {
    // A little past a full circle, the way a hand overshoots the point it started at.
    const t = (i / (turns - 1)) * (Math.PI * 2 * 1.04);
    const wobble = 3 * Math.sin(3 * t) + 1.6 * Math.cos(7 * t + 0.4);
    const jitter = (rand() - 0.5) * 1.2;
    const radius = r + wobble + jitter;
    out.push({ x: round(cx + radius * Math.cos(t - Math.PI / 2)), y: round(cy + radius * Math.sin(t - Math.PI / 2)) });
  }
  return out;
})();

/**
 * A hand-drawn underline: ~120 points along a nearly-straight run that sags, rises at
 * the end and carries the same sub-pixel jitter.
 */
export const UNDERLINE: Point[] = (() => {
  const rand = seeded(777);
  const x0 = 120;
  const y0 = 500;
  const len = 560;
  const steps = 120;
  const out: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const sag = 6 * Math.sin(Math.PI * u); // the middle sits lower than the ends
    const lift = 10 * u * u * u; // and it flicks up at the end
    out.push({
      x: round(x0 + len * u),
      y: round(y0 + sag - lift + (rand() - 0.5) * 1.1),
    });
  }
  return out;
})();

/**
 * One very long continuous stroke: more than STROKE_MAX_POINTS points, so the Pen tool
 * has to finish it and go on drawing. A spiral, because it never overlaps itself at the
 * scale the stroke is drawn at and so keeps the join between the two parts checkable.
 */
export const LONG_SPIRAL: Point[] = (() => {
  const rand = seeded(31337);
  const cx = 600;
  const cy = 400;
  const n = STROKE_MAX_POINTS + 10;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.02;
    const radius = 4 + i * 0.06;
    out.push({
      x: round(cx + radius * Math.cos(t) + (rand() - 0.5) * 0.8),
      y: round(cy + radius * Math.sin(t) + (rand() - 0.5) * 0.8),
    });
  }
  return out;
})();

/** Two points, the shortest stroke that is not a dot. */
export const TWO_POINTS: Point[] = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
];

/** Three points, the shortest path the smoothing has something to bend. */
export const THREE_POINTS: Point[] = [
  { x: 100, y: 100 },
  { x: 200, y: 160 },
  { x: 300, y: 100 },
];

/** One point: the click that draws a dot. */
export const ONE_POINT: Point[] = [{ x: 250, y: 250 }];

/** A path of exactly `n` points on a straight run, for boundary testing. */
export function straightRun(n: number, x0 = 0, y0 = 0, step = 10): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, y: y0 }));
}

/** Two decimals is finer than a screen pixel at any zoom the board can reach. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A copy of a path, so a test can mutate it without disturbing the fixture. */
export function copyPath(path: readonly Point[]): Point[] {
  return path.map((p) => ({ x: p.x, y: p.y }));
}
