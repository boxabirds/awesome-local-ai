import type * as Y from 'yjs';
import {
  createSticky, deleteObject, getStickyText, moveObject, setStickyColor, snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';

const WORDS = ['pricing', 'launch', 'risk', 'retro', 'idea', 'blocked', 'ship', 'metrics', 'users'];

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

/** One seeded operation: 40% typing, 30% moves, 10% each create / recolour / delete. */
export function randomOp(doc: Y.Doc, rand: () => number, created: Set<string>, deleted: Set<string>): void {
  const notes = snapshot(doc);
  const pick = () => notes[Math.floor(rand() * notes.length)];
  const r = rand();
  if (notes.length === 0 || r < 0.1) {
    const id = createSticky(doc, { x: Math.round(rand() * 2000), y: Math.round(rand() * 2000) });
    if (id) created.add(id);
    return;
  }
  const note = pick();
  if (r < 0.5) {
    const text = getStickyText(doc, note.id);
    if (text) text.insert(Math.floor(rand() * (text.length + 1)), `${WORDS[Math.floor(rand() * WORDS.length)]} `);
  } else if (r < 0.8) {
    moveObject(doc, note.id, Math.round(rand() * 2000), Math.round(rand() * 2000));
  } else if (r < 0.9) {
    const colors = Object.keys(STICKY_COLORS);
    setStickyColor(doc, note.id, colors[Math.floor(rand() * colors.length)]);
  } else {
    if (deleteObject(doc, note.id)) deleted.add(note.id);
  }
}
