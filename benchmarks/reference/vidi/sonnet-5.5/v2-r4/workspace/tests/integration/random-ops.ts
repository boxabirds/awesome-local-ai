import type * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, moveObject, setStickyColor, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';

/** Small deterministic PRNG (mulberry32). */
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

const WORDS = ['green', 'red', 'blue', 'idea', 'pricing', 'launch', 'risk', 'next'];

/** One random operation (40% typing, 30% moves, 10% creates, 10% recolours, 10% deletes) via the real board-model. */
export function randomOp(doc: Y.Doc, rand: () => number): void {
  const notes = snapshot(doc);
  const pick = () => notes[Math.floor(rand() * notes.length)];
  const r = rand();
  if (notes.length === 0) {
    createSticky(doc, { x: Math.round(rand() * 1000), y: Math.round(rand() * 1000) });
    return;
  }
  if (r < 0.4) {
    const t = getStickyText(doc, pick().id);
    if (t) t.insert(Math.floor(rand() * (t.length + 1)), WORDS[Math.floor(rand() * WORDS.length)] + ' ');
  } else if (r < 0.7) {
    moveObject(doc, pick().id, Math.round(rand() * 2000), Math.round(rand() * 2000));
  } else if (r < 0.8) {
    createSticky(doc, { x: Math.round(rand() * 1000), y: Math.round(rand() * 1000) });
  } else if (r < 0.9) {
    const colors = Object.keys(STICKY_COLORS);
    setStickyColor(doc, pick().id, colors[Math.floor(rand() * colors.length)]);
  } else {
    deleteObject(doc, pick().id);
  }
}
