import type { Point } from '../../src/shared/geometry';

/** Deterministic pseudo-random jitter so the fixtures are stable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

/** A hand-drawn loop of ~400 points with about a pixel of jitter. */
export function handwrittenLoop(): Point[] {
  const r = rng(7);
  const out: Point[] = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 399) * Math.PI * 2.1;
    out.push({ x: 300 + 120 * Math.cos(a) + r() * 1.6, y: 300 + 80 * Math.sin(a) + r() * 1.6 });
  }
  return out;
}

/** A roughly horizontal underline of ~120 points. */
export function underline(): Point[] {
  const r = rng(11);
  const out: Point[] = [];
  for (let i = 0; i < 120; i++) out.push({ x: 100 + i * 2.5, y: 500 + Math.sin(i / 15) * 3 + r() * 1.2 });
  return out;
}

/** A 5,010-point outward spiral. */
export function spiral(): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 5010; i++) {
    const a = i * 0.05;
    out.push({ x: 600 + a * 0.4 * Math.cos(a), y: 400 + a * 0.4 * Math.sin(a) });
  }
  return out;
}
