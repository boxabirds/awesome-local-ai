/**
 * Story 11: recorded pointer paths.
 *
 * These are the shapes a hand actually makes, as board points: a loop drawn around a
 * cluster of notes, an underline dragged under one, and a spiral long enough to run
 * past the point limit. They are generated from a fixed seed rather than typed out, so
 * every run of every suite bends, jitters and splits in exactly the same place — which
 * is what lets a test say "the finished stroke has fewer points than this" and mean it.
 *
 * The jitter is the shaky part. A perfect circle simplifies to almost nothing and
 * proves nothing; a hand-held one keeps a few points and drops most, and the
 * assertions about faithfulness are made against *that*.
 */

import type { Point } from '../../src/shared/geometry';

/**
 * A tiny deterministic generator (mulberry32). Not a cryptographic hash and never
 * used for anything but the wobble of a drawn line.
 */
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

/** Wobble of this amplitude, in board units, both ways. */
function jitter(next: () => number, amplitude: number): Point {
  return { x: (next() * 2 - 1) * amplitude, y: (next() * 2 - 1) * amplitude };
}

export interface PathOptions {
  /** How many points the path is sampled at. */
  points?: number;
  /** How far each point wanders from the ideal line, in board units. */
  wobble?: number;
  /** Where the path is placed on the board. */
  centre?: Point;
}

/**
 * A closed loop, like the one drawn around a cluster of notes: an ellipse taken in
 * slightly unequal steps, because a hand does not travel at a constant speed.
 */
export function handwrittenLoop(options: PathOptions = {}): Point[] {
  const count = options.points ?? 400;
  const wobble = options.wobble ?? 1.2;
  const centre = options.centre ?? { x: 400, y: 300 };
  const radius = { x: 180, y: 120 };
  const next = random(0x5eed11);
  const path: Point[] = [];
  // The angle advances unevenly: a hand slows round the corners and hurries along the
  // straights, which is why the raw path has more points than the drawing needs.
  let angle = 0;
  for (let i = 0; i < count; i += 1) {
    angle += (Math.PI * 2) / count + (next() - 0.5) * 0.012;
    const w = jitter(next, wobble);
    path.push({
      x: centre.x + Math.cos(angle) * radius.x + w.x,
      y: centre.y + Math.sin(angle) * radius.y + w.y,
    });
  }
  return path;
}

/**
 * A roughly horizontal underline dragged under a note: 120 points over 320 board
 * units, with the vertical wander of a wrist moving sideways.
 */
export function underline(options: PathOptions = {}): Point[] {
  const count = options.points ?? 120;
  const wobble = options.wobble ?? 1;
  const start = options.centre ?? { x: 100, y: 500 };
  const length = 320;
  const next = random(0xbeef11);
  const path: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const w = jitter(next, wobble);
    // The drift is the hand falling as it runs out of road; the wobble is the shake.
    path.push({
      x: start.x + length * t + (next() - 0.5) * 2,
      y: start.y + Math.sin(t * Math.PI) * 3 + w.y,
    });
  }
  return path;
}

/**
 * A spiral long enough to pass the point limit: the same gesture, wound inward, at
 * whatever length a test asks for (the coverage table's 5,010-point drag).
 */
export function longSpiral(points = 5010, options: PathOptions = {}): Point[] {
  const centre = options.centre ?? { x: 600, y: 400 };
  const next = random(0x1dea11);
  const path: Point[] = [];
  for (let i = 0; i < points; i += 1) {
    const angle = i * 0.05;
    // The radius grows very slowly, so no two consecutive points are ever identical —
    // a limit test that stops moving would not exercise the restart.
    const radius = 40 + i * 0.02;
    const w = jitter(next, 0.4);
    path.push({
      x: centre.x + Math.cos(angle) * radius + w.x,
      y: centre.y + Math.sin(angle) * radius + w.y,
    });
  }
  return path;
}

/** A straight line of `count` points, `step` board units apart. */
export function straightLine(count = 50, step = 4, start: Point = { x: 0, y: 0 }): Point[] {
  return Array.from({ length: count }, (_, i) => ({ x: start.x + i * step, y: start.y }));
}

/** The three points of a right angle, the smallest path that is a corner. */
export const CORNER: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];
