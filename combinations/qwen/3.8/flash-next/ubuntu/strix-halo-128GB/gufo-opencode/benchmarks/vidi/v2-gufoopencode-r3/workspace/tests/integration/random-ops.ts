import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

// Deterministic PRNG so randomized-convergence failures are reproducible:
// the seed is printed by the test before the run.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'design', 'board', 'sticky', 'note', 'sync', 'merge',
  'flow', 'crdt', 'live', 'edit', 'hello', 'world'
];
const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

export interface OpLog {
  created: string[];
  deleted: string[];
}

// Applies `count` random legal mutations to doc. Deletes only ids visible in
// this replica, so every op stays within the board model's contract.
export function runRandomOps(
  doc: Y.Doc,
  rand: () => number,
  count: number
): OpLog {
  const log: OpLog = { created: [], deleted: [] };
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rand() * items.length)];
  for (let i = 0; i < count; i += 1) {
    const notes = snapshot(doc);
    const roll = rand();
    if (notes.length === 0 || roll < 0.35) {
      log.created.push(
        createSticky(doc, { x: rand() * 1000, y: rand() * 1000 })
      );
    } else if (roll < 0.65) {
      const target = pick(notes);
      const text = getStickyText(doc, target.id);
      if (text !== undefined) {
        const word = pick(WORDS);
        const at = Math.floor(rand() * (text.length + 1));
        doc.transact(() => {
          text.insert(at, rand() < 0.3 ? `${word} ` : word);
        }, LOCAL_ORIGIN);
      }
    } else if (roll < 0.85) {
      const target = pick(notes);
      moveObject(doc, target.id, rand() * 1000, rand() * 1000);
    } else if (roll < 0.93) {
      const target = pick(notes);
      setStickyColor(doc, target.id, pick(COLOR_KEYS));
    } else {
      const target = pick(notes);
      log.deleted.push(target.id);
      deleteObject(doc, target.id);
    }
  }
  return log;
}
