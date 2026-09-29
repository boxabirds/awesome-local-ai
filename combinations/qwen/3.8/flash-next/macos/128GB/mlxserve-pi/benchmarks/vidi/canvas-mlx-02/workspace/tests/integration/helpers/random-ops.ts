// Seeded random operation generator for the concurrency/soak integration tests.
// Produces a realistic mix (40% typing real words, 30% moves, 10% creates,
// 10% recolours, 10% deletes) using the real board-model mutators so tests
// exercise the same code paths as the UI. Deterministic for a given seed.
import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
} from '../../../src/shared/board-model.ts';
import type { StickyColor } from '../../../src/shared/config.ts';

const WORDS = [
  'design',
  'flow',
  'idea',
  'scope',
  'sync',
  'merge',
  'board',
  'note',
  'team',
  'plan',
];
const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

// mulberry32: small, fast, deterministic PRNG.
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

export interface OpStats {
  seed: number;
  created: string[];
  deleted: string[];
  ops: number;
}

// Apply `count` random operations to `doc`. Tracks created vs deleted ids so a
// test can assert that every surviving creation is present in the end state.
export function runSeededOps(doc: Y.Doc, count: number, seed: number): OpStats {
  const rnd = mulberry32(seed);
  const created = new Set<string>();
  const deleted = new Set<string>();
  const pick = <T>(arr: T[]): T | undefined =>
    arr.length ? arr[Math.floor(rnd() * arr.length)] : undefined;

  for (let i = 0; i < count; i++) {
    const roll = rnd();
    const alive = Array.from(created).filter((id) => !deleted.has(id));
    if (roll < 0.4) {
      // typing a real word into a random live note (create one if none yet)
      let id = pick(alive);
      if (!id) id = createSticky(doc, { x: rnd() * 800, y: rnd() * 800 });
      created.add(id);
      const text = getStickyText(doc, id);
      const word = WORDS[Math.floor(rnd() * WORDS.length)];
      if (text) text.insert(text.length, (text.length ? ' ' : '') + word);
    } else if (roll < 0.7) {
      // move a live note (or create if none)
      let id = pick(alive);
      if (!id) id = createSticky(doc, { x: rnd() * 800, y: rnd() * 800 });
      created.add(id);
      moveObject(doc, id, rnd() * 1000 - 500, rnd() * 1000 - 500);
    } else if (roll < 0.8) {
      // create
      created.add(createSticky(doc, { x: rnd() * 800, y: rnd() * 800 }));
    } else if (roll < 0.9) {
      // recolour a live note
      const id = pick(alive);
      if (id) setStickyColor(doc, id, COLORS[Math.floor(rnd() * COLORS.length)]);
    } else {
      // delete a live note
      const id = pick(alive);
      if (id) {
        deleteObject(doc, id);
        deleted.add(id);
      }
    }
  }
  return { seed, created: Array.from(created), deleted: Array.from(deleted), ops: count };
}
