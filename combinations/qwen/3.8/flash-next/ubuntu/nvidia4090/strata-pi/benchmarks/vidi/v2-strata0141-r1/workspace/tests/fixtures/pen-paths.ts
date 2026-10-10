import type { Point } from '../../src/shared/geometry';

/**
 * Recorded handwritten pointer paths (`pen.*` tests).
 *
 * These are **deterministic**: a small seeded generator stands in for a real
 * mouse recording, so a unit test, a component test and an e2e drag all replay the
 * same path and a failure is reproducible. The jitter is what a real hand makes -
 * a little wander along the path and a little across it - which is exactly what
 * `simplify` has to survive (`pen.smooth`).
 */

/** Tiny deterministic generator (mulberry32): the same path on every machine. */
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
 * A handwritten loop around a cluster of notes: about 400 points, one and a half
 * turns of a wobbling circle. `wobble` is the slow error of a hand that never
 * closes a circle exactly; `wander` is the fast jitter of the pointer itself.
 */
export function handwrittenLoop(): Point[] {
  const random = seeded(0x73_74_31_31);
  const points: Point[] = [];
  const centre = { x: 420, y: 300 };
  const radius = 150;
  const turns = 1.5;
  const count = 400;
  let wander = 0;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / (count - 1)) * Math.PI * 2 * turns;
    // Slow wobble: the radius of a hand-drawn circle is not constant.
    const wobble =
      7 * Math.sin(angle * 3 + 0.4) + 4 * Math.sin(angle * 7.3 + 1.1) + 2.5 * Math.cos(angle * 11);
    // Fast jitter: ±1.5 world units across the path, drifting like a real hand.
    wander = wander * 0.7 + (random() - 0.5) * 3;
    const r = radius + wobble + wander;
    points.push({
      x: centre.x + r * Math.cos(angle),
      y: centre.y + r * Math.sin(angle) + Math.sin(angle * 5) * 3,
    });
  }
  return points;
}

/** An underline under a sticky note: about 120 points, roughly straight, slightly bowed. */
export function underlinePath(): Point[] {
  const random = seeded(0x75_6e_64_32);
  const points: Point[] = [];
  const count = 120;
  const from = { x: 200, y: 520 };
  const to = { x: 520, y: 528 };
  let wander = 0;
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    wander = wander * 0.75 + (random() - 0.5) * 2.4;
    points.push({
      x: from.x + (to.x - from.x) * t + Math.sin(t * 9) * 1.2,
      y:
        from.y +
        (to.y - from.y) * t +
        // A hand bows a line it draws left to right.
        Math.sin(t * Math.PI) * 6 +
        wander,
    });
  }
  return points;
}

/**
 * A synthetic 5,010-point spiral - longer than `STROKE_MAX_POINTS`, so the point
 * limit is reached in the middle of it (`pen.long_stroke`, TC-03, TC-12).
 */
export function longSpiral(count = 5010): Point[] {
  const points: Point[] = [];
  const centre = { x: 600, y: 400 };
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const angle = t * Math.PI * 2 * 12;
    const radius = 40 + t * 160 + Math.sin(angle * 3) * 2.5;
    points.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
  }
  return points;
}

/** A path a few frames of a real drag can replay (`tests/e2e/pen.spec.ts`). */
export function decimate(points: readonly Point[], every: number): Point[] {
  if (every <= 1) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }
  const out: Point[] = [];
  for (let index = 0; index < points.length; index += every) {
    out.push({ x: points[index]!.x, y: points[index]!.y });
  }
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) {
    out.push({ x: last.x, y: last.y });
  }
  return out;
}
