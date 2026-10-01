import type * as Y from 'yjs';
import { STICKY_COLORS } from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';

const WORDS = ['pricing', 'launch', 'risk', 'idea', 'users', 'budget', 'plan', 'metrics', 'goal'];
const COLORS = Object.keys(STICKY_COLORS);

/** Small deterministic PRNG (mulberry32) so failing runs can be replayed from the logged seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

/** One realistic operation: 40% typing, 30% moves, 10% creates, 10% recolours, 10% deletes. Returns what it did. */
export function randomOp(doc: Y.Doc, rand: () => number): OpKind {
  const notes = snapshot(doc);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const roll = rand();
  if (notes.length === 0 || (roll >= 0.4 && roll < 0.5)) {
    createSticky(doc, { x: Math.round(rand() * 2000 - 1000), y: Math.round(rand() * 2000 - 1000) });
    return 'create';
  }
  const note = pick(notes);
  if (roll < 0.4) {
    const text = getStickyText(doc, note.id);
    text?.insert(Math.floor(rand() * (text.length + 1)), `${pick(WORDS)} `);
    return 'type';
  }
  if (roll < 0.5) return 'create';
  if (roll < 0.8) {
    moveObject(doc, note.id, Math.round(rand() * 2000 - 1000), Math.round(rand() * 2000 - 1000));
    return 'move';
  }
  if (roll < 0.9) {
    setStickyColor(doc, note.id, pick(COLORS));
    return 'recolour';
  }
  deleteObject(doc, note.id);
  return 'delete';
}
