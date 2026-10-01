import type * as Y from 'yjs';
import {
  createSticky, deleteObject, getStickyText, moveObject, setStickyColor, snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS } from '../../../src/shared/config';

/** mulberry32: small seeded PRNG so failures can be replayed from the logged seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['pricing', 'launch', 'risk', 'idea', 'user', 'goal', 'later', 'ship'];
const COLORS = Object.keys(STICKY_COLORS);

/** One op: 40% typing, 30% moves, 10% creates, 10% recolours, 10% deletes. */
export function randomOp(doc: Y.Doc, rand: () => number): void {
  const notes = snapshot(doc);
  const pick = () => notes[Math.floor(rand() * notes.length)];
  const r = rand();
  if (notes.length === 0 || (r >= 0.4 && r < 0.5)) {
    createSticky(doc, { x: rand() * 2000, y: rand() * 2000 });
  } else if (r < 0.4) {
    const text = getStickyText(doc, pick().id);
    const word = WORDS[Math.floor(rand() * WORDS.length)] + ' ';
    text?.insert(Math.floor(rand() * (text.length + 1)), word);
  } else if (r < 0.7) {
    moveObject(doc, pick().id, Math.round(rand() * 2000), Math.round(rand() * 2000));
  } else if (r < 0.8) {
    setStickyColor(doc, pick().id, COLORS[Math.floor(rand() * COLORS.length)]);
  } else {
    deleteObject(doc, pick().id);
  }
}
