// Seeded random operation generator for the convergence stress test (TC-31).
// The same seed produces the same operation sequence, so a failure is
// reproducible by re-running with the same seed.

import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  snapshot,
} from '../../src/shared/board-model';

/** Small deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
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
 * Apply `count` random board operations to `doc`: create a sticky, set text
 * on a random sticky, move a random sticky, or delete a random sticky.
 */
export function randomOps(doc: Y.Doc, count: number, rng: () => number): void {
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const ids = snapshot(doc).map((s) => s.id);

    if (roll < 0.35 || ids.length === 0) {
      createSticky(doc, {
        x: Math.floor(rng() * 400) - 200,
        y: Math.floor(rng() * 400) - 200,
      });
    } else if (roll < 0.75) {
      // set (append) text on a random note
      const id = ids[Math.floor(rng() * ids.length)];
      const text = getStickyText(doc, id);
      if (text) {
        text.insert(text.length, ` op${i}`);
      }
    } else if (roll < 0.92) {
      const id = ids[Math.floor(rng() * ids.length)];
      moveObject(doc, id, Math.floor(rng() * 400) - 200, Math.floor(rng() * 400) - 200);
    } else {
      const id = ids[Math.floor(rng() * ids.length)];
      deleteObject(doc, id);
    }
  }
}
