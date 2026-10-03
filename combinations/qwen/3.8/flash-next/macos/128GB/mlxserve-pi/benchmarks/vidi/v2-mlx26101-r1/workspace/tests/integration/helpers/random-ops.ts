// Seeded random board operations for the convergence tests. The mix follows the
// story's fixture spec — 40% typing real words, 30% moves, 10% creates, 10%
// recolours, 10% deletes — and every operation goes through the real
// board-model functions, so the document the room merges is exactly what a
// person editing in the browser would produce.

import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';
import { applyTextDiff, clampToLimit } from '../../../src/client/objects/StickyText';
import { RANDOM_WORDS } from '../../fixtures/texts';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic PRNG (mulberry32): same seed, same board, every run. */
export interface Random {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** One element of `items`. */
  pick<T>(items: readonly T[]): T;
  /** The seed this generator started from (log it when a run fails). */
  readonly seed: number;
}

export function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    seed,
    pick<T>(items: readonly T[]): T {
      return items[int(items.length)] as T;
    },
  };
}

/** One operation that was applied to a document. */
export interface AppliedOp {
  kind: 'create' | 'move' | 'color' | 'text' | 'front' | 'delete';
  noteId: string;
  /** Short human-readable description, used in failure messages. */
  detail: string;
}

/**
 * Apply `count` random operations to `doc`, tracking the live note ids in
 * `notes` (mutated in place). Returns the operations that actually changed the
 * document, so a test can say "every change of this list shows up for everybody".
 */
export function applyRandomOps(
  doc: Y.Doc,
  random: Random,
  count: number,
  notes: string[] = [],
): AppliedOp[] {
  const applied: AppliedOp[] = [];
  const alive = (): string[] => notes.filter((id) => getStickyText(doc, id) !== undefined);

  for (let i = 0; i < count; i++) {
    const live = alive();
    // Nothing to work with yet: a create is the only sensible operation.
    const roll = live.length === 0 ? 0 : random.next();

    if (roll < 0.1) {
      // 10% creates
      const id = createSticky(
        doc,
        { x: random.int(4000) - 2000, y: random.int(4000) - 2000 },
        random.pick(COLOR_NAMES),
      );
      if (id !== '') {
        notes.push(id);
        applied.push({ kind: 'create', noteId: id, detail: 'created a note' });
      }
      continue;
    }

    const id = random.pick(live);

    if (roll < 0.5) {
      // 40% typing real words
      const text = getStickyText(doc, id);
      if (!text) continue;
      const word = random.pick(RANDOM_WORDS);
      const previous = text.toString();
      const next = previous.length === 0 ? word : `${previous} ${word}`;
      applyTextDiff(text, clampToLimit(next), LOCAL_ORIGIN);
      applied.push({ kind: 'text', noteId: id, detail: `typed "${word}"` });
      continue;
    }

    if (roll < 0.8) {
      // 30% moves
      const x = random.int(4000) - 2000;
      const y = random.int(4000) - 2000;
      if (moveObject(doc, id, x, y)) {
        applied.push({ kind: 'move', noteId: id, detail: `moved to ${x},${y}` });
      }
      continue;
    }

    if (roll < 0.9) {
      // 10% recolours
      const color = random.pick(COLOR_NAMES);
      if (setStickyColor(doc, id, color)) {
        applied.push({ kind: 'color', noteId: id, detail: `recoloured ${color}` });
      }
      continue;
    }

    // 10% deletes
    if (deleteObject(doc, id)) {
      applied.push({ kind: 'delete', noteId: id, detail: 'deleted the note' });
    }
  }
  return applied;
}

/** Bring a random note to the front (used to check z ordering converges). */
export function randomBringToFront(doc: Y.Doc, random: Random): AppliedOp | null {
  const map = doc.getMap<Y.Map<unknown>>('objects');
  const ids: string[] = [];
  map.forEach((value, id) => {
    if (value.get('type') === 'sticky') ids.push(id);
  });
  if (ids.length === 0) return null;
  const id = random.pick(ids)!;
  return bringToFront(doc, id) ? { kind: 'front', noteId: id, detail: 'raised a note' } : null;
}

/**
 * Seed `count` notes onto a board deterministically (TC-12's "200 seeded random
 * ops" starts from a shared base so all clients have common ground to edit).
 */
export function seedNotes(doc: Y.Doc, random: Random, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = createSticky(
      doc,
      { x: random.int(2000) - 1000, y: random.int(2000) - 1000 },
      random.pick(COLOR_NAMES),
    );
    if (id !== '') ids.push(id);
  }
  return ids;
}
