// Seeded random operation generator (story 3 fixtures): produces realistic
// mixes of 40% text typing of real words, 30% moves, 10% creates,
// 10% recolours and 10% deletes, using the real board-model functions.
// Seeds are logged by the tests for replay.

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

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'launch', 'pricing', 'onboarding', 'rollback', 'metrics', 'churn',
  'retention', 'handoff', 'roadmap', 'latency', 'throughput', 'budget',
  'release', 'canary', 'staging', 'deploy', 'incident', 'postmortem',
  'backlog', 'sprint', 'velocity', 'capacity', 'priority', 'deadline',
];

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * Applies `count` random operations to `doc` (deterministic for a given
 * seed). Mix: 40% typing, 30% moves, 10% creates, 10% recolours,
 * 10% deletes.
 */
export function randomOps(doc: Y.Doc, seed: number, count: number): void {
  const rand = mulberry32(seed);
  const pickWord = (): string => WORDS[Math.floor(rand() * WORDS.length)];
  const pickColor = (): StickyColor => COLOR_NAMES[Math.floor(rand() * COLOR_NAMES.length)];
  const pickNoteId = (): string | null => {
    const notes = snapshot(doc);
    if (notes.length === 0) return null;
    return notes[Math.floor(rand() * notes.length)].id;
  };
  const ensureNote = (): string => {
    const id = pickNoteId();
    return id ?? createSticky(doc, { x: Math.floor(rand() * 1000), y: Math.floor(rand() * 1000) });
  };

  for (let i = 0; i < count; i++) {
    const r = rand();
    if (r < 0.4) {
      // 40%: type a real word into a random note's text.
      const id = ensureNote();
      const text = getStickyText(doc, id);
      if (text) text.insert(text.length, pickWord());
    } else if (r < 0.7) {
      // 30%: move a random note.
      const id = ensureNote();
      moveObject(doc, id, Math.floor(rand() * 2000), Math.floor(rand() * 2000));
    } else if (r < 0.8) {
      // 10%: create a note.
      createSticky(doc, { x: Math.floor(rand() * 1000), y: Math.floor(rand() * 1000) }, pickColor());
    } else if (r < 0.9) {
      // 10%: recolour a random note.
      const id = ensureNote();
      setStickyColor(doc, id, pickColor());
    } else {
      // 10%: delete a random note.
      const id = pickNoteId();
      if (id !== null) deleteObject(doc, id);
    }
  }
}
