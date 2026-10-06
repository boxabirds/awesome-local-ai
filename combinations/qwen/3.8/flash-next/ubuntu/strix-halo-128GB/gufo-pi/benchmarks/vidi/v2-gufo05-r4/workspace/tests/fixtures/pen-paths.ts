/**
 * Recorded pointer paths for the pen (story 11).
 *
 * These are not straight lines with noise bolted on at the end: each one is written the way a
 * hand writes — a shape the pen is going round, a speed that is never quite constant, and a
 * wobble of a fraction of a millimetre that no mouse path has. That matters because the thing
 * under test is *faithfulness*: "smoothed, but no farther than one screen pixel from what was
 * drawn" is only a real claim if the input is the messy kind a smoothing algorithm is asked to
 * tidy.
 *
 * Everything here is deterministic: a seeded generator, so a failing test fails the same way
 * twice and a passing one cannot be luck.
 */

import { STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';

/**
 * A tiny deterministic generator (a linear congruential one, the same maths everywhere), so a
 * "recorded" path is a function of its seed rather than of the machine that first ran it.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes' LCG: fine for jitter, never for cryptography.
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Roughly-normal noise in [-amplitude, amplitude], from a uniform generator. */
function noise(random: () => number, amplitude: number): number {
  return (random() + random() + random() - 1.5) * (amplitude / 0.75);
}

/** How many points a hand-drawn loop of a circle records at a normal speed. */
export const LOOP_POINT_COUNT = 400;

/** How many points a short underline records. */
export const UNDERLINE_POINT_COUNT = 120;

/** How many points one stroke is allowed to hold before it is split (`pen.long_stroke`). */
export const LONG_PATH_COUNT = STROKE_MAX_POINTS + 10;

export interface LoopOptions {
  readonly count?: number;
  /** Radius of the circle the hand is going round, in board units. */
  readonly radius?: number;
  readonly centre?: Point;
  readonly seed?: number;
}

/**
 * A closed-ish loop, like the circle drawn round a cluster of sticky notes.
 *
 * The radius breathes (a hand cannot hold a compass), the angular speed varies (the pen slows
 * on the far side), and every point carries a sub-unit wobble. The wobble is deliberately
 * smaller than the 1-unit smoothing tolerance in places and larger in others, which is what
 * makes "every raw point ends up within tolerance" a test rather than a tautology.
 */
export function handwrittenLoop(options: LoopOptions = {}): Point[] {
  const count = options.count ?? LOOP_POINT_COUNT;
  const radius = options.radius ?? 180;
  const centre = options.centre ?? { x: 0, y: 0 };
  const random = seeded(options.seed ?? 20251011);
  const points: Point[] = [];
  // A hand goes a little past the start rather than landing on it exactly.
  const turns = 1.06;
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    const theta = progress * Math.PI * 2 * turns - Math.PI / 2;
    // Two slow harmonics: the shape of the loop, then the pen's own unsteadiness.
    const breathe = radius + 7 * Math.sin(theta * 2 + 0.4) + 3 * Math.sin(theta * 5 + 1.1);
    // Uneven speed: more points where the pen turns.
    const speed = 1 + 0.25 * Math.sin(progress * Math.PI * 3);
    const angle = theta * speed - (speed - 1) * theta * 0.1;
    points.push({
      x: centre.x + breathe * Math.cos(angle) + noise(random, 0.7),
      y: centre.y + breathe * Math.sin(angle) + noise(random, 0.7)
    });
  }
  return points;
}

export interface UnderlineOptions {
  readonly count?: number;
  readonly from?: Point;
  readonly to?: Point;
  readonly seed?: number;
}

/**
 * An underline: mostly straight, drifting a little, and overshooting at the end the way a
 * quick horizontal stroke does.
 */
export function underline(options: UnderlineOptions = {}): Point[] {
  const count = options.count ?? UNDERLINE_POINT_COUNT;
  const from = options.from ?? { x: -140, y: 60 };
  const to = options.to ?? { x: 160, y: 64 };
  const random = seeded(options.seed ?? 777);
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    // Accelerate, then run past the end.
    const eased = progress < 0.7 ? progress / 0.7 : 1 + (progress - 0.7) * 0.15;
    points.push({
      x: from.x + (to.x - from.x) * eased + noise(random, 0.4),
      y: from.y + (to.y - from.y) * eased + 2 * Math.sin(progress * Math.PI) + noise(random, 0.4)
    });
  }
  return points;
}

/**
 * A spiral long enough to run into `STROKE_MAX_POINTS` and past it: what the pen has to split
 * (`pen.long_stroke`), and the reason the point limit is tested rather than trusted.
 */
export function longSpiral(options: { count?: number; seed?: number } = {}): Point[] {
  const count = options.count ?? LONG_PATH_COUNT;
  const random = seeded(options.seed ?? 4242);
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const theta = index * 0.02;
    // The radius grows without bound, so the path is never repeated and never closes.
    const radius = 20 + index * 0.05;
    points.push({
      x: radius * Math.cos(theta) + noise(random, 0.3),
      y: radius * Math.sin(theta) + noise(random, 0.3)
    });
  }
  return points;
}
