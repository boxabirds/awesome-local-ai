// Seeded random board operations using the real board-model functions.
// Mix: 40% typing real words, 30% moves, 10% creates, 10% recolours, 10% deletes.
import type * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';

const WORDS = [
  'pricing', 'onboarding', 'churn', 'roadmap', 'customer', 'interview', 'launch', 'retention',
  'feedback', 'metrics', 'budget', 'hiring', 'design', 'research', 'backlog', 'sprint',
];
const COLORS = Object.keys(STICKY_COLORS);

/** Deterministic PRNG (mulberry32). */
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

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

export function pickOp(rand: () => number): OpKind {
  const r = rand();
  if (r < 0.4) return 'type';
  if (r < 0.7) return 'move';
  if (r < 0.8) return 'create';
  if (r < 0.9) return 'recolour';
  return 'delete';
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** Applies one random operation to `doc`; creates a note when there is nothing to change. */
export function randomOp(doc: Y.Doc, rand: () => number): OpKind {
  const notes = snapshot(doc);
  let kind = pickOp(rand);
  if (notes.length === 0) kind = 'create';
  const coord = () => Math.round((rand() - 0.5) * 4000);
  if (kind === 'create') {
    createSticky(doc, { x: coord(), y: coord() });
    return kind;
  }
  const note = pick(rand, notes);
  switch (kind) {
    case 'type': {
      const text = getStickyText(doc, note.id)!;
      const at = Math.floor(rand() * (text.length + 1));
      text.insert(at, `${pick(rand, WORDS)} `);
      break;
    }
    case 'move':
      moveObject(doc, note.id, coord(), coord());
      break;
    case 'recolour':
      setStickyColor(doc, note.id, pick(rand, COLORS));
      break;
    case 'delete':
      deleteObject(doc, note.id);
      break;
  }
  return kind;
}
