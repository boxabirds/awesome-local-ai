import * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/**
 * Seeded random operation generator (design "Fixtures"): 40% typing real
 * words, 30% moves, 10% creates, 10% recolours, 10% deletes. Every operation
 * goes through the real `board-model` functions. Seeds are logged by the
 * tests so a failure can be replayed.
 */

/** Deterministic PRNG (mulberry32). */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'idea', 'design', 'ship', 'test', 'plan', 'review', 'scope',
  'budget', 'pricing', 'feedback', 'sync', 'demo', 'risk', 'note',
];

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Apply one random operation to `doc`. */
export function applyRandomOp(doc: Y.Doc, random: () => number): void {
  const notes = snapshot(doc);
  const pick = () => notes[Math.floor(random() * notes.length)];

  if (notes.length === 0) {
    createSticky(doc, { x: Math.floor(random() * 800), y: Math.floor(random() * 600) });
    return;
  }

  const roll = random();
  const note = pick();
  if (roll < 0.4) {
    // Typing a real word at a random position.
    const text = getStickyText(doc, note.id);
    if (text) {
      const word = WORDS[Math.floor(random() * WORDS.length)];
      const at = Math.floor(random() * (text.length + 1));
      text.insert(at, `${word} `, undefined);
    }
  } else if (roll < 0.7) {
    moveObject(doc, note.id, Math.floor(random() * 1000), Math.floor(random() * 800));
  } else if (roll < 0.8) {
    createSticky(doc, { x: Math.floor(random() * 900), y: Math.floor(random() * 700) });
  } else if (roll < 0.9) {
    const color = COLORS[Math.floor(random() * COLORS.length)];
    setStickyColor(doc, note.id, color);
  } else {
    deleteObject(doc, note.id);
  }
}
