/**
 * The seeded random number generator the randomised tests share.
 *
 * A fixed seed produces the same sequence, so a failure can always be replayed —
 * which is the only thing that makes a randomised test worth having. Both the
 * workerd integration soak and the nightly browser soak drive their choices from
 * here, so "the same run" means the same thing in either place.
 */

/** mulberry32: small, deterministic, good enough for shuffling operations. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for a run that is worth printing when something goes wrong. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** A whole number in [0, max). */
export function below(random: () => number, max: number): number {
  return Math.floor(random() * max);
}
