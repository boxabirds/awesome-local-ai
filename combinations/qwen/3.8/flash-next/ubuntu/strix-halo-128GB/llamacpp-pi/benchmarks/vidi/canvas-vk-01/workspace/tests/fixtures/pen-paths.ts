import type { Point } from '../../src/shared/geometry';

/**
 * Recorded pointer paths for the pen tool tests.
 *
 * - `handwrittenLoop` ~400 points tracing a jittery handwritten loop
 * - `underline` ~120 points for an underline stroke
 * - `spiral5010` a synthetic 5,010-point spiral for STROKE_MAX_POINTS split tests
 */

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A handwritten loop: approximately elliptical path with 1-3 px jitter,
 * ~400 points.
 */
export function handwrittenLoop(): Point[] {
  const rng = mulberry32(42);
  const points: Point[] = [];
  const cx = 300;
  const cy = 250;
  const rx = 120;
  const ry = 80;
  const steps = 400;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const jitterX = (rng() - 0.5) * 3;
    const jitterY = (rng() - 0.5) * 3;
    points.push({
      x: cx + rx * Math.cos(angle) + jitterX,
      y: cy + ry * Math.sin(angle) + jitterY,
    });
  }
  return points;
}

/**
 * An underline stroke: a slightly wavy horizontal line, ~120 points.
 */
export function underline(): Point[] {
  const rng = mulberry32(123);
  const points: Point[] = [];
  const startX = 100;
  const y = 300;
  const length = 200;
  const steps = 120;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      x: startX + t * length,
      y: y + (rng() - 0.5) * 2,
    });
  }
  return points;
}

/**
 * A synthetic 5,010-point spiral (for STROKE_MAX_POINTS boundary testing).
 */
export function spiral5010(): Point[] {
  const points: Point[] = [];
  const cx = 200;
  const cy = 200;
  const steps = 5010;
  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    const angle = t * Math.PI * 10;
    const radius = 5 + t * 150;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}
