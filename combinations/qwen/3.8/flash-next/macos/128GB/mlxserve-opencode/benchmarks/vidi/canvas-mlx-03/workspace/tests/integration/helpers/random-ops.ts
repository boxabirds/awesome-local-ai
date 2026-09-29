// Seeded random operation generator for the capacity / convergence tests. The
// mix matches the design fixture: 40% typing real words, 30% moves, 10% creates,
// 10% recolours, 10% deletes — all applied through the real board-model.

import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  bringToFront,
} from '../../../src/shared/board-model.ts';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config.ts';

const WORDS = [
  'pricing',
  'onboarding',
  'roadmap',
  'feedback',
  'release',
  'sprint',
  'research',
  'design',
  'metrics',
  'pilot',
  'handoff',
  'review',
];

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** mulberry32: a small deterministic PRNG (seed-driven, replays identically). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * Apply `count` random operations to `doc` (LOCAL_ORIGIN transactions, so they
 * transmit). Returns the ids that survive at the end.
 */
export function applyRandomOps(doc: Y.Doc, seed: number, count: number): string[] {
  const rng = mulberry32(seed);
  let live: string[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng();
    if (live.length === 0 || roll < 0.1) {
      // create
      const id = createSticky(doc, { x: rng() * 2000 - 1000, y: rng() * 2000 - 1000 });
      live.push(id);
    } else if (roll < 0.5) {
      // typing real words (40%)
      const id = pick(rng, live);
      const t = getStickyText(doc, id);
      if (t) {
        const word = pick(rng, WORDS);
        const at = Math.min(t.length, Math.floor(rng() * (t.length + 1)));
        t.insert(at, rng() < 0.5 ? word : ` ${word} `);
      }
    } else if (roll < 0.8) {
      // moves (30%)
      const id = pick(rng, live);
      moveObject(doc, id, rng() * 2000 - 1000, rng() * 2000 - 1000);
    } else if (roll < 0.9) {
      // recolour (10%)
      const id = pick(rng, live);
      setStickyColor(doc, id, pick(rng, COLOR_NAMES));
    } else {
      // delete (10%)
      const id = pick(rng, live);
      bringToFront(doc, id);
      deleteObject(doc, id);
      live = live.filter((x) => x !== id);
    }
  }
  return live;
}
