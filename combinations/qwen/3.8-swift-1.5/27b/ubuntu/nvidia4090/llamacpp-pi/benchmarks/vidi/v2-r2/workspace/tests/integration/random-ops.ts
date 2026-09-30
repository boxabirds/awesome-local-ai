import * as Y from 'yjs';
import { createSticky, moveObject, setStickyColor, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';

/** Simple seeded PRNG (mulberry32) */
function mulberry32(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['hello', 'world', 'foo', 'bar', 'baz', 'qux', 'test', 'note', 'idea', 'plan'];
const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;

export interface RandomOpsResult {
  seed: number;
  opsPerformed: number;
}

/**
 * Performs `count` random operations on the given doc using a seeded PRNG.
 * Distribution: 40% typing, 30% moves, 10% creates, 10% recolours, 10% deletes.
 */
export function performRandomOps(doc: Y.Doc, count: number, seed: number): RandomOpsResult {
  const rng = mulberry32(seed);
  let opsPerformed = 0;

  for (let i = 0; i < count; i++) {
    const r = rng();
    const notes = snapshot(doc);

    if (r < 0.4) {
      // 40%: typing
      if (notes.length > 0) {
        const note = notes[Math.floor(rng() * notes.length)];
        const text = getStickyText(doc, note.id);
        if (text) {
          const word = WORDS[Math.floor(rng() * WORDS.length)];
          text.insert(text.length, word + ' ');
          opsPerformed++;
        }
      }
    } else if (r < 0.7) {
      // 30%: moves
      if (notes.length > 0) {
        const note = notes[Math.floor(rng() * notes.length)];
        const x = Math.floor(rng() * 1000);
        const y = Math.floor(rng() * 1000);
        moveObject(doc, note.id, x, y);
        opsPerformed++;
      }
    } else if (r < 0.8) {
      // 10%: creates
      const x = Math.floor(rng() * 1000);
      const y = Math.floor(rng() * 1000);
      createSticky(doc, { x, y });
      opsPerformed++;
    } else if (r < 0.9) {
      // 10%: recolours
      if (notes.length > 0) {
        const note = notes[Math.floor(rng() * notes.length)];
        const color = COLORS[Math.floor(rng() * COLORS.length)];
        setStickyColor(doc, note.id, color);
        opsPerformed++;
      }
    } else {
      // 10%: deletes
      if (notes.length > 1) {
        const note = notes[Math.floor(rng() * notes.length)];
        deleteObject(doc, note.id);
        opsPerformed++;
      }
    }
  }

  return { seed, opsPerformed };
}
