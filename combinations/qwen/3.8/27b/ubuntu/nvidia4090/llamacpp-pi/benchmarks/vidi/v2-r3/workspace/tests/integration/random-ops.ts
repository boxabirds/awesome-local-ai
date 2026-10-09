import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/** Deterministic PRNG (mulberry32) so failing runs can be replayed by seed. */
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

const WORDS = ['ship', 'idea', 'bug', 'zoom', 'note', 'blue', 'fast', 'sync', 'drag', 'live'];
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

export interface RandomOps {
  run(n: number): void;
  createdIds: string[];
  deletedIds: Set<string>;
}

/**
 * Seeded random board operations on a Y.Doc: ~40% typing, ~30% moves,
 * ~10% creates, ~10% recolors, ~10% deletes. Always leaves a board that can
 * be compared across clients (ids are tracked for the "created unless
 * deleted" assertion).
 */
export function makeRandomOps(doc: Y.Doc, seed: number): RandomOps {
  const rand = mulberry32(seed);
  const createdIds: string[] = [];
  const deletedIds = new Set<string>();

  const pickNote = (): string | null => {
    const notes = snapshot(doc).filter((n) => !deletedIds.has(n.id));
    if (notes.length === 0) return null;
    return notes[Math.floor(rand() * notes.length)].id;
  };

  return {
    createdIds,
    deletedIds,
    run(n: number) {
      for (let i = 0; i < n; i++) {
        const roll = rand();
        if (roll < 0.4) {
          const id = pickNote();
          if (id) {
            const text = getStickyText(doc, id);
            if (text && text.length < 200) text.insert(text.length, WORDS[Math.floor(rand() * WORDS.length)]);
          }
        } else if (roll < 0.7) {
          const id = pickNote();
          if (id) {
            moveObject(doc, id, Math.floor(rand() * 2000) - 1000, Math.floor(rand() * 2000) - 1000);
          }
        } else if (roll < 0.8) {
          const id = createSticky(
            doc,
            { x: Math.floor(rand() * 1000), y: Math.floor(rand() * 1000) },
            COLOR_NAMES[Math.floor(rand() * COLOR_NAMES.length)],
          );
          if (id) createdIds.push(id);
        } else if (roll < 0.9) {
          const id = pickNote();
          if (id) {
            setStickyColor(doc, id, COLOR_NAMES[Math.floor(rand() * COLOR_NAMES.length)]);
          }
        } else {
          const id = pickNote();
          if (id && deleteObject(doc, id)) deletedIds.add(id);
        }
      }
    },
  };
}

/** Convenience: the id set that must exist on a converged board. */
export function mustExist(ops: RandomOps): Set<string> {
  return new Set(ops.createdIds.filter((id) => !ops.deletedIds.has(id)));
}

export type { Y };
