import type { Point } from '../../src/shared/geometry';

/** Deterministic pseudo-random jitter so the "recorded" paths are identical on every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

/** A hand-drawn loop around (cx, cy): ~400 points with jitter, slightly overshooting where it closes. */
export function handwrittenLoop(cx = 300, cy = 300, r = 120): Point[] {
  const rand = rng(7);
  const n = 400;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2.1;
    const wobble = 1 + 0.06 * Math.sin(a * 3);
    out.push({
      x: cx + Math.cos(a) * r * wobble + rand() * 1.5,
      y: cy + Math.sin(a) * r * 0.8 * wobble + rand() * 1.5,
    });
  }
  return out;
}

/** A slightly wavy underline of ~120 points. */
export function underline(x = 100, y = 500, length = 300): Point[] {
  const rand = rng(11);
  return Array.from({ length: 120 }, (_, i) => ({
    x: x + (i / 119) * length,
    y: y + Math.sin(i / 9) * 2 + rand() * 1.2,
  }));
}

/** A synthetic spiral of 5,010 points, past STROKE_MAX_POINTS. */
export function spiral(cx = 400, cy = 300): Point[] {
  return Array.from({ length: 5010 }, (_, i) => {
    const a = i * 0.02;
    const r = 5 + i * 0.03;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}
