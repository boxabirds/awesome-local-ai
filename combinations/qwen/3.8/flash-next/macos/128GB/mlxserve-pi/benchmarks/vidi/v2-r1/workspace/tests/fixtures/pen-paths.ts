// Recorded pointer paths for the Pen tool's tests.
//
// Three paths, the three things a pen test needs to be long or short about: a loop the
// size of the circle somebody draws round a cluster of notes (long enough that
// smoothing has something to do), an underline (the shape a finished stroke most often
// has, and the one whose box is mostly empty air), and a spiral with more points in it
// than one stroke may hold (the only practical way to reach the limit in a test).
//
// The wobble is a seeded generator rather than `Math.random`, because these paths are
// the *input* to assertions about how many points survive smoothing: a path that changed
// between runs would make "the result has fewer points than the drawing" a coin toss.
import type { Point } from '../../src/shared/geometry';

/** A generator of the numbers in [0, 1): small, fast, and the same on every machine. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The jitter a hand puts on every sample, in board units, both ways from the line. */
const jitter = (random: () => number, amplitude: number): number =>
  (random() * 2 - 1) * amplitude;

/** How many samples the recorded loop holds. */
export const HANDWRITTEN_LOOP_POINTS = 400;

/**
 * A circle round a cluster of notes, drawn by hand: `points` samples of a circle of
 * `radius`, each pushed a little in or out and a little sideways, which is what a wrist
 * does. It comes back to where it started, so this is a closed loop, and the last point
 * is not the first — a pen lifts.
 */
export function handwrittenLoop(
  center: Point = { x: 0, y: 0 },
  radius = 180,
  points = HANDWRITTEN_LOOP_POINTS,
): Point[] {
  const random = seeded(0xc0ffee);
  const path: Point[] = [];
  // A hand does not travel at a constant rate: the sweep wobbles around the average.
  let wobble = 0;
  for (let i = 0; i < points; i += 1) {
    const turn = (i / points) * Math.PI * 2;
    wobble = wobble * 0.8 + jitter(random, 0.012);
    const angle = turn + wobble;
    const reach = radius + jitter(random, 3) + Math.sin(turn * 3) * 4;
    path.push({
      x: center.x + Math.cos(angle) * reach,
      y: center.y + Math.sin(angle) * reach,
    });
  }
  return path;
}

/** How many samples the recorded underline holds. */
export const UNDERLINE_POINTS = 120;

/**
 * An underline: `points` samples along a line `length` long, sagging in the middle and
 * jittering as they go, starting where `from` is. Nearly straight, which is the point —
 * it is the path whose bounding box is hundreds of units of empty air with four units of
 * ink in it.
 */
export function underline(
  from: Point = { x: -200, y: 0 },
  length = 400,
  points = UNDERLINE_POINTS,
): Point[] {
  const random = seeded(0xbadc0de);
  const path: Point[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    path.push({
      x: from.x + length * t + jitter(random, 0.6),
      y: from.y + Math.sin(t * Math.PI) * 6 + jitter(random, 0.6),
    });
  }
  return path;
}

/** More points than one stroke may hold, which is what the limit is tested with. */
export const SPIRAL_POINTS = 5_010;

/**
 * A synthetic spiral of `points` samples, ~5,010 of them by default: one and a half
 * pixels between neighbours, so it is a plausible drawing rather than a wall of noise,
 * and long enough to cross `STROKE_MAX_POINTS` on its way through.
 */
export function spiral(center: Point = { x: 0, y: 0 }, points = SPIRAL_POINTS): Point[] {
  const path: Point[] = [];
  for (let i = 0; i < points; i += 1) {
    // One point per frame at 60 fps, travelling 1.5 units a frame: about a minute and
    // a half of drawing, which is what a big sketch costs.
    const angle = i * 0.01;
    const reach = 20 + i * 0.03;
    path.push({
      x: center.x + Math.cos(angle) * reach,
      y: center.y + Math.sin(angle) * reach,
    });
  }
  return path;
}
