/**
 * Seeded random board operations (design Fixtures): 40% typing real words, 30% moves,
 * 10% creates, 10% recolours, 10% deletes, all through the real board-model functions.
 * Log the seed of a failing run to replay it.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

const WORDS = [
  'pricing', 'onboarding', 'churn', 'roadmap', 'retro', 'customer', 'interview', 'launch', 'beta',
  'feedback', 'metrics', 'budget', 'hiring', 'design', 'research', 'risk', 'deadline', 'support',
];
const WORLD_SPAN = 2000;
const COLORS = Object.keys(STICKY_COLORS);

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OpLog {
  created: Set<string>;
  deleted: Set<string>;
}

function pick<T>(rand: () => number, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(rand() * items.length)];
}

function chooseKind(rand: () => number): OpKind {
  const r = rand();
  if (r < 0.4) return 'type';
  if (r < 0.7) return 'move';
  if (r < 0.8) return 'create';
  if (r < 0.9) return 'recolour';
  return 'delete';
}

/** Applies one random operation to `doc`; returns what was attempted. */
export function randomOp(doc: Y.Doc, rand: () => number, log: OpLog): OpKind {
  const notes = snapshot(doc);
  let kind = chooseKind(rand);
  if (notes.length === 0) kind = 'create';
  const note = pick(rand, notes);
  const coord = () => Math.round(rand() * WORLD_SPAN - WORLD_SPAN / 2);
  switch (kind) {
    case 'create': {
      const id = createSticky(doc, { x: coord(), y: coord() });
      if (id !== '') log.created.add(id);
      break;
    }
    case 'move':
      if (note) moveObject(doc, note.id, coord(), coord());
      break;
    case 'recolour':
      if (note) setStickyColor(doc, note.id, pick(rand, COLORS) ?? 'yellow');
      break;
    case 'delete':
      if (note && deleteObject(doc, note.id)) log.deleted.add(note.id);
      break;
    case 'type': {
      const text = note ? getStickyText(doc, note.id) : undefined;
      const word = `${pick(rand, WORDS) ?? 'idea'} `;
      if (text && text.length + word.length <= STICKY_TEXT_MAX_CHARS) {
        const at = Math.floor(rand() * (text.length + 1));
        doc.transact(() => text.insert(at, word), LOCAL_ORIGIN);
      }
      break;
    }
  }
  return kind;
}
