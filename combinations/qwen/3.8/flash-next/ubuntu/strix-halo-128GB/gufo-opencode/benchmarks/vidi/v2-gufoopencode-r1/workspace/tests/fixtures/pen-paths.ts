// Story 11 fixtures: recorded-style handwritten paths as plain point arrays.
// Deterministic (seeded PRNG), no test-framework imports.

export interface FixturePoint {
  readonly x: number;
  readonly y: number;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Closed-ish handwritten loop, ~400 points around (640, 400), radius ~150,
// with small hand jitter. Roughly circular so RDP at 1px drops straight-run
// points while keeping the shape.
export function handwrittenLoop(): FixturePoint[] {
  const rand = lcg(20261009);
  const points: FixturePoint[] = [];
  const n = 400;
  const cx = 640;
  const cy = 400;
  for (let i = 0; i <= n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    const r = 150 + Math.sin(t * 3) * 8 + (rand() - 0.5) * 0.8;
    points.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r * 0.8 });
  }
  return points;
}

// Handwritten underline, ~120 points, slightly wavy horizontal stroke.
export function underlinePath(): FixturePoint[] {
  const rand = lcg(424242);
  const points: FixturePoint[] = [];
  const n = 120;
  const x0 = 400;
  const y0 = 500;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    points.push({
      x: x0 + t * 480,
      y: y0 + Math.sin(t * Math.PI * 2) * 2 + (rand() - 0.5) * 0.6
    });
  }
  return points;
}

// Synthetic 5010-point spiral used for the STROKE_MAX_POINTS split tests
// (one over the 5000-point cap).
export function syntheticSpiral(count = 5010): FixturePoint[] {
  const points: FixturePoint[] = [];
  const cx = 300;
  const cy = 300;
  for (let i = 0; i < count; i += 1) {
    const t = i / 20;
    const r = 2 + i * 0.05;
    points.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return points;
}

// Straight horizontal line from (0, 0) to (100, 0), sampled every 2 units.
export function straightLine(count = 51): FixturePoint[] {
  const points: FixturePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push({ x: (i * 100) / (count - 1), y: 0 });
  }
  return points;
}

export function toFlat(points: readonly FixturePoint[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.x, p.y);
  }
  return out;
}
