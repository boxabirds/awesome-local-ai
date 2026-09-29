/**
 * Seeded random-operation generator for the integration soak test (TC-12).
 * Produces a realistic mix using the real board-model functions:
 *   40% text typing of real words, 30% moves, 10% creates, 10% recolours, 10% deletes.
 *
 * Determinism contract: when the SAME seed is applied on every client, every
 * client makes the SAME operations (same created ids, same target notes), so
 * the merged board converges to identical snapshots on all clients.
 */
import type * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from 'src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from 'src/shared/config';

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
  'pricing', 'growth', 'roadmap', 'launch', 'beta', 'alpha', 'metrics',
  'budget', 'users', 'retention', 'churn', 'onboarding', 'feedback', 'bugs',
  'performance', 'scalability', 'security', 'access', 'tokens', 'session',
  'login', 'signup', 'email', 'verify', 'invoice', 'refund', 'support',
  'docs', 'help', 'faq',
];

function pickWord(rng: () => number): string {
  return WORDS[Math.floor(rng() * WORDS.length)];
}

export interface RandomOp {
  kind: 'type' | 'move' | 'create' | 'recolor' | 'delete';
  id?: string;
}

/**
 * Runs `count` seeded random ops on `doc`. The `createCounter` starts at 0 so
 * that identically-seeded runs create identically-ided notes.
 */
export function randomOps(doc: Y.Doc, seed: number, count: number): void {
  const rng = mulberry32(seed);
  let createCounter = 0;

  // Pick a deterministic target note (by sorted id) so every client chooses
  // the same note for the same roll.
  const pickNote = (): string | undefined => {
    const ids = snapshot(doc).map((s) => s.id).sort();
    if (ids.length === 0) return undefined;
    return ids[Math.floor(rng() * ids.length)];
  };

  // Pick an existing note, or create one deterministically so every client
  // ends up operating on the same id.
  const ensureNote = (): string | null => {
    const existing = pickNote();
    if (existing !== undefined) return existing;
    return createSticky(doc, { x: 0, y: 0 }, undefined, `${seed}-c${createCounter++}`);
  };

  for (let i = 0; i < count; i++) {
    const roll = rng();

    if (roll < 0.4) {
      // Type a real word into a note (create one first if the board is empty).
      const id = ensureNote();
      if (id === null) continue;
      const text = getStickyText(doc, id);
      if (text) text.insert(text.length, ' ' + pickWord(rng));
    } else if (roll < 0.7) {
      // Move a note (create one first if the board is empty).
      const id = ensureNote();
      if (id === null) continue;
      moveObject(doc, id, Math.floor(rng() * 600) - 300, Math.floor(rng() * 600) - 300);
    } else if (roll < 0.8) {
      // Create a note with a deterministic id.
      createSticky(
        doc,
        { x: Math.floor(rng() * 600) - 300, y: Math.floor(rng() * 600) - 300 },
        undefined,
        `${seed}-c${createCounter++}`,
      );
    } else if (roll < 0.9) {
      // Recolour a note (create one first if the board is empty).
      const id = ensureNote();
      if (id === null) continue;
      const colors = Object.keys(STICKY_COLORS) as StickyColor[];
      setStickyColor(doc, id, colors[Math.floor(rng() * colors.length)]);
    } else {
      // Delete a note (create one first if the board is empty).
      const id = ensureNote();
      if (id === null) continue;
      deleteObject(doc, id);
    }
  }
}
