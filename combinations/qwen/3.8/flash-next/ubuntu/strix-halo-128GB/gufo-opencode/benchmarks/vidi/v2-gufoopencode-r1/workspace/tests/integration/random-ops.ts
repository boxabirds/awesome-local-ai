import type * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor
} from '../../src/shared/board-model';

// Small seeded PRNG (mulberry32) so a failure can be reproduced by logging
// the seed printed by the test.
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

const WORDS = ['red', 'blue', 'green', 'note', 'draft', 'ship', 'sync', 'board', 'idea', 'fix'];
const COLORS = ['yellow', 'pink', 'violet', 'blue', 'green', 'orange'];

// Distribution per the task: ~40% typing, 30% moves, 10% creates,
// 10% recolours, 10% deletes. `notes` tracks ids this client created so
// deletes/moves have something to act on; acting on a note another peer
// already deleted is a no-op the board-model returns false for.
export function applyRandomOp(
  doc: Y.Doc,
  notes: string[],
  random: () => number
): void {
  const roll = random();
  const pick = <T,>(list: readonly T[]): T | undefined =>
    list.length === 0 ? undefined : list[Math.floor(random() * list.length)];
  if (roll < 0.4) {
    const id = pick(notes);
    if (id === undefined) return;
    const text = getStickyText(doc, id);
    if (text === undefined) return;
    const word = WORDS[Math.floor(random() * WORDS.length)];
    const at = Math.floor(random() * (text.length + 1));
    text.insert(at, word + (random() < 0.5 ? ' ' : ''));
  } else if (roll < 0.7) {
    const id = pick(notes);
    if (id === undefined) return;
    moveObject(doc, id, Math.round(random() * 2000) - 500, Math.round(random() * 2000) - 500);
  } else if (roll < 0.8) {
    const id = createSticky(doc, { x: Math.round(random() * 1200) - 300, y: Math.round(random() * 900) - 200 });
    if (typeof id === 'string') notes.push(id);
  } else if (roll < 0.9) {
    const id = pick(notes);
    if (id === undefined) return;
    setStickyColor(doc, id, COLORS[Math.floor(random() * COLORS.length)]);
  } else {
    const id = pick(notes);
    if (id === undefined) return;
    deleteObject(doc, id);
  }
}
