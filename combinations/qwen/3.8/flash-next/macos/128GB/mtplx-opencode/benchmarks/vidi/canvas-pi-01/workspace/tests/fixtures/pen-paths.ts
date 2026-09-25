/**
 * Story 11 · recorded pointer paths (design "Fixtures").
 *
 * The simplification contract ("every raw point stays within the tolerance of the
 * result") is only interesting on a path that has *shape* to lose: a synthetic
 * straight line simplifies to itself whatever the tolerance. These three paths are
 * therefore generated once, from a fixed seed, so they are stable across runs and
 * platforms but still look like a hand: a closed loop with wobble (the shape a
 * person draws when they circle something), an underline with a hand-drift, and a
 * long spiral used only to prove the maths survives the point cap.
 *
 * Everything here is deterministic — no `Math.random()` — because a test that
 * fails one run in twenty is worse than no test.
 */

/** A recorded pointer position, in world units. */
export interface PathPoint {
  x: number;
  y: number;
}

/** mulberry32: a tiny deterministic PRNG, good enough for wobble. */
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
 * A handwritten loop: about 1.6 turns of an ellipse, travelled counter-clockwise
 * with a 0.6-unit wobble and a slight closing overshoot, sampled every ~1.5 units
 * (≈ 400 points). The wobble is what `simplify` must not erase; the smooth arcs
 * are what it must collapse.
 */
export function makeHandwrittenLoop(count = 400, seed = 20260924): PathPoint[] {
  const random = seeded(seed);
  const points: PathPoint[] = [];
  const radiusX = 90;
  const radiusY = 62;
  const turns = 1.6;
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * turns * Math.PI * 2;
    // The pen drifts inward as it closes, so the last points sit inside the first.
    const shrink = 1 - 0.06 * (i / (count - 1));
    const jitter = (random() - 0.5) * 1.2;
    const x = 200 + Math.cos(t) * radiusX * shrink + jitter;
    const y = 180 + Math.sin(t) * radiusY * shrink + (random() - 0.5) * 1.2;
    points.push({ x, y });
  }
  return points;
}

/**
 * A handwritten underline: ~120 points running left to right with a slow upward
 * drift (a hand does not travel flat) and a small wobble, ending in a short
 * deceleration. Used to check that a mostly-straight run collapses hard while the
 * drift survives.
 */
export function makeUnderline(count = 120, seed = 991): PathPoint[] {
  const random = seeded(seed);
  const points: PathPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    // The stroke starts fast and slows into the end, so the samples crowd at the
    // right-hand end the way a lifted pen does.
    const travel = 620 * (1 - (1 - t) * (1 - t) * (1 - t) * (1 - t)) ** 0.5;
    const x = 140 + travel;
    const y = 420 - 18 * t + (random() - 0.5) * 1.4;
    points.push({ x, y });
  }
  return points;
}

/** A long Archimedean spiral, {@link count} points (the point-cap fixture). */
export function makeSpiral(count = 5010, seed = 7): PathPoint[] {
  const random = seeded(seed);
  const points: PathPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i * 0.035;
    const radius = 6 + t * 2.4;
    const wobble = (random() - 0.5) * 0.8;
    points.push({
      x: 500 + Math.cos(t * 6) * (radius + wobble),
      y: 380 + Math.sin(t * 6) * (radius + wobble),
    });
  }
  return points;
}
