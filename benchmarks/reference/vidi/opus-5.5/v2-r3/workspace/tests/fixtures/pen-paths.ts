// Recorded-style pointer paths for the pen (story 11): world/screen points at 100% zoom.
// Deterministic: jitter comes from a seeded generator, so every run replays the same path.
import type { Point } from '../../src/shared/geometry';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A hand-drawn loop around a cluster (~400 points, ±1.5 px jitter, slightly overlapping ends). */
export function handwrittenLoop(center: Point = { x: 400, y: 300 }, radius = 150, count = 400): Point[] {
  const r = rng(11);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2.1 - Math.PI / 2;
    const wobble = radius * (1 + 0.08 * Math.sin(a * 3));
    pts.push({
      x: center.x + Math.cos(a) * wobble * 1.3 + (r() - 0.5) * 3,
      y: center.y + Math.sin(a) * wobble + (r() - 0.5) * 3,
    });
  }
  return pts;
}

/** A quick underline, left to right (~120 points, slight drift and jitter). */
export function underline(start: Point = { x: 200, y: 500 }, length = 360, count = 120): Point[] {
  const r = rng(7);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    pts.push({ x: start.x + t * length + (r() - 0.5) * 1.5, y: start.y + t * 6 + (r() - 0.5) * 2 });
  }
  return pts;
}

/** A synthetic 5,010-point spiral (more than STROKE_MAX_POINTS). */
export function spiral(center: Point = { x: 0, y: 0 }, count = 5010): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 0.05;
    const rad = 5 + i * 0.05;
    pts.push({ x: center.x + Math.cos(a) * rad, y: center.y + Math.sin(a) * rad });
  }
  return pts;
}
