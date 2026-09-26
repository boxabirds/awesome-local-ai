/**
 * Recorded pointer paths for the pen (story 11).
 *
 * The three paths a pen test needs are all "handwritten": a closed loop drawn
 * around a cluster of notes, a flat underline, and one continuous stroke long
 * enough to hit the point limit. They are produced by a seeded generator rather
 * than pasted from a mouse recording so that a run is reproducible, but the
 * shape is what a recording looks like: a hand does not follow its own first
 * pass, and a trackpad reports more points than the screen can show.
 *
 * Coordinates are world units at zoom 1 (one unit is one screen pixel at
 * 100%), which is how the pen captures them.
 */
import type { Point } from '../../src/shared/geometry';

/** Deterministic PRNG (mulberry32): the same fixture on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A loop drawn clockwise from the left, closing slightly past its start, the
 * way a circle round a cluster is drawn in one stroke.
 *
 * Two kinds of noise are added on purpose: a slow wobble (the arm drifts
 * outward on the way round) and per-point jitter (a mouse reports more points
 * than the eye can see). Without them the path would be a smooth curve that
 * any simplifier handles, and "shaky lines" is the thing under test.
 */
export function handwrittenLoop(options: {
  centre?: Point;
  radius?: number;
  points?: number;
  seed?: number;
  jitter?: number;
  wobble?: number;
}): Point[] {
  const centre = options.centre ?? { x: 300, y: 300 };
  const radius = options.radius ?? 120;
  const count = options.points ?? 400;
  const random = seededRandom(options.seed ?? 0x5eed);
  const jitter = options.jitter ?? 0.9;
  const wobble = options.wobble ?? 2.4;

  const path: Point[] = [];
  // Start a little outside the circle and end a little past it: a hand does
  // not stop where it began.
  const startAngle = -0.25;
  const turn = Math.PI * 2 + 0.6;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const angle = startAngle + turn * t;
    // The wobble grows through the stroke and the radius opens slightly, so
    // the return pass does not retrace the first one.
    const drift = wobble * Math.sin(t * Math.PI * 2.5) + 6 * t;
    const r = radius + drift;
    const x = centre.x + r * Math.cos(angle) + (random() - 0.5) * 2 * jitter;
    const y = centre.y + r * Math.sin(angle) + (random() - 0.5) * 2 * jitter;
    path.push({ x, y });
  }
  return path;
}

/**
 * A flat underline under a note, drawn left to right with the two ends lifted
 * a little — about 120 points of nearly-straight travel.
 */
export function underline(options: {
  from?: Point;
  length?: number;
  points?: number;
  seed?: number;
  jitter?: number;
}): Point[] {
  const from = options.from ?? { x: 120, y: 430 };
  const length = options.length ?? 240;
  const count = options.points ?? 120;
  const random = seededRandom(options.seed ?? 0xbeef);
  const jitter = options.jitter ?? 0.7;

  const path: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    // The pen dips in the middle and lifts at both ends.
    const lift = -3 * Math.sin(Math.PI * t) + 1.5 * Math.sin(Math.PI * 3 * t);
    const x = from.x + length * t + (random() - 0.5) * 2 * jitter;
    const y = from.y + lift + (random() - 0.5) * 2 * jitter;
    path.push({ x, y });
  }
  return path;
}

/**
 * One continuous stroke of `points` samples: an outward spiral, which keeps
 * moving (so the capture never stops) and stays near the middle of the board.
 *
 * The default of 5,010 points is the point-limit boundary: `STROKE_MAX_POINTS`
 * plus the ten extra moves the component test adds.
 */
export function longSpiral(options: {
  centre?: Point;
  points?: number;
  seed?: number;
  jitter?: number;
}): Point[] {
  const centre = options.centre ?? { x: 400, y: 400 };
  const count = options.points ?? 5010;
  const random = seededRandom(options.seed ?? 0xc0ffee);
  const jitter = options.jitter ?? 0.5;

  const path: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / 40;
    const r = 6 + i * 0.012;
    const x = centre.x + r * Math.cos(t) + (random() - 0.5) * 2 * jitter;
    const y = centre.y + r * Math.sin(t) + (random() - 0.5) * 2 * jitter;
    path.push({ x, y });
  }
  return path;
}

/** Flatten a path to the `[x0, y0, x1, y1, ...]` layout the document stores. */
export function flatten(path: readonly Point[]): number[] {
  const out: number[] = [];
  for (const p of path) {
    out.push(p.x, p.y);
  }
  return out;
}

/** The three recorded paths, at their recorded sizes. */
export const HANDWRITTEN_LOOP: Point[] = handwrittenLoop({});
export const UNDERLINE: Point[] = underline({});
export const LONG_SPIRAL: Point[] = longSpiral({});
