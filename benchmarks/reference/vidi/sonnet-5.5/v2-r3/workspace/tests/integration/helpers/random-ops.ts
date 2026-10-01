import type * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS } from '../../../src/shared/config';

const WORDS = ['pricing', 'roadmap', 'risk', 'idea', 'launch', 'users', 'budget', 'design'];

/** mulberry32: small seeded PRNG so failures can be replayed from the logged seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One realistic operation: 40% typing, 30% moves, 10% each create / recolour / delete. */
export function randomOp(doc: Y.Doc, rand: () => number): void {
  const notes = snapshot(doc);
  const pick = () => notes[Math.floor(rand() * notes.length)];
  const r = rand();
  if (notes.length === 0 || r < 0.1) {
    createSticky(doc, { x: Math.floor(rand() * 2000), y: Math.floor(rand() * 2000) });
  } else if (r < 0.5) {
    const text = getStickyText(doc, pick().id);
    if (text) text.insert(Math.floor(rand() * (text.length + 1)), WORDS[Math.floor(rand() * WORDS.length)] + ' ');
  } else if (r < 0.8) {
    moveObject(doc, pick().id, Math.floor(rand() * 2000), Math.floor(rand() * 2000));
  } else if (r < 0.9) {
    const colors = Object.keys(STICKY_COLORS);
    setStickyColor(doc, pick().id, colors[Math.floor(rand() * colors.length)]);
  } else {
    deleteObject(doc, pick().id);
  }
}
