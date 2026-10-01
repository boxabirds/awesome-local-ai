import type { Point } from '../../src/shared/geometry';

/**
 * Deterministic PRNG (mulberry32) so the recorded-style fixtures are stable
 * across runs and platforms.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A handwritten-style loop of ~400 jittery points, inside a ~240x160 box
 * with its top-left at (0, 0). Resembles a rough ellipse sketched by hand.
 */
export function handwrittenLoop(): Point[] {
  const rand = mulberry32(11);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2.15; // slightly more than one turn, open tail
    const wobble = 1 + 0.07 * Math.sin(7 * t) + 0.05 * Math.cos(5 * t);
    const x = 120 + 92 * Math.cos(t) * wobble + (rand() - 0.5) * 4;
    const y = 80 + 62 * Math.sin(t) * wobble + (rand() - 0.5) * 4;
    pts.push({ x, y });
  }
  return pts;
}

/**
 * A quick underline of ~120 points: roughly horizontal with a slight wave
 * and hand jitter, inside a ~220x24 box with its top-left at (0, 0).
 */
export function underline(): Point[] {
  const rand = mulberry32(23);
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 220;
    const y = 12 + 4 * Math.sin(x / 14) + (rand() - 0.5) * 2.5;
    pts.push({ x, y });
  }
  return pts;
}

/**
 * A synthetic spiral of exactly 5,010 points (used for the STROKE_MAX_POINTS
 * boundary). Three turns, radius growing 2 → 102, centred at (150, 150).
 */
export function longSpiral(): Point[] {
  const pts: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 6;
    const r = 2 + (i / (n - 1)) * 100;
    pts.push({ x: 150 + r * Math.cos(t), y: 150 + r * Math.sin(t) });
  }
  return pts;
}
