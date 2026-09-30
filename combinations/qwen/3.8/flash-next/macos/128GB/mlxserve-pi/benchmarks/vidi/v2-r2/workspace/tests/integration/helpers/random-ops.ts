// A seeded generator of realistic board edits, used by the convergence test
// (TC-12). Every op goes through the real board-model mutators, so the room sees
// exactly the transactions a browser would produce. The seed makes the sequence
// reproducible; the assertion is that Yjs merges the interleaving to one state.

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

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

// Real English words, matching the fixtures' "prose, not single characters".
const WORDS = [
  'board', 'idea', 'note', 'colour', 'merge', 'together', 'remote',
  'update', 'sticky', 'layout', 'converge', 'editor', 'room', 'live',
  'position', 'delete', 'insert', 'crdt', 'sync', 'yellow',
];

/** mulberry32: a tiny deterministic PRNG returning floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T | undefined {
  return list.length === 0 ? undefined : list[Math.floor(rng() * list.length)];
}

/**
 * Apply one random op: ~40% typing, 30% moves, 10% creates, 10% recolours,
 * 10% deletes. Returns a short label for logging.
 */
export function applyRandomOp(doc: Y.Doc, rng: () => number): string {
  const roll = rng();
  const notes = snapshot(doc);
  const target = pick(rng, notes);

  if (roll < 0.4) {
    // typing (needs a note; create one if the board is empty)
    if (target === undefined) {
      createSticky(doc, { x: spot(rng), y: spot(rng) });
      return 'create->typing';
    }
    const text = getStickyText(doc, target.id);
    if (text === undefined) return 'noop';
    const at = Math.floor(rng() * (text.length + 1));
    const word = pick(rng, WORDS)!;
    text.insert(at, (at === 0 ? '' : ' ') + word);
    return `type ${target.id}@${at}:${word}`;
  }

  if (roll < 0.7) {
    if (target === undefined) {
      createSticky(doc, { x: spot(rng), y: spot(rng) });
      return 'create->move';
    }
    moveObject(doc, target.id, spot(rng), spot(rng));
    return `move ${target.id}`;
  }

  if (roll < 0.8) {
    createSticky(doc, { x: spot(rng), y: spot(rng) });
    return 'create';
  }

  if (roll < 0.9) {
    if (target === undefined) {
      createSticky(doc, { x: spot(rng), y: spot(rng) });
      return 'create->recolour';
    }
    setStickyColor(doc, target.id, pick(rng, COLOR_KEYS)!);
    return `recolour ${target.id}`;
  }

  if (target === undefined) {
    createSticky(doc, { x: spot(rng), y: spot(rng) });
    return 'create->delete';
  }
  deleteObject(doc, target.id);
  return `delete ${target.id}`;
}

function spot(rng: () => number): number {
  return Math.round(rng() * 1000);
}
