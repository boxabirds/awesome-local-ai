// Recorded pointer paths for story 11 (design `Fixtures`).
//
// They are GENERATED once, from a fixed seed, rather than written out by hand: a
// handwritten line is a smooth path plus the shake of a hand, and both halves are
// easy to describe and tedious to type. A fixed seed means every run of every test
// draws exactly the same stroke, which is what makes "every raw point lies within
// the tolerance of the result" an assertion rather than a coin flip.
//
// All coordinates are world units at zoom 1 (1 screen pixel == 1 world unit), so a
// test that wants the stroke somewhere else on the board offsets or scales it.
import type { Point } from '../../src/shared/geometry.ts';

// mulberry32: a tiny deterministic PRNG, so these paths never change.
function seeded(seed: number): () => number {
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
 * A handwritten loop: about 1.05 turns of a circle of radius 120 centred on
 * (220, 200), with a slow wobble of the radius (the arm) and a shake of a few
 * units (the hand). 400 points.
 */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const rnd = seeded(20110711);
  const out: Point[] = [];
  const cx = 220;
  const cy = 200;
  const r = 120;
  const turns = 1.05;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const angle = -Math.PI / 3 + t * Math.PI * 2 * turns;
    // The arm: a slow, large-scale wobble the simplifier cannot remove.
    const arm = Math.sin(t * Math.PI * 3.1) * 9;
    // The hand: a fast, small-scale shake it can.
    const shake = (rnd() - 0.5) * 6;
    const radius = r + arm + shake;
    out.push({
      x: round2(cx + Math.cos(angle) * radius),
      y: round2(cy + Math.sin(angle) * radius * 0.82),
    });
  }
  return out;
})();

/**
 * A handwritten underline: a nearly-straight run of 240 units with a slight bow
 * and the same small shake. 120 points.
 */
export const UNDERLINE: readonly Point[] = (() => {
  const rnd = seeded(770311);
  const out: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({
      x: round2(40 + t * 240),
      y: round2(300 + Math.sin(t * Math.PI) * 6 + (rnd() - 0.5) * 4),
    });
  }
  return out;
})();

/**
 * A long continuous drag: 5,010 points spiralling outwards, which is what a
 * person drawing for a long time without lifting the pen actually produces. One
 * point over `STROKE_MAX_POINTS` more than ten moves, so it is the shape of the
 * case the point limit exists for.
 */
export const SPIRAL_5010: readonly Point[] = (() => {
  const out: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const angle = t * Math.PI * 2 * 9;
    const radius = 8 + t * 380;
    out.push({
      x: round2(400 + Math.cos(angle) * radius),
      y: round2(300 + Math.sin(angle) * radius),
    });
  }
  return out;
})();

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The same path moved by (dx, dy) world units. */
export function offsetPath(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** The same path scaled about its own first point, for a bigger drag on screen. */
export function scalePath(points: readonly Point[], factor: number): Point[] {
  if (points.length === 0) return [];
  const origin = points[0];
  return points.map((p) => ({
    x: round2(origin.x + (p.x - origin.x) * factor),
    y: round2(origin.y + (p.y - origin.y) * factor),
  }));
}
