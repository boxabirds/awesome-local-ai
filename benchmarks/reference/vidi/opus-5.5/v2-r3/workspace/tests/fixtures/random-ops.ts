// Seeded random board operations (design "Fixtures"): 40% typing real words,
// 30% moves, 10% creates, 10% recolours, 10% deletes, applied through the real
// board-model functions. Seeds are logged by callers so failures can be replayed.
import type * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getObjectsMap,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';

export const WORDS = [
  'pricing', 'onboarding', 'roadmap', 'retro', 'customer', 'churn', 'launch', 'survey',
  'interview', 'backlog', 'metrics', 'invoice', 'feedback', 'budget', 'hiring', 'design',
  'sprint', 'demo', 'partner', 'support',
] as const;

const COLORS = Object.keys(STICKY_COLORS);
const WORLD_EXTENT = 2000;

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

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

export function pickKind(r: number): OpKind {
  if (r < 0.4) return 'type';
  if (r < 0.7) return 'move';
  if (r < 0.8) return 'create';
  if (r < 0.9) return 'recolour';
  return 'delete';
}

export interface OpLog {
  created: string[];
  deleted: string[];
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** Applies one random operation to `doc`; with no notes present every op creates one. */
export function applyRandomOp(doc: Y.Doc, rand: () => number, log: OpLog): OpKind {
  const ids = Array.from(getObjectsMap(doc).keys()).sort();
  const kind: OpKind = ids.length === 0 ? 'create' : pickKind(rand());
  const coord = () => Math.round((rand() - 0.5) * WORLD_EXTENT);
  switch (kind) {
    case 'create': {
      const id = createSticky(doc, { x: coord(), y: coord() });
      log.created.push(id);
      break;
    }
    case 'type': {
      const text = getStickyText(doc, pick(rand, ids));
      if (text) text.insert(Math.floor(rand() * (text.length + 1)), `${pick(rand, WORDS)} `);
      break;
    }
    case 'move':
      moveObject(doc, pick(rand, ids), coord(), coord());
      break;
    case 'recolour':
      setStickyColor(doc, pick(rand, ids), pick(rand, COLORS));
      break;
    case 'delete': {
      const id = pick(rand, ids);
      deleteObject(doc, id);
      log.deleted.push(id);
      break;
    }
  }
  return kind;
}
