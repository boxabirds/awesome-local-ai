/**
 * Seeded pseudo-random board operations for concurrency tests (design TC-11
 * random ops; also reused by the e2e soak). Deterministic per seed so a
 * failed run can be reproduced.
 */

import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

const COLORS: StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[];

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Applies `count` random board mutations (create / move / recolor / delete)
 * to the given doc. Deletions target only notes this client created here,
 * so the test can bound the final note count.
 */
export function applyRandomOps(doc: Y.Doc, seed: number, count: number): void {
  const rng = mulberry32(seed);
  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    const op = Math.floor(rng() * 4);
    const x = Math.round(rng() * 4000) - 2000;
    const y = Math.round(rng() * 4000) - 2000;
    if (op === 0 || created.length === 0) {
      const id = createSticky(doc, { x, y }, COLORS[Math.floor(rng() * COLORS.length)]);
      if (id !== '') {
        created.push(id);
      }
    } else if (op === 1) {
      const id = created[Math.floor(rng() * created.length)];
      moveObject(doc, id, x, y);
    } else if (op === 2) {
      const id = created[Math.floor(rng() * created.length)];
      setStickyColor(doc, id, COLORS[Math.floor(rng() * COLORS.length)]);
    } else {
      // delete the most recent note we made
      const id = created.pop();
      if (id !== undefined) {
        deleteObject(doc, id);
      }
    }
  }
}

/** Note texts of a snapshot (for diagnostics). */
export function texts(doc: Y.Doc): string[] {
  return snapshot(doc).map((o) => o.text);
}
