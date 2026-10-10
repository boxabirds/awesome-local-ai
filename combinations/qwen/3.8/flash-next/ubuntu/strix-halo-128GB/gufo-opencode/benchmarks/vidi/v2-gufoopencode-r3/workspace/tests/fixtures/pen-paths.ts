import type { Point } from '../../src/shared/geometry';

// Deterministic PRNG (mulberry32) so every run simplifies the same paths.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A hand-drawn closed loop: ~400 points around a wobbly circle.
export function handwrittenLoop(count = 400): Point[] {
  const rand = mulberry32(11);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const r = 120 + Math.sin(t * 3) * 8 + (rand() - 0.5) * 6;
    points.push({ x: 300 + Math.cos(t) * r, y: 240 + Math.sin(t) * r });
  }
  return points;
}

// A hand-drawn underline: ~120 points, mostly straight with small wobble.
export function underlinePath(count = 120): Point[] {
  const rand = mulberry32(22);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({ x: 60 + t * 260, y: 100 + (rand() - 0.5) * 4 + Math.sin(t * 5) * 1.5 });
  }
  return points;
}

// A long deterministic spiral for the point-limit tests.
export function spiralPath(count = 5010): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / 40;
    const r = 5 + t * 2;
    points.push({ x: 500 + Math.cos(t) * r, y: 500 + Math.sin(t) * r });
  }
  return points;
}
