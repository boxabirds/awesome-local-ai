// Recorded pen paths (story 11). These are the gestures the component and e2e pen
// tests replay, so a test draws the same line twice and can say what it should
// store. They are generated rather than typed by hand so they are reproducible:
// the same fixture every run, jitter and all - a fixture that changed between runs
// would make the point counts in the simplification tests meaningless.
//
// Every path is in BOARD units, written for the tests' camera: zoom 1 with the
// origin at the window's top-left, which is where `setCamera(page, { x: 0, y: 0,
// zoom: 1 })` puts it, so board units and window pixels are the same numbers and
// the paths stay inside a 1280x800 window.

import type { Point } from '../../src/shared/geometry';
import { STROKE_MAX_POINTS } from '../../src/shared/config';

/**
 * A deterministic pseudo-random source: mulberry32. Seeded, so the wobble in
 * every path below is the same wobble on every machine and every run.
 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand-drawn loop: an ellipse gone wobbly, with the crossing a pen makes. */
function loop(): Point[] {
  const random = prng(0x5eed1a);
  const points: Point[] = [];
  const cx = 480;
  const cy = 300;
  const steps = 400;
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * Math.PI * 2;
    // the ellipse, plus a small loop near the start, plus the jitter a hand adds
    const swirl = 26 * Math.sin(t * 3) * Math.exp(-Math.pow((t - 1.2) / 0.5, 2));
    const jitter = (n: number): number => (random() - 0.5) * n;
    points.push({
      x: Math.round((cx + 170 * Math.cos(t) + swirl + jitter(1.4)) * 100) / 100,
      y: Math.round((cy + 110 * Math.sin(t) + swirl * 0.6 + jitter(1.4)) * 100) / 100,
    });
  }
  return points;
}

/** A hand-drawn underline: left to right, dipping and rising as it goes. */
function underline(): Point[] {
  const random = prng(0x5eed1b);
  const points: Point[] = [];
  const steps = 120;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const jitter = (random() - 0.5) * 1.2;
    points.push({
      x: Math.round((300 + t * 460) * 100) / 100,
      y: Math.round((520 + 8 * Math.sin(t * Math.PI * 2) + jitter) * 100) / 100,
    });
  }
  return points;
}

/**
 * A spiral of `n` points: the gesture the point cap is tested with. Tight at the
 * centre and widening out, so the early points are close together (where the
 * simplifier has most to do) and the later ones are far apart (where it has least).
 */
export function penFixtureSpiral(n: number = STROKE_MAX_POINTS + 10): Point[] {
  const points: Point[] = [];
  const cx = 520;
  const cy = 360;
  for (let i = 0; i < n; i++) {
    const t = i / 6;
    const radius = 2 + i * 0.06;
    points.push({
      x: Math.round((cx + radius * Math.cos(t)) * 100) / 100,
      y: Math.round((cy + radius * Math.sin(t)) * 100) / 100,
    });
  }
  return points;
}

/** One handwritten loop of ~400 jittery points. */
export const PEN_FIXTURE_LOOP: readonly Point[] = loop();

/** One hand-drawn underline of ~120 points. */
export const PEN_FIXTURE_UNDERLINE: readonly Point[] = underline();

/** The over-cap gesture: STROKE_MAX_POINTS + 10 points. */
export const PEN_FIXTURE_SPIRAL: readonly Point[] = penFixtureSpiral();

/** A path as flat numbers, for feeding a mouse through a real browser. */
export function flattenPath(points: readonly Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}
