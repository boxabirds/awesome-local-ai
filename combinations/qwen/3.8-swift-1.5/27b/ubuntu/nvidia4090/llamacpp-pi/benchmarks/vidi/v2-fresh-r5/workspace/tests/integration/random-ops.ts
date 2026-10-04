/**
 * Seeded random board operations for TC-12 (convergence soak).
 *
 * Distribution per op: 40% typing real words, 30% moves, 10% creates,
 * 10% recolours, 10% deletes — all through the real board-model functions
 * so the ops are exactly what the client app would produce.
 */
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLORS: StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[];

const WORDS = [
  'hello', 'world', 'idea', 'plan', 'sync', 'board', 'note', 'test',
  'live', 'edit', 'crdt', 'merge', 'room', 'sticky', 'canvas', 'draft',
];

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Apply one random op to `doc` (using its current local snapshot) and
 * return a short description (for logging). Never throws: ops that need a
 * note fall back to creating one when the board is empty.
 */
export function randomOp(doc: Y.Doc, rng: () => number): string {
  const r = rng();
  const notes: readonly StickySnapshot[] = snapshot(doc);

  if (r < 0.4) {
    // 40%: type a real word into a note's text
    const target = notes.length > 0 ? pick(rng, notes) : undefined;
    const id = target?.id ?? createSticky(doc, { x: Math.floor(rng() * 400), y: Math.floor(rng() * 400) });
    const text = getStickyText(doc, id);
    if (!text) return `type:${id}:no-text`;
    const word = pick(rng, WORDS);
    text.insert(text.length, word + ' ');
    return `type:${id}`;
  }

  if (r < 0.7) {
    // 30%: move a note
    const target = notes.length > 0 ? pick(rng, notes) : undefined;
    const id = target?.id ?? createSticky(doc, { x: Math.floor(rng() * 400), y: Math.floor(rng() * 400) });
    moveObject(doc, id, Math.floor(rng() * 400), Math.floor(rng() * 400));
    return `move:${id}`;
  }

  if (r < 0.8) {
    // 10%: create a note
    const id = createSticky(doc, { x: Math.floor(rng() * 400), y: Math.floor(rng() * 400) });
    return `create:${id}`;
  }

  if (r < 0.9) {
    // 10%: recolour a note
    if (notes.length === 0) return 'recolor:empty';
    const id = pick(rng, notes).id;
    setStickyColor(doc, id, pick(rng, COLORS));
    return `recolor:${id}`;
  }

  // 10%: delete a note (keep at least one so typing has a target)
  if (notes.length <= 1) return 'delete:too-few';
  const id = pick(rng, notes).id;
  deleteObject(doc, id);
  return `delete:${id}`;
}
