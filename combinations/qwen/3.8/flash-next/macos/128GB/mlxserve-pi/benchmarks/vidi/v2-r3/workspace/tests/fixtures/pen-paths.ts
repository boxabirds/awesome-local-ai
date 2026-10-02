// Recorded pointer paths for the pen (story 11).
//
// A straight line is the easiest path a simplifier can have and so proves nothing:
// the interesting cases are a line a hand actually drew — wobbly, denser in some
// places than others, doubling back over itself — and a line long enough to reach
// the point limit, which nobody draws by hand but a test has to be able to.
//
// All three are produced from a fixed seed rather than `Math.random()`, because a
// fixture that changed between runs would make every assertion about how many
// points survived the simplification a question about the machine it ran on.
import type { Point } from '../../src/shared/geometry';

/** A tiny deterministic generator (mulberry32): same seed, same path, every run. */
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

/**
 * A handwritten loop — the kind a person draws round something on the board: one
 * turn of an ellipse, closed on itself, with the jitter a hand adds and the
 * uneven spacing a fast stroke has.
 *
 * ~400 points, all in board units at zoom 1.
 */
export function handwrittenLoop(count = 400): Point[] {
  const next = random(0x1157);
  const points: Point[] = [];
  const cx = 320;
  const cy = 240;
  const rx = 180;
  const ry = 110;
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * Math.PI * 2;
    // The hand is not a metronome: it lingers near the top and bottom of the turn.
    const phase = t + 0.12 * Math.sin(2 * t);
    // A radius that drifts, so the stroke is not a closed curve but an overlapping
    // one, which is what a real circle round an object looks like.
    const wobble = 1 + 0.04 * Math.sin(3 * t) + (next() - 0.5) * 0.03;
    points.push({
      x: cx + Math.cos(phase) * rx * wobble + (next() - 0.5) * 2.5,
      y: cy + Math.sin(phase) * ry * wobble + (next() - 0.5) * 2.5,
    });
  }
  return points;
}

/**
 * An underline — ~120 points along a nearly-straight line, with the small vertical
 * wander a wrist makes and the slight rise at the end. Mostly collinear points, so
 * a simplification is expected to keep very few of them.
 */
export function underline(count = 120): Point[] {
  const next = random(0x7ee);
  const points: Point[] = [];
  const x0 = 100;
  const y0 = 500;
  const length = 460;
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    points.push({
      x: x0 + u * length + (next() - 0.5) * 1.5,
      y: y0 + Math.sin(u * Math.PI * 3) * 3 + u * 6 + (next() - 0.5) * 1.5,
    });
  }
  return points;
}

/**
 * A spiral of exactly `count` points (5,010 by default, which is
 * `STROKE_MAX_POINTS` + 10): the path a test needs to reach the point limit and
 * go past it, without anybody drawing it.
 *
 * Its turns grow outward, so no two points coincide and every point is finite.
 */
export function spiral(count = 5010): Point[] {
  const points: Point[] = [];
  const cx = 600;
  const cy = 400;
  for (let i = 0; i < count; i++) {
    const t = i * 0.05;
    const radius = 4 + i * 0.02;
    points.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
  }
  return points;
}

/** `count` points along a horizontal line, with `jitter` added deterministically. */
export function straightLine(count = 50, step = 10, jitter = 0): Point[] {
  const next = random(0x51a1);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: i * step,
      y: jitter === 0 ? 0 : (next() - 0.5) * jitter,
    });
  }
  return points;
}
