import * as Y from 'yjs';
import { createSticky, moveObject, setStickyColor, deleteObject, getStickyText } from '../../../src/shared/board-model.ts';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config.ts';

const WORDS = ['hello', 'world', 'foo', 'bar', 'baz', 'qux', 'test', 'idea', 'plan', 'note', 'draft', 'review', 'ship', 'deploy', 'fix'];

// Simple seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRandomOps(doc: Y.Doc, count: number, seed: number): void {
  const rand = mulberry32(seed);
  const notes: string[] = [];

  for (let i = 0; i < count; i++) {
    const action = rand();

    if (action < 0.4) {
      // 40%: text typing
      if (notes.length > 0) {
        const noteId = notes[Math.floor(rand() * notes.length)];
        const text = getStickyText(doc, noteId);
        if (text) {
          const word = WORDS[Math.floor(rand() * WORDS.length)];
          const pos = Math.floor(rand() * (text.length + 1));
          doc.transact(() => {
            text.insert(Math.min(pos, text.length), word + ' ');
          });
        }
      } else {
        // No notes yet, create one
        const id = createSticky(doc, { x: rand() * 400, y: rand() * 400 });
        if (id) notes.push(id);
      }
    } else if (action < 0.7) {
      // 30%: move
      if (notes.length > 0) {
        const noteId = notes[Math.floor(rand() * notes.length)];
        moveObject(doc, noteId, rand() * 500, rand() * 500);
      } else {
        const id = createSticky(doc, { x: rand() * 400, y: rand() * 400 });
        if (id) notes.push(id);
      }
    } else if (action < 0.8) {
      // 10%: create
      const id = createSticky(doc, { x: rand() * 400, y: rand() * 400 });
      if (id) notes.push(id);
    } else if (action < 0.9) {
      // 10%: recolour
      if (notes.length > 0) {
        const noteId = notes[Math.floor(rand() * notes.length)];
        const colors = Object.keys(STICKY_COLORS) as StickyColor[];
        const color = colors[Math.floor(rand() * colors.length)];
        setStickyColor(doc, noteId, color);
      }
    } else {
      // 10%: delete
      if (notes.length > 1) {
        const idx = Math.floor(rand() * notes.length);
        deleteObject(doc, notes[idx]);
        notes.splice(idx, 1);
      }
    }
  }
}
