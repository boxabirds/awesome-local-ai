// Story 3, task 6: deterministic random-operation fixture for convergence
// tests (TC-12). A seeded PRNG (mulberry32) drives a stream of board
// operations that are applied through the REAL board-model functions, so
// the fixture exercises the same code path the UI uses.
//
// The same seed produces the same operation *choices*; each client applies
// the stream to its own live doc (picking note ids from its own snapshot),
// so the sequences may diverge slightly while updates are in flight — that
// is exactly the concurrency the convergence test wants.

import {
  createStickyAt,
  deleteObject,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import type * as Y from 'yjs';

export const CONVERGENCE_SEED = 0x5eed_1234;
export const OPERATIONS_PER_CLIENT = 200;
export const CONCURRENT_CLIENTS = 5;

/** "Real" words that typing operations insert. */
export const SAMPLE_WORDS = [
  'idea',
  'ship',
  'beta',
  'launch',
  'budget',
  'roadmap',
  'sprint',
  'review',
  'draft',
  'focus',
  'async',
  'standup',
  'metric',
  'north',
  'star',
];

/** mulberry32: small, fast, deterministic PRNG. Returns [0, 1). */
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

export interface OpRecord {
  kind: 'type' | 'move' | 'create' | 'recolor' | 'delete';
  noteId?: string;
  /** note ids this client created (for the "exists unless deleted" check). */
  createdIds: string[];
  deletedIds: string[];
}

/**
 * Build an operation generator bound to one client's doc. Each call applies
 * one random operation through the board-model API and returns a record.
 * Distribution: 40% type, 30% move, 10% create, 10% recolor, 10% delete.
 */
export function makeOpGenerator(seed: number, doc: Y.Doc): () => OpRecord {
  const rnd = mulberry32(seed);
  const colorNames = Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[];

  const stickies = (): string[] => snapshot(doc).map((n) => n.id);
  const pick = (): string => stickies()[Math.floor(rnd() * stickies().length)];

  /**
   * Pick an existing sticky, or create one when the board is empty and
   * record it in `created` so the bookkeeping checks see EVERY note this
   * client ever created (side-effect creations included).
   */
  const ensureNote = (created: string[]): string => {
    if (stickies().length > 0) return pick();
    const id = createStickyAt(doc, 0, 0);
    created.push(id);
    return id;
  };

  return (): OpRecord => {
    const r = rnd();
    if (r < 0.4) {
      // Type a real word: insert at a random position in a random note's
      // text (create a note first when the board is empty).
      const created: string[] = [];
      const id = ensureNote(created);
      const text = getStickyText(doc, id);
      const word = SAMPLE_WORDS[Math.floor(rnd() * SAMPLE_WORDS.length)];
      const len = text!.length;
      const pos = len === 0 ? 0 : Math.floor(rnd() * (len + 1));
      const prefix = pos === 0 ? '' : ' ';
      // Real clients route every text change through a LOCAL_ORIGIN transact
      // (board-model contract); the WsClient send filter drops updates that
      // lack that origin, so the fixture must follow the same contract.
      doc.transact(() => text!.insert(pos, prefix + word), LOCAL_ORIGIN);
      return { kind: 'type', noteId: id, createdIds: created, deletedIds: [] };
    }
    if (r < 0.7) {
      // Move a random note to a random integer world position.
      const created: string[] = [];
      const id = ensureNote(created);
      const x = Math.round((rnd() - 0.5) * 4000);
      const y = Math.round((rnd() - 0.5) * 4000);
      moveObject(doc, id, x, y);
      return { kind: 'move', noteId: id, createdIds: created, deletedIds: [] };
    }
    if (r < 0.8) {
      // Create a note at a random position and colour.
      const x = Math.round((rnd() - 0.5) * 4000);
      const y = Math.round((rnd() - 0.5) * 4000);
      const color = colorNames[Math.floor(rnd() * colorNames.length)];
      const id = createStickyAt(doc, x, y, color);
      return { kind: 'create', noteId: id, createdIds: [id], deletedIds: [] };
    }
    if (r < 0.9) {
      // Recolour a random note.
      const created: string[] = [];
      const id = ensureNote(created);
      const color = colorNames[Math.floor(rnd() * colorNames.length)];
      setStickyColor(doc, id, color);
      return { kind: 'recolor', noteId: id, createdIds: created, deletedIds: [] };
    }
    // Delete a random note (create one first when the board is empty, so
    // the delete is never a no-op).
    const created: string[] = [];
    const id = ensureNote(created);
    const deleted = deleteObject(doc, id);
    return {
      kind: 'delete',
      noteId: id,
      createdIds: created,
      deletedIds: deleted ? [id] : [],
    };
  };
}
