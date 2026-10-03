// Recorded pointer paths for story 11.
//
// The smoothing contract is a statement about a *hand*: "no point of the finished stroke lies
// farther than 1 screen pixel from the path the user drew" is only interesting for a path that
// wobbles and stutters the way a real one does, so the fixtures are hand-shaped rather than
// clean — a loop that overshoots its own starting point, an underline that sags, a spiral that
// just goes on and on until it reaches the point limit.
//
// They are *generated deterministically* rather than pasted from one person's mouse: a seeded
// generator gives the same jitter in every run and on every machine (a test whose point count
// changes between runs cannot assert a boundary), and it gives the long fixture any length a
// test needs, which a single recording cannot.
//
// Points are in screen pixels, because that is the space a pointer travels in: the unit tests
// read them as world points at zoom 1, and the e2e tests replay them with `page.mouse.move`.

import type { Point } from '../../src/shared/geometry';

/** mulberry32: small, deterministic, and good enough to pass for a shaky hand. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand's sideways/vertical error, in pixels: ±`px` around zero. */
function jitter(next: () => number, px: number): number {
  return (next() - 0.5) * 2 * px;
}

/**
 * The circle a person draws round a cluster of notes: 400 samples, an ellipse rather than a
 * circle (a wrist sweeps wider than it lifts), a slow wobble on the radius (the arm), a
 * half-pixel tremor (the hand), and an overshoot, because a hand does not stop exactly where
 * it started.
 */
export function handwrittenLoop(count = 400, seed = 11): Point[] {
  const next = random(seed);
  const centre = { x: 420, y: 300 };
  const radius = { x: 190, y: 120 };
  // 1.06 turns: the pen comes back past the point it left, the way it does in real life.
  const turns = Math.PI * 2 * 1.06;
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * turns;
    // A slow wobble: two long waves round the loop, never more than 4 px.
    const wobble = Math.sin(t * 2 + 0.7) * 3 + Math.cos(t * 3) * 1.2;
    const rx = radius.x + wobble;
    const ry = radius.y - wobble * 0.5;
    points.push({
      x: centre.x + Math.cos(t) * rx + jitter(next, 0.7),
      y: centre.y + Math.sin(t) * ry + jitter(next, 0.7),
    });
  }
  return points;
}

/**
 * The underline under one sticky note: ~120 samples along a line that sags in the middle and
 * lifts at the end — the shape a forearm makes when it is pulled across a page — with the same
 * tremor on top.
 */
export function underline(count = 120, seed = 22): Point[] {
  const next = random(seed);
  const from = { x: 80, y: 470 };
  const to = { x: 520, y: 476 };
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    // Half a sine of sag: down 7 px at the middle, back to nothing at the end.
    const sag = Math.sin(t * Math.PI) * 7 - Math.sin(t * Math.PI * 2) * 2;
    // A hand accelerates through the middle and slows at both ends.
    const eased = t - Math.sin(t * Math.PI * 2) / (Math.PI * 4);
    points.push({
      x: from.x + (to.x - from.x) * eased + jitter(next, 0.6),
      y: from.y + (to.y - from.y) * t + sag + jitter(next, 0.6),
    });
  }
  return points;
}

/**
 * A stroke long enough to have to be split: an outward spiral, so every point is a little
 * farther out than the last and the path never doubles exactly back on itself. `count` is a
 * parameter because the interesting numbers are `STROKE_MAX_POINTS - 1`, exactly that, and one
 * more than that.
 */
export function spiral(count: number, seed = 33): Point[] {
  const next = random(seed);
  const centre = { x: 640, y: 520 };
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i * 0.05;
    const radius = 4 + t * 2.2;
    points.push({
      x: centre.x + Math.cos(t) * radius + jitter(next, 0.4),
      y: centre.y + Math.sin(t) * radius + jitter(next, 0.4),
    });
  }
  return points;
}

/** The count `STROKE_MAX_POINTS` is compared against in TC-03 and TC-12. */
export const SPIRAL_LONG_COUNT = 5_010;

/** The three fixtures, made once so the counts in the tests are the real counts. */
export const HANDWRITTEN_LOOP: readonly Point[] = handwrittenLoop();
export const UNDERLINE: readonly Point[] = underline();
export const LONG_SPIRAL: readonly Point[] = spiral(SPIRAL_LONG_COUNT);

/**
 * The path as a list of `[x, y]` pairs, which is what a test hands to `page.mouse.move` in one
 * `evaluate` without shipping the same numbers twice.
 */
export function pairs(points: readonly Point[]): [number, number][] {
  return points.map((p) => [p.x, p.y]);
}
